// The optical flow's arithmetic, on the CPU twin of its kernels (`cpu-reference.fixture.ts`): a pattern moved by a
// known amount between two frames gives that amount back as the flow, and the frame interpolated between them is the
// pattern moved halfway, much closer to it than the blend of the two frames is.

import { describe, expect, it } from 'vite-plus/test'
import { interpolateFrame, measureGap, type Field, type GapFields, type Picture } from './cpu-reference.fixture'
import { flowSizeFor } from './scale'

const WIDTH = 192
const HEIGHT = 128

/** A smooth, textured grey pattern (code values 0.2..0.8) defined everywhere, so a moved copy is exact at any shift */
function pattern(x: number, y: number): number {
  return (
    0.5 +
    0.15 * Math.sin((2 * Math.PI * x) / 23 + 0.3) * Math.sin((2 * Math.PI * y) / 17 + 1.1) +
    0.1 * Math.sin((2 * Math.PI * (x + 0.6 * y)) / 31) +
    0.05 * Math.cos((2 * Math.PI * (0.4 * x - y)) / 13)
  )
}

/** The pattern moved right by `dx` and down by `dy`: what was at (x, y) is at (x + dx, y + dy) */
function moved(dx: number, dy: number, width = WIDTH, height = HEIGHT): Picture {
  const data = new Float64Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pattern(x - dx, y - dy)
      data.set([value, value, value, 1], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

/** The median of a flow's x and y over its pixels at least `margin` from every edge */
function medianFlow(flow: Field, margin: number): [number, number] {
  const xs: number[] = []
  const ys: number[] = []
  for (let y = margin; y < flow.height - margin; y += 1) {
    for (let x = margin; x < flow.width - margin; x += 1) {
      xs.push(flow.data[(y * flow.width + x) * 2]!)
      ys.push(flow.data[(y * flow.width + x) * 2 + 1]!)
    }
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!
  return [median(xs), median(ys)]
}

/** The mean absolute difference of the red channel over the pixels at least `margin` from every edge */
function meanError(a: Picture, b: Picture, margin: number): number {
  let sum = 0
  let count = 0
  for (let y = margin; y < a.height - margin; y += 1) {
    for (let x = margin; x < a.width - margin; x += 1) {
      sum += Math.abs(a.data[(y * a.width + x) * 4]! - b.data[(y * a.width + x) * 4]!)
      count += 1
    }
  }
  return sum / count
}

/** The plain blend of two frames at phase t, code values */
function blendOf(a: Picture, b: Picture, t: number): Picture {
  return { width: a.width, height: a.height, data: a.data.map((value, i) => (1 - t) * value + t * b.data[i]!) }
}

/** A flow of one constant vector (pixels of the flow's size) */
function constantField(width: number, height: number, x: number, y: number): Field {
  const data = new Float64Array(width * height * 2)
  for (let i = 0; i < width * height; i += 1) data.set([x, y], i * 2)
  return { width, height, data }
}

describe('the optical flow on a moved pattern', () => {
  const dx = 5
  const dy = -3
  const first = moved(0, 0)
  const second = moved(dx, dy)
  const gap = measureGap(first, second)
  const { width: fw } = flowSizeFor(first)
  const scale = WIDTH / fw

  it('measures the move both ways, in pixels of the flow (half the frame here)', () => {
    expect(scale).toBe(2)
    const [fx, fy] = medianFlow(gap.forward, 8)
    const [bx, by] = medianFlow(gap.backward, 8)
    expect(fx).toBeCloseTo(dx / scale, 1)
    expect(fy).toBeCloseTo(dy / scale, 1)
    expect(bx).toBeCloseTo(-dx / scale, 1)
    expect(by).toBeCloseTo(-dy / scale, 1)
  })

  it('makes the frame halfway the pattern moved halfway, far closer than the blend', () => {
    const truth = moved(dx / 2, dy / 2)
    const flow = meanError(interpolateFrame(first, second, gap, 0.5), truth, 12)
    const blend = meanError(blendOf(first, second, 0.5), truth, 12)
    expect(flow).toBeLessThan(0.004)
    expect(flow).toBeLessThan(blend / 8)
  })

  it('holds at any phase: a quarter and three quarters of the way', () => {
    for (const t of [0.25, 0.75]) {
      const truth = moved(dx * t, dy * t)
      const flow = meanError(interpolateFrame(first, second, gap, t), truth, 12)
      const blend = meanError(blendOf(first, second, t), truth, 12)
      expect(flow).toBeLessThan(0.004)
      expect(flow).toBeLessThan(blend / 6)
    }
  })
})

describe('the interpolation', () => {
  const first = moved(0, 0, 64, 48)
  const second = moved(2, 0, 64, 48)
  const fw = 32
  const fh = 24

  it('gives the frame itself between two equal frames, and at rest', () => {
    const still: GapFields = { forward: constantField(fw, fh, 0, 0), backward: constantField(fw, fh, 0, 0) }
    const out = interpolateFrame(first, first, still, 0.4)
    for (let i = 0; i < out.data.length; i += 1) expect(out.data[i]).toBeCloseTo(first.data[i]!, 12)
  })

  it('falls back to the blend where the two flows disagree (the round trip misses by far more than 2 px)', () => {
    // Both flows point the same way: following one there and the other back lands 2 x 5 x 2 = 20 frame pixels off
    const broken: GapFields = { forward: constantField(fw, fh, 5, 0), backward: constantField(fw, fh, 5, 0) }
    const out = interpolateFrame(first, second, broken, 0.5)
    const blend = blendOf(first, second, 0.5)
    for (let i = 0; i < out.data.length; i += 1) expect(out.data[i]).toBeCloseTo(blend.data[i]!, 9)
  })

  it('moves each frame along a known, consistent flow to the halfway point', () => {
    // 2 frame pixels to the right, both ways consistent: 1 flow pixel forward, -1 backward
    const exact: GapFields = { forward: constantField(fw, fh, 1, 0), backward: constantField(fw, fh, -1, 0) }
    const out = interpolateFrame(first, second, exact, 0.5)
    expect(meanError(out, moved(1, 0, 64, 48), 4)).toBeLessThan(0.002)
  })
})
