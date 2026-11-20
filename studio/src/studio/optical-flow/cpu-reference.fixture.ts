// The CPU twin of the optical-flow kernels (`kernels.ts`), one function per kernel, in the same order and with the same
// arithmetic (in doubles where the GPU has floats), for the tests: what the flow recovers from a known motion, and what
// the interpolated frame is, can then be checked without a GPU. The pyramid and the work per level come from the same
// `scale.ts` as the GPU's. The GPU path itself is checked end to end by the golden cases `flow-half-speed` and
// `flow-occlusion` (golden/cases.mjs).

import { splatPackingFor, type SplatPacking } from './kernels'
import {
  CONSISTENCY_SIGMA,
  FILL_PASSES,
  flowLevels,
  flowScaleFor,
  flowSizeFor,
  levelWork,
  LK_MAX_STEP,
  type FlowDetail,
  type FlowEdges,
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

/** `OpticalFlow.measure` on the CPU at `detail`: both luma pyramids, then both directions */
export function measureGap(first: Picture, second: Picture, detail: FlowDetail = 'normal'): GapFields {
  const size = flowSizeFor(first, detail)
  const scale = flowScaleFor(first, detail)
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

/** The Catmull-Rom weights of the four pixels around a fractional position `f` (`catmullRom` in `INTERPOLATE_WGSL`) */
function catmullRom(f: number): [number, number, number, number] {
  const f2 = f * f
  const f3 = f2 * f
  return [-0.5 * f3 + f2 - 0.5 * f, 1.5 * f3 - 2.5 * f2 + 1, -1.5 * f3 + 2 * f2 + 0.5 * f, 0.5 * f3 - 0.5 * f2]
}

/**
 * Channel `c` of `picture` at (px, py): bicubic over the 4 x 4 pixels around it, clamped to the range of the 2 x 2
 * nearest (`colAt` in `INTERPOLATE_WGSL`)
 */
export function sampleBicubic(picture: Picture, px: number, py: number, c: number): number {
  const { width: W, height: H } = picture
  const qx = Math.min(Math.max(px, 0), W - 1)
  const qy = Math.min(Math.max(py, 0), H - 1)
  const bx = Math.floor(qx)
  const by = Math.floor(qy)
  const wx = catmullRom(qx - bx)
  const wy = catmullRom(qy - by)
  const at = (x: number, y: number) =>
    picture.data[(clampInt(y, 0, H - 1) * W + clampInt(x, 0, W - 1)) * 4 + c]!
  let sum = 0
  for (let j = 0; j < 4; j += 1) {
    let row = 0
    for (let i = 0; i < 4; i += 1) row += wx[i]! * at(bx - 1 + i, by - 1 + j)
    sum += wy[j]! * row
  }
  const near = [at(bx, by), at(bx + 1, by), at(bx, by + 1), at(bx + 1, by + 1)]
  return Math.min(Math.max(sum, Math.min(...near)), Math.max(...near))
}

/** A flow field's value at a frame position (x, y), bilinearly, in frame pixels (`fieldAt` in `INTERPOLATE_WGSL`) */
function fieldAt(
  data: Float64Array,
  stride: number,
  size: FlowFrameSize,
  rx: number,
  ry: number,
  x: number,
  y: number,
): [number, number] {
  const { width: fw, height: fh } = size
  const qx = Math.min(Math.max((x + 0.5) / rx - 0.5, 0), fw - 1)
  const qy = Math.min(Math.max((y + 0.5) / ry - 0.5, 0), fh - 1)
  const x0 = Math.floor(qx)
  const y0 = Math.floor(qy)
  const x1 = Math.min(x0 + 1, fw - 1)
  const y1 = Math.min(y0 + 1, fh - 1)
  const fx = qx - x0
  const fy = qy - y0
  const at = (px: number, py: number, c: number) => data[(py * fw + px) * stride + c]!
  const value = (c: number) => mix(mix(at(x0, y0, c), at(x1, y0, c), fx), mix(at(x0, y1, c), at(x1, y1, c), fx), fy)
  return [value(0) * rx, value(1) * ry]
}

/**
 * The frame's value from its two moved samples `a` (frame 0) and `b` (frame 1): weighted by how far each frame's own
 * flow at its sample point is from the motion at the phase (`e0`, `e1`, frame pixels), and where neither is trusted
 * the two samples mixed by the phase (`fragmentMain` in `INTERPOLATE_WGSL`)
 */
export function mixSamples(
  a: number,
  b: number,
  e0: number,
  e1: number,
  phase: number,
  edges: FlowEdges = 'mix',
): number {
  const s2 = CONSISTENCY_SIGMA * CONSISTENCY_SIGMA
  const w0 = (1 - phase) * Math.exp((-e0 * e0) / s2)
  const w1 = phase * Math.exp((-e1 * e1) / s2)
  const ws = w0 + w1
  const k = Math.min(Math.max((ws - 0.02) / (0.15 - 0.02), 0), 1)
  const warped = (w0 * a + w1 * b) / Math.max(ws, 1e-6)
  // "hard edges: nearest frame": the frame more likely to see the content, else the two mixed by the phase
  const moved = edges === 'nearest' ? (w0 >= w1 ? a : b) : (1 - phase) * a + phase * b
  return mix(moved, warped, k * k * (3 - 2 * k))
}

/** `splat`'s key: the quantized luma difference of a vector's two ends, its direction, then its index (`SplatPacking`) */
const splatKey = (packing: SplatPacking, difference: number, direction: number, index: number) =>
  Math.min(Math.trunc(difference * packing.errorScale), packing.errorMax) * 2 ** (packing.indexBits + 1) +
  direction * 2 ** packing.indexBits +
  index

const SPLAT_CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const

/** `splat`: each flow pixel of both frames carried to where it is at `phase`, the smallest key kept per pixel */
function splat(la: Plane, lb: Plane, gap: GapFields, phase: number, packing: SplatPacking): Float64Array {
  const { width: fw, height: fh } = gap.forward
  const keys = new Float64Array(fw * fh).fill(Number.POSITIVE_INFINITY)
  // into the 2 x 2 pixels around the point
  const land = (px: number, py: number, key: number) => {
    for (const [i, j] of SPLAT_CORNERS) {
      const x = Math.floor(px) + i
      const y = Math.floor(py) + j
      if (x >= 0 && y >= 0 && x < fw && y < fh) keys[y * fw + x] = Math.min(keys[y * fw + x]!, key)
    }
  }
  for (let i = 0; i < fw * fh; i += 1) {
    const x = i % fw
    const y = Math.floor(i / fw)
    const [fx, fy] = [gap.forward.data[i * 2]!, gap.forward.data[i * 2 + 1]!]
    land(x + phase * fx, y + phase * fy, splatKey(packing, Math.abs(la.data[i]! - samplePlane(lb, x + fx, y + fy)), 0, i))
    const [bx, by] = [gap.backward.data[i * 2]!, gap.backward.data[i * 2 + 1]!]
    const difference = Math.abs(lb.data[i]! - samplePlane(la, x + bx, y + by))
    land(x + (1 - phase) * bx, y + (1 - phase) * by, splatKey(packing, difference, 1, i))
  }
  return keys
}

/** `resolve`: the winner's vector as the motion from frame 0 to frame 1 (x, y, 1 where something landed, else zeros) */
function resolve(keys: Float64Array, gap: GapFields, packing: SplatPacking): Float64Array {
  const field = new Float64Array(keys.length * 4)
  keys.forEach((key, i) => {
    if (key === Number.POSITIVE_INFINITY) return
    const index = key % 2 ** packing.indexBits
    const fromSecond = Math.floor(key / 2 ** packing.indexBits) % 2 === 1
    const source = fromSecond ? gap.backward.data : gap.forward.data
    const sign = fromSecond ? -1 : 1
    field.set([sign * source[index * 2]!, sign * source[index * 2 + 1]!, 1, 0], i * 4)
  })
  return field
}

/** `fill`, one pass: a pixel nothing landed on takes the mean of its found 3 x 3 neighbours */
function fillPass(field: Float64Array, fw: number, fh: number): Float64Array {
  const next = field.slice()
  for (let i = 0; i < fw * fh; i += 1) {
    if (field[i * 4 + 2]! > 0) continue
    const x = i % fw
    const y = Math.floor(i / fw)
    const found = [-1, 0, 1]
      .flatMap((j) => [-1, 0, 1].map((k) => [x + k, y + j] as const))
      .filter(([xx, yy]) => xx >= 0 && yy >= 0 && xx < fw && yy < fh && field[(yy * fw + xx) * 4 + 2]! > 0)
      .map(([xx, yy]) => (yy * fw + xx) * 4)
    if (found.length === 0) continue
    const mean = (c: number) => found.reduce((sum, o) => sum + field[o + c]!, 0) / found.length
    next.set([mean(0), mean(1), 1, 0], i * 4)
  }
  return next
}

/** The motion at `phase` at the flow's size (`splat`, `resolve`, then `fill` FILL_PASSES times): x, y, found */
function motionAtPhase(first: Picture, second: Picture, gap: GapFields, phase: number): Float64Array {
  const size = { width: gap.forward.width, height: gap.forward.height }
  const scale = first.width / size.width
  const packing = splatPackingFor(size.width * size.height)
  const keys = splat(lumaOf(first, size, scale), lumaOf(second, size, scale), gap, phase, packing)
  let field = resolve(keys, gap, packing)
  for (let pass = 0; pass < FILL_PASSES; pass += 1) field = fillPass(field, size.width, size.height)
  return field
}

/** The fragment shader of `INTERPOLATE_WGSL` on the CPU (without the half-float rounding of the write) */
export function interpolateFrame(
  first: Picture,
  second: Picture,
  gap: GapFields,
  phase: number,
  options: { readonly edges?: FlowEdges } = {},
): Picture {
  const { width: W, height: H } = first
  const size = { width: gap.forward.width, height: gap.forward.height }
  const rx = W / size.width
  const ry = H / size.height
  const atPhase = motionAtPhase(first, second, gap, phase)
  const out: Picture = { width: W, height: H, data: new Float64Array(W * H * 4) }
  const t = phase
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [fx, fy] = fieldAt(atPhase, 4, size, rx, ry, x, y)
      const y0: [number, number] = [x - t * fx, y - t * fy]
      const y1: [number, number] = [x + (1 - t) * fx, y + (1 - t) * fy]
      const own0 = fieldAt(gap.forward.data, 2, size, rx, ry, y0[0], y0[1])
      const own1 = fieldAt(gap.backward.data, 2, size, rx, ry, y1[0], y1[1])
      const e0 = Math.hypot(own0[0] - fx, own0[1] - fy)
      const e1 = Math.hypot(own1[0] + fx, own1[1] + fy)
      for (let c = 0; c < 4; c += 1) {
        const a = sampleBicubic(first, y0[0], y0[1], c)
        const b = sampleBicubic(second, y1[0], y1[1], c)
        out.data[(y * W + x) * 4 + c] = mixSamples(a, b, e0, e1, t, options.edges)
      }
    }
  }
  return out
}
