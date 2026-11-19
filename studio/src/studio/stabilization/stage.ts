// The stabilization stage: Gyroflow's warp shader (assembled by `kernel.ts`) as a WebGPU render pipeline that turns a
// source frame and one frame's stabilization data into the clip's stabilized picture, into the caller's command
// encoder.
//
// A texture in, a texture out: no submit, no readback, no knowledge of time, tracks or the project (design 6.3 §4.6).
// The precise path (3.1) hands it the decoded frame as a normalized float texture and an output texture at the clip's
// stabilized size, and records its own submit around the pass; today's renderer (C2) does the same from its GPU route.
//
// The two data transforms of the port that are not text (design 6.3 §4.1, items 7 and 8):
//
//   7. `max_pixel_value` and `pixel_value_limit` (bytes 352 and 364 of the kernel parameters) are 1.0, as Gyroflow's
//      wgpu path writes them for a normalized texture format (`stabilization/mod.rs:329-335`). The module's own
//      `frameData` reports 255, the 8-bit CPU warp's values, so `prepareFrame` rewrites them;
//   8. the `coeffs` storage buffer carries Gyroflow's table (`cpu_undistort.rs::COEFFS`) and `interpolation` is the
//      pipeline constant the shader's sampling loop is compiled for (bilinear, the only one the module produces).
//
// The per-frame data (the kernel parameters, the row matrices and the mesh) is uploaded through the caller's
// `StageUploads` - the frame arena of `render/stages/arena.ts` - and each range is bound with a dynamic offset, so N warps
// recorded into one encoder each keep their own bytes (review finding S8: one `writeBuffer`-ed buffer per stage gave
// all of them the last frame's data). Without uploads the stage allocates a buffer per warp, which is correct for any
// caller that records and submits one warp at a time (the probe page, the renderer's seat until the pipeline replaces it).
//
// Gyroflow's own GPU path is half a pixel off its CPU kernel; this stage keeps the CPU-matching convention (the -0.5 px
// correction `kernel.ts` applies), because the module's CPU warp is the reference tasks 6.2 and 6.3 measure against.
//
// The source texture may be any size: a proxy, or any decode that is not the file's own (review finding S2). The kernel
// then keeps the frame's own geometry - `f`, the matrices and the output plane are the frame's, because the shader builds
// the output plane from `f` (`out_f = params.f * stretch / params.fov`) and looks a pixel's rolling-shutter matrix up by
// the frame row its source position falls on - and reads the texture through Gyroflow's source rect, as Gyroflow does
// for an input buffer of another size than the video (`stabilization/mod.rs:302`, `HAS_SOURCE_RECT`). Scaling `f`, `c`
// and the size to the texture instead would zoom the output plane and pick the wrong row's matrix.

import { assembleKernel, type KernelAssets } from './kernel'

/** The bytes of Gyroflow's `KernelParams`, the kernel's uniform (design 6.3 §4.1) */
const KERNEL_PARAMS_BYTES = 416

/** Where the fields the stage reads are in those bytes (Gyroflow's struct, `KernelParams`, little-endian) */
const WIDTH = 0
const HEIGHT = 4
/** The input buffer's row length in bytes; the texture path does not read it, Gyroflow writes it for the input it has */
const STRIDE = 8
const OUTPUT_WIDTH = 12
const OUTPUT_HEIGHT = 16
/** How many row matrices the frame has; `matrix_count * 16` floats of `matrices` */
const MATRIX_COUNT = 24
const FLAGS = 36
const BYTES_PER_PIXEL = 40
/** The lens centre in the frame's pixels, two floats: added last to a ray's source position (`rotate_and_distort`) */
const LENS_CENTRE = 72
/** Where the frame is in the input, four integers (x, y, w, h): the whole buffer unless the engine crops */
const SOURCE_RECT = 240
/** `KernelParamsFlags::HAS_SOURCE_RECT`: the shader maps a source position from the frame onto `SOURCE_RECT` */
const HAS_SOURCE_RECT = 32
/** A normalized texture's values: the two floats that make the shader read one (`cpu_undistort.rs`'s are 255) */
const MAX_PIXEL_VALUE = 352
const PIXEL_VALUE_LIMIT = 364
/** Floats per row matrix: the shader indexes `row * 16` (design 6.3 §3.1) */
const MATRIX_STRIDE = 16
/** Gyroflow's `coeffs` table is 496 floats: 448 of interpolation weights, 44 of drawing colours, 4 alphas */
const COEFFS_FLOATS = 496
/** The `mesh_data` storage buffer is bound at this size at least (`gpu/wgpu.rs:404`), zeroed when a frame has no mesh */
const MESH_BYTES = 4096
/** The `drawing` storage buffer (16 bytes, never read: the pipeline's `flags` override, which the shader no longer reads) */
const DRAWING_BYTES = 16
/** The vertex list's length: Gyroflow's six positions, as a triangle strip (`gpu/wgpu.rs:475`) */
const VERTICES = 6

/** What the stage needs of the shader: `Stabilizer.shaderAssets`'s reply, as the wasm module gives it */
export interface StabilizationAssets extends KernelAssets {
  /** The `coeffs` storage buffer's contents: Gyroflow's coefficient table, 496 floats */
  coeffs: Float32Array
  /** The `interpolation` pipeline constant (bilinear, 2) */
  interpolation: number
}

/** One frame's stabilization data: the `frameData` reply's `matrices`, `params` and `mesh` */
export interface StabilizationFrame {
  /** Every sensor row's 4x4 matrix, flattened, 16 floats per row */
  matrices: Float32Array
  /** Gyroflow's `KernelParams`, 416 bytes, `max_pixel_value` and `pixel_value_limit` still the CPU warp's 255 */
  params: Uint8Array
  /** The frame's undistortion mesh, empty when it has none */
  mesh: Float32Array
}

/** The textures' formats: the input is a normalized float one (design 6.3 §0.5), the output the same */
export interface StabilizationFormats {
  input: GPUTextureFormat
  output: GPUTextureFormat
}

/** One uploaded range of per-frame data: bind `buffer` with `offset` as the dynamic offset and `size` as the binding size */
export interface StageUpload {
  readonly buffer: GPUBuffer
  readonly offset: number
  readonly size: number
}

/**
 * Where a frame's per-encode bytes go: the arena's `upload` writes `data` at a 256-byte-aligned offset of a slab and
 * returns where. The bytes of a returned range stay what they were until the frame that used them is done.
 */
export interface StageUploads {
  upload(data: ArrayBufferView): StageUpload
}

/** The stage the client, the precise path and today's renderer draw with */
export interface StabilizationStage {
  /**
   * Records one full-screen draw into `encoder`: `input` is the source frame at any size (the file's own, or a proxy's),
   * `output` the stabilized picture at the size the frame's kernel parameters name. The caller submits the encoder.
   * With `uploads` the frame's data goes into the caller's arena (any number of warps can share one encoder); without,
   * the stage allocates the buffers of this one warp.
   */
  warp(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    output: GPUTexture,
    frame: StabilizationFrame,
    uploads?: StageUploads,
  ): void
}

/**
 * The bindings that carry one frame's data and are bound with a dynamic offset: the kernel parameters, the row matrices
 * and the mesh. The coefficients and the drawing buffer are the stage's own, immutable.
 */
const PER_FRAME_BINDINGS: readonly number[] = [0, 1, 3]

/** A binding of the warp shader, as Gyroflow's bind group layout has it */
export interface StageBinding {
  binding: number
  kind: 'uniform' | 'storage' | 'texture'
}

/**
 * The shader's `@group(0)` bindings, in order: the kernel parameters, the row matrices, the coefficients, the
 * undistortion mesh, the drawing buffer (never read) and the input texture. The stage's layout is built from this, and
 * `stage.test.ts` holds it to the bindings the assembled shader declares.
 */
export const KERNEL_BINDINGS: readonly StageBinding[] = [
  { binding: 0, kind: 'uniform' },
  { binding: 1, kind: 'storage' },
  { binding: 2, kind: 'storage' },
  { binding: 3, kind: 'storage' },
  { binding: 4, kind: 'storage' },
  { binding: 5, kind: 'texture' },
]

/**
 * The formats the shader reads and writes: normalized floats, which is what makes `max_pixel_value` 1.0 right. An
 * integer texture would need a second shader variant (`u32` sampling), which the design leaves out (6.3 §4.1).
 */
export const NORMALIZED_FORMATS: readonly GPUTextureFormat[] = [
  'rgba8unorm',
  'rgba16float',
  'rgba32float',
]

/** One frame's data as the GPU takes it: fresh copies in the caller's own arrays, never views into the wasm memory */
export interface PreparedFrame {
  /**
   * `params`, copied, with `max_pixel_value` and `pixel_value_limit` set to 1.0, and the source rect, stride and lens
   * centre of a source texture that is not the frame's own size
   */
  params: Uint8Array
  /** `matrices`, copied */
  matrices: Float32Array
  /** `mesh`, copied */
  mesh: Float32Array
  /** The source frame's own size, as the kernel parameters state it: the frame's geometry, whatever the texture's */
  inputSize: [number, number]
  /** The stabilized frame's size, as the kernel parameters state it */
  outputSize: [number, number]
}

/**
 * The frame's data as the uniform and the storage buffers need it: copies, with the two floats a normalized texture
 * wants (transform 7), and the checks that would otherwise become a draw of garbage: the struct's size and the matrix
 * count against the matrices' length. With `source`, the size of the texture the frame is read from: when it is not
 * the frame's own size the texture is read through the source rect (`readThroughSourceRect`); at the frame's own size,
 * or without `source`, nothing else changes.
 */
export function prepareFrame(
  frame: StabilizationFrame,
  source?: { width: number; height: number },
): PreparedFrame {
  const { matrices, params, mesh } = frame
  if (params.byteLength !== KERNEL_PARAMS_BYTES) {
    throw new Error(
      `a frame's params are ${KERNEL_PARAMS_BYTES} bytes of Gyroflow's KernelParams, not ${params.byteLength}`,
    )
  }
  if (matrices.length === 0 || matrices.length % MATRIX_STRIDE !== 0) {
    throw new Error(
      `a frame's matrices are ${matrices.length} floats, not whole ${MATRIX_STRIDE}-float row matrices`,
    )
  }
  // A copy: the two floats below are rewritten, and the arrays may be a cache's window entry the caller reads again
  const uniform = new Uint8Array(params)
  const view = new DataView(uniform.buffer, uniform.byteOffset, uniform.byteLength)
  const matrixCount = view.getInt32(MATRIX_COUNT, true)
  if (matrixCount < 1 || matrixCount * MATRIX_STRIDE > matrices.length) {
    throw new Error(
      `a frame says ${matrixCount} row matrices, which needs ${matrixCount * MATRIX_STRIDE} floats, but has ${matrices.length}`,
    )
  }
  view.setFloat32(MAX_PIXEL_VALUE, 1, true)
  view.setFloat32(PIXEL_VALUE_LIMIT, 1, true)
  const inputSize: [number, number] = [view.getInt32(WIDTH, true), view.getInt32(HEIGHT, true)]
  if (source && (source.width !== inputSize[0] || source.height !== inputSize[1])) {
    readThroughSourceRect(view, inputSize, source)
  }
  return {
    params: uniform,
    matrices: new Float32Array(matrices),
    mesh: new Float32Array(mesh),
    inputSize,
    outputSize: [view.getInt32(OUTPUT_WIDTH, true), view.getInt32(OUTPUT_HEIGHT, true)],
  }
}

/**
 * Makes the kernel read a texture of another size than the frame, keeping the frame's own geometry:
 *
 * - the source rect (where the frame is in the input) is scaled to the texture, and `HAS_SOURCE_RECT` is set, so the
 *   shader maps each source position from the frame's pixels onto the texture's and bounds its taps by the rect;
 * - the stride is the texture's row, as Gyroflow writes it for its input buffer (the texture path does not read it);
 * - the lens centre moves by `0.5 - 0.5 / s` on each axis, `s` the rect's scale: the rect maps pixel corners (0..width
 *   onto rect.x..rect.x + rect.w) while the kernel indexes pixel centres, so without it a half-size texture is read
 *   half a frame pixel off (measured in `stage.test.ts`: 31.8 dB without, 41.95 dB with, on a 24-pixel pattern). The
 *   centre is only ever added to a ray's source position (`rotate_and_distort`), so nothing else moves.
 */
function readThroughSourceRect(
  view: DataView,
  [frameWidth, frameHeight]: [number, number],
  source: { width: number; height: number },
): void {
  if (!(source.width > 0) || !(source.height > 0) || !(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(
      `a ${source.width}x${source.height} source texture cannot be read for a ${frameWidth}x${frameHeight} frame`,
    )
  }
  const scaleX = source.width / frameWidth
  const scaleY = source.height / frameHeight
  const rect = [0, 1, 2, 3].map((index) => view.getInt32(SOURCE_RECT + index * 4, true))
  const [x, y, width, height] = [
    Math.round(rect[0]! * scaleX),
    Math.round(rect[1]! * scaleY),
    Math.round(rect[2]! * scaleX),
    Math.round(rect[3]! * scaleY),
  ]
  if (width < 1 || height < 1) {
    throw new Error(
      `the frame's source rect ${rect.join(',')} has no pixel left in a ${source.width}x${source.height} texture`,
    )
  }
  for (const [index, value] of [x, y, width, height].entries()) {
    view.setInt32(SOURCE_RECT + index * 4, value, true)
  }
  view.setInt32(STRIDE, source.width * view.getInt32(BYTES_PER_PIXEL, true), true)
  view.setInt32(FLAGS, view.getInt32(FLAGS, true) | HAS_SOURCE_RECT, true)
  const rectScaleX = width / frameWidth
  const rectScaleY = height / frameHeight
  view.setFloat32(LENS_CENTRE, view.getFloat32(LENS_CENTRE, true) + 0.5 - 0.5 / rectScaleX, true)
  view.setFloat32(
    LENS_CENTRE + 4,
    view.getFloat32(LENS_CENTRE + 4, true) + 0.5 - 0.5 / rectScaleY,
    true,
  )
}

function layoutEntries(): GPUBindGroupLayoutEntry[] {
  return KERNEL_BINDINGS.map(({ binding, kind }) => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    ...(kind === 'texture'
      ? { texture: { sampleType: 'unfilterable-float' as const } }
      : {
          buffer: {
            type: (kind === 'uniform' ? 'uniform' : 'read-only-storage') as GPUBufferBindingType,
            hasDynamicOffset: PER_FRAME_BINDINGS.includes(binding),
            ...(kind === 'uniform' ? { minBindingSize: KERNEL_PARAMS_BYTES } : {}),
          },
        }),
  }))
}

function sizeFor(bytes: number): number {
  return Math.max(4, Math.ceil(bytes / 4) * 4)
}

/**
 * Builds the stage: one pipeline of Gyroflow's shader for the two formats, and the buffers every frame's data goes
 * into. The pipeline compiles asynchronously (1.5-2.0 s cold, design 6.3 §5.3), so build the stage when stabilization
 * is switched on, not on the first frame.
 */
export async function createStabilizationStage(
  device: GPUDevice,
  assets: StabilizationAssets,
  formats: StabilizationFormats,
): Promise<StabilizationStage> {
  for (const [what, format] of [
    ['input', formats.input],
    ['output', formats.output],
  ] as const) {
    if (!NORMALIZED_FORMATS.includes(format)) {
      throw new Error(
        `the stabilization stage's ${what} format is ${format}: it reads and writes normalized float textures ` +
          `(${NORMALIZED_FORMATS.join(', ')}), because the shader works with max_pixel_value 1.0`,
      )
    }
  }
  if (assets.coeffs.length < COEFFS_FLOATS) {
    throw new Error(
      `Gyroflow's coefficient table is ${COEFFS_FLOATS} floats, not ${assets.coeffs.length}: ` +
        'pass shaderAssets().coeffs',
    )
  }

  const module = device.createShaderModule({ code: assembleKernel(assets), label: 'gyroflow warp' })
  const compilation = await module.getCompilationInfo()
  const errors = compilation.messages.filter((message) => message.type === 'error')
  if (errors.length > 0) {
    throw new Error(
      `Gyroflow's warp shader does not compile after the transforms:\n${errors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n')}`,
    )
  }

  const pipeline = await device.createRenderPipelineAsync({
    label: 'gyroflow warp',
    layout: device.createPipelineLayout({
      label: 'gyroflow warp',
      bindGroupLayouts: [
        device.createBindGroupLayout({ label: 'gyroflow warp', entries: layoutEntries() }),
      ],
    }),
    vertex: { module, entryPoint: 'undistort_vertex' },
    fragment: {
      module,
      entryPoint: 'undistort_fragment',
      targets: [{ format: formats.output }],
      // `interpolation` is the shader's own override; `pix_element_count`, `bytes_per_pixel` and `flags` keep their
      // declared values: nothing reads them after the buffer block and the flags reads are transformed away
      constants: { 100: assets.interpolation },
    },
    primitive: { topology: 'triangle-strip' },
  })

  const coeffsBuffer = device.createBuffer({
    label: 'stabilization coeffs',
    size: sizeFor(assets.coeffs.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(coeffsBuffer, 0, assets.coeffs)
  // Never read: the shader's drawing branch is off (`flags & 8` is 0), and the shader no longer reads the override
  const drawingBuffer = device.createBuffer({
    label: 'stabilization drawing',
    size: DRAWING_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  /** The buffers of one warp when the caller has no arena: right-sized, written once, never shared with another warp */
  const ownUploads = (): StageUploads => {
    let uploads = 0
    return {
      upload(data) {
        const label = ['stabilization params', 'stabilization matrices', 'stabilization mesh'][uploads++]
        const buffer = device.createBuffer({
          label,
          size: sizeFor(data.byteLength),
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(buffer, 0, data as unknown as BufferSource)
        return { buffer, offset: 0, size: data.byteLength }
      },
    }
  }

  return {
    warp(encoder, input, output, frame, uploads = ownUploads()) {
      const prepared = prepareFrame(frame, input)
      if (output.width !== prepared.outputSize[0] || output.height !== prepared.outputSize[1]) {
        throw new Error(
          `the output is ${output.width}x${output.height}, but the frame's kernel parameters are for a stabilized ` +
            `${prepared.outputSize[0]}x${prepared.outputSize[1]} picture`,
        )
      }
      if (output.format !== formats.output) {
        throw new Error(`the stage draws ${formats.output} textures, not ${output.format}`)
      }

      // The frame's own ranges, in the order `ownUploads` labels them: params, matrices, mesh
      const params = uploads.upload(prepared.params)
      const matrices = uploads.upload(prepared.matrices)
      const mesh = uploads.upload(paddedMesh(prepared.mesh))

      const bindGroup = device.createBindGroup({
        label: 'gyroflow warp',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params.buffer, offset: 0, size: params.size } },
          { binding: 1, resource: { buffer: matrices.buffer, offset: 0, size: matrices.size } },
          { binding: 2, resource: { buffer: coeffsBuffer } },
          { binding: 3, resource: { buffer: mesh.buffer, offset: 0, size: mesh.size } },
          { binding: 4, resource: { buffer: drawingBuffer } },
          { binding: 5, resource: input.createView() },
        ],
      })

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: output.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      })
      pass.setPipeline(pipeline)
      // The dynamic offsets are the per-frame bindings' (0, 1 and 3), in binding order
      pass.setBindGroup(0, bindGroup, [params.offset, matrices.offset, mesh.offset])
      pass.draw(VERTICES)
      pass.end()
    },
  }
}

/** The mesh as the buffer is bound: at least `MESH_BYTES` (zeroed when the frame has no mesh), as Gyroflow binds it */
function paddedMesh(mesh: Float32Array): Float32Array {
  if (mesh.byteLength >= MESH_BYTES) return mesh
  const padded = new Float32Array(MESH_BYTES / Float32Array.BYTES_PER_ELEMENT)
  padded.set(mesh)
  return padded
}
