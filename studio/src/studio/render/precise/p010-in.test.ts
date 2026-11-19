// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { preciseFrameBytes, type ColourTags } from './contract'
import {
  P010_CHROMA_SITING,
  assertP010Frame,
  chromaTaps,
  createP010InPass,
  p010InShader,
  p010PixelReference,
  p010Supports,
  swscaleBicubic,
} from './p010-in'

const BT709: ColourTags = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }

/** Levels of 1023, as the reference's output reads. */
const levels = (values: readonly number[]) => values.map((value) => value * 1023)

describe('the conversion, against FFmpeg 9.0.2 on synthetic frames (scale with the decoder’s flags, to gbrp10le)', () => {
  it('expands luma in 8-bit steps: 940 is 1020, 502 is 510, 64 is 0', () => {
    expect(levels(p010PixelReference(940, 512, 512, BT709))).toEqual(
      [1020, 1020, 1020].map((v) => expect.closeTo(v, 9)),
    )
    expect(levels(p010PixelReference(502, 512, 512, BT709))[1]).toBeCloseTo(510, 9)
    expect(levels(p010PixelReference(64, 512, 512, BT709))[0]).toBe(0)
  })

  it('expands chroma by 255/224: U 700 on Y 502 is B 907 (FFmpeg: 907), U 300 is B 62 (FFmpeg: 62)', () => {
    expect(levels(p010PixelReference(502, 700, 512, BT709))[2]).toBeCloseTo(907.13, 1)
    expect(levels(p010PixelReference(502, 300, 512, BT709))[2]).toBeCloseTo(62.17, 1)
  })

  it('keeps super-white above 1.0 (FFmpeg clips it) and holds a value below black at 0', () => {
    const [r] = p010PixelReference(1019, 512, 512, BT709)
    expect(r).toBeGreaterThan(1)
    expect(r * 1023).toBeCloseTo(((1019 - 64) * 255) / 219, 9)
    expect(p010PixelReference(4, 512, 512, BT709)).toEqual([0, 0, 0])
  })

  it('uses BT.601’s weights for an SD source', () => {
    const sd: ColourTags = { ...BT709, matrix: 'smpte170m' }
    const [r709] = p010PixelReference(502, 512, 700, BT709)
    const [r601] = p010PixelReference(502, 512, 700, sd)
    // Cr to R is 2 (1 - Kr): 1.5748 for BT.709, 1.402 for BT.601.
    expect((r601 * 1023 - 510) / (r709 * 1023 - 510)).toBeCloseTo(1.402 / 1.5748, 9)
  })
})

describe('the chroma interpolation', () => {
  it('is swscale’s bicubic: B = 0, C = 0.6', () => {
    expect(swscaleBicubic(0)).toBe(1)
    expect(swscaleBicubic(1)).toBeCloseTo(0, 12)
    expect(swscaleBicubic(0.5)).toBeCloseTo(0.575, 12)
    expect(swscaleBicubic(1.5)).toBeCloseTo(-0.075, 12)
    expect(swscaleBicubic(2)).toBe(0)
  })

  it('sites the samples at each block’s centre, where FFmpeg reads them for the decoder: the measured kernel', () => {
    expect(P010_CHROMA_SITING).toEqual([-0.25, -0.25])
    const [even, odd] = chromaTaps(-0.25)
    // FFmpeg's impulse response (gbrp16le, chroma constant down the column): -0.028 -0.084 0.240 0.808* 0.808* 0.240
    // -0.084 -0.028 around the sample (* clipped in the probe), i.e. these taps.
    expect(even.offset).toBe(-2)
    expect(even.weights.map((w) => Number(w.toFixed(6)))).toEqual([
      -0.028125, 0.240625, 0.871875, -0.084375,
    ])
    expect(odd.offset).toBe(-1)
    expect(odd.weights.map((w) => Number(w.toFixed(6)))).toEqual([
      -0.084375, 0.871875, 0.240625, -0.028125,
    ])
  })

  it('co-sited samples (the standard’s left siting) would pass even pixels straight through', () => {
    const [even, odd] = chromaTaps(0)
    expect(even.weights.map((w) => Number(w.toFixed(6)))).toEqual([0, 1, 0, 0])
    expect(odd.weights.map((w) => Number(w.toFixed(6)))).toEqual([-0.075, 0.575, 0.575, -0.075])
  })

  it('writes the same constants into the shader', () => {
    const shader = p010InShader(BT709)
    expect(shader).toMatch(
      /const H_EVEN = vec4f\(-0\.0281\d*, 0\.2406\d*, 0\.8718\d*, -0\.0843\d*\);/,
    )
    expect(shader).toContain('const H_OFFSET = vec2i(-2, -1);')
    expect(shader).toContain(`* ${255 / 219}`)
    expect(shader).toContain(`* ${255 / 224}`)
    expect(shader).toContain(`${2 * (1 - 0.2126)} * uv.y`)
  })
})

describe('which sources it converts', () => {
  it('takes limited-range BT.709 and BT.601, and untagged ones', () => {
    expect(p010Supports(BT709)).toBe(true)
    expect(p010Supports({ ...BT709, matrix: 'bt470bg' })).toBe(true)
    expect(
      p010Supports({
        matrix: 'unknown',
        range: 'unknown',
        transfer: 'unknown',
        primaries: 'unknown',
      }),
    ).toBe(true)
  })

  it('leaves full range and BT.2020 to FFmpeg’s gbrp10le', () => {
    expect(p010Supports({ ...BT709, range: 'pc' })).toBe(false)
    expect(p010Supports({ ...BT709, matrix: 'bt2020nc' })).toBe(false)
  })
})

interface Recorded {
  textures: Array<{ label?: string; format: string; size: { width: number; height: number } }>
  writes: Array<{
    texture: string
    bytes: number
    bytesPerRow: number
    first: number
    size: { width: number; height: number }
  }>
  submits: number
}

function fakeDevice(): { device: GPUDevice; recorded: Recorded } {
  const recorded: Recorded = { textures: [], writes: [], submits: 0 }
  const device = {
    createTexture(descriptor: {
      label?: string
      format: string
      size: { width: number; height: number }
    }) {
      recorded.textures.push(descriptor)
      return { label: descriptor.label, createView: () => ({}), destroy() {} }
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
      finish: () => ({}),
    }),
    queue: {
      writeTexture(
        destination: { texture: { label: string } },
        data: Uint8Array,
        layout: { bytesPerRow: number },
        size: { width: number; height: number },
      ) {
        recorded.writes.push({
          texture: destination.texture.label,
          bytes: data.byteLength,
          bytesPerRow: layout.bytesPerRow,
          first: data[0] ?? -1,
          size: { width: size.width, height: size.height },
        })
      },
      submit() {
        recorded.submits += 1
      },
    },
  }
  return { device: device as unknown as GPUDevice, recorded }
}

describe('the pass', () => {
  const width = 6
  const height = 4
  const frameBytes = preciseFrameBytes('p010le', width, height)

  it('uploads the luma plane as r16uint and the chroma pairs as rg16uint, then converts into the target', () => {
    const { device, recorded } = fakeDevice()
    const pass = createP010InPass(device, { width, height, colour: BT709 })
    expect(recorded.textures.map((t) => [t.label, t.format, t.size.width, t.size.height])).toEqual([
      ['p010-luma', 'r16uint', 6, 4],
      ['p010-chroma', 'rg16uint', 3, 2],
    ])
    const data = new Uint8Array(frameBytes)
    data[0] = 7
    data[width * height * 2] = 9
    pass.convert(data, { width, height, createView: () => ({}) } as unknown as GPUTexture)
    expect(recorded.writes).toEqual([
      { texture: 'p010-luma', bytes: 48, bytesPerRow: 12, first: 7, size: { width: 6, height: 4 } },
      {
        texture: 'p010-chroma',
        bytes: 24,
        bytesPerRow: 12,
        first: 9,
        size: { width: 3, height: 2 },
      },
    ])
    expect(recorded.submits).toBe(1)
  })

  it('refuses a frame of the wrong length and a target of the wrong size', () => {
    const { device } = fakeDevice()
    const pass = createP010InPass(device, { width, height, colour: BT709 })
    expect(() => assertP010Frame(new Uint8Array(frameBytes - 2), width, height)).toThrow(
      /is 72 bytes, got 70/,
    )
    expect(() =>
      pass.convert(new Uint8Array(frameBytes), {
        width: 4,
        height,
        createView: () => ({}),
      } as unknown as GPUTexture),
    ).toThrow(/the target is 4x4, the source 6x4/)
  })

  it('refuses a source it does not convert, rather than drawing it wrong', () => {
    const { device } = fakeDevice()
    expect(() =>
      createP010InPass(device, { width, height, colour: { ...BT709, range: 'pc' } }),
    ).toThrow(/take the gbrp10le path/)
  })
})

describe('the nearest half float', () => {
  /** The shader's `nearestHalf`, step for step, on one value (f32 bit tricks done with a DataView). */
  function nearestHalf(v: number): number {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, Math.abs(v))
    const exponent = Math.max(((view.getUint32(0) >>> 23) & 0xff) - 127, -14)
    view.setUint32(0, (exponent - 10 + 127) << 23)
    const step = view.getFloat32(0)
    return Math.sign(v) * Math.round(Math.abs(v) / step) * step
  }

  it('rounds to the half-float grid, so the render target’s own conversion (which truncates on Apple GPUs) is exact', () => {
    // 535.47 levels of 1023 lies between the half floats 534.977 and 535.477: the nearest, not the one below.
    const value = 535.47 / 1023
    expect(nearestHalf(value) * 1023).toBeCloseTo(535.477, 2)
    // On the grid already, a value stays; between 0.5 and 1 the grid is 2^-11.
    expect(nearestHalf(0.5 + 3 * 2 ** -11)).toBe(0.5 + 3 * 2 ** -11)
    expect(nearestHalf(0.5 + 3.4 * 2 ** -11)).toBe(0.5 + 3 * 2 ** -11)
    expect(nearestHalf(0)).toBe(0)
    expect(nearestHalf(1.25)).toBe(1.25)
    expect(p010InShader(BT709)).toContain('nearestHalf(max(rgb / 1023.0, vec3f(0.0)))')
  })
})
