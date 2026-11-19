/**
 * The input colour stage on the GPU: one render pipeline that turns a source frame's code values
 * into display-referred RGB, implementing `InputColorPass` (design 5.1 §4.6).
 *
 * The shader is `transform()` of `../display.ts` in WGSL, in its order: decode the code with the
 * profile's curve, map linear light with the profile's gamut matrix, apply the shoulder, and encode
 * with the sRGB transfer function. `none` copies the input through untouched. The fragment stage
 * reads the input with `textureLoad`, so a pixel is never filtered and the frame keeps its size.
 *
 * **The uniform.** One buffer of 16 floats per profile, in the layout `inputColorShader`'s
 * `Uniforms` struct declares: the decode's mode and D-Log M's three fitted constants, the 9 gamut
 * coefficients, and the shoulder's two numbers and its on/off flag. The published D-Log formula's
 * constants do not fit in a uniform of 16 floats beside the fitted curve's, so they are compiled
 * into the shader from `DLOG_CURVE` (as `source-pass.ts` compiles in `PRECISE_SOURCE_CODE_MAX`):
 * they are a published, fixed formula, while the fitted D-Log M numbers are data a later DJI family
 * replaces. The buffer is written once per profile at build time — `encode` records a pass, and two
 * passes recorded into one encoder before a submit would otherwise both read the last profile.
 *
 * Both target formats the product has are supported: `rgba16float` (the precise path) and
 * `rgba8unorm` (today's preview, 8 bits per design 3.1 §0 decision 7). One pass instance is built
 * per target format, as with the stabilization stage; the input may be either format, and the
 * shader's binding is `unfilterable-float` so no filtering is ever applied.
 */

import { D_GAMUT_TO_REC709, DLOG_M_TO_REC709, type Matrix3 } from '../gamut'
import { DLOG_CURVE, DLOG_M_CURVE, DLOG_SHOULDER, type Shoulder } from '../profiles'
import type { ColorProfileId, InputColorPass } from '../types'
import { FULLSCREEN_VERTEX_WGSL, assertPassSize, createPassPipeline } from './pass'

/** Floats in the input colour pass's uniform: the four `vec4f` of the shader's `Uniforms` struct. */
export const INPUT_COLOR_UNIFORM_FLOATS = 16

/** Bytes in that uniform: 16 floats. */
export const INPUT_COLOR_UNIFORM_BYTES = INPUT_COLOR_UNIFORM_FLOATS * 4

/**
 * The texture formats the pass reads and writes: the normalized float formats of design 5.1's
 * precise path and of today's 8-bit preview. An integer texture has no code in 0..1 to transform.
 */
export const INPUT_COLOR_FORMATS: readonly GPUTextureFormat[] = ['rgba8unorm', 'rgba16float']

/**
 * The profile ids as the uniform's first float spells them: the shader switches on this number, and
 * `packInputColorUniforms` writes it.
 */
export const INPUT_COLOR_MODES: Record<ColorProfileId, number> = {
  none: 0,
  dlog: 1,
  'dlog-m': 2,
}

/** The profile ids, in one place for building their uniform buffers. */
const PROFILES: readonly ColorProfileId[] = ['none', 'dlog', 'dlog-m']

/** The identity, for the profile whose matrix is never applied ('none' returns before it). */
const IDENTITY_MATRIX: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** What one profile's uniform holds: its mode, its fitted curve, its matrix and its shoulder. */
interface ColorPipeline {
  readonly mode: number
  /** The fitted three constants `(x^p − b·x^q)/(1 − b)`, for D-Log M only. */
  readonly decode: { readonly p: number; readonly q: number; readonly b: number } | null
  readonly matrix: Matrix3
  readonly shoulder: Shoulder | null
}

/**
 * The two transforms of `../display.ts`, with the same constants: D-Log is the published decode
 * plus D-Gamut and the fitted shoulder, D-Log M is the fitted curve and matrix with no shoulder
 * (design 5.1 §4.1, §4.2).
 */
const PIPELINES: Record<ColorProfileId, ColorPipeline> = {
  none: { mode: INPUT_COLOR_MODES.none, decode: null, matrix: IDENTITY_MATRIX, shoulder: null },
  dlog: {
    mode: INPUT_COLOR_MODES.dlog,
    decode: null,
    matrix: D_GAMUT_TO_REC709,
    shoulder: DLOG_SHOULDER,
  },
  'dlog-m': {
    mode: INPUT_COLOR_MODES['dlog-m'],
    decode: DLOG_M_CURVE,
    matrix: DLOG_M_TO_REC709,
    shoulder: null,
  },
}

/**
 * One profile's 16 uniform floats, in the layout `inputColorShader`'s `Uniforms` struct declares:
 *
 * ```
 * 0..3    decode.x: the mode; decode.y/z/w: D-Log M's p, q and b
 * 4..7    row0.xyz: the matrix's first row; row0.w: the shoulder's exposure
 * 8..11   row1.xyz: the matrix's second row; row1.w: the shoulder's white point
 * 12..15  row2.xyz: the matrix's third row; row2.w: 1 when the shoulder applies, 0 when it does not
 * ```
 */
export function packInputColorUniforms(profile: ColorProfileId): Float32Array {
  const pipeline = PIPELINES[profile]
  const floats = new Float32Array(INPUT_COLOR_UNIFORM_FLOATS)
  const shoulder = pipeline.shoulder
  floats[0] = pipeline.mode
  floats[1] = pipeline.decode?.p ?? 0
  floats[2] = pipeline.decode?.q ?? 0
  floats[3] = pipeline.decode?.b ?? 0
  floats[4] = pipeline.matrix[0]
  floats[5] = pipeline.matrix[1]
  floats[6] = pipeline.matrix[2]
  floats[7] = shoulder?.exposure ?? 1
  floats[8] = pipeline.matrix[3]
  floats[9] = pipeline.matrix[4]
  floats[10] = pipeline.matrix[5]
  floats[11] = shoulder?.white ?? 1
  floats[12] = pipeline.matrix[6]
  floats[13] = pipeline.matrix[7]
  floats[14] = pipeline.matrix[8]
  floats[15] = shoulder === null ? 0 : 1
  return floats
}

/**
 * A constant as WGSL spells a float: an integer gets its `.0`, so `1` never compiles as an integer
 * where the shader's `f32` is wanted.
 */
function wgslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`
}

/**
 * The input colour pass's fragment stage: `transform()` of `../display.ts`, in its order. The D-Log
 * decode's published constants are compiled in from `DLOG_CURVE`; everything that changes per
 * profile arrives in the uniform. The text is a module constant: it is data, not a step.
 */
const INPUT_COLOR_FRAGMENT_WGSL = /* wgsl */ `
struct Uniforms {
  decode: vec4f,
  row0: vec4f,
  row1: vec4f,
  row2: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;

const MODE_DLOG: f32 = ${wgslFloat(INPUT_COLOR_MODES.dlog)};
const MODE_DLOG_M: f32 = ${wgslFloat(INPUT_COLOR_MODES['dlog-m'])};

// DJI's published D-Log decode, compiled in from profiles.ts (DLOG_CURVE).
const DLOG_CODE_THRESHOLD: f32 = ${wgslFloat(DLOG_CURVE.codeThreshold)};
const DLOG_OFFSET: f32 = ${wgslFloat(DLOG_CURVE.offset)};
const DLOG_SLOPE: f32 = ${wgslFloat(DLOG_CURVE.slope)};
const DLOG_EXPONENT_SCALE: f32 = ${wgslFloat(DLOG_CURVE.exponentScale)};
const DLOG_EXPONENT_OFFSET: f32 = ${wgslFloat(DLOG_CURVE.exponentOffset)};
const DLOG_LOG_GAIN: f32 = ${wgslFloat(DLOG_CURVE.logGain)};
const DLOG_LOG_OFFSET: f32 = ${wgslFloat(DLOG_CURVE.logOffset)};

// (x − 0.0929)/6.025 for x <= 0.14, else (10^(3.89616·x − 2.27752) − 0.0108)/0.9892
fn decodeDLog(code: f32) -> f32 {
  let x = clamp(code, 0.0, 1.0);
  if (x <= DLOG_CODE_THRESHOLD) {
    return (x - DLOG_OFFSET) / DLOG_SLOPE;
  }
  return (pow(10.0, DLOG_EXPONENT_SCALE * x - DLOG_EXPONENT_OFFSET) - DLOG_LOG_OFFSET)
    / DLOG_LOG_GAIN;
}

// (x^p − b·x^q)/(1 − b), with p, q and b in the uniform
fn decodeDLogM(code: f32) -> f32 {
  let x = clamp(code, 0.0, 1.0);
  return (pow(x, uniforms.decode.y) - uniforms.decode.w * pow(x, uniforms.decode.z))
    / (1.0 - uniforms.decode.w);
}

// The sRGB transfer function of display.ts, on its 0..1 domain
fn srgbEncode(linear: f32) -> f32 {
  let value = clamp(linear, 0.0, 1.0);
  if (value <= 0.0) {
    return 0.0;
  }
  if (value >= 1.0) {
    return 1.0;
  }
  if (value < 0.0031308) {
    return 12.92 * value;
  }
  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

// v ← v·(1 + v/w²)/(1 + v), after v ← exposure·v; a negative is clamped to 0 first
fn shoulderChannel(linear: f32) -> f32 {
  let exposed = max(linear, 0.0) * uniforms.row0.w;
  return (exposed * (1.0 + exposed / (uniforms.row1.w * uniforms.row1.w))) / (1.0 + exposed);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let texel = textureLoad(inputTexture, vec2i(position.xy), 0);
  let mode = uniforms.decode.x;
  if (mode < 0.5) {
    // 'none': the clip is already display-referred, so the texel is the answer, bit for bit
    return texel;
  }
  var linear: vec3f;
  if (mode == MODE_DLOG) {
    linear = vec3f(decodeDLog(texel.r), decodeDLog(texel.g), decodeDLog(texel.b));
  } else if (mode == MODE_DLOG_M) {
    linear = vec3f(decodeDLogM(texel.r), decodeDLogM(texel.g), decodeDLogM(texel.b));
  } else {
    return texel;
  }
  var mapped = vec3f(
    dot(uniforms.row0.xyz, linear),
    dot(uniforms.row1.xyz, linear),
    dot(uniforms.row2.xyz, linear),
  );
  if (uniforms.row2.w > 0.5) {
    mapped = vec3f(
      shoulderChannel(mapped.r),
      shoulderChannel(mapped.g),
      shoulderChannel(mapped.b),
    );
  }
  return vec4f(srgbEncode(mapped.r), srgbEncode(mapped.g), srgbEncode(mapped.b), 1.0);
}
`

/**
 * The input colour pass's shader: the full-screen vertex stage and the fragment stage that ports
 * `transform()` of `../display.ts`.
 */
export function inputColorShader(): string {
  return `${FULLSCREEN_VERTEX_WGSL}${INPUT_COLOR_FRAGMENT_WGSL}`
}

/** The pass's formats: what the caller feeds it and what it draws into. */
export interface InputColorFormats {
  readonly input: GPUTextureFormat
  readonly output: GPUTextureFormat
}

/** Throws unless a format is one the pass's shader reads or writes. */
function assertFormat(
  functionName: string,
  what: 'input' | 'output',
  format: GPUTextureFormat,
): void {
  if (!INPUT_COLOR_FORMATS.includes(format)) {
    throw new Error(
      `${functionName}: the ${what} format is ${format}; the input colour pass reads and writes ` +
        `${INPUT_COLOR_FORMATS.join(' or ')} textures, the formats the shader's code values are in`,
    )
  }
}

/** The pass's bindings: the profile's uniform and the frame it reads. */
function inputColorLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'input colour',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: INPUT_COLOR_UNIFORM_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  })
}

/**
 * One uniform buffer for each profile, written once: `encode` records a pass, and two passes
 * recorded into one encoder before a submit would both read the last profile if the buffer were
 * shared and rewritten.
 */
function profileUniforms(device: GPUDevice): Record<ColorProfileId, GPUBuffer> {
  const uniforms = {} as Record<ColorProfileId, GPUBuffer>
  for (const profile of PROFILES) {
    const buffer = device.createBuffer({
      label: `input colour ${profile}`,
      size: INPUT_COLOR_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(buffer, 0, packInputColorUniforms(profile))
    uniforms[profile] = buffer
  }
  return uniforms
}

/**
 * Builds the input colour pass for one target format, as the stabilization stage does for its own:
 * the pipeline, its bind group layout, and the profiles' uniform buffers. Build it once per device
 * and format, not per frame; `encode` records one draw into the caller's encoder.
 */
export async function createInputColorPass(
  device: GPUDevice,
  formats: InputColorFormats,
): Promise<InputColorPass> {
  assertFormat('createInputColorPass', 'input', formats.input)
  assertFormat('createInputColorPass', 'output', formats.output)
  const label = 'input colour'
  const layout = inputColorLayout(device)
  const pipeline = await createPassPipeline(device, {
    label,
    code: inputColorShader(),
    layout,
    format: formats.output,
  })
  const uniforms = profileUniforms(device)

  return {
    encode(encoder, input, output, profile, size) {
      assertPassSize('InputColorPass.encode', size)
      const bindGroup = device.createBindGroup({
        label,
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniforms[profile] } },
          { binding: 1, resource: input },
        ],
      })
      const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [
          {
            view: output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      // The viewport is the size the caller names, so a view of a larger texture draws the frame
      // and not its padding; a size larger than the target is a WebGPU validation error.
      pass.setViewport(0, 0, size.width, size.height, 0, 1)
      pass.draw(3)
      pass.end()
    },
  }
}
