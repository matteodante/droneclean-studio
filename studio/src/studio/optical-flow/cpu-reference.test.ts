// The optical flow's arithmetic, on the CPU twin of its kernels (`cpu-reference.fixture.ts`): a pattern moved by a
// known amount between two frames gives that amount back as the flow, and the frame interpolated between them is the
// pattern moved halfway, much closer to it than the blend of the two frames is. Design 11.24: the frame is made by a
// forward warp, so where one layer covers another each output pixel takes the layer that is really there and the frame
// that sees it; where neither frame is trusted the two moved samples are mixed (never the unmoved frames); and the
// frames are sampled bicubically, sharper than bilinear sampling and with no ringing beside an edge.

import { describe, expect, it } from 'vite-plus/test'
import {
  interpolateFrame,
  measureGap,
  mixSamples,
  sampleBicubic,
  type Field,
  type GapFields,
  type Picture,
} from './cpu-reference.fixture'
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

  it('moves each frame along a known, consistent flow to the halfway point', () => {
    // 2 frame pixels to the right, both ways consistent: 1 flow pixel forward, -1 backward
    const exact: GapFields = { forward: constantField(fw, fh, 1, 0), backward: constantField(fw, fh, -1, 0) }
    const out = interpolateFrame(first, second, exact, 0.5)
    expect(meanError(out, moved(1, 0, 64, 48), 4)).toBeLessThan(0.002)
  })
})

describe('the sampling of the frames (design 11.24)', () => {
  /** A picture of one value per pixel, the same on every row and channel */
  function rowPicture(width: number, height: number, valueAt: (x: number) => number): Picture {
    const data = new Float64Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = valueAt(x)
        data.set([value, value, value, 1], (y * width + x) * 4)
      }
    }
    return { width, height, data }
  }
  const W = 64
  const H = 16
  // 1 frame pixel to the right, consistent both ways (half a pixel of the half-size flow): at t = 0.5 each frame is
  // sampled half a pixel off its grid, where sampling matters most
  const shift: GapFields = { forward: constantField(W / 2, H / 2, 0.5, 0), backward: constantField(W / 2, H / 2, -0.5, 0) }

  it('returns the pixel itself at a whole position', () => {
    const picture = rowPicture(W, H, (x) => 0.5 + 0.3 * Math.sin(x))
    for (const x of [0, 7, 30, W - 1]) expect(sampleBicubic(picture, x, 3, 0)).toBeCloseTo(picture.data[(3 * W + x) * 4]!, 12)
  })

  it('makes a frame of fine detail sharper than bilinear sampling does: under 0.65 of its error', () => {
    const detail = (x: number) => 0.5 + 0.3 * Math.sin((2 * Math.PI * x) / 6)
    const first = rowPicture(W, H, detail)
    const second = rowPicture(W, H, (x) => detail(x - 1))
    const out = interpolateFrame(first, second, shift, 0.5)
    const truth = rowPicture(W, H, (x) => detail(x - 0.5))
    // what bilinear sampling half a pixel off gives: the mean of the two pixels around the point (a softened detail)
    const bilinear = rowPicture(W, H, (x) => (detail(x - 1) + detail(x)) / 2)
    // (0.60 measured: the clamp to the nearest pixels' range, which stops ringing at edges, also trims the peaks of a
    // detail six pixels wide)
    const sharp = meanError(out, truth, 4)
    expect(sharp).toBeLessThan(0.65 * meanError(bilinear, truth, 4))
  })

  it('never rings beside an edge: a step stays inside its two levels', () => {
    const step = (x: number) => (x < W / 2 ? 0.2 : 0.8)
    const first = rowPicture(W, H, step)
    const second = rowPicture(W, H, (x) => step(x - 1))
    const out = interpolateFrame(first, second, shift, 0.5)
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0.2 - 1e-12)
      expect(out.data[i]).toBeLessThanOrEqual(0.8 + 1e-12)
    }
    // ... and the edge moved: half a pixel lies between the two levels, the rest on one side
    const row = Array.from({ length: W }, (_, x) => out.data[(8 * W + x) * 4]!)
    expect(row[W / 2 - 2]).toBeCloseTo(0.2, 9)
    expect(row[W / 2 + 1]).toBeCloseTo(0.8, 9)
  })
})

describe('the mix of the two moved samples (design 11.24)', () => {
  it('weighs each frame by the phase where both see the content', () => {
    expect(mixSamples(0.2, 0.8, 0, 0, 0.25)).toBeCloseTo(0.35, 12)
  })

  it('takes the frame that sees the content where the other does not (its own flow there moves elsewhere)', () => {
    expect(mixSamples(0.2, 0.8, 0, 50, 0.5)).toBeCloseTo(0.2, 9)
    expect(mixSamples(0.2, 0.8, 50, 0, 0.5)).toBeCloseTo(0.8, 9)
  })

  it('mixes the two moved samples by the phase where neither frame is trusted', () => {
    expect(mixSamples(0.2, 0.8, 50, 50, 0.25)).toBeCloseTo(0.35, 12)
  })

  it('with hard edges on "nearest frame", takes there the frame more likely to see it instead of mixing', () => {
    // neither trusted, frame 1 the less wrong: its sample alone, no mix
    expect(mixSamples(0.2, 0.8, 9, 7, 0.5, 'nearest')).toBeCloseTo(0.8, 9)
    // equally unsure: the nearer in time
    expect(mixSamples(0.2, 0.8, 50, 50, 0.25, 'nearest')).toBeCloseTo(0.2, 9)
    // where a frame is trusted the setting changes nothing
    expect(mixSamples(0.2, 0.8, 0, 0, 0.25, 'nearest')).toBeCloseTo(mixSamples(0.2, 0.8, 0, 0, 0.25), 12)
  })
})

describe('a layer moving over another (design 11.24)', () => {
  const W = 192
  const H = 128
  // a textured square moving 8 px right a frame over a background moving 4 px left: where the square goes it covers
  // the background, behind it the background appears; the truth at any moment is exact
  const square = { x: 60, y: 40, side: 44, step: 8, background: -4 }
  const inside = (x: number, y: number, k: number) => {
    const left = square.x + square.step * k
    return x >= left && x < left + square.side && y >= square.y && y < square.y + square.side
  }
  const value = (x: number, y: number, k: number) => {
    const left = square.x + square.step * k
    if (inside(x, y, k)) return 0.05 + 0.6 * pattern(1.7 * (x - left) + 5, 1.7 * (y - square.y) + 9)
    return pattern(x - square.background * k, y)
  }
  const frame = (k: number): Picture => {
    const data = new Float64Array(W * H * 4)
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const v = value(x + 0.5, y + 0.5, k)
        data.set([v, v, v, 1], (y * W + x) * 4)
      }
    }
    return { width: W, height: H, data }
  }
  /** The mean error over the frame and over the band around the square's left and right edges at time `t` */
  function errors(picture: Picture, t: number): { all: number; band: number } {
    let all = 0
    let allCount = 0
    let band = 0
    let bandCount = 0
    const left = square.x + square.step * t
    for (let y = 8; y < H - 8; y += 1) {
      for (let x = 8; x < W - 8; x += 1) {
        const error = Math.abs(picture.data[(y * W + x) * 4]! - value(x + 0.5, y + 0.5, t))
        all += error
        allCount += 1
        const nearEdge = Math.abs(x - left) < 10 || Math.abs(x - (left + square.side)) < 10
        if (nearEdge && y >= square.y - 6 && y < square.y + square.side + 6) {
          band += error
          bandCount += 1
        }
      }
    }
    return { all: all / allCount, band: band / bandCount }
  }
  const first = frame(0)
  const second = frame(1)

  it('with the exact motion, draws each edge from the layer and the frame that is really there', () => {
    // the exact flows, at half the frame: the square's motion where the square is at that frame, else the background's
    const exact = (k: number, sign: number): Field => {
      const data = new Float64Array((W / 2) * (H / 2) * 2)
      for (let y = 0; y < H / 2; y += 1) {
        for (let x = 0; x < W / 2; x += 1) {
          const motion = inside(2 * x + 1, 2 * y + 1, k) ? square.step : square.background
          data.set([(sign * motion) / 2, 0], (y * (W / 2) + x) * 2)
        }
      }
      return { width: W / 2, height: H / 2, data }
    }
    const gap: GapFields = { forward: exact(0, 1), backward: exact(1, -1) }
    const made = errors(interpolateFrame(first, second, gap, 0.5), 0.5)
    const blend = errors(blendOf(first, second, 0.5), 0.5)
    expect(made.all).toBeLessThan(0.0025)
    expect(made.band).toBeLessThan(0.4 * blend.band)
  })

  it('at high motion detail and with hard edges on the nearest frame, still draws the layers from the right frame', () => {
    const gap = measureGap(first, second, 'high')
    expect(gap.forward.width).toBe(W)
    const made = errors(interpolateFrame(first, second, gap, 0.5, { edges: 'nearest' }), 0.5)
    const blend = errors(blendOf(first, second, 0.5), 0.5)
    // 0.42 of the blend's error measured (0.47 at normal detail with the mix)
    expect(made.all).toBeLessThan(0.5 * blend.all)
  })

  it('with the motion it measures, is closer to the truth than the blend', () => {
    const made = errors(interpolateFrame(first, second, measureGap(first, second), 0.5), 0.5)
    const blend = errors(blendOf(first, second, 0.5), 0.5)
    // 0.47 of the blend's error measured; the 11.12 interpolation, searching backwards, made 0.56
    expect(made.all).toBeLessThan(0.52 * blend.all)
  })
})
