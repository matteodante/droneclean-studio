import { describe, expect, it } from 'vite-plus/test'
import { accumulatorFormatFor, blendInLinearLight, createMotionBlurStage, linearToSrgb, srgbToLinear } from './stage'

/** A device that records the passes the gather draws */
function fakeDevice(features: readonly string[] = []) {
  const log: string[] = []
  let shader = ''
  const pipelinesBuilt: string[] = []
  const targetFormats: string[] = []
  const shares: number[][] = []
  const uploads = {
    upload: (data: Float32Array) => {
      shares.push(Array.from(data))
      return { buffer: {} as GPUBuffer, offset: 256 * shares.length, size: 16 }
    },
  }
  const device = {
    lost: new Promise(() => undefined),
    features: new Set(features),
    createShaderModule: (descriptor: { code: string }) => {
      shader = descriptor.code
      return {}
    },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipelineAsync: async (descriptor: {
      label: string
      fragment: { entryPoint: string; targets: Array<{ format: string; blend?: { color: unknown; alpha: unknown } }> }
    }) => {
      pipelinesBuilt.push(descriptor.label)
      targetFormats.push(`${descriptor.label}:${descriptor.fragment.targets[0]!.format}`)
      return { label: descriptor.label, blend: descriptor.fragment.targets[0]!.blend }
    },
    createTexture: (descriptor: { size: { width: number; height: number }; format: string }) => ({
      ...descriptor,
      made: targetFormats.push(`texture:${descriptor.format}`),
      createView: () => `accumulator(${descriptor.format})`,
      destroy: () => log.push('destroy'),
    }),
    createBindGroup: (descriptor: { entries: Array<{ resource: unknown }> }) => ({
      pictures: descriptor.entries.slice(1).map((entry) => String(entry.resource)),
    }),
  }
  const encoder = {
    beginRenderPass: (descriptor: {
      colorAttachments: Array<{ view: unknown; loadOp: string }>
    }) => {
      const [attachment] = descriptor.colorAttachments
      let pipeline = ''
      let pictures: string[] = []
      let offset = -1
      return {
        setPipeline: (p: { label: string }) => (pipeline = p.label),
        setBindGroup: (_: number, group: { pictures: string[] }, offsets: number[]) => {
          pictures = group.pictures
          offset = offsets[0]!
        },
        draw: () =>
          log.push(`${pipeline} ${pictures.join('+')}>${String(attachment!.view)} ${attachment!.loadOp} @${offset}`),
        end: () => log.push(`end ${attachment!.loadOp}`),
      }
    },
  } as unknown as GPUCommandEncoder
  return { device: device as unknown as GPUDevice, encoder, log, pipelinesBuilt, targetFormats, uploads, shares, shader: () => shader }
}

describe('the gather in linear light', () => {
  it('a 50/50 mix of black and white is 0.735 in code values, not the 0.502 (sRGB 128) of the code average', () => {
    const mixed = blendInLinearLight([
      { value: 0, weight: 0.5 },
      { value: 1, weight: 0.5 },
    ])
    expect(mixed).toBeCloseTo(0.7354, 4)
    expect(Math.abs(mixed - 128 / 255)).toBeGreaterThan(0.2)
  })

  it('a quarter of white over black is code 0.537; four equal samples give the sample back', () => {
    expect(
      blendInLinearLight([
        { value: 1, weight: 0.25 },
        { value: 0, weight: 0.75 },
      ]),
    ).toBeCloseTo(0.5371, 3)
    const flat = [0.1, 0.1, 0.1, 0.1].map((value) => ({ value, weight: 0.25 }))
    expect(blendInLinearLight(flat)).toBeCloseTo(0.1, 12)
  })

  it('the two curves are inverses, keep a value outside 0..1,', () => {
    for (const code of [0, 0.02, 0.04045, 0.3, 0.8, 1, 1.2, -0.1]) {
      expect(linearToSrgb(srgbToLinear(code))).toBeCloseTo(code, 6)
    }
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4)
  })

  it('the shader applies the same curves around a weighted sum of up to four pictures', () => {
    const { device, shader } = fakeDevice()
    return createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 }).then(() => {
      expect(shader()).toContain('pow((a + vec3f(0.055)) / 1.055, vec3f(2.4))')
      expect(shader()).toContain('1.055 * pow(a, vec3f(1.0 / 2.4))')
      expect(shader()).toContain('picture3')
      expect(shader()).toContain('round_half(from_linear(total.rgb))')
    })
  })
})

describe('createMotionBlurStage', () => {
  const view = (name: string) => name as unknown as GPUTextureView

  it('four samples are one pass into the output, weights in the arena, no accumulator made', async () => {
    const { device, encoder, log, uploads, shares } = fakeDevice()
    const stage = await createMotionBlurStage(device, 'rgba16float', { width: 8, height: 6 })
    expect(stage.size).toEqual({ width: 8, height: 6 })

    const inputs = ['a', 'b', 'c', 'd'].map((name) => ({ view: view(name), weight: 0.25 }))
    stage.pass(encoder, uploads, inputs, 'only', view('out'))

    expect(log).toEqual(['motion-blur-only a+b+c+d+a>out clear @256', 'end clear'])
    expect(shares).toEqual([[0.25, 0.25, 0.25, 0.25]])
    stage.destroy()
    expect(log.at(-1)).toBe('end clear')
  })

  it('unused slots hold the first picture with no share', async () => {
    const { device, encoder, log, uploads, shares } = fakeDevice()
    const stage = await createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 })
    stage.pass(encoder, uploads, [{ view: view('a'), weight: 0.5 }, { view: view('b'), weight: 0.5 }], 'only', view('out'))
    expect(log[0]).toBe('motion-blur-only a+b+a+a+a>out clear @256')
    expect(shares).toEqual([[0.5, 0.5, 0, 0]])
  })

  it('a long plan: first writes the accumulator, middle adds into it, last reads it and encodes', async () => {
    const { device, encoder, log, uploads } = fakeDevice(['float32-blendable'])
    const stage = await createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 })
    const one = (name: string) => [{ view: view(name), weight: 0.25 }]
    stage.pass(encoder, uploads, one('a'), 'first')
    stage.pass(encoder, uploads, one('b'), 'middle')
    stage.pass(encoder, uploads, one('c'), 'last', view('out'))
    expect(log.filter((line) => line.startsWith('motion-blur'))).toEqual([
      'motion-blur-first a+a+a+a+a>accumulator(rgba32float) clear @256',
      'motion-blur-middle b+b+b+b+b>accumulator(rgba32float) load @512',
      'motion-blur-last c+c+c+c+accumulator(rgba32float)>out clear @768',
    ])
  })

  it('builds the four pipelines once per device', async () => {
    const { device, pipelinesBuilt } = fakeDevice()
    await createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 })
    await createMotionBlurStage(device, 'rgba16float', { width: 16, height: 9 })
    expect(pipelinesBuilt).toEqual(['motion-blur-only', 'motion-blur-first', 'motion-blur-middle', 'motion-blur-last'])
  })

  it('refuses a weight outside (0, 1], a pass of no or five pictures, an encoding pass without output, a bad size', async () => {
    const { device, encoder, uploads } = fakeDevice()
    const stage = await createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 })
    for (const weight of [0, -0.5, 1.5, Number.NaN]) {
      expect(() => stage.pass(encoder, uploads, [{ view: view('a'), weight }], 'first')).toThrow(RangeError)
    }
    expect(() => stage.pass(encoder, uploads, [], 'first')).toThrow(RangeError)
    const five = Array.from({ length: 5 }, () => ({ view: view('a'), weight: 0.2 }))
    expect(() => stage.pass(encoder, uploads, five, 'first')).toThrow(RangeError)
    expect(() => stage.pass(encoder, uploads, five.slice(0, 1), 'only')).toThrow(RangeError)
    await expect(createMotionBlurStage(device, 'rgba16float', { width: 0, height: 4 })).rejects.toThrow(RangeError)
    await expect(createMotionBlurStage(device, 'rgba16float', { width: 4.5, height: 4 })).rejects.toThrow(RangeError)
  })

  it('destroys its accumulator once it has one', async () => {
    const { device, encoder, log, uploads } = fakeDevice()
    const stage = await createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 })
    stage.destroy()
    expect(log).toEqual([])
    stage.pass(encoder, uploads, [{ view: view('a'), weight: 0.5 }], 'first')
    stage.destroy()
    expect(log.at(-1)).toBe('destroy')
  })
})

describe('the accumulator format', () => {
  it('is rgba32float on a device with float32-blendable, rgba16float without it (or with no feature list)', () => {
    expect(accumulatorFormatFor({ features: new Set(['float32-blendable']) })).toBe('rgba32float')
    expect(accumulatorFormatFor({ features: new Set(['timestamp-query']) })).toBe('rgba16float')
    expect(accumulatorFormatFor({})).toBe('rgba16float')
  })

  it('a 32-bit device blends and holds the sum in rgba32float and resolves into the half-float output', async () => {
    const { device, targetFormats } = fakeDevice(['float32-blendable'])
    const stage = await createMotionBlurStage(device, 'rgba16float', { width: 4, height: 4 })
    expect(stage.accumulatorFormat).toBe('rgba32float')
    expect(targetFormats).toEqual([
      'motion-blur-only:rgba16float',
      'motion-blur-first:rgba32float',
      'motion-blur-middle:rgba32float',
      'motion-blur-last:rgba16float',
    ])
  })

  it('a device without it keeps the half-float accumulator, and the pipelines of the two formats are not shared', async () => {
    const half = fakeDevice()
    const stage = await createMotionBlurStage(half.device, 'rgba16float', { width: 4, height: 4 })
    expect(stage.accumulatorFormat).toBe('rgba16float')
    expect(half.targetFormats).toEqual([
      'motion-blur-only:rgba16float',
      'motion-blur-first:rgba16float',
      'motion-blur-middle:rgba16float',
      'motion-blur-last:rgba16float',
    ])
  })
})
