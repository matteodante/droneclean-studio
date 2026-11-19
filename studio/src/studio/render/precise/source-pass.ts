import {
  PRECISE_RENDER_FORMAT,
  preciseFrameBytes,
  precisePlaneLayout,
  type ColourTags,
  type PreciseFrame,
} from './contract'

/**
 * The largest 10-bit code value. The GPU divides by it, so 0–1023 becomes 0–1; the WGSL below writes
 * `f32(code) / 1023.0` from this constant rather than repeating the number.
 */
export const PRECISE_SOURCE_CODE_MAX = 1023

/**
 * The descriptor of the source texture at a decoded frame's size: `rgba16float` (the float
 * composite's format, design 3.1 §4.3), one mip level, sampled by the later stages and written by
 * this pass. It is never a copy source: the readback packs the composite, not the source.
 */
export function preciseSourceTextureDescriptor(width: number, height: number): GPUTextureDescriptor {
  return {
    label: 'precise-source',
    size: { width, height },
    format: PRECISE_RENDER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }
}

/**
 * The source stage of the precise path (design 3.1, slice P3): a decoded `gbrp10le` frame becomes
 * the normalized float source texture the later stages sample.
 *
 * **Where it sits.** `source frame -> this pass -> stabilize (6.3) -> input colour (5.1) ->
 * effects -> transform -> composite`. It is the one place a source frame changes format: FFmpeg
 * has already made the YUV->RGB conversion and expanded the range to full (design 3.1, section
 * 4.4), so the GPU's whole job is to divide each plane's 10-bit code by
 * `PRECISE_SOURCE_CODE_MAX`, once, at the source size, into the texture
 * `preciseSourceTextureDescriptor` describes.
 *
 * **What the caller gets** (the interface 6.3 and 5.1 build on). A `PreciseSourceFrame`:
 * - `texture` and `view`: `PRECISE_RENDER_FORMAT` at the source size, values 0..1, alpha 1. A
 *   *normalized float* texture and not an integer one, so 6.3's `StabilizationStage.warp` takes it
 *   as its `input` and 5.1's `InputColorPass.encode` takes `view` as its `input`, with no
 *   `max_pixel_value` or division of their own.
 * - `frame`: the contract's `PreciseFrame`, so `preciseFramePts(frame)` is the encoder's PTS and
 *   `frameToSeconds(frame.rate, frame.index)` the frame's exact time. Nothing is derived from a
 *   float frame rate.
 * - `colour`: the decoder's `ColourTags`. It is carried, not applied here.
 *
 * **Who calls it.** P4's native decoder (`native-source.ts`). The source-frame provider's native
 * backend, which copies its frames into textures of its own (design 3.6 section 2.4), comes with
 * the decode rings of design 3.6 section 2.16 (slice 7); slice 3's commit `25e42ea39` has it.
 */

/** What a pass is made for: one source file's size and colour description. */
export interface SourcePassOptions {
  readonly width: number
  readonly height: number
  readonly colour: ColourTags
}

/** One decoded frame as the pass hands it on. */
export interface PreciseSourceFrame {
  /**
   * `PRECISE_RENDER_FORMAT` at the source size, values 0..1, alpha 1. It belongs to the pass and is
   * overwritten by the next `uploadFrame`.
   */
  readonly texture: GPUTexture
  /** The same texture as a view, for a stage that takes a `GPUTextureView`. */
  readonly view: GPUTextureView
  readonly width: number
  readonly height: number
  /** The frame's exact place in the source: index, rate and the duration it occupies. */
  readonly frame: PreciseFrame
  readonly colour: ColourTags
}

export interface SourcePass {
  /**
   * Uploads one decoded `gbrp10le` frame and turns it into the source texture.
   *
   * `data` is one whole frame exactly as FFmpeg's raw `gbrp10le` stream carries it: the planes in
   * the contract's order, each `width * height` 16-bit little-endian samples with no row padding.
   * The pass submits its own conversion, so submit the work that reads the returned texture before
   * uploading the next frame; a caller that needs two frames alive at once creates two passes.
   */
  uploadFrame(data: Uint8Array, frame: PreciseFrame): PreciseSourceFrame
  /** Releases the pass's GPU textures. */
  destroy(): void
}

/**
 * Throws unless `data` is exactly one tightly packed `gbrp10le` frame of this size. A stream frame
 * whose length disagrees with the size would upload silently shifted planes, so it fails here.
 */
export function assertGbrp10leFrame(data: Uint8Array, width: number, height: number): void {
  const expected = preciseFrameBytes('gbrp10le', width, height)
  if (data.byteLength !== expected) {
    throw new Error(
      `precise source pass: a ${width}x${height} gbrp10le frame is ${expected} bytes, got ${data.byteLength}`,
    )
  }
}

/**
 * The whole job of the GPU: one full-screen triangle that reads each plane with `textureLoad`
 * (integer textures, no filtering), divides each code by `PRECISE_SOURCE_CODE_MAX`, and writes the
 * planes into R, G, B and alpha 1. Binding 0, 1 and 2 are the contract's `gbrp10le` planes in its
 * order (G, B, R). `@builtin(position)` is the target pixel, so there is no uv round trip.
 */
const SOURCE_PASS_WGSL = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VertexOut;
  out.position = vec4f(corners[index], 0.0, 1.0);
  return out;
}

@group(0) @binding(0) var greenPlane: texture_2d<u32>;
@group(0) @binding(1) var bluePlane: texture_2d<u32>;
@group(0) @binding(2) var redPlane: texture_2d<u32>;

const MAX_CODE: f32 = ${PRECISE_SOURCE_CODE_MAX}.0;

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(greenPlane));
  let pixel = clamp(vec2i(position.xy), vec2i(0), dimensions - vec2i(1));
  let g = f32(textureLoad(greenPlane, pixel, 0).r) / MAX_CODE;
  let b = f32(textureLoad(bluePlane, pixel, 0).r) / MAX_CODE;
  let r = f32(textureLoad(redPlane, pixel, 0).r) / MAX_CODE;
  return vec4f(clamp(vec3f(r, g, b), vec3f(0.0), vec3f(1.0)), 1.0);
}
`

/**
 * Creates the pass for one source file: the staging planes from the contract's `gbrp10le` layout,
 * the source texture of `preciseSourceTextureDescriptor`, and the pipeline that converts between them.
 */
export function createSourcePass(device: GPUDevice, options: SourcePassOptions): SourcePass {
  const { width, height, colour } = options
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(
      `precise source pass: the size must be positive integers, got ${width}x${height}`,
    )
  }

  const layout = precisePlaneLayout('gbrp10le', width, height)
  const planes = layout.map((plane) => ({
    plane,
    texture: device.createTexture({
      label: `precise-source-${plane.channel}`,
      size: { width: plane.width, height: plane.height },
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    }),
  }))

  const texture = device.createTexture(preciseSourceTextureDescriptor(width, height))
  const view = texture.createView()

  const module = device.createShaderModule({ label: 'precise-source', code: SOURCE_PASS_WGSL })
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'precise-source-layout',
    entries: layout.map((_plane, binding) => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'uint' as const },
    })),
  })
  const pipeline = device.createRenderPipeline({
    label: 'precise-source-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format: PRECISE_RENDER_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
  })
  const bindGroup = device.createBindGroup({
    label: 'precise-source-bindings',
    layout: bindGroupLayout,
    entries: planes.map((entry, binding) => ({
      binding,
      resource: entry.texture.createView(),
    })),
  })

  return {
    uploadFrame(data, frame) {
      assertGbrp10leFrame(data, width, height)
      for (const { plane, texture: planeTexture } of planes) {
        device.queue.writeTexture(
          { texture: planeTexture },
          data.subarray(plane.offset, plane.offset + plane.sizeBytes),
          { bytesPerRow: plane.stride, rowsPerImage: plane.height },
          { width: plane.width, height: plane.height, depthOrArrayLayers: 1 },
        )
      }

      const encoder = device.createCommandEncoder({ label: 'precise-source' })
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])

      return { texture, view, width, height, frame, colour }
    },

    destroy() {
      for (const entry of planes) {
        entry.texture.destroy()
      }
      texture.destroy()
    },
  }
}
