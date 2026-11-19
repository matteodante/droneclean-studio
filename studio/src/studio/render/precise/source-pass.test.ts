// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { frameToSeconds } from '@/studio/time'
import {
  PRECISE_RENDER_FORMAT,
  preciseFrameBytes,
  preciseFramePts,
  precisePlaneLayout,
  type ColourTags,
  type PreciseFrame,
} from './contract'
import {
  PRECISE_SOURCE_CODE_MAX,
  assertGbrp10leFrame,
  createSourcePass,
  preciseSourceTextureDescriptor,
  type PreciseSourceFrame,
} from './source-pass'

const WIDTH = 2
const HEIGHT = 2

const COLOUR: ColourTags = {
  matrix: 'bt709',
  range: 'tv',
  transfer: 'bt709',
  primaries: 'bt709',
}

const FRAME: PreciseFrame = { index: 60, rate: { num: 60000, den: 1001 }, durationFrames: 1 }

interface RgbCodes {
  readonly r: number
  readonly g: number
  readonly b: number
}

/**
 * One `gbrp10le` frame written the way FFmpeg writes it: FFmpeg's own plane order (G, B, R) from
 * the contract's layout, each sample a 16-bit little-endian value, rows tightly packed.
 */
function frameFromCodes(codes: readonly RgbCodes[]): Uint8Array {
  const bytes = new Uint8Array(preciseFrameBytes('gbrp10le', WIDTH, HEIGHT))
  const view = new DataView(bytes.buffer)
  const [green, blue, red] = precisePlaneLayout('gbrp10le', WIDTH, HEIGHT)
  if (!green || !blue || !red) throw new Error('the gbrp10le layout lost a plane')
  const planeAt = { g: green.offset, b: blue.offset, r: red.offset } as const
  codes.forEach((code, pixel) => {
    for (const plane of ['g', 'b', 'r'] as const) {
      view.setUint16(planeAt[plane] + pixel * 2, code[plane], true)
    }
  })
  return bytes
}

/**
 * The reference the shader must agree with: FFmpeg's packing read by its own definition (green,
 * blue and red planes in that order at 0, one plane and two planes), each code divided by 1023,
 * alpha 1.
 */
function rgbaAt(bytes: Uint8Array, pixel: number): [number, number, number, number] {
  const planeBytes = WIDTH * HEIGHT * 2
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const code = (plane: 'g' | 'b' | 'r'): number => {
    const offset = (plane === 'g' ? 0 : plane === 'b' ? planeBytes : 2 * planeBytes) + pixel * 2
    return view.getUint16(offset, true) / 1023
  }
  return [code('r'), code('g'), code('b'), 1]
}

describe('the gbrp10le frame the pass reads', () => {
  it('is the contract layout the shader binds: green, blue, red, six bytes per pixel', () => {
    expect(precisePlaneLayout('gbrp10le', WIDTH, HEIGHT).map((plane) => plane.channel)).toEqual([
      'g',
      'b',
      'r',
    ])
    expect(preciseFrameBytes('gbrp10le', WIDTH, HEIGHT)).toBe(24)
    expect(preciseFrameBytes('gbrp10le', 3840, 2880)).toBe(66_355_200)
  })

  it('reconstructs each pixel as R, G, B, alpha 1, with the code divided by 1023', () => {
    const codes: RgbCodes[] = [
      { r: 1023, g: 0, b: 0 },
      { r: 0, g: 1023, b: 0 },
      { r: 0, g: 0, b: 1023 },
      { r: 512, g: 256, b: 768 },
    ]
    const frame = frameFromCodes(codes)
    codes.forEach((code, pixel) => {
      const [r, g, b, a] = rgbaAt(frame, pixel)
      expect(r).toBeCloseTo(code.r / 1023, 12)
      expect(g).toBeCloseTo(code.g / 1023, 12)
      expect(b).toBeCloseTo(code.b / 1023, 12)
      expect(a).toBe(1)
    })
  })
})

describe('assertGbrp10leFrame', () => {
  it('accepts one whole tightly packed frame', () => {
    expect(() => assertGbrp10leFrame(new Uint8Array(24), WIDTH, HEIGHT)).not.toThrow()
  })

  it('rejects a frame of any other length, in the message the decoder will show', () => {
    expect(() => assertGbrp10leFrame(new Uint8Array(23), WIDTH, HEIGHT)).toThrow(
      /a 2x2 gbrp10le frame is 24 bytes, got 23/,
    )
    expect(() => assertGbrp10leFrame(new Uint8Array(25), WIDTH, HEIGHT)).toThrow(
      /a 2x2 gbrp10le frame is 24 bytes, got 25/,
    )
    expect(() => assertGbrp10leFrame(new Uint8Array(0), 3840, 2880)).toThrow(
      /is 66355200 bytes, got 0/,
    )
  })
})

describe('createSourcePass', () => {
  it('refuses a size that is not positive integers before it touches the device', () => {
    expect(() =>
      createSourcePass({} as GPUDevice, {
        width: 0,
        height: 2880,
        colour: COLOUR,
      }),
    ).toThrow(/the size must be positive integers, got 0x2880/)
  })
})

describe('PreciseSourceFrame', () => {
  it('carries the exact frame and the colour description rather than a float fps', () => {
    const frame: PreciseSourceFrame = {
      texture: {} as GPUTexture,
      view: {} as GPUTextureView,
      width: 3840,
      height: 2880,
      frame: FRAME,
      colour: COLOUR,
    }

    expect(preciseFramePts(frame.frame)).toBe(60_060)
    expect(frameToSeconds(frame.frame.rate, frame.frame.index)).toBe(1.001)
    expect(frame.colour).toEqual({
      matrix: 'bt709',
      range: 'tv',
      transfer: 'bt709',
      primaries: 'bt709',
    })
  })
})

describe('the source texture descriptor', () => {
  it('is the float composite’s format at the source’s own size, sampled and renderable', () => {
    const usage = globalThis as typeof globalThis & { GPUTextureUsage?: typeof GPUTextureUsage }
    usage.GPUTextureUsage ??= {
      COPY_SRC: 0x01,
      COPY_DST: 0x02,
      TEXTURE_BINDING: 0x04,
      STORAGE_BINDING: 0x08,
      RENDER_ATTACHMENT: 0x10,
    } as typeof GPUTextureUsage
    const descriptor = preciseSourceTextureDescriptor(1920, 1080)

    expect(descriptor.format).toBe(PRECISE_RENDER_FORMAT)
    expect(descriptor.format).toBe('rgba16float')
    expect(descriptor.size).toEqual({ width: 1920, height: 1080 })
    // GPUTextureUsage.TEXTURE_BINDING (0x04) | GPUTextureUsage.RENDER_ATTACHMENT (0x10).
    expect(descriptor.usage).toBe(0x14)
  })

  it('divides the 10-bit code values by the largest one', () => {
    // 0..1023 becomes 0..1: the GPU's whole conversion of a gbrp10le frame.
    expect(PRECISE_SOURCE_CODE_MAX).toBe(1023)
  })
})
