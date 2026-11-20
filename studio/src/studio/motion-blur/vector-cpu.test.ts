// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { linearToSrgb, srgbToLinear } from './stage'
import {
  cpuFlow,
  cpuPicture,
  cpuVectorBlur,
  cpuVelocity,
  type CpuGap,
  type CpuPicture,
} from './vector-cpu.fixture'

/** A smooth grey texture, code values 0.2..0.8 (the flow golden's pattern) */
function pattern(x: number, y: number): number {
  return (
    0.5 +
    0.15 * Math.sin((2 * Math.PI * x) / 23 + 0.3) * Math.sin((2 * Math.PI * y) / 17 + 1.1) +
    0.1 * Math.sin((2 * Math.PI * (x + 0.6 * y)) / 31) +
    0.05 * Math.cos((2 * Math.PI * (0.4 * x - y)) / 13)
  )
}

/** The pattern as a picture: pixel (x, y) holds the pattern at its centre */
const patternPicture = (width: number, height: number) =>
  cpuPicture(width, height, (x, y) => {
    const v = pattern(x + 0.5, y + 0.5)
    return [v, v, v, 1]
  })

/** A gap whose flows are uniform: `forward` (frame pixels per source frame) and its exact opposite back */
function uniformGap(frameW: number, frameH: number, flowW: number, flowH: number, forward: readonly [number, number]): CpuGap {
  const sx = frameW / flowW
  const sy = frameH / flowH
  return {
    forward: cpuFlow(flowW, flowH, () => [forward[0] / sx, forward[1] / sy]),
    backward: cpuFlow(flowW, flowH, () => [-forward[0] / sx, -forward[1] / sy]),
  }
}

/** The mean over a segment from `a` to `b` of the pattern in linear light, as code values (dense quadrature) */
function segmentMean(a: readonly [number, number], b: readonly [number, number], samples = 400): number {
  let sum = 0
  for (let k = 0; k < samples; k++) {
    const t = (k + 0.5) / samples
    sum += srgbToLinear(pattern(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
  }
  return sum / samples
}

/** Mean and largest absolute difference of channel 0 against `expected(x, y)` over the interior */
function errors(picture: CpuPicture, expected: (x: number, y: number) => number, border: number) {
  let sum = 0
  let worst = 0
  let count = 0
  for (let y = border; y < picture.height - border; y++) {
    for (let x = border; x < picture.width - border; x++) {
      const d = Math.abs(picture.data[(y * picture.width + x) * 4]! - expected(x, y))
      sum += d
      worst = Math.max(worst, d)
      count++
    }
  }
  return { mean: sum / count, worst }
}

const W = 64
const H = 48
const FW = 16
const FH = 12

describe('the vector blur (design 9.2), CPU twin', () => {
  it('passes a still picture through as it is', () => {
    const picture = patternPicture(W, H)
    const still = uniformGap(W, H, FW, FH, [0, 0])
    const out = cpuVectorBlur(picture, cpuVelocity(picture, still, still), 0.5)
    expect(Array.from(out.data)).toEqual(Array.from(picture.data))
  })

  it('averages uniform motion along its line, centred on the frame: 180 degrees of 6 px right and 2 down', () => {
    const picture = patternPicture(W, H)
    const gap = uniformGap(W, H, FW, FH, [6, 2])
    const out = cpuVectorBlur(picture, cpuVelocity(picture, gap, gap), 0.5)
    // a quarter of the motion before the frame's time and a quarter after
    const expected = (x: number, y: number) =>
      linearToSrgb(segmentMean([x + 0.5 - 1.5, y + 0.5 - 0.5], [x + 0.5 + 1.5, y + 0.5 + 0.5]))
    const blurred = errors(out, expected, 8)
    const sharp = errors(picture, expected, 8)
    // what is left is the picture's own pixel grid (the pattern sampled at pixel centres, read back bilinearly)
    expect(blurred.mean).toBeLessThan(0.0015)
    expect(blurred.worst).toBeLessThan(0.006)
    expect(blurred.mean).toBeLessThan(0.5 * sharp.mean)
  })

  it('blurs over the whole interval at 360 degrees, twice the line of 180', () => {
    const picture = patternPicture(W, H)
    const gap = uniformGap(W, H, FW, FH, [6, 2])
    const out = cpuVectorBlur(picture, cpuVelocity(picture, gap, gap), 1)
    const expected = (x: number, y: number) =>
      linearToSrgb(segmentMean([x + 0.5 - 3, y + 0.5 - 1], [x + 0.5 + 3, y + 0.5 + 1]))
    expect(errors(out, expected, 8).mean).toBeLessThan(0.0015)
    expect(errors(out, expected, 8).mean).toBeLessThan(0.25 * errors(picture, expected, 8).mean)
  })

  it('follows a bend: the earlier half along the motion to the previous frame, the later half to the next', () => {
    const picture = patternPicture(W, H)
    // came from below (B points down: towards where it was), goes right
    const before = uniformGap(W, H, FW, FH, [0, -8])
    const after = uniformGap(W, H, FW, FH, [8, 0])
    const velocity = cpuVelocity(picture, before, after)
    expect(Array.from(velocity.data.subarray(0, 4)).map((v) => v + 0)).toEqual([8, 0, 0, 8])
    const out = cpuVectorBlur(picture, velocity, 1)
    // later half: X - t F for t in [0, 0.5]; earlier half: X - t B
    const expected = (x: number, y: number) => {
      const X: [number, number] = [x + 0.5, y + 0.5]
      const later = segmentMean(X, [X[0] - 4, X[1]])
      const earlier = segmentMean(X, [X[0], X[1] - 4])
      return linearToSrgb((later + earlier) / 2)
    }
    expect(errors(out, expected, 8).mean).toBeLessThan(0.0015)
  })

  it('trusts the side whose round trip holds: an occluded gap after takes the gap before, negated', () => {
    const picture = patternPicture(W, H)
    const before = uniformGap(W, H, FW, FH, [5, 0])
    const broken: CpuGap = {
      forward: cpuFlow(FW, FH, () => [10 / 4, 0]),
      backward: cpuFlow(FW, FH, () => [10 / 4, 0]),
    }
    const velocity = cpuVelocity(picture, before, broken)
    const [fx, fy, bx, by] = Array.from(velocity.data.subarray(0, 4))
    expect(fx).toBeCloseTo(5, 6)
    expect(fy).toBeCloseTo(0, 6)
    expect(bx).toBeCloseTo(-5, 6)
    expect(by).toBeCloseTo(0, 6)
  })

  it('uses the one gap there is at the file’s ends', () => {
    const picture = patternPicture(W, H)
    const gap = uniformGap(W, H, FW, FH, [4, -2])
    const first = Array.from(cpuVelocity(picture, undefined, gap).data.subarray(0, 4))
    const last = Array.from(cpuVelocity(picture, gap, undefined).data.subarray(0, 4))
    for (const [index, want] of [4, -2, -4, 2].entries()) {
      expect(first[index]).toBeCloseTo(want, 9)
      expect(last[index]).toBeCloseTo(want, 9)
    }
  })

  describe('a fast square over a still background', () => {
    const SW = 96
    const SH = 64
    // frame pixels [40, 56) x [24, 40) move 16 px right a frame; the flow is at a quarter (24 x 16)
    const inSquare = (x: number, y: number) => x >= 40 && x < 56 && y >= 24 && y < 40
    const background = (x: number, y: number) => 0.25 + 0.05 * Math.sin(x / 3) * Math.cos(y / 4)
    const picture = cpuPicture(SW, SH, (x, y) => {
      const v = inSquare(x, y) ? 1 : background(x, y)
      return [v, v, v, 1]
    })
    const squareFlow = (fx: number, fy: number) => inSquare(fx * 4 + 2, fy * 4 + 2)
    const gap: CpuGap = {
      forward: cpuFlow(24, 16, (x, y) => (squareFlow(x, y) ? [4, 0] : [0, 0])),
      backward: cpuFlow(24, 16, (x, y) => (squareFlow(x, y) ? [-4, 0] : [0, 0])),
    }
    const velocity = cpuVelocity(picture, gap, gap)
    const level = (p: CpuPicture, x: number, y: number) => p.data[(y * SW + x) * 4]!

    it('spreads its smear past its leading and trailing edges for the time it covers them', () => {
      const out = cpuVectorBlur(picture, velocity, 1)
      for (const x of [57, 58, 60]) {
        // the square's right edge sweeps from 48 to 64 over the shutter: a point d px past 56 is covered (8 - d) / 16
        const d = x + 0.5 - 56
        const cover = (8 - d) / 16
        const light = (1 - cover) * srgbToLinear(background(x, 32)) + cover * srgbToLinear(1)
        expect(level(out, x, 32)).toBeCloseTo(linearToSrgb(light), 1)
        expect(level(out, x, 32)).toBeGreaterThan(background(x, 32) + 0.1)
      }
      expect(level(out, 37, 32)).toBeGreaterThan(background(37, 32) + 0.1)
    })

    it('leaves the background far from it alone, and leaves the edges hard without the foreground term', () => {
      const out = cpuVectorBlur(picture, velocity, 1)
      const plain = cpuVectorBlur(picture, velocity, 1, { edges: false })
      for (const x of [5, 80, 90]) expect(level(out, x, 32)).toBe(background(x, 32))
      expect(level(plain, 58, 32)).toBe(background(58, 32))
    })
  })

  it('adds no foreground term along a smooth change of speed (receding ground)', () => {
    const picture = patternPicture(W, H)
    // the motion grows from 0 to 12 px a frame across the frame, smoothly
    const gap: CpuGap = {
      forward: cpuFlow(FW, FH, (x) => [((12 * (x + 0.5)) / FW) / 4, 0]),
      backward: cpuFlow(FW, FH, (x) => [-((12 * (x + 0.5)) / FW) / 4, 0]),
    }
    const velocity = cpuVelocity(picture, gap, gap)
    const withEdges = cpuVectorBlur(picture, velocity, 1)
    const without = cpuVectorBlur(picture, velocity, 1, { edges: false })
    let worst = 0
    for (let i = 0; i < withEdges.data.length; i++) worst = Math.max(worst, Math.abs(withEdges.data[i]! - without.data[i]!))
    expect(worst).toBeLessThan(1e-9)
  })
})
