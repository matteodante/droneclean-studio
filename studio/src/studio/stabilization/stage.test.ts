// @vitest-environment node

// What the stage can be held to without a GPU: the kernel parameters it hands the shader (the two floats a normalized
// texture wants, and copies the caller's cache keeps), the bindings its layout has against the ones the assembled
// shader declares, and the refusals that would otherwise become a draw of garbage. The draw itself is the probe's
// (`probe.mjs`, Chromium's WebGPU against the module's CPU warp, 45 dB).

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FrameArena, type ArenaDevice } from '@/studio/render/stages/arena'
import { assembleKernel } from './kernel'
import {
  KERNEL_BINDINGS,
  NORMALIZED_FORMATS,
  createStabilizationStage,
  prepareFrame,
  type StageBinding,
  type StabilizationAssets,
  type StabilizationFormats,
  type StabilizationFrame,
} from './stage'

function gyroflow(path: string): string {
  return readFileSync(new URL(`../../../../gyroflow/${path}`, import.meta.url), 'utf8')
}

/** One frame's data: 3840x2880 in, 3840x2160 out, the sizes clip 0020 has */
function frame(): StabilizationFrame {
  const params = new Uint8Array(416)
  const view = new DataView(params.buffer)
  view.setInt32(0, 3840, true) // width
  view.setInt32(4, 2880, true) // height
  view.setInt32(12, 3840, true) // output_width
  view.setInt32(16, 2160, true) // output_height
  view.setInt32(24, 4, true) // matrix_count: a short one, so the test's arrays stay small
  view.setFloat32(352, 255, true) // max_pixel_value, the CPU warp's
  view.setFloat32(364, 255, true) // pixel_value_limit
  return { params, matrices: new Float32Array(4 * 16), mesh: new Float32Array(0) }
}

describe('prepareFrame', () => {
  it('copies the frame and leaves the caller’s arrays alone', () => {
    const original = frame()
    const prepared = prepareFrame(original)
    expect(prepared.matrices).not.toBe(original.matrices)
    expect(prepared.mesh).not.toBe(original.mesh)
    expect(new Uint8Array(prepared.params.buffer)).not.toBe(original.params)
    // The caller's params still say 255: the copy is what changed
    expect(new DataView(original.params.buffer).getFloat32(352, true)).toBe(255)
    expect(new DataView(original.params.buffer).getFloat32(364, true)).toBe(255)
  })

  it('writes 1.0 into max_pixel_value and pixel_value_limit, and nothing else', () => {
    const original = frame()
    const prepared = prepareFrame(original)
    const view = new DataView(prepared.params.buffer)
    expect(view.getFloat32(352, true)).toBe(1)
    expect(view.getFloat32(364, true)).toBe(1)
    // 255.0 is 00 00 7f 43 and 1.0 is 00 00 80 3f: the low two bytes of each float happen to be the same
    const changed = Array.from(prepared.params, (byte, index) =>
      byte === original.params[index] ? -1 : index,
    ).filter((index) => index >= 0)
    expect(changed).toEqual([354, 355, 366, 367])
    expect(prepared.params.byteLength).toBe(original.params.byteLength)
  })

  it('reads the sizes the shader maps with', () => {
    const prepared = prepareFrame(frame())
    expect(prepared.inputSize).toEqual([3840, 2880])
    expect(prepared.outputSize).toEqual([3840, 2160])
  })

  it('refuses parameters that are not Gyroflow’s struct', () => {
    expect(() => prepareFrame({ ...frame(), params: new Uint8Array(400) })).toThrow(/416 bytes/)
  })

  it('refuses a matrix count the matrices cannot fill', () => {
    const mismatched = frame()
    new DataView(mismatched.params.buffer).setInt32(24, 2880, true)
    expect(() => prepareFrame(mismatched)).toThrow(/2880 row matrices/)
    expect(() => prepareFrame({ ...frame(), matrices: new Float32Array(10) })).toThrow(
      /whole 16-float/,
    )
  })
})

/** The `@group(0)` bindings a WGSL text declares, in the order it declares them */
function declaredBindings(kernel: string): StageBinding[] {
  return [...kernel.matchAll(/@group\(0\) @binding\((\d+)\) var(?:<([^>]+)>)? \w+: ([^;]+);/g)].map(
    (match) => {
      const [, binding, attribute, type] = match
      if (!binding || !type) throw new Error(`cannot read the binding ${match[0]}`)
      return {
        binding: Number(binding),
        kind: type.startsWith('texture_2d')
          ? 'texture'
          : attribute?.startsWith('storage')
            ? 'storage'
            : 'uniform',
      }
    },
  )
}

describe('KERNEL_BINDINGS', () => {
  it('is the bindings the assembled shader declares, in its order', () => {
    const kernel = assembleKernel({
      kernelWgsl: gyroflow('src/core/gpu/wgpu_undistort.wgsl'),
      lensWgsl: gyroflow('src/core/stabilization/distortion_models/opencv_fisheye.wgsl'),
      digitalLensWgsl:
        'fn digital_undistort_point(uv: vec2<f32>) -> vec2<f32> { return uv; }\n' +
        'fn digital_distort_point  (uv: vec2<f32>) -> vec2<f32> { return uv; }',
    })
    expect(declaredBindings(kernel)).toEqual([...KERNEL_BINDINGS])
  })
})

describe('createStabilizationStage', () => {
  // The refusals come before the device is touched: a stub that fails on any call is enough
  const untouchedDevice = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `the device was used (${String(property)}) for a stage it should have refused`,
        )
      },
    },
  ) as GPUDevice

  const assets: StabilizationAssets = {
    kernelWgsl: gyroflow('src/core/gpu/wgpu_undistort.wgsl'),
    lensWgsl: gyroflow('src/core/stabilization/distortion_models/opencv_fisheye.wgsl'),
    digitalLensWgsl: '',
    coeffs: new Float32Array(496),
    interpolation: 2,
  }
  const formats: StabilizationFormats = { input: 'rgba16float', output: 'rgba16float' }

  it('reads and writes normalized float textures only', async () => {
    expect(NORMALIZED_FORMATS).toEqual(['rgba8unorm', 'rgba16float', 'rgba32float'])
    await expect(
      createStabilizationStage(untouchedDevice, assets, { ...formats, input: 'rgba16uint' }),
    ).rejects.toThrow(/rgba16uint/)
    await expect(
      createStabilizationStage(untouchedDevice, assets, { ...formats, output: 'bgra8unorm' }),
    ).rejects.toThrow(/bgra8unorm/)
  })

  it('wants Gyroflow’s whole coefficient table', async () => {
    await expect(
      createStabilizationStage(
        untouchedDevice,
        { ...assets, coeffs: new Float32Array(64) },
        formats,
      ),
    ).rejects.toThrow(/496 floats/)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// A source texture of any size (review finding S2): a proxy, or any decode that is not the file's own size

/** Gyroflow's `KernelParams` fields the stage reads or writes, at their byte offsets (`stabilization/mod.rs:144`) */
function readParams(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const int = (offset: number): number => view.getInt32(offset, true)
  const float = (offset: number): number => view.getFloat32(offset, true)
  return {
    width: int(0),
    height: int(4),
    stride: int(8),
    outputWidth: int(12),
    outputHeight: int(16),
    outputStride: int(20),
    matrixCount: int(24),
    flags: int(36),
    f: [float(64), float(68)] as [number, number],
    c: [float(72), float(76)] as [number, number],
    translation: [float(216), float(220)] as [number, number],
    sourceRect: [int(240), int(244), int(248), int(252)] as [number, number, number, number],
    outputRect: [int(256), int(260), int(264), int(268)],
  }
}

/** A 64x48 source, a 64x36 stabilized picture and a matrix per sensor row, as the engine reports a frame */
function sizedFrame(): StabilizationFrame {
  const params = new Uint8Array(416)
  const view = new DataView(params.buffer)
  const ints: Array<[number, number]> = [
    [0, 64], // width
    [4, 48], // height
    [8, 64 * 4], // stride: the engine's RGBA8 buffer
    [12, 64], // output_width
    [16, 36], // output_height
    [20, 64 * 4], // output_stride
    [24, 48], // matrix_count: one per row, so the row a pixel reads is part of the picture
    [28, 2], // interpolation: bilinear
    [40, 4], // bytes_per_pixel
    [44, 4], // pix_element_count
    [248, 64], // source_rect: the whole frame, as Gyroflow writes it for a buffer of the video's size
    [252, 48],
    [264, 64], // output_rect
    [268, 36],
  ]
  for (const [offset, value] of ints) view.setInt32(offset, value, true)
  view.setFloat32(64, 50, true) // f
  view.setFloat32(68, 50, true)
  view.setFloat32(72, 32, true) // c
  view.setFloat32(76, 24, true)
  view.setFloat32(352, 255, true) // max_pixel_value, the CPU warp's
  view.setFloat32(364, 255, true) // pixel_value_limit
  const matrices = new Float32Array(48 * 16).map((_, index) => Math.floor(index / 16) + 1)
  return { params, matrices, mesh: new Float32Array(0) }
}

/** A device that records the bytes the stage writes into each buffer, by label; nothing is drawn */
function recordingDevice(): { device: GPUDevice; written: (label: string) => Uint8Array } {
  const writes = new Map<string, Uint8Array>()
  const device = {
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createPipelineLayout: () => ({}),
    createBindGroupLayout: () => ({}),
    createBindGroup: () => ({}),
    createBuffer: (descriptor: GPUBufferDescriptor) => ({
      label: descriptor.label,
      size: descriptor.size,
      destroy: () => {},
    }),
    queue: {
      writeBuffer: (buffer: GPUBuffer, _offset: number, data: ArrayBufferView) => {
        writes.set(
          buffer.label,
          new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        )
      },
    },
  } as unknown as GPUDevice
  return {
    device,
    written: (label) => {
      const bytes = writes.get(label)
      if (!bytes) throw new Error(`nothing was written into ${label}`)
      return bytes
    },
  }
}

function texture(width: number, height: number, format: GPUTextureFormat = 'rgba16float'): GPUTexture {
  return { width, height, format, createView: () => ({}) } as unknown as GPUTexture
}

const encoder = {
  beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
} as unknown as GPUCommandEncoder

const realAssets = (): StabilizationAssets => ({
  kernelWgsl: gyroflow('src/core/gpu/wgpu_undistort.wgsl'),
  lensWgsl: gyroflow('src/core/stabilization/distortion_models/opencv_fisheye.wgsl'),
  digitalLensWgsl:
    'fn digital_undistort_point(uv: vec2<f32>) -> vec2<f32> { return uv; }\n' +
    'fn digital_distort_point  (uv: vec2<f32>) -> vec2<f32> { return uv; }',
  coeffs: new Float32Array(496),
  interpolation: 2,
})

/** The kernel parameters the stage hands the GPU for one warp of `frame` from a source texture of this size */
async function paramsForSource(width: number, height: number, frame = sizedFrame(), output = { width: 64, height: 36 }) {
  const { device, written } = recordingDevice()
  const stage = await createStabilizationStage(device, realAssets(), {
    input: 'rgba16float',
    output: 'rgba16float',
  })
  stage.warp(encoder, texture(width, height), texture(output.width, output.height), frame)
  return {
    bytes: written('stabilization params'),
    params: readParams(written('stabilization params')),
    matrices: new Float32Array(written('stabilization matrices').buffer),
  }
}

describe('a source texture of any size', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
    vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is warped in the frame’s own coordinates, read through Gyroflow’s source rect', async () => {
    const full = await paramsForSource(64, 48)
    const half = await paramsForSource(32, 24)

    // The frame's geometry is untouched: the output plane (`out_f` is built from `f`), the row a pixel's matrix is
    // looked up by and the matrices themselves are the full frame's, whatever the texture
    expect(half.params).toMatchObject({
      width: 64,
      height: 48,
      outputWidth: 64,
      outputHeight: 36,
      outputRect: [0, 0, 64, 36],
      matrixCount: 48,
      f: [50, 50],
    })
    expect(half.matrices).toEqual(full.matrices)
    // The texture is read through the source rect (flag 32, HAS_SOURCE_RECT), as Gyroflow does for an input buffer of
    // another size than the video (`stabilization/mod.rs:302`); its rows are the texture's
    expect(half.params.flags & 32).toBe(32)
    expect(half.params.sourceRect).toEqual([0, 0, 32, 24])
    expect(half.params.stride).toBe(32 * 4)
    // The lens centre moves by 0.5 - 0.5/s: the rect maps pixel corners, the kernel indexes pixel centres
    expect(half.params.c).toEqual([32 - 0.5, 24 - 0.5])
  })

  it('takes any size, not only a half: each axis is scaled on its own', async () => {
    const { params } = await paramsForSource(48, 40)

    expect(params.sourceRect).toEqual([0, 0, 48, 40])
    expect(params.stride).toBe(48 * 4)
    expect(params.c[0]).toBeCloseTo(32 + 0.5 - (0.5 * 64) / 48, 5)
    expect(params.c[1]).toBeCloseTo(24 + 0.5 - (0.5 * 48) / 40, 5)
  })

  it('leaves the kernel parameters of a source at the frame’s own size exactly as they were', async () => {
    const frame = sizedFrame()
    const { bytes } = await paramsForSource(64, 48, frame)

    expect(bytes).toEqual(prepareFrame(frame).params)
  })

  it('gives the full-size picture from a half-size source, within 40 dB, through the kernel’s own source-rect mapping', async () => {
    const kernel = assembleKernel(realAssets())
    // The three steps of the kernel this test follows, as the assembled kernel has them: the lens centre added to the
    // source position, the source rect's mapping of that position, and the rect bounding the bilinear taps
    for (const line of [
      'uv += c;',
      'if (bool(params.flags & 32) && params.background_mode != 3) { // Uses source rect',
      'map_coord(uv.x, 0.0, f32(frame_size.x), f32(params.source_rect.x), f32(params.source_rect.x + params.source_rect.z)),',
      'map_coord(uv.y, 0.0, f32(frame_size.y), f32(params.source_rect.y), f32(params.source_rect.y + params.source_rect.w))',
      'if (sx + xp >= params.source_rect.x && sx + xp < params.source_rect.x + params.source_rect.z) {',
    ]) {
      expect(kernel).toContain(line)
    }

    const fullParams = (await paramsForSource(64, 48)).params
    const halfParams = (await paramsForSource(32, 24)).params
    const picture = (x: number, y: number): number =>
      0.5 + 0.25 * Math.sin((2 * Math.PI * x) / 24) * Math.cos((2 * Math.PI * y) / 20)
    const fullTexture = { width: 64, height: 48, at: picture }
    // The half-size source is the full one box-filtered, as a proxy is
    const halfTexture = {
      width: 32,
      height: 24,
      at: (x: number, y: number) =>
        (picture(2 * x, 2 * y) +
          picture(2 * x + 1, 2 * y) +
          picture(2 * x, 2 * y + 1) +
          picture(2 * x + 1, 2 * y + 1)) /
        4,
    }
    // Where a stabilized pixel's ray lands in the source before the lens centre is added: a function of `f`, the
    // matrices and the output plane only, which the half-size warp keeps (the test above)
    const ray = (x: number, y: number): [number, number] => [
      x * 0.85 - 27 + 0.06 * y,
      y * 0.85 - 14 - 0.06 * x,
    ]

    const warp = (params: typeof fullParams, source: typeof fullTexture): number[] => {
      const out: number[] = []
      for (let y = 0; y < 36; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const [rx, ry] = ray(x, y)
          out.push(sampleLikeTheKernel(params, source, rx + params.c[0], ry + params.c[1]))
        }
      }
      return out
    }
    const fullPicture = warp(fullParams, fullTexture)
    const halfPicture = warp(halfParams, halfTexture)
    const unscaledPicture = warp(fullParams, halfTexture)

    // 41.95 dB and at most 0.0206 (5.3 levels of 255) on this run: what a half-size source loses of a picture whose
    // period is 24 pixels, and nothing else
    expect(psnr(halfPicture, fullPicture)).toBeGreaterThan(40)
    expect(maxDifference(halfPicture, fullPicture)).toBeLessThan(0.025)
    // The test can tell: the half-size texture read with the full frame's parameters is another picture (6.88 dB)
    expect(psnr(unscaledPicture, fullPicture)).toBeLessThan(10)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// An output texture of any size of the picture's shape (design 8.10): the preview draws the warp at the size it shows

describe('an output texture of any size', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
    vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const quarter = { width: 16, height: 9 }

  it('is drawn in the full-size output’s coordinates, written through Gyroflow’s output rect', async () => {
    const full = await paramsForSource(64, 48)
    const small = await paramsForSource(64, 48, sizedFrame(), quarter)

    // The geometry is the full size's: the output plane, its size (the bounds test and `out_c`), the matrices
    expect(small.params).toMatchObject({ width: 64, height: 48, outputWidth: 64, outputHeight: 36, matrixCount: 48, f: [50, 50] })
    expect(small.matrices).toEqual(full.matrices)
    // The texture is written through the output rect (flag 64, HAS_OUTPUT_RECT), as Gyroflow does for an output buffer
    // of another size than its output (`stabilization/mod.rs:303`); its rows are the texture's
    expect(small.params.flags & 64).toBe(64)
    expect(small.params.outputRect).toEqual([0, 0, 16, 9])
    expect(small.params.outputStride).toBe(16 * 4)
    // The pan moves by 0.5 * s - 0.5: the rect maps pixel corners, the kernel indexes pixel centres
    expect(small.params.translation).toEqual([0.5 * 4 - 0.5, 0.5 * 4 - 0.5])
    // The source side is untouched: a source at the frame's own size is read as it was
    expect(small.params.flags & 32).toBe(0)
    expect(small.params.sourceRect).toEqual(full.params.sourceRect)
  })

  it('takes both at once: a smaller source read through the source rect into a smaller output', async () => {
    const { params } = await paramsForSource(16, 12, sizedFrame(), quarter)

    expect(params.flags & (32 | 64)).toBe(32 | 64)
    expect(params.sourceRect).toEqual([0, 0, 16, 12])
    expect(params.outputRect).toEqual([0, 0, 16, 9])
  })

  it('leaves the kernel parameters of an output at the picture’s own size exactly as they were', async () => {
    const frame = sizedFrame()
    const { bytes } = await paramsForSource(64, 48, frame, { width: 64, height: 36 })

    expect(bytes).toEqual(prepareFrame(frame).params)
    expect(prepareFrame(frame, undefined, undefined, { width: 64, height: 36 }).params).toEqual(prepareFrame(frame).params)
  })

  it('takes a rounded size of the shape, and refuses another shape', () => {
    // 64x36 at a seventh is 9.14x5.14: 9x5 is the shape within a pixel
    expect(() => prepareFrame(sizedFrame(), undefined, undefined, { width: 9, height: 5 })).not.toThrow()
    expect(() => prepareFrame(sizedFrame(), undefined, undefined, { width: 16, height: 16 })).toThrow(/not the shape/)
    expect(() => prepareFrame(sizedFrame(), undefined, undefined, { width: 36, height: 64 })).toThrow(/not the shape/)
    expect(() => prepareFrame(sizedFrame(), undefined, undefined, { width: 0, height: 0 })).toThrow(/cannot be drawn/)
  })

  it('refuses a frame whose parameters already map the output through a rect', () => {
    const frame = sizedFrame()
    const view = new DataView(frame.params.buffer)
    view.setInt32(36, 64, true)
    expect(() => prepareFrame(frame, undefined, undefined, quarter)).toThrow(/already map the output/)
  })

  it('is the full-size picture box-filtered, within 38 dB, through the kernel’s own output-rect mapping', async () => {
    const kernel = assembleKernel(realAssets())
    // The two steps of the kernel this test follows: the output rect's mapping of a pixel's position onto the full-size
    // output, and the pan added after it, before the ray is made (`undistort_coord`)
    for (const line of [
      'if (bool(params.flags & 64)) { // Uses output rect',
      'map_coord(position.x, f32(params.output_rect.x), f32(params.output_rect.x + params.output_rect.z), 0.0, f32(params.output_width) ),',
      'out_pos += params.translation2d;',
    ]) {
      expect(kernel).toContain(line)
    }
    // ... and the position it is given is the fragment's centre minus half a pixel (transform 6)
    expect(kernel).toContain('undistort(position.xy + vec2<f32>(-0.5))')

    const { params } = await paramsForSource(64, 48, sizedFrame(), quarter)
    // The stabilized picture as a function of a full-size output position: a smooth picture seen through a ray
    const picture = (x: number, y: number): number =>
      0.5 + 0.25 * Math.sin((2 * Math.PI * x) / 24) * Math.cos((2 * Math.PI * y) / 20)
    const stabilizedAt = (x: number, y: number): number => picture(x * 0.85 + 5 + 0.06 * y, y * 0.85 + 10 - 0.06 * x)
    // What the kernel draws at texture pixel (qx, qy): its position (q, after transform 6) mapped through the rect, and
    // the pan added
    const mapped = (q: number, size: number, full: number, pan: number): number => (q * full) / size + pan
    const drawn = (pan: [number, number]): number[] => {
      const out: number[] = []
      for (let qy = 0; qy < quarter.height; qy += 1) {
        for (let qx = 0; qx < quarter.width; qx += 1) {
          out.push(stabilizedAt(mapped(qx, quarter.width, 64, pan[0]), mapped(qy, quarter.height, 36, pan[1])))
        }
      }
      return out
    }
    // The full-size warp, each 4x4 block of its pixels averaged: what the preview would show of the full-size picture
    const boxed: number[] = []
    for (let qy = 0; qy < quarter.height; qy += 1) {
      for (let qx = 0; qx < quarter.width; qx += 1) {
        let sum = 0
        for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) sum += stabilizedAt(4 * qx + x, 4 * qy + y)
        boxed.push(sum / 16)
      }
    }

    // 40.65 dB on this run: a point at each block's centre against the block's mean, on a picture whose period is 24
    // full-size pixels (6 texture pixels); the centre is right
    expect(psnr(drawn(params.translation), boxed)).toBeGreaterThan(38)
    // The test can tell: without the half-pixel pan every texture pixel shows the block's top-left pixel (24.20 dB)
    expect(psnr(drawn([0, 0]), boxed)).toBeLessThan(30)
  })
})

/**
 * One texel value as the kernel samples it, single-channel: the source rect's mapping when flag 32 is set (corners:
 * 0..width onto the rect), then Gyroflow's bilinear taps on whole texels with 1/32 steps (`INTER_TAB_SIZE`), a tap
 * outside the rect reading the background (0).
 */
function sampleLikeTheKernel(
  params: ReturnType<typeof readParams>,
  source: { width: number; height: number; at: (x: number, y: number) => number },
  uvx: number,
  uvy: number,
): number {
  const [rx, ry, rw, rh] = params.sourceRect
  let x = uvx
  let y = uvy
  if (params.flags & 32) {
    x = (x * rw) / params.width + rx
    y = (y * rh) / params.height + ry
  }
  const sx0 = Math.round(x * 32)
  const sy0 = Math.round(y * 32)
  const sx = sx0 >> 5
  const sy = sy0 >> 5
  const fx = (sx0 & 31) / 32
  const fy = (sy0 & 31) / 32
  let sum = 0
  for (let yp = 0; yp < 2; yp += 1) {
    for (let xp = 0; xp < 2; xp += 1) {
      const tx = sx + xp
      const ty = sy + yp
      const inside = tx >= rx && tx < rx + rw && ty >= ry && ty < ry + rh
      const weight = (yp ? fy : 1 - fy) * (xp ? fx : 1 - fx)
      sum += weight * (inside && tx < source.width && ty < source.height ? source.at(tx, ty) : 0)
    }
  }
  return sum
}

function psnr(a: number[], b: number[]): number {
  const mse = a.reduce((total, value, index) => total + (value - b[index]!) ** 2, 0) / a.length
  return 10 * Math.log10(1 / mse)
}

function maxDifference(a: number[], b: number[]): number {
  return a.reduce((most, value, index) => Math.max(most, Math.abs(value - b[index]!)), 0)
}


// ---------------------------------------------------------------------------------------------------------------------
// Per-encode data (review finding S8): N warps in one encoder, each with its own bytes

/** A device that keeps every byte written into every buffer, by buffer, and every bind group and dynamic offset drawn */
function arenaDevice() {
  const contents = new Map<object, Uint8Array>()
  const groups: Array<{ entries: GPUBindGroupEntry[] }> = []
  const draws: Array<{ group: { entries: GPUBindGroupEntry[] }; offsets: number[] }> = []
  const device = {
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createPipelineLayout: () => ({}),
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => ({ d }),
    createBindGroup: (d: GPUBindGroupDescriptor) => {
      const group = { entries: [...d.entries] }
      groups.push(group)
      return group
    },
    createBuffer: (d: GPUBufferDescriptor) => {
      const buffer = { label: d.label, size: d.size, destroy: () => {} }
      contents.set(buffer, new Uint8Array(d.size))
      return buffer
    },
    queue: {
      writeBuffer: (buffer: object, offset: number, data: ArrayBufferView) => {
        contents
          .get(buffer)!
          .set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset)
      },
      onSubmittedWorkDone: async () => {},
    },
    limits: { minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256 },
  }
  const recording = {
    beginRenderPass: () => {
      let group: { entries: GPUBindGroupEntry[] } | undefined
      let offsets: number[] = []
      return {
        setPipeline() {},
        setBindGroup(_i: number, g: { entries: GPUBindGroupEntry[] }, o: number[]) {
          group = g
          offsets = o
        },
        draw() {},
        end() {
          draws.push({ group: group!, offsets })
        },
      }
    },
  } as unknown as GPUCommandEncoder
  /** The bytes a binding reads in a draw: the range bound there, at the dynamic offset */
  const bound = (draw: (typeof draws)[number], binding: number): Uint8Array => {
    const resource = draw.group.entries.find((e) => e.binding === binding)!.resource as GPUBufferBinding
    const slot = binding === 0 ? 0 : binding === 1 ? 1 : 2
    const start = draw.offsets[slot]!
    return contents.get(resource.buffer)!.slice(start, start + (resource.size ?? 0))
  }
  return { device: device as unknown as GPUDevice, arenaDevice: device, recording, draws, bound }
}

describe('N warps in one encoder', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
    vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bind different ranges with different bytes (a stage-owned buffer would give both the last frame’s)', async () => {
    const rig = arenaDevice()
    const stage = await createStabilizationStage(rig.device, realAssets(), {
      input: 'rgba16float',
      output: 'rgba16float',
    })
    const arena = new FrameArena(rig.arenaDevice as unknown as ArenaDevice)
    const first = sizedFrame()
    const second = sizedFrame()
    new DataView(second.params.buffer).setFloat32(64, 77, true) // f
    second.matrices = second.matrices.map((value) => value + 100)

    arena.beginFrame()
    stage.warp(rig.recording, texture(64, 48), texture(64, 36), first, arena)
    stage.warp(rig.recording, texture(64, 48), texture(64, 36), second, arena)
    void arena.endFrame()

    expect(rig.draws).toHaveLength(2)
    const [a, b] = rig.draws as [(typeof rig.draws)[number], (typeof rig.draws)[number]]
    expect(a.offsets).not.toEqual(b.offsets)
    for (const offset of [...a.offsets, ...b.offsets]) expect(offset % 256).toBe(0)
    expect(readParams(rig.bound(a, 0)).f).toEqual([50, 50])
    expect(readParams(rig.bound(b, 0)).f).toEqual([77, 50])
    expect(new Float32Array(rig.bound(a, 1).buffer)[0]).toBe(1)
    expect(new Float32Array(rig.bound(b, 1).buffer)[0]).toBe(101)
  })

  it('bind the whole zeroed mesh when the frame has none, and a larger one as it is', async () => {
    const rig = arenaDevice()
    const stage = await createStabilizationStage(rig.device, realAssets(), {
      input: 'rgba16float',
      output: 'rgba16float',
    })
    const arena = new FrameArena(rig.arenaDevice as unknown as ArenaDevice)
    const big = { ...sizedFrame(), mesh: new Float32Array(2000).fill(3) }
    arena.beginFrame()
    stage.warp(rig.recording, texture(64, 48), texture(64, 36), sizedFrame(), arena)
    stage.warp(rig.recording, texture(64, 48), texture(64, 36), big, arena)
    void arena.endFrame()
    const [none, large] = rig.draws as [(typeof rig.draws)[number], (typeof rig.draws)[number]]
    expect(rig.bound(none, 3)).toEqual(new Uint8Array(4096))
    expect(rig.bound(large, 3).byteLength).toBe(8000)
    expect(new Float32Array(rig.bound(large, 3).buffer)[1999]).toBe(3)
  })

  it('without an arena, give each warp buffers of its own', async () => {
    const rig = arenaDevice()
    const stage = await createStabilizationStage(rig.device, realAssets(), {
      input: 'rgba16float',
      output: 'rgba16float',
    })
    const other = sizedFrame()
    new DataView(other.params.buffer).setFloat32(64, 77, true)
    stage.warp(rig.recording, texture(64, 48), texture(64, 36), sizedFrame())
    stage.warp(rig.recording, texture(64, 48), texture(64, 36), other)
    const [a, b] = rig.draws as [(typeof rig.draws)[number], (typeof rig.draws)[number]]
    expect(a.offsets).toEqual([0, 0, 0])
    expect(readParams(rig.bound(a, 0)).f).toEqual([50, 50])
    expect(readParams(rig.bound(b, 0)).f).toEqual([77, 50])
  })
})
