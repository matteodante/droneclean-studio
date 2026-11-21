// A decoded frame reduced for the preview (design 8.10): one full-screen pass from the provider's `rgba16float` frame
// into a smaller texture of the pipeline's own, each output pixel the mean of the source block it covers. A box and not
// a single bilinear tap: the stabilization's warp then reads a picture whose fine detail is already averaged, so a
// quarter-size preview does not shimmer where the full-size frame has detail finer than its pixels.
//
// The mean is taken with bilinear taps of the hardware sampler, `ceil(scale / 2)` on each axis, each tap on the corner
// between two source pixels: at a whole even scale that is exactly the block's mean, at another scale close to it.

import type { Size } from './types'

/** The source frame's format and every reduced frame's (design 3.6 section 2.6) */
const FORMAT: GPUTextureFormat = 'rgba16float'

// The WebGPU usage flags, as the spec numbers them (the module loads where there is no GPU, as arena.ts does)
const TEXTURE_COPY_SRC = 0x01
const TEXTURE_BINDING = 0x04
const RENDER_ATTACHMENT = 0x10
const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40

/** A reduced frame is read as a source frame is (a stage samples it, a run with no stage copies it) */
const REDUCED_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC

/** How many free textures of one size are kept for the next frames: the frames of one gather group and a few more */
const FREE_PER_SIZE = 6

const REDUCE_WGSL = /* wgsl */ `
struct Reduction {
  scale: vec2f,
  taps: vec2u,
}

@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> reduction: Reduction;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(picture));
  // The block of source pixels this output pixel covers, in pixel-corner coordinates
  let start = floor(position.xy) * reduction.scale;
  let taps = vec2f(reduction.taps);
  let step = reduction.scale / taps;
  var sum = vec4f(0.0);
  for (var y = 0u; y < reduction.taps.y; y += 1u) {
    for (var x = 0u; x < reduction.taps.x; x += 1u) {
      let at = start + (vec2f(f32(x), f32(y)) + 0.5) * step;
      sum += textureSampleLevel(picture, linearSampler, at / size, 0.0);
    }
  }
  return sum / (taps.x * taps.y);
}
`

/** How many bilinear taps cover `scale` source pixels on one axis: each tap on a pixel corner averages two */
export function reductionTaps(scale: number): number {
  return Math.max(1, Math.ceil(scale / 2))
}

/** The pass and the reduced frames' textures of one pipeline */
export interface FrameReducer {
  /** Records and submits the reduction of `source` into a texture of `size`; give it back with `release` */
  reduce(source: GPUTexture, size: Size): GPUTexture
  /** A reduced texture back, for the next frame of its size */
  release(texture: GPUTexture): void
  /** Destroys every texture it made */
  destroy(): void
}

/** The reducer of one device; the pass is built when it is first used */
export function createFrameReducer(device: GPUDevice): FrameReducer {
  let built: { pipeline: GPURenderPipeline; sampler: GPUSampler } | undefined
  /** One uniform per (source size, reduced size): a clip's sizes are few and stable */
  const uniforms = new Map<string, GPUBuffer>()
  const free = new Map<string, GPUTexture[]>()
  const made = new Set<GPUTexture>()
  const keyOf = (size: Size): string => `${size.width}x${size.height}`

  const pass = () => {
    built ??= (() => {
      const module = device.createShaderModule({ label: 'preview frame reduction', code: REDUCE_WGSL })
      return {
        pipeline: device.createRenderPipeline({
          label: 'preview frame reduction',
          layout: 'auto',
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: FORMAT }] },
          primitive: { topology: 'triangle-list' },
        }),
        sampler: device.createSampler({ label: 'preview frame reduction', magFilter: 'linear', minFilter: 'linear' }),
      }
    })()
    return built
  }

  const uniformFor = (source: Size, size: Size): GPUBuffer => {
    const key = `${keyOf(source)}>${keyOf(size)}`
    const known = uniforms.get(key)
    if (known !== undefined) return known
    const scaleX = source.width / size.width
    const scaleY = source.height / size.height
    const bytes = new ArrayBuffer(16)
    new Float32Array(bytes, 0, 2).set([scaleX, scaleY])
    new Uint32Array(bytes, 8, 2).set([reductionTaps(scaleX), reductionTaps(scaleY)])
    const buffer = device.createBuffer({ label: 'preview frame reduction', size: 16, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
    device.queue.writeBuffer(buffer, 0, bytes)
    uniforms.set(key, buffer)
    return buffer
  }

  const take = (size: Size): GPUTexture => {
    const reused = free.get(keyOf(size))?.pop()
    if (reused !== undefined) return reused
    const texture = device.createTexture({
      label: 'reduced-source-frame',
      size: { width: size.width, height: size.height },
      format: FORMAT,
      usage: REDUCED_USAGE,
    })
    made.add(texture)
    return texture
  }

  return {
    reduce(source, size) {
      const { pipeline, sampler } = pass()
      const target = take(size)
      const encoder = device.createCommandEncoder({ label: 'preview frame reduction' })
      const render = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      })
      render.setPipeline(pipeline)
      render.setBindGroup(
        0,
        device.createBindGroup({
          label: 'preview frame reduction',
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: source.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: uniformFor(source, size) } },
          ],
        }),
      )
      render.draw(3)
      render.end()
      device.queue.submit([encoder.finish()])
      return target
    },

    release(texture) {
      if (!made.has(texture)) return
      const list = free.get(keyOf(texture)) ?? []
      free.set(keyOf(texture), list)
      if (list.includes(texture)) return
      if (list.length >= FREE_PER_SIZE) {
        made.delete(texture)
        texture.destroy()
        return
      }
      list.push(texture)
    },

    destroy() {
      for (const texture of made) texture.destroy()
      made.clear()
      free.clear()
      for (const buffer of uniforms.values()) buffer.destroy()
      uniforms.clear()
    },
  }
}
