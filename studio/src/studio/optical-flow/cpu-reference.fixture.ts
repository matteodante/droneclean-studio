// The CPU twin of the optical-flow kernels (`kernels.ts`), one function per kernel, in the same order and with the same
// arithmetic (in doubles where the GPU has floats), for the tests: what the flow recovers from a known motion, and what
// the interpolated frame is, can then be checked without a GPU. The pyramid and the work per level come from the same
// `scale.ts` as the GPU's. The GPU path itself is checked end to end by the golden case `flow-half-speed` (golden/cases.mjs).

import {
  CONSISTENCY_SIGMA,
  flowLevels,
  flowScaleFor,
  flowSizeFor,
  levelWork,
  LK_MAX_STEP,
  type FlowFrameSize,
} from './scale'

/** A one-channel picture, row by row */
interface Plane {
  readonly width: number
  readonly height: number
  readonly data: Float64Array
}

/** A flow: two values (x, y) a pixel, row by row, in pixels of its own size */
export interface Field {
  readonly width: number
  readonly height: number
  readonly data: Float64Array
}

/** An RGBA picture of code values, four values a pixel, row by row (what the pipeline's `rgba16float` texture holds) */
export interface Picture {
  readonly width: number
  readonly height: number
  readonly data: Float64Array
}

const plane = (width: number, height: number): Plane => ({ width, height, data: new Float64Array(width * height) })
const field = (width: number, height: number): Field => ({ width, height, data: new Float64Array(width * height * 2) })
const clampInt = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** `luma`: the frame's luma, 0..255, box-averaged over `scale` x `scale` pixels into `size` */
function lumaOf(frame: Picture, size: FlowFrameSize, scale: number): Plane {
  const out = plane(size.width, size.height)
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      let acc = 0
      for (let j = 0; j < scale; j += 1) {
        for (let i = 0; i < scale; i += 1) {
          const sx = Math.min(x * scale + i, frame.width - 1)
          const sy = Math.min(y * scale + j, frame.height - 1)
          const p = (sy * frame.width + sx) * 4
          acc += 0.299 * frame.data[p]! + 0.587 * frame.data[p + 1]! + 0.114 * frame.data[p + 2]!
        }
      }
      out.data[y * size.width + x] = (255 * acc) / (scale * scale)
    }
  }
  return out
}

/** `down`: a 2x2 box downsample */
function down(src: Plane, size: FlowFrameSize): Plane {
  const out = plane(size.width, size.height)
  const at = (x: number, y: number) => src.data[y * src.width + x]!
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const x0 = Math.min(x * 2, src.width - 1)
      const x1 = Math.min(x * 2 + 1, src.width - 1)
      const y0 = Math.min(y * 2, src.height - 1)
      const y1 = Math.min(y * 2 + 1, src.height - 1)
      out.data[y * size.width + x] = 0.25 * (at(x0, y0) + at(x1, y0) + at(x0, y1) + at(x1, y1))
    }
  }
  return out
}

/** `grad`: the central-difference gradient */
function gradientOf(img: Plane): Field {
  const { width: w, height: h } = img
  const out = field(w, h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const xm = Math.max(x, 1) - 1
      const xp = Math.min(x + 1, w - 1)
      const ym = Math.max(y, 1) - 1
      const yp = Math.min(y + 1, h - 1)
      out.data[(y * w + x) * 2] = 0.5 * (img.data[y * w + xp]! - img.data[y * w + xm]!)
      out.data[(y * w + x) * 2 + 1] = 0.5 * (img.data[yp * w + x]! - img.data[ym * w + x]!)
    }
  }
  return out
}

/** Bilinear read of a plane, the point clamped to its pixels */
function samplePlane(img: Plane, px: number, py: number): number {
  const qx = Math.min(Math.max(px, 0), img.width - 1)
  const qy = Math.min(Math.max(py, 0), img.height - 1)
  const x0 = Math.floor(qx)
  const y0 = Math.floor(qy)
  const x1 = Math.min(x0 + 1, img.width - 1)
  const y1 = Math.min(y0 + 1, img.height - 1)
  const fx = qx - x0
  const fy = qy - y0
  const at = (x: number, y: number) => img.data[y * img.width + x]!
  return mix(mix(at(x0, y0), at(x1, y0), fx), mix(at(x0, y1), at(x1, y1), fx), fy)
}

/** `warpdiff`: B(p + flow) - A(p) */
function warpDifference(a: Plane, b: Plane, flow: Field): Plane {
  const out = plane(a.width, a.height)
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = y * a.width + x
      out.data[i] = samplePlane(b, x + flow.data[i * 2]!, y + flow.data[i * 2 + 1]!) - a.data[i]!
    }
  }
  return out
}

/** `lk`: one damped, step-limited Lucas-Kanade round over a (2R+1)^2 window */
function lucasKanadeStep(gr: Field, it: Plane, fin: Field, radius: number, maxStep: number): Field {
  const { width: w, height: h } = it
  const out = field(w, h)
  for (let gy = 0; gy < h; gy += 1) {
    for (let gx = 0; gx < w; gx += 1) {
      let sxx = 0
      let sxy = 0
      let syy = 0
      let bx = 0
      let by = 0
      for (let j = -radius; j <= radius; j += 1) {
        const y = clampInt(gy + j, 0, h - 1)
        for (let i = -radius; i <= radius; i += 1) {
          const x = clampInt(gx + i, 0, w - 1)
          const k = y * w + x
          const dx = gr.data[k * 2]!
          const dy = gr.data[k * 2 + 1]!
          const t = it.data[k]!
          sxx += dx * dx
          sxy += dx * dy
          syy += dy * dy
          bx += dx * t
          by += dy * t
        }
      }
      const n = (2 * radius + 1) * (2 * radius + 1)
      const reg = 1 * n
      const a = sxx + reg
      const d = syy + reg
      const det = a * d - sxy * sxy
      let sx = -(d * bx - sxy * by) / det
      let sy = -(-sxy * bx + a * by) / det
      const len = Math.hypot(sx, sy)
      if (len > maxStep) {
        sx *= maxStep / len
        sy *= maxStep / len
      }
      const idx = gy * w + gx
      out.data[idx * 2] = fin.data[idx * 2]! + sx
      out.data[idx * 2 + 1] = fin.data[idx * 2 + 1]! + sy
    }
  }
  return out
}

/** `median`: the 3x3 median of each component */
function median3(fin: Field): Field {
  const { width: w, height: h } = fin
  const out = field(w, h)
  const vx: number[] = []
  const vy: number[] = []
  for (let gy = 0; gy < h; gy += 1) {
    for (let gx = 0; gx < w; gx += 1) {
      vx.length = 0
      vy.length = 0
      for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
          const k = clampInt(gy + j, 0, h - 1) * w + clampInt(gx + i, 0, w - 1)
          vx.push(fin.data[k * 2]!)
          vy.push(fin.data[k * 2 + 1]!)
        }
      }
      vx.sort((a, b) => a - b)
      vy.sort((a, b) => a - b)
      out.data[(gy * w + gx) * 2] = vx[4]!
      out.data[(gy * w + gx) * 2 + 1] = vy[4]!
    }
  }
  return out
}

/** `up`: a coarse flow to the next finer level, bilinear, its values scaled to the finer pixels */
function upsample(coarse: Field, size: FlowFrameSize): Field {
  const { width: w, height: h } = size
  const out = field(w, h)
  const rx = w / coarse.width
  const ry = h / coarse.height
  const at = (x: number, y: number, c: number) => coarse.data[(y * coarse.width + x) * 2 + c]!
  for (let gy = 0; gy < h; gy += 1) {
    for (let gx = 0; gx < w; gx += 1) {
      const px = Math.min(Math.max((gx + 0.5) / rx - 0.5, 0), coarse.width - 1)
      const py = Math.min(Math.max((gy + 0.5) / ry - 0.5, 0), coarse.height - 1)
      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const x1 = Math.min(x0 + 1, coarse.width - 1)
      const y1 = Math.min(y0 + 1, coarse.height - 1)
      const fx = px - x0
      const fy = py - y0
      for (let c = 0; c < 2; c += 1) {
        const value = mix(mix(at(x0, y0, c), at(x1, y0, c), fx), mix(at(x0, y1, c), at(x1, y1, c), fx), fy)
        out.data[(gy * w + gx) * 2 + c] = value * (c === 0 ? rx : ry)
      }
    }
  }
  return out
}

/** One direction's coarse-to-fine solve, from pyramid `a` to pyramid `b` (finest first) */
function solve(a: readonly Plane[], b: readonly Plane[]): Field {
  const count = a.length
  let flow = field(a[count - 1]!.width, a[count - 1]!.height)
  for (let level = count - 1; level >= 0; level -= 1) {
    const size = a[level]!
    if (level < count - 1) flow = upsample(flow, size)
    const gr = gradientOf(a[level]!)
    const { rounds, radius } = levelWork(level, count)
    for (let round = 0; round < rounds; round += 1) {
      const it = warpDifference(a[level]!, b[level]!, flow)
      flow = median3(lucasKanadeStep(gr, it, flow, radius, LK_MAX_STEP))
    }
  }
  return flow
}

/** The flows of one gap, both ways, at the flow's size: what `OpticalFlow.measure` records */
export interface GapFields {
  readonly forward: Field
  readonly backward: Field
}

/** `OpticalFlow.measure` on the CPU: both luma pyramids, then both directions */
export function measureGap(first: Picture, second: Picture): GapFields {
  const size = flowSizeFor(first)
  const scale = flowScaleFor(first)
  const levels = flowLevels(size)
  const pyramid = (frame: Picture): Plane[] => {
    const list = [lumaOf(frame, size, scale)]
    for (let level = 1; level < levels.length; level += 1) list.push(down(list[level - 1]!, levels[level]!))
    return list
  }
  const a = pyramid(first)
  const b = pyramid(second)
  return { forward: solve(a, b), backward: solve(b, a) }
}

/** The fragment shader of `INTERPOLATE_WGSL` on the CPU (without the half-float rounding of the write) */
export function interpolateFrame(first: Picture, second: Picture, gap: GapFields, phase: number): Picture {
  const { width: W, height: H } = first
  const { width: fw, height: fh } = gap.forward
  const rx = W / fw
  const ry = H / fh
  const out: Picture = { width: W, height: H, data: new Float64Array(W * H * 4) }
  const flowAt = (f: Field, px: number, py: number): [number, number] => {
    const qx = Math.min(Math.max((px + 0.5) / rx - 0.5, 0), fw - 1)
    const qy = Math.min(Math.max((py + 0.5) / ry - 0.5, 0), fh - 1)
    const x0 = Math.floor(qx)
    const y0 = Math.floor(qy)
    const x1 = Math.min(x0 + 1, fw - 1)
    const y1 = Math.min(y0 + 1, fh - 1)
    const fx = qx - x0
    const fy = qy - y0
    const at = (x: number, y: number, c: number) => f.data[(y * fw + x) * 2 + c]!
    const value = (c: number) => mix(mix(at(x0, y0, c), at(x1, y0, c), fx), mix(at(x0, y1, c), at(x1, y1, c), fx), fy)
    return [value(0) * rx, value(1) * ry]
  }
  const colAt = (picture: Picture, px: number, py: number, c: number): number => {
    const qx = Math.min(Math.max(px, 0), W - 1)
    const qy = Math.min(Math.max(py, 0), H - 1)
    const x0 = Math.floor(qx)
    const y0 = Math.floor(qy)
    const x1 = Math.min(x0 + 1, W - 1)
    const y1 = Math.min(y0 + 1, H - 1)
    const fx = qx - x0
    const fy = qy - y0
    const at = (x: number, y: number) => picture.data[(y * W + x) * 4 + c]!
    return mix(mix(at(x0, y0), at(x1, y0), fx), mix(at(x0, y1), at(x1, y1), fx), fy)
  }
  const t = phase
  const s2 = CONSISTENCY_SIGMA * CONSISTENCY_SIGMA
  const smoothstep = (e0: number, e1: number, v: number) => {
    const k = Math.min(Math.max((v - e0) / (e1 - e0), 0), 1)
    return k * k * (3 - 2 * k)
  }
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let y0: [number, number] = [x, y]
      for (let k = 0; k < 3; k += 1) {
        const f = flowAt(gap.forward, y0[0], y0[1])
        y0 = [x - t * f[0], y - t * f[1]]
      }
      let y1: [number, number] = [x, y]
      for (let k = 0; k < 3; k += 1) {
        const f = flowAt(gap.backward, y1[0], y1[1])
        y1 = [x - (1 - t) * f[0], y - (1 - t) * f[1]]
      }
      const fa = flowAt(gap.forward, y0[0], y0[1])
      const fb = flowAt(gap.backward, y1[0], y1[1])
      const backA = flowAt(gap.backward, y0[0] + fa[0], y0[1] + fa[1])
      const backB = flowAt(gap.forward, y1[0] + fb[0], y1[1] + fb[1])
      const e0 = Math.hypot(fa[0] + backA[0], fa[1] + backA[1])
      const e1 = Math.hypot(fb[0] + backB[0], fb[1] + backB[1])
      const w0 = (1 - t) * Math.exp((-e0 * e0) / s2)
      const w1 = t * Math.exp((-e1 * e1) / s2)
      const ws = w0 + w1
      const k = smoothstep(0.02, 0.15, ws)
      for (let c = 0; c < 4; c += 1) {
        const warped = (w0 * colAt(first, y0[0], y0[1], c) + w1 * colAt(second, y1[0], y1[1], c)) / Math.max(ws, 1e-6)
        const blend = (1 - t) * colAt(first, x, y, c) + t * colAt(second, x, y, c)
        out.data[(y * W + x) * 4 + c] = mix(blend, warped, k)
      }
    }
  }
  return out
}
