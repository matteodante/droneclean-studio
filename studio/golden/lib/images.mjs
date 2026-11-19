// Procedural test images for the golden frames.
//
// Everything here is integer arithmetic on pixel coordinates (no random numbers,
// no trigonometry, no floating point that could round differently on another
// machine), so the same code produces the same bytes anywhere. The images are
// generated into a temporary folder at run time; none is committed.
import { encodePng } from './png.mjs'

export const WIDTH = 320
export const HEIGHT = 180

function canvas() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  // Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
  // fallow-ignore-next-line complexity
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return
    const i = (y * WIDTH + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return { data, set }
}

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Integer HSV (h 0..359, s and v 0..255) to RGB. */
function hsv(h, s, v) {
  const region = Math.floor(h / 60)
  const rem = Math.floor(((h % 60) * 255) / 60)
  const p = (v * (255 - s)) / 255
  const q = (v * (255 - (s * rem) / 255)) / 255
  const t = (v * (255 - (s * (255 - rem)) / 255)) / 255
  const table = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ]
  return table[region % 6].map((c) => clampByte(Math.round(c)))
}

/** Triangle wave in 0..period/2, integer. */
const triangle = (x, period) => {
  const m = ((x % period) + period) % period
  return m < period / 2 ? m : period - m
}

/**
 * "card": colour bars, grey ramp, grey stairs, a hue sweep, a fine-detail patch,
 * stripes, four natural colour patches and four coloured corner squares that
 * show any flip or rotation. Every colour tool and transform is judged on this.
 */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function card() {
  const { data, set } = canvas()
  const bars = [
    [191, 191, 191],
    [191, 191, 0],
    [0, 191, 191],
    [0, 191, 0],
    [191, 0, 191],
    [191, 0, 0],
    [0, 0, 191],
    [0, 0, 0],
  ]
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let c
      if (y < 60) c = bars[Math.floor(x / 40)]
      else if (y < 80) {
        const v = Math.floor((x * 255) / (WIDTH - 1))
        c = [v, v, v]
      } else if (y < 100) {
        const v = Math.floor(x / 20) * 17
        c = [v, v, v]
      } else if (y < 140) {
        if (x < 160) {
          c =
            y < 120
              ? hsv(Math.floor((x * 360) / 160), 255, 255)
              : hsv(Math.floor((x * 360) / 160), 128, 153)
        } else {
          const lx = x - 160
          if (lx < 80) c = (lx + y) % 2 === 0 ? [224, 224, 224] : [32, 32, 32] // 1-pixel checker
          else c = Math.floor(lx / 2) % 2 === 0 ? [255, 255, 255] : [0, 0, 0] // 2-pixel lines
        }
      } else if (x < 160) {
        c = (x + y) % 20 < 10 ? [220, 200, 60] : [40, 60, 140] // diagonal stripes
      } else {
        const patch = Math.floor((x - 160) / 40)
        c = [
          [200, 150, 120], // skin
          [90, 140, 200], // sky
          [60, 100, 50], // foliage
          [120, 120, 120], // concrete
        ][patch]
        // An asymmetric "F" in the first patch: orientation is unmistakable.
        if (patch === 0 && y >= 146 && y < 174) {
          const lx = x - 164
          const ly = y - 146
          if (
            (lx >= 0 && lx < 4 && ly < 28) ||
            (ly < 4 && lx >= 0 && lx < 22) ||
            (ly >= 12 && ly < 16 && lx >= 0 && lx < 16)
          ) {
            c = [20, 20, 20]
          }
        }
      }
      set(x, y, c[0], c[1], c[2])
    }
  }
  const corner = (x0, y0, r, g, b) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set(x0 + x, y0 + y, r, g, b)
  }
  corner(0, 0, 255, 0, 0)
  corner(WIDTH - 8, 0, 0, 255, 0)
  corner(0, HEIGHT - 8, 0, 0, 255)
  corner(WIDTH - 8, HEIGHT - 8, 255, 255, 0)
  return data
}

/**
 * "ramp": four slow ramps (grey, red, green, blue), 64 levels over the width,
 * five pixels per level. Any step the pipeline adds or removes is a visible band.
 */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function ramp() {
  const { data, set } = canvas()
  const band = HEIGHT / 4
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = 16 + Math.floor((x * 64) / WIDTH)
      const which = Math.floor(y / band)
      set(
        x,
        y,
        which === 0 || which === 1 ? v : 16,
        which === 0 || which === 2 ? v : 16,
        which === 0 || which === 3 ? v : 16,
      )
    }
  }
  return data
}

/** "detail": a triangle-wave zone plate, a fixed-seed noise strip, a grid and diagonals. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function detail() {
  const { data, set } = canvas()
  let seed = 12345
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return (seed >>> 16) & 0xff
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = x - WIDTH / 2
      const dy = y - HEIGHT / 2
      const phase = (dx * dx + dy * dy * 2) & 1023
      let v = Math.floor((Math.abs(phase - 512) * 255) / 512)
      let c = [v, v, v]
      if (y < 16) {
        const n = next()
        c = [n, (n * 3) & 255, (n * 7) & 255]
      }
      if (x % 16 === 0 || y % 16 === 0) c = [255, 128, 0]
      if ((x + y) % 40 === 0) c = [0, 200, 255]
      set(x, y, c[0], c[1], c[2])
    }
  }
  return data
}

/** "scene": a drone-style sky at dusk, a sun, layered hills and a field with a road. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function scene() {
  const { data, set } = canvas()
  const horizon = 112
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let c
      if (y < horizon) {
        const t = y / horizon // 0 top .. 1 horizon
        c = [Math.round(30 + 220 * t * t), Math.round(80 + 90 * t), Math.round(170 - 80 * t)]
        const dx = x - 236
        const dy = y - 92
        const d2 = dx * dx + dy * dy
        if (d2 < 26 * 26) c = [255, 240, 205]
        else if (d2 < 60 * 60) {
          const k = Math.floor(((60 * 60 - d2) * 90) / (60 * 60 - 26 * 26))
          c = [clampByte(c[0] + k), clampByte(c[1] + k), clampByte(c[2] + (k >> 1))]
        }
      } else c = [34, 70, 40]
      const far =
        horizon - 6 - Math.floor(triangle(x + 40, 150) / 6) - Math.floor(triangle(x, 46) / 12)
      const near =
        horizon + 4 - Math.floor(triangle(x + 90, 210) / 5) - Math.floor(triangle(x, 28) / 10)
      if (y >= far && y < horizon + 10) c = [40, 50, 80]
      if (y >= near) {
        const g = y - near
        c = [clampByte(30 + g), clampByte(78 + (g >> 1)), clampByte(40 + (g >> 2))]
        if (Math.floor((x + g * 2) / 12) % 2 === 0 && y > horizon + 24)
          c = [c[0] - 6, c[1] - 6, c[2] - 4]
      }
      const road = Math.abs(x - 40 - Math.floor(((y - horizon) * 150) / 70))
      if (y > horizon + 8 && road < 3 + ((y - horizon) >> 4)) c = [170, 160, 140]
      set(x, y, c[0], c[1], c[2])
    }
  }
  return data
}

/** A small "overlay" image with opaque shapes on a solid field, for blend modes. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function overlay() {
  const { data, set } = canvas()
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const stripe = Math.floor(x / 20) % 2 === 0
      let c = stripe ? [230, 120, 40] : [40, 120, 230]
      const dx = x - 160
      const dy = y - 90
      if (dx * dx + dy * dy < 50 * 50) c = [130 + (dx >> 1), 130 + (dy >> 1), 200]
      set(x, y, c[0], c[1], c[2])
    }
  }
  return data
}

const GENERATORS = { card, ramp, detail, scene, overlay }

/** Names of the generated images. */
export const IMAGE_NAMES = Object.keys(GENERATORS)

/** The PNG bytes of one generated image. */
export function imagePng(name) {
  const generate = GENERATORS[name]
  if (!generate) throw new Error(`Unknown test image "${name}"`)
  return encodePng({ width: WIDTH, height: HEIGHT, data: generate() })
}
