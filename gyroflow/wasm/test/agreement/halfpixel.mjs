// How well the module's warp and Gyroflow's render line up: their PSNR as it is, and with one of them moved half a
// pixel in each direction (bilinear, weights of a half). If a half-pixel sampling offset separated the two, one of the
// moved versions would score higher than the unmoved one; it doesn't (see README).
//
// The pictures are the ones run.mjs leaves in its work folder:
//
//   node gyroflow/wasm/test/agreement/halfpixel.mjs /path/to/work/pictures [frames]
//
// Uses ffmpeg to read the PNGs, like run.mjs.
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const folder = process.argv[2]
const frames = (process.argv[3] || '1000,3000,6000,9000,12000').split(',').map(Number)
const width = 3840
const height = 2160
if (!folder || !existsSync(folder)) {
  console.error('usage: node halfpixel.mjs <the work folder\'s pictures> [frames]')
  process.exit(2)
}

const rgb = (path) => {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: width * height * 3 + 1024 * 1024 })
  if (result.status !== 0) throw new Error(`ffmpeg couldn't read ${path}: ${result.stderr}`)
  return result.stdout
}

/// PSNR of `a` against `b` moved by (dy, dx), on the pixels both have: the half-pixel moves are the only ones used
const psnr = (a, b, dy, dx) => {
  const wy = Math.abs(dy)
  const wx = Math.abs(dx)
  const sy = Math.sign(dy)
  const sx = Math.sign(dx)
  let sum = 0
  let n = 0
  const at = (y, x, c) => b[(y * width + x) * 3 + c]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const v = at(y, x, c) * (1 - wy) * (1 - wx) + at(y + sy, x, c) * wy * (1 - wx)
          + at(y, x + sx, c) * (1 - wy) * wx + at(y + sy, x + sx, c) * wy * wx
        const d = a[(y * width + x) * 3 + c] - v
        sum += d * d
        n++
      }
    }
  }
  return 10 * Math.log10(255 * 255 / (sum / n))
}

const moves = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.5, 0.5], [-0.5, -0.5]]
console.log('frame   unmoved   x +-0.5   y +-0.5   both +-0.5   (PSNR dB, the render moved against the module)')
for (const frame of frames) {
  const module = rgb(join(folder, `module-${frame}.png`))
  const render = rgb(join(folder, `gyroflow-${frame}.png`))
  const scores = moves.map(([dy, dx]) => psnr(module, render, dy, dx))
  const fmt = (v) => v.toFixed(2).padStart(7)
  console.log(`${String(frame).padEnd(7)} ${fmt(scores[0])}   ${fmt(scores[1])}   ${fmt(scores[3])}   ${fmt(scores[5])}`)
}
