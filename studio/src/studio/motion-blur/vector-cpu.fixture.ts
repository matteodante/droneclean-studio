// The CPU twin of the vector blur's kernels (`vector-kernels.ts`), line for line, for the tests: the same velocity,
// tiles and blur on small pictures in plain arrays. The GPU keeps the light, the velocity and the tiles in half floats
// and samples them through the hardware's bilinear filter; the twin computes in doubles, so the two agree to the
// half float's rounding, not bit for bit (the golden cases check the GPU itself).

import { MAX_BLUR_RADIUS, MAX_TAPS, TAP_SPACING, tileSideFor, CONSISTENCY_SIGMA } from './vector-stage'
import { linearToSrgb, srgbToLinear } from './stage'

/** An RGBA picture, row by row, four numbers a pixel */
export interface CpuPicture {
  readonly width: number
  readonly height: number
  readonly data: Float64Array
}

/** A flow at the flow's size, two numbers a pixel, in pixels of that size */
export interface CpuFlow {
  readonly width: number
  readonly height: number
  readonly data: Float64Array
}

/** A gap's flows both ways */
export interface CpuGap {
  readonly forward: CpuFlow
  readonly backward: CpuFlow
}

/** A picture of `width` x `height` from `rgba(x, y)` */
export function cpuPicture(width: number, height: number, rgba: (x: number, y: number) => readonly number[]): CpuPicture {
  const data = new Float64Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(rgba(x, y), (y * width + x) * 4)
  }
  return { width, height, data }
}

/** A flow of `width` x `height` from `xy(x, y)` (flow pixels) */
export function cpuFlow(width: number, height: number, xy: (x: number, y: number) => readonly [number, number]): CpuFlow {
  const data = new Float64Array(width * height * 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(xy(x, y), (y * width + x) * 2)
  }
  return { width, height, data }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Bilinear read of `channels` numbers at a point in pixels (clamped to the array), as the velocity kernel's */
function bilinear(data: Float64Array, width: number, height: number, channels: number, qx: number, qy: number): number[] {
  const px = clamp(qx, 0, width - 1)
  const py = clamp(qy, 0, height - 1)
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const fx = px - x0
  const fy = py - y0
  const out: number[] = []
  for (let c = 0; c < channels; c++) {
    const at = (x: number, y: number) => data[(y * width + x) * channels + c]!
    const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
    const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
    out.push(top * (1 - fy) + bottom * fy)
  }
  return out
}

/** A texture read through a clamp-to-edge linear sampler at frame point `p` (pixel centres at +0.5), as the GPU's */
function sampled(data: Float64Array, width: number, height: number, channels: number, frameW: number, frameH: number, px: number, py: number): number[] {
  // uv = p / frame size; texel coordinate = uv x texture size - 0.5
  return bilinear(data, width, height, channels, (px / frameW) * width - 0.5, (py / frameH) * height - 0.5)
}

type Vec = [number, number]

/** One flow pixel's motion both ways from the two gaps, the side whose round trip fails replaced by the other's */
function velocityAt(before: CpuGap, after: CpuGap, x: number, y: number, rx: number, ry: number): [Vec, Vec] {
  const { width: fw, height: fh } = after.forward
  const i = y * fw + x
  const fRaw: Vec = [after.forward.data[2 * i]!, after.forward.data[2 * i + 1]!]
  const bRaw: Vec = [before.backward.data[2 * i]!, before.backward.data[2 * i + 1]!]
  const f: Vec = [fRaw[0] * rx, fRaw[1] * ry]
  const b: Vec = [bRaw[0] * rx, bRaw[1] * ry]
  const back = bilinear(after.backward.data, fw, fh, 2, x + fRaw[0], y + fRaw[1])
  const forth = bilinear(before.forward.data, fw, fh, 2, x + bRaw[0], y + bRaw[1])
  const s2 = CONSISTENCY_SIGMA * CONSISTENCY_SIGMA
  const wF = Math.exp(-(Math.hypot(f[0] + back[0]! * rx, f[1] + back[1]! * ry) ** 2) / s2)
  const wB = Math.exp(-(Math.hypot(b[0] + forth[0]! * rx, b[1] + forth[1]! * ry) ** 2) / s2)
  const mid: Vec = [0.5 * (f[0] - b[0]), 0.5 * (f[1] - b[1])]
  const dF = wF + (1 - wF) * wB
  const dB = wB + (1 - wB) * wF
  const F: Vec = dF > 0.02 ? [(wF * f[0] - (1 - wF) * wB * b[0]) / dF, (wF * f[1] - (1 - wF) * wB * b[1]) / dF] : mid
  const B: Vec = dB > 0.02 ? [(wB * b[0] - (1 - wB) * wF * f[0]) / dB, (wB * b[1] - (1 - wB) * wF * f[1]) / dB] : [-mid[0], -mid[1]]
  return [F, B]
}

/** The velocity kernel: (F.x, F.y, B.x, B.y) per flow pixel, in frame pixels per source frame */
export function cpuVelocity(frame: { width: number; height: number }, before: CpuGap | undefined, after: CpuGap | undefined): CpuFlow {
  const any = (after ?? before)!
  const { width: fw, height: fh } = any.forward
  const rx = frame.width / fw
  const ry = frame.height / fh
  const out = new Float64Array(fw * fh * 4)
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x
      let F: Vec
      let B: Vec
      if (before !== undefined && after !== undefined) {
        ;[F, B] = velocityAt(before, after, x, y, rx, ry)
      } else if (after !== undefined) {
        F = [after.forward.data[2 * i]! * rx, after.forward.data[2 * i + 1]! * ry]
        B = [-F[0], -F[1]]
      } else {
        B = [before!.backward.data[2 * i]! * rx, before!.backward.data[2 * i + 1]! * ry]
        F = [-B[0], -B[1]]
      }
      out.set([F[0], F[1], B[0], B[1]], i * 4)
    }
  }
  return { width: fw, height: fh, data: out }
}

/** The longest of some vectors (the first of equal ones), as the tile kernels pick */
function longest(vectors: Iterable<Vec>): Vec {
  let best: Vec = [0, 0]
  let bestLength = 0
  for (const v of vectors) {
    const l = v[0] * v[0] + v[1] * v[1]
    if (l > bestLength) {
      bestLength = l
      best = v
    }
  }
  return best
}

/** The mean motion (F - B) / 2 of each flow pixel of a T x T tile */
function* tileMotions(velocity: CpuFlow, tx: number, ty: number, T: number): Generator<Vec> {
  for (let y = ty * T; y < Math.min(ty * T + T, velocity.height); y++) {
    for (let x = tx * T; x < Math.min(tx * T + T, velocity.width); x++) {
      const at = (y * velocity.width + x) * 4
      yield [0.5 * (velocity.data[at]! - velocity.data[at + 2]!), 0.5 * (velocity.data[at + 1]! - velocity.data[at + 3]!)]
    }
  }
}

/** The tiles of a 3x3 neighbourhood, clamped to the grid */
function* neighbourTiles(tiles: Float64Array, tw: number, th: number, tx: number, ty: number): Generator<Vec> {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const at = (clamp(ty + dy, 0, th - 1) * tw + clamp(tx + dx, 0, tw - 1)) * 2
      yield [tiles[at]!, tiles[at + 1]!]
    }
  }
}

/** The tile maxima and their 3x3 neighbourhood maxima of a velocity (mean motion (F - B) / 2) */
function cpuNeighborMax(frame: { width: number; height: number }, velocity: CpuFlow): CpuFlow & { side: number } {
  const T = tileSideFor(frame, velocity)
  const tw = Math.ceil(velocity.width / T)
  const th = Math.ceil(velocity.height / T)
  const tiles = new Float64Array(tw * th * 2)
  const neighbors = new Float64Array(tw * th * 2)
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) tiles.set(longest(tileMotions(velocity, tx, ty, T)), (ty * tw + tx) * 2)
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) neighbors.set(longest(neighbourTiles(tiles, tw, th, tx, ty)), (ty * tw + tx) * 2)
  return { width: tw, height: th, data: neighbors, side: T }
}

const ign = (x: number, y: number) => {
  const inner = x * 0.06711056 + y * 0.00583715
  const f = inner - Math.floor(inner)
  const outer = 52.9829189 * f
  return outer - Math.floor(outer)
}

/** Options of the twin's blur: the edge term can be left out, to compare */
export interface CpuBlurOptions {
  readonly edges?: boolean
}

/** What the blur of one picture reads, prepared once */
interface BlurContext {
  readonly W: number
  readonly H: number
  readonly half: number
  readonly rx: number
  readonly ry: number
  readonly neighbors: CpuFlow & { side: number }
  motion(px: number, py: number): number[]
  lightAt(px: number, py: number): number[]
}

const limited = (h: Vec): Vec => {
  const l = Math.hypot(h[0], h[1])
  return l > MAX_BLUR_RADIUS ? [(h[0] * MAX_BLUR_RADIUS) / l, (h[1] * MAX_BLUR_RADIUS) / l] : h
}

/** The mean half-motion over the shutter, (F - B) / 2 x half, of a velocity sample */
const meanHalf = (m: number[], half: number): Vec => limited([0.5 * (m[0]! - m[2]!) * half, 0.5 * (m[1]! - m[3]!) * half])

/** The pixel's own blur: its light averaged along -F after the frame's time and along -B before it */
function ownBlur(c: BlurContext, X: Vec, hF: Vec, hB: Vec, reach: number, j: number): number[] {
  if (reach < 0.5) return c.lightAt(X[0], X[1]).slice(0, 3)
  const n1 = clamp(Math.ceil((2 * reach) / TAP_SPACING), 2, MAX_TAPS)
  const jitter = j * clamp((2 * reach) / n1 - 1, 0, 1)
  const total = [0, 0, 0]
  for (let k = 0; k < n1; k++) {
    const s = ((k + 0.5 + jitter) / n1) * 2 - 1
    const p = s >= 0 ? [X[0] - s * hF[0], X[1] - s * hF[1]] : [X[0] + s * hB[0], X[1] + s * hB[1]]
    const light = c.lightAt(p[0]!, p[1]!)
    for (let ch = 0; ch < 3; ch++) total[ch]! += light[ch]!
  }
  return total.map((v) => v / n1)
}

/** The faster neighbours that sweep over the pixel during the shutter: how long they cover it, and their light */
function foregroundCover(c: BlurContext, X: Vec, lenX: number, j: number): { cover: number; light: number[] } | undefined {
  const tile = [
    Math.min(Math.floor(X[0] / (c.rx * c.neighbors.side)), c.neighbors.width - 1),
    Math.min(Math.floor(X[1] / (c.ry * c.neighbors.side)), c.neighbors.height - 1),
  ]
  const ni = (tile[1]! * c.neighbors.width + tile[0]!) * 2
  const hN = limited([c.neighbors.data[ni]! * c.half, c.neighbors.data[ni + 1]! * c.half])
  const lenN = Math.hypot(hN[0], hN[1])
  if (!(lenN > lenX * 1.15 + 1)) return undefined
  const n2 = clamp(Math.ceil(lenN / TAP_SPACING), 2, MAX_TAPS)
  const dir: Vec = [hN[0] / lenN, hN[1] / lenN]
  const delta = lenN / n2
  const jitter = j * clamp(delta - 1, 0, 1)
  let cover = 0
  const light = [0, 0, 0]
  for (let k = 0; k < n2; k++) {
    const r = (k + 0.5 + jitter) * delta
    for (const side of [-1, 1]) {
      const Y: Vec = [X[0] + dir[0] * r * side, X[1] + dir[1] * r * side]
      const hY = meanHalf(c.motion(Y[0], Y[1]), c.half)
      const lenY = Math.hypot(hY[0], hY[1])
      const dv = lenY - lenX
      const ahead = smoothstep(0.25, 0.5, dv / Math.max(lenY, 1)) * smoothstep(1, 3, dv)
      const reach = 1 - smoothstep(lenY - 0.5, lenY + 0.5, r)
      const along = smoothstep(0.3, 0.7, Math.abs((dir[0] * hY[0] + dir[1] * hY[1]) / Math.max(lenY, 1e-3)))
      const w = (ahead * reach * along * delta) / (2 * Math.max(lenY, 0.5))
      cover += w
      const lightY = c.lightAt(Y[0], Y[1])
      for (let ch = 0; ch < 3; ch++) light[ch]! += w * lightY[ch]!
    }
  }
  return cover > 1e-5 ? { cover, light: light.map((v) => v / cover) } : undefined
}

/** One pixel of the `only` step: its blurred light, or `undefined` when it is passed through as it is */
function blurredPixel(c: BlurContext, x: number, y: number, edges: boolean): number[] | undefined {
  const X: Vec = [x + 0.5, y + 0.5]
  const m = c.motion(X[0], X[1])
  const hF = limited([m[0]! * c.half, m[1]! * c.half])
  const hB = limited([m[2]! * c.half, m[3]! * c.half])
  const lenX = Math.hypot(...meanHalf(m, c.half))
  const reach = Math.max(Math.hypot(hF[0], hF[1]), Math.hypot(hB[0], hB[1]))
  const j = ign(x, y) - 0.5
  const own = ownBlur(c, X, hF, hB, reach, j)
  const front = edges ? foregroundCover(c, X, lenX, j) : undefined
  if (front !== undefined) {
    const share = Math.min(front.cover, 1)
    return own.map((v, ch) => v * (1 - share) + front.light[ch]! * share)
  }
  return reach < 0.5 ? undefined : own
}

/**
 * The blur kernel's `only` step: the picture (code values) blurred over `extent` source frames along `velocity`,
 * encoded back to code values; a pixel with no motion and no faster neighbour is passed through as it is.
 */
export function cpuVectorBlur(picture: CpuPicture, velocity: CpuFlow, extent: number, options: CpuBlurOptions = {}): CpuPicture {
  const { width: W, height: H } = picture
  const light = new Float64Array(picture.data.length)
  for (let i = 0; i < picture.data.length; i++) light[i] = i % 4 === 3 ? picture.data[i]! : srgbToLinear(picture.data[i]!)
  const context: BlurContext = {
    W,
    H,
    half: extent / 2,
    rx: W / velocity.width,
    ry: H / velocity.height,
    neighbors: cpuNeighborMax({ width: W, height: H }, velocity),
    motion: (px, py) => sampled(velocity.data, velocity.width, velocity.height, 4, W, H, px, py),
    lightAt: (px, py) => sampled(light, W, H, 4, W, H, px, py),
  }
  const out = new Float64Array(picture.data)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const result = blurredPixel(context, x, y, options.edges !== false)
      if (result === undefined) continue
      const i = (y * W + x) * 4
      for (let ch = 0; ch < 3; ch++) out[i + ch] = linearToSrgb(result[ch]!)
    }
  }
  return { width: W, height: H, data: out }
}
