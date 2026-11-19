/**
 * The float look stage on the GPU: one render pipeline that samples a look's `.cube` table
 * tetrahedrally from an `rgba16float` 3D texture, implementing `LookPass` (design 5.1 §4.4, §4.6).
 *
 * A look runs after the input transform, so its input is display-referred Rec.709 in 0…1; its
 * output is the same size, in the caller's format. The shader is `sampleTetrahedralFloat32` of
 * `../tetrahedral.ts` in WGSL, operation for operation: the shaper (when the file has one), the
 * grid's input domain, the cell and its fraction, the six-tetrahedron choice, and four corners
 * blended left to right. It reads the table with `textureLoad` — no sampler, so no filtering and no
 * `float32-filterable` feature (design 5.1 §4.4).
 *
 * The table is uploaded as `lut-texture.ts` lays it out: entry `r + g·size + b·size²` at texel
 * `(x, y, z) = (r, g, b)`, `rgba16float`, 8 bytes a texel — 2.10 MB for a 65³ table.
 *
 * **The 1D shaper** (a `.cube` with `LUT_1D_SIZE` beside its `LUT_3D_SIZE`) is a 1024×1
 * `rgba16float` texture (design 5.1 §4.4): the file's table resampled to 1024 entries over its own
 * domain, then read with linear interpolation between two entries, so a 10-bit code lands on an
 * entry and interpolates with weight 0. A file with only `LUT_1D_SIZE` has no grid and is not a
 * look.
 *
 * **The uniform.** 16 floats an encode: the grid's input domain and the intensity, the grid's
 * points per side, and the shaper's input domain with the flag that says whether it is there. It is
 * written to a small buffer per `encode` call, because two looks can be recorded into one encoder
 * before the submit and a shared buffer would hand both the last values.
 */

import {
  CUBE_MAX_SHAPER_SIZE,
  CUBE_MAX_SIZE,
  CUBE_MIN_SIZE,
  type CubeLut1D,
  type CubeLut3D,
  type ParsedCube,
} from '../cube'
import {
  LUT_TEXTURE_BYTES_PER_TEXEL,
  LUT_TEXTURE_FORMAT,
  createLutTextureLayout,
  encodeLutTexture,
  floatToHalfBits,
  type LookId,
  type LookPass,
} from '../lut-texture'
import { FULLSCREEN_VERTEX_WGSL, assertPassSize, createPassPipeline } from './pass'

/** Floats in the look pass's uniform: the four `vec4f` of the shader's `Uniforms` struct. */
export const LOOK_UNIFORM_FLOATS = 16

/** Bytes in that uniform: 16 floats. */
const LOOK_UNIFORM_BYTES = LOOK_UNIFORM_FLOATS * 4

/** Entries in the shaper texture: 1024×1, one per 10-bit code (design 5.1 §4.4). */
export const LOOK_SHAPER_SIZE = 1024

/**
 * The texture formats the pass reads and writes: the normalized float formats of the precise path
 * and of today's 8-bit preview. The look's own table is always `rgba16float` (`lut-texture.ts`).
 */
export const LOOK_FORMATS: readonly GPUTextureFormat[] = ['rgba8unorm', 'rgba16float']

/**
 * `GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST`, spelled out because
 * `GPUTextureUsage` is a browser global while this module's tests run in Node.
 */
const LOOK_TEXTURE_USAGE = 0x04 | 0x02

/** The half-float bit pattern of 1.0: the alpha every shaper texel and table entry carries. */
const HALF_ONE_BITS = 0x3c00

/** Where one encode's uniform goes: the arena's `upload`, whose ranges keep their bytes until the frame is done. */
export interface LookUploads {
  upload(data: ArrayBufferView): { readonly buffer: GPUBuffer; readonly offset: number; readonly size: number }
}

/**
 * The look pass as the looks library drives it: `LookPass` (one `encode`) plus the table's
 * lifetime — a look's textures appear when its file is read and go when it is removed.
 */
export interface LookStage extends LookPass {
  /**
   * Records the look's render pass. With `uploads` (the frame arena of `render/stages/arena.ts`) the 64-byte uniform goes
   * into the caller's arena and is bound with a dynamic offset; without, a buffer of its own is made for this encode.
   */
  encode(
    encoder: GPUCommandEncoder,
    input: GPUTextureView,
    output: GPUTextureView,
    look: LookId,
    intensity: number,
    size: { readonly width: number; readonly height: number },
    uploads?: LookUploads,
  ): void
  /**
   * Uploads one parsed `.cube` as a look, replacing a look of the same id. `cube.lut3d` must be
   * there: a file with only a 1D table is a shaper, not a look.
   */
  setLook(look: LookId, cube: ParsedCube): void
  /** Releases a look's textures; a look that is not loaded is ignored. */
  removeLook(look: LookId): void
  /** Releases every look's textures and the identity shaper. The pipelines stay with the device. */
  destroy(): void
}

/**
 * One look's 16 uniform floats, in the layout `lookShader`'s `Uniforms` struct declares:
 *
 * ```
 * 0..3    gridMin.xyz: the 3D table's input domain minimum; gridMin.w: the intensity
 * 4..7    gridMax.xyz: the 3D table's input domain maximum; gridMax.w: the table's points per side
 * 8..11   shaperMin.xyz: the shaper's input domain minimum; shaperMin.w: 1 when there is a shaper
 * 12..15  shaperMax.xyz: the shaper's input domain maximum
 * ```
 */
export function packLookUniforms(cube: ParsedCube, intensity: number): Float32Array {
  const table = cube.lut3d
  if (table === null) {
    throw new Error(
      'packLookUniforms: the .cube file has no LUT_3D_SIZE, so it holds a shaper and not a look',
    )
  }
  if (!Number.isInteger(table.size) || table.size < CUBE_MIN_SIZE || table.size > CUBE_MAX_SIZE) {
    throw new RangeError(
      `packLookUniforms: the table's size must be an integer between ${CUBE_MIN_SIZE} and ${CUBE_MAX_SIZE}, got ${table.size}`,
    )
  }
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    throw new RangeError(
      `packLookUniforms: the intensity must be a number from 0 to 1, got ${intensity}`,
    )
  }
  const floats = new Float32Array(LOOK_UNIFORM_FLOATS)
  floats[0] = table.domainMin[0]
  floats[1] = table.domainMin[1]
  floats[2] = table.domainMin[2]
  floats[3] = intensity
  floats[4] = table.domainMax[0]
  floats[5] = table.domainMax[1]
  floats[6] = table.domainMax[2]
  floats[7] = table.size
  const shaper = cube.shaper
  if (shaper !== null) {
    floats[8] = shaper.domainMin[0]
    floats[9] = shaper.domainMin[1]
    floats[10] = shaper.domainMin[2]
    floats[11] = 1
    floats[12] = shaper.domainMax[0]
    floats[13] = shaper.domainMax[1]
    floats[14] = shaper.domainMax[2]
  }
  return floats
}

/** Throws unless a 1D shaper is a table this pass can resample. */
function assertShaper(functionName: string, shaper: CubeLut1D): void {
  if (
    !Number.isInteger(shaper.size) ||
    shaper.size < CUBE_MIN_SIZE ||
    shaper.size > CUBE_MAX_SHAPER_SIZE
  ) {
    throw new RangeError(
      `${functionName}: the shaper's size must be an integer between ${CUBE_MIN_SIZE} and ${CUBE_MAX_SHAPER_SIZE}, got ${shaper.size}`,
    )
  }
  if (shaper.data.length !== shaper.size * 3) {
    throw new RangeError(
      `${functionName}: the shaper's data must hold ${shaper.size * 3} values, got ${shaper.data.length}`,
    )
  }
}

/**
 * One channel of a 1D shaper at an input value: the file's domain, then linear interpolation
 * between the neighbouring entries — what `tetrahedral.ts`'s `shaperChannel` does, in float64.
 */
function shaperChannel(shaper: CubeLut1D, value: number, channel: number): number {
  const minimum = shaper.domainMin[channel] as number
  const maximum = shaper.domainMax[channel] as number
  const range = maximum - minimum
  const normalized = range === 0 ? 0 : Math.min(Math.max((value - minimum) / range, 0), 1)
  const coordinate = normalized * (shaper.size - 1)
  const index = Math.min(Math.floor(coordinate), shaper.size - 2)
  const fraction = coordinate - index
  const from = shaper.data[index * 3 + channel] as number
  const to = shaper.data[(index + 1) * 3 + channel] as number
  return from + (to - from) * fraction
}

/**
 * The bytes of a look's 1024×1 shaper texture: the file's 1D table resampled onto 1024 entries
 * spread over its own input domain, then stored as `rgba16float` with alpha 1. A 10-bit source
 * code lands on an entry, so the shader's interpolation is exact there; a longer file is resampled
 * down to the 1024 entries the design fixes.
 */
export function encodeShaperTexture(shaper: CubeLut1D): Uint8Array {
  assertShaper('encodeShaperTexture', shaper)
  const bytes = new Uint8Array(LOOK_SHAPER_SIZE * LUT_TEXTURE_BYTES_PER_TEXEL)
  let offset = 0
  for (let index = 0; index < LOOK_SHAPER_SIZE; index++) {
    const position = index / (LOOK_SHAPER_SIZE - 1)
    for (let channel = 0; channel < 3; channel++) {
      const minimum = shaper.domainMin[channel] as number
      const maximum = shaper.domainMax[channel] as number
      const value = minimum + (maximum - minimum) * position
      const bits = floatToHalfBits(shaperChannel(shaper, value, channel))
      bytes[offset++] = bits & 0xff
      bytes[offset++] = bits >>> 8
    }
    bytes[offset++] = HALF_ONE_BITS & 0xff
    bytes[offset++] = HALF_ONE_BITS >>> 8
  }
  return bytes
}

/** The identity shaper: the table a look without one binds, which the shader never reads. */
function identityShaper(): CubeLut1D {
  const data = new Float32Array(LOOK_SHAPER_SIZE * 3)
  for (let index = 0; index < LOOK_SHAPER_SIZE; index++) {
    const value = index / (LOOK_SHAPER_SIZE - 1)
    data[index * 3] = value
    data[index * 3 + 1] = value
    data[index * 3 + 2] = value
  }
  return { size: LOOK_SHAPER_SIZE, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
}

/**
 * The look pass's fragment stage: `sampleTetrahedralFloat32` of `../tetrahedral.ts` in WGSL, with
 * the shaper in front of the grid and the looked image blended with the input by the intensity.
 * The text is a module constant: it is data, not a step.
 */
const LOOK_FRAGMENT_WGSL = /* wgsl */ `
struct Uniforms {
  gridMin: vec4f,
  gridMax: vec4f,
  shaperMin: vec4f,
  shaperMax: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var lutTexture: texture_3d<f32>;
@group(0) @binding(3) var shaperTexture: texture_2d<f32>;

const SHAPER_SIZE: f32 = ${LOOK_SHAPER_SIZE}.0;

// One channel of the shaper: the file's domain, then the two neighbouring entries blended by the
// fraction — a 10-bit code lands on an entry and interpolates with weight 0.
fn shaperChannel(value: f32, minimum: f32, maximum: f32, channel: u32) -> f32 {
  let range = maximum - minimum;
  let normalized = select(0.0, clamp((value - minimum) / range, 0.0, 1.0), range != 0.0);
  let coordinate = normalized * (SHAPER_SIZE - 1.0);
  let index = min(i32(floor(coordinate)), i32(SHAPER_SIZE) - 2);
  let fraction = coordinate - f32(index);
  let lower = textureLoad(shaperTexture, vec2i(index, 0), 0);
  let upper = textureLoad(shaperTexture, vec2i(index + 1, 0), 0);
  return lower[channel] + (upper[channel] - lower[channel]) * fraction;
}

fn shaper(value: vec3f) -> vec3f {
  if (uniforms.shaperMin.w < 0.5) {
    return value;
  }
  return vec3f(
    shaperChannel(value.x, uniforms.shaperMin.x, uniforms.shaperMax.x, 0u),
    shaperChannel(value.y, uniforms.shaperMin.y, uniforms.shaperMax.y, 1u),
    shaperChannel(value.z, uniforms.shaperMin.z, uniforms.shaperMax.z, 2u),
  );
}

fn corner(cell: vec3u, offset: vec3u) -> vec4f {
  return textureLoad(lutTexture, vec3i(cell + offset), 0);
}

// The six tetrahedra of tetrahedral.ts's tetrahedralChannel, with the same conditions in the same
// order: a = c000, b = the first corner after it, c = the second, d = c111. The four weights sum to
// 1, and the blend runs left to right.
fn tetrahedral(cell: vec3u, f: vec3f) -> vec3f {
  let c000 = corner(cell, vec3u(0u, 0u, 0u));
  let c100 = corner(cell, vec3u(1u, 0u, 0u));
  let c010 = corner(cell, vec3u(0u, 1u, 0u));
  let c110 = corner(cell, vec3u(1u, 1u, 0u));
  let c001 = corner(cell, vec3u(0u, 0u, 1u));
  let c101 = corner(cell, vec3u(1u, 0u, 1u));
  let c011 = corner(cell, vec3u(0u, 1u, 1u));
  let c111 = corner(cell, vec3u(1u, 1u, 1u));
  var a = c000.rgb;
  var b = c100.rgb;
  var c = c110.rgb;
  var d = c111.rgb;
  var w0 = 1.0 - f.x;
  var w1 = f.x - f.y;
  var w2 = f.y - f.z;
  var w3 = f.z;
  if (f.x > f.y) {
    if (f.y <= f.z) {
      if (f.x > f.z) {
        // x > z >= y
        b = c100.rgb;
        c = c101.rgb;
        d = c111.rgb;
        w0 = 1.0 - f.x;
        w1 = f.x - f.z;
        w2 = f.z - f.y;
        w3 = f.y;
      } else {
        // z >= x > y
        b = c001.rgb;
        c = c101.rgb;
        d = c111.rgb;
        w0 = 1.0 - f.z;
        w1 = f.z - f.x;
        w2 = f.x - f.y;
        w3 = f.y;
      }
    }
  } else if (f.z > f.y) {
    // z > y >= x
    b = c001.rgb;
    c = c011.rgb;
    d = c111.rgb;
    w0 = 1.0 - f.z;
    w1 = f.z - f.y;
    w2 = f.y - f.x;
    w3 = f.x;
  } else if (f.z > f.x) {
    // y >= z > x
    b = c010.rgb;
    c = c011.rgb;
    d = c111.rgb;
    w0 = 1.0 - f.y;
    w1 = f.y - f.z;
    w2 = f.z - f.x;
    w3 = f.x;
  } else {
    // y >= x >= z
    b = c010.rgb;
    c = c110.rgb;
    d = c111.rgb;
    w0 = 1.0 - f.y;
    w1 = f.y - f.x;
    w2 = f.x - f.z;
    w3 = f.z;
  }
  return a * w0 + b * w1 + c * w2 + d * w3;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let texel = textureLoad(inputTexture, vec2i(position.xy), 0);
  let source = shaper(texel.rgb);
  let range = uniforms.gridMax.xyz - uniforms.gridMin.xyz;
  let t = select(
    vec3f(0.0),
    clamp((source - uniforms.gridMin.xyz) / range, vec3f(0.0), vec3f(1.0)),
    range != vec3f(0.0),
  );
  let size = u32(uniforms.gridMax.w);
  let coordinate = t * f32(size - 1u);
  let cell = min(vec3u(coordinate), vec3u(size - 2u));
  let f = coordinate - vec3f(cell);
  let looked = tetrahedral(cell, f);
  return vec4f(mix(texel.rgb, looked, uniforms.gridMin.w), 1.0);
}
`

/**
 * The look pass's shader: the full-screen vertex stage and the fragment stage that ports
 * `sampleTetrahedralFloat32` of `../tetrahedral.ts`.
 */
export function lookShader(): string {
  return `${FULLSCREEN_VERTEX_WGSL}${LOOK_FRAGMENT_WGSL}`
}

/** The pass's formats: what the caller feeds it and what it draws into. */
export interface LookFormats {
  readonly input: GPUTextureFormat
  readonly output: GPUTextureFormat
}

/** Throws unless a format is one the pass's shader reads or writes. */
function assertFormat(
  functionName: string,
  what: 'input' | 'output',
  format: GPUTextureFormat,
): void {
  if (!LOOK_FORMATS.includes(format)) {
    throw new Error(
      `${functionName}: the ${what} format is ${format}; the look pass reads and writes ` +
        `${LOOK_FORMATS.join(' or ')} textures`,
    )
  }
}

/** One look's textures: its 3D table, and the shaper when the file has one. */
interface LookTextures {
  readonly lut: GPUTexture
  readonly lutView: GPUTextureView
  /** The look's own shaper texture, or null when the file has none. */
  readonly shaper: GPUTexture | null
}

/** One loaded look: its textures, the shaper view to bind, and the cube `encode` packs. */
interface LoadedLook extends LookTextures {
  readonly shaperView: GPUTextureView
  readonly cube: ParsedCube
}

/** The textures of a 1024×1 `rgba16float` shaper, uploaded from a 1D table. */
function createShaperTexture(device: GPUDevice, shaper: CubeLut1D): GPUTexture {
  const texture = device.createTexture({
    label: `look shaper ${shaper.size}`,
    size: { width: LOOK_SHAPER_SIZE, height: 1 },
    format: LUT_TEXTURE_FORMAT,
    usage: LOOK_TEXTURE_USAGE,
  })
  device.queue.writeTexture(
    { texture },
    encodeShaperTexture(shaper),
    { bytesPerRow: LOOK_SHAPER_SIZE * LUT_TEXTURE_BYTES_PER_TEXEL },
    { width: LOOK_SHAPER_SIZE, height: 1 },
  )
  return texture
}

/** The pass's bindings: the uniform, the input, the table and the shaper. */
function lookLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'look',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: LOOK_UNIFORM_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '3d' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  })
}

/**
 * Uploads one look's table (and its shaper, when the file has one) as the textures the pass binds.
 * Both of `lut-texture.ts`'s checks run before a texture is created, so a broken file allocates
 * nothing.
 */
function uploadLook(device: GPUDevice, table: CubeLut3D, shaper: CubeLut1D | null): LookTextures {
  const layout = createLutTextureLayout(table.size)
  const bytes = encodeLutTexture(table)
  const lut = device.createTexture(layout.descriptor)
  device.queue.writeTexture(
    { texture: lut },
    bytes,
    { bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rowsPerImage },
    { width: table.size, height: table.size, depthOrArrayLayers: table.size },
  )
  return {
    lut,
    lutView: lut.createView(),
    shaper: shaper === null ? null : createShaperTexture(device, shaper),
  }
}

/** Releases a look's textures (the identity shaper is the stage's, and outlives every look). */
function releaseLook(loaded: LookTextures): void {
  loaded.lut.destroy()
  loaded.shaper?.destroy()
}

/** Records one look's draw: its 16 floats, the four bindings, and the full-screen triangle. */
function encodeLook(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  layout: GPUBindGroupLayout,
  loaded: LoadedLook,
  encoder: GPUCommandEncoder,
  input: GPUTextureView,
  output: GPUTextureView,
  look: LookId,
  intensity: number,
  size: { readonly width: number; readonly height: number },
  uploads: LookUploads | undefined,
): void {
  assertPassSize('LookPass.encode', size)
  // Packed before a buffer exists, so an intensity outside 0…1 allocates nothing
  const values = packLookUniforms(loaded.cube, intensity)
  // Two looks can be recorded into one encoder before its submit, so the uniform is never one shared buffer: it is a
  // range of the caller's arena, or a buffer made for this encode.
  const range = uploads?.upload(values) ?? ownUniform(device, look, values)
  const bindGroup = device.createBindGroup({
    label: 'look',
    layout,
    entries: [
      { binding: 0, resource: { buffer: range.buffer, offset: 0, size: range.size } },
      { binding: 1, resource: input },
      { binding: 2, resource: loaded.lutView },
      { binding: 3, resource: loaded.shaperView },
    ],
  })
  const pass = encoder.beginRenderPass({
    label: 'look',
    colorAttachments: [
      { view: output, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup, [range.offset])
  pass.setViewport(0, 0, size.width, size.height, 0, 1)
  pass.draw(3)
  pass.end()
}

/** The uniform of one encode when the caller has no arena: a buffer of its own, written once */
function ownUniform(device: GPUDevice, look: LookId, values: Float32Array) {
  const buffer = device.createBuffer({
    label: `look ${look} uniforms`,
    size: LOOK_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, values)
  return { buffer, offset: 0, size: LOOK_UNIFORM_BYTES }
}

/**
 * Builds the look pass for one target format: the pipeline, its bind group layout, the table a look
 * without a shaper binds, and an empty looks registry. Looks are added with `setLook` when the
 * library reads their files; `encode` records one draw into the caller's encoder.
 */
export async function createLookPass(device: GPUDevice, formats: LookFormats): Promise<LookStage> {
  assertFormat('createLookPass', 'input', formats.input)
  assertFormat('createLookPass', 'output', formats.output)
  const layout = lookLayout(device)
  const pipeline = await createPassPipeline(device, {
    label: 'look',
    code: lookShader(),
    layout,
    format: formats.output,
  })
  const identity = createShaperTexture(device, identityShaper())
  const identityView = identity.createView()
  const looks = new Map<LookId, LoadedLook>()

  return {
    setLook(look, cube) {
      const table = cube.lut3d
      if (table === null) {
        throw new Error(
          `setLook: "${look}" has no LUT_3D_SIZE, so the file holds a shaper and not a look`,
        )
      }
      const textures = uploadLook(device, table, cube.shaper)
      // Replacing a look: the textures it had must not outlive the entry
      const previous = looks.get(look)
      if (previous !== undefined) releaseLook(previous)
      looks.set(look, {
        ...textures,
        shaperView: textures.shaper === null ? identityView : textures.shaper.createView(),
        cube,
      })
    },

    removeLook(look) {
      const loaded = looks.get(look)
      if (loaded === undefined) return
      releaseLook(loaded)
      looks.delete(look)
    },

    destroy() {
      for (const loaded of looks.values()) releaseLook(loaded)
      looks.clear()
      identity.destroy()
    },

    encode(encoder, input, output, look, intensity, size, uploads) {
      const loaded = looks.get(look)
      if (loaded === undefined) {
        throw new Error(
          `LookPass.encode: the look "${look}" is not loaded; call setLook with its parsed .cube first`,
        )
      }
      encodeLook(device, pipeline, layout, loaded, encoder, input, output, look, intensity, size, uploads)
    },
  }
}
