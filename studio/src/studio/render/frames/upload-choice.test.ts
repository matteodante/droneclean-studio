// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { chooseUpload, UPLOAD_TOLERANCE_LEVELS, type UploadProbe } from './blit'

/** What the browser does to a 10-bit BT.709 frame (measured on a grey ramp): sRGB-encode of the code value to 1.961. */
function browserConverted(level: number): number {
  const linear = (level / 255) ** 1.961
  const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  return srgb * 255
}

const GREYS = [0, 16, 40, 64, 100, 136, 145, 180, 220, 255]
const rgb = (levels: number[], map: (n: number) => number = (n) => n) =>
  Float32Array.from(levels.flatMap((n) => [map(n), map(n), map(n)]))

describe('which upload a file takes in the preview', () => {
  it('matches the greys measured on a 10-bit ramp: 15 gives 13, 63 gives 72, 134 gives 145', () => {
    expect(browserConverted(15)).toBeCloseTo(13, 0)
    expect(browserConverted(63)).toBeCloseTo(72, 0)
    expect(browserConverted(134)).toBeCloseTo(145, 0)
  })

  it('takes the external texture as it is when it equals the canvas picture (an 8-bit frame)', () => {
    const probe: UploadProbe = {
      canvas: rgb(GREYS),
      plain: rgb(GREYS),
      corrected: rgb(GREYS, (n) => n + 11),
    }
    expect(chooseUpload(probe)).toBe('plain')
  })

  it('corrects the external texture when the browser converted the transfer (a 10-bit frame)', () => {
    // plain is what the browser handed over; the corrected panel is what the shader makes of it: the canvas picture
    const probe: UploadProbe = {
      canvas: rgb(GREYS),
      plain: rgb(GREYS, browserConverted),
      corrected: rgb(GREYS, (n) => n + 0.4),
    }
    expect(chooseUpload(probe)).toBe('corrected')
  })

  it('falls back to the canvas when neither reading matches it', () => {
    const probe: UploadProbe = {
      canvas: rgb(GREYS),
      plain: rgb(GREYS, (n) => n * 0.8 + 20),
      corrected: rgb(GREYS, (n) => n * 0.8 + 30),
    }
    expect(chooseUpload(probe)).toBe('canvas')
  })

  it('cannot decide on a frame both readings draw alike (black), instead of picking plain for a 10-bit file', () => {
    const black = rgb([0, 0, 0])
    expect(chooseUpload({ canvas: black, plain: black, corrected: black })).toBe('undecided')
    const dark = rgb([2, 3, 4])
    expect(chooseUpload({ canvas: dark, plain: rgb([2, 3, 4], (n) => n + 0.4), corrected: rgb([2, 3, 4], (n) => n + 0.2) })).toBe('undecided')
  })

  it('keeps the tolerance at a few levels, so a gamut or matrix change is never accepted', () => {
    expect(UPLOAD_TOLERANCE_LEVELS).toBeLessThanOrEqual(3)
    const off = rgb(GREYS, (n) => n + UPLOAD_TOLERANCE_LEVELS + 1)
    expect(chooseUpload({ canvas: rgb(GREYS), plain: off, corrected: off })).toBe('canvas')
  })
})
