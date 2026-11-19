// The compact 10-bit source format on the GPU (design 3.6 sections 2.16 and 2.18 b, plan task 8.4): FFmpeg hands the
// decoded frame over as `p010le`, the planes the hardware decoder produces (a 16-bit luma plane and a half-height plane
// of 16-bit U,V pairs, each code in the word's top ten bits), and this pass turns it into the `rgba16float` source
// texture. Half the bytes of `gbrp10le` cross the pipe and the page, and FFmpeg does no conversion at all.
//
// What the pass computes is FFmpeg's own `gbrp10le` conversion, the one the decoder ran until now
// (`scale=in_range=tv:in_color_matrix=<matrix>:out_range=pc:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int`,
// `desktop/src/main/media/ffmpeg.ts`), divided by 1023, so every later stage reads the values it read before:
//
// - **Range.** FFmpeg expands limited range in 8-bit steps at every bit depth: a 10-bit luma code `D` becomes the
//   full-range code `(D - 64) * 255/219` and a chroma code `(C - 512) * 255/224`. Nominal white (940) lands on 1020 of
//   1023, not on 1023, as the standard's `(D - 64) / 876` would put it (measured on FFmpeg 9.0.2: Y 940 gives 1020,
//   Y 502 gives 510). The constants below say so in one place.
// - **Chroma.** The half-size chroma is brought to full size with swscale's bicubic (B = 0, C = 0.6), separable,
//   edge samples repeated. Its sample positions are `P010_CHROMA_SITING` (measured: see that constant).
// - **Matrix.** The source's own (BT.709 or BT.601), into BT.709 RGB, which is what `out_color_matrix=bt709` keeps.
// - **No rounding to ten bits, no clipping above.** FFmpeg rounded to ten bits and clipped to 0..1023; here the values
//   stay float. A code above nominal white (super-white, up to 1019) reads above 1.0 instead of being clipped (finding
//   R8 b); a value below 0 is held at 0, as FFmpeg holds it, because the log and gamma stages that follow are not
//   defined there.
// - **The nearest half float.** The shader rounds each value to the nearest `rgba16float` value itself, because the
//   render target's own conversion truncates on this Mac's GPU (measured on clip 0020: every value written lands up to
//   one half-float step below, a mean bias of -0.19 to -0.24 levels of 1023 and 0.02 % of the pixels more than one
//   level off; rounded here: the conversion is exact and the bias is gone).
//
// `p010PixelReference` computes the same thing on the CPU; the tests hold the shader's constants to it, and the
// measurement on clip 0020 (`bench/native/`) holds the GPU's output to FFmpeg's `gbrp10le` of the same frames.

import { PRECISE_RENDER_FORMAT, precisePlaneLayout, type ColourTags } from './contract'

/** FFmpeg's full-range codes per limited-range luma code, at any bit depth: 255/219 (its 8-bit ratio). */
export const P010_LUMA_SCALE = 255 / 219

/** FFmpeg's full-range codes per limited-range chroma code: 255/224. */
export const P010_CHROMA_SCALE = 255 / 224

/** The limited-range black and the chroma zero of a 10-bit code. */
export const P010_LUMA_BLACK = 64
export const P010_CHROMA_ZERO = 512

/** The full-range code that is 1.0 in the float texture: the same division as the `gbrp10le` source pass. */
export const P010_FULL_CODE = 1023

/**
 * Where the chroma samples sit (horizontal, vertical): luma pixel `2k` lies at chroma position `k + siting`, in chroma
 * samples. `0` is co-sited with the even luma pixel (the standard's `left` horizontally); `-0.25` is the centre of each
 * 2x2 block.
 *
 * `[-0.25, -0.25]`, the centre, is where FFmpeg's `scale` puts them for the decoder's command line: it ignores the
 * file's own chroma location (clip 0020 says `left`) unless `in_chroma_loc` is given, so its `gbrp10le` (the reference
 * this pass must match) is interpolated as if the samples were centred. Measured on clip 0020: centred, every pixel of
 * three frames within 0.95 levels of FFmpeg's; co-sited, 22.6 levels off at chroma edges.
 */
export const P010_CHROMA_SITING: readonly [number, number] = [-0.25, -0.25]

/** swscale's bicubic: Mitchell-Netravali with B = 0, C = 0.6 (its defaults). */
const BICUBIC_B = 0
const BICUBIC_C = 0.6

/** The bicubic kernel at a distance `d` (in source samples). */
export function swscaleBicubic(d: number): number {
  const x = Math.abs(d)
  const B = BICUBIC_B
  const C = BICUBIC_C
  if (x < 1) {
    return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6
  }
  if (x < 2) {
    return (
      ((-B - 6 * C) * x ** 3 +
        (6 * B + 30 * C) * x ** 2 +
        (-12 * B - 48 * C) * x +
        (8 * B + 24 * C)) /
      6
    )
  }
  return 0
}

/**
 * The four taps of one output phase along one axis: the first tap's offset from the chroma sample `k` of the output
 * pixel `2k + phase`, and the four weights (summing to 1).
 */
export interface ChromaTaps {
  readonly offset: number
  readonly weights: readonly [number, number, number, number]
}

/** The taps of phase 0 and phase 1 (even and odd output pixels) for samples sited as `P010_CHROMA_SITING` says. */
export function chromaTaps(siting: number): readonly [ChromaTaps, ChromaTaps] {
  const phase = (p: number): ChromaTaps => {
    const position = p / 2 + siting
    const offset = Math.floor(position) - 1
    const raw = [0, 1, 2, 3].map((j) => swscaleBicubic(position - (offset + j)))
    const sum = raw.reduce((total, w) => total + w, 0)
    const [a = 0, b = 0, c = 0, d = 0] = raw.map((w) => w / sum)
    return { offset, weights: [a, b, c, d] }
  }
  return [phase(0), phase(1)]
}

/** Kr and Kb of the matrices the pass converts from. */
interface MatrixWeights {
  readonly kr: number
  readonly kb: number
}

const BT709: MatrixWeights = { kr: 0.2126, kb: 0.0722 }
const BT601: MatrixWeights = { kr: 0.299, kb: 0.114 }

/**
 * The colour descriptions the pass converts: limited range (or untagged, which the precise path reads as limited),
 * BT.709 or BT.601 (or untagged, read as BT.709). Anything else takes the `gbrp10le` path, where FFmpeg converts.
 */
export function p010Supports(colour: ColourTags): boolean {
  const rangeOk = colour.range === 'tv' || colour.range === 'unknown'
  const matrixOk =
    colour.matrix === 'bt709' ||
    colour.matrix === 'unknown' ||
    colour.matrix === 'bt470bg' ||
    colour.matrix === 'smpte170m'
  return rangeOk && matrixOk
}

function matrixWeights(colour: ColourTags): MatrixWeights {
  return colour.matrix === 'bt470bg' || colour.matrix === 'smpte170m' ? BT601 : BT709
}

/** The RGB coefficients of a matrix, in full-range codes per full-range chroma code. */
function rgbCoefficients(m: MatrixWeights): { crR: number; cbG: number; crG: number; cbB: number } {
  const kg = 1 - m.kr - m.kb
  return {
    crR: 2 * (1 - m.kr),
    cbG: (-2 * m.kb * (1 - m.kb)) / kg,
    crG: (-2 * m.kr * (1 - m.kr)) / kg,
    cbB: 2 * (1 - m.kb),
  }
}

/**
 * One pixel on the CPU: 10-bit codes in (luma, and the chroma already interpolated to this pixel), the float values
 * the pass writes out. The tests' reference for the shader's arithmetic.
 */
export function p010PixelReference(
  luma: number,
  cb: number,
  cr: number,
  colour: ColourTags,
): [number, number, number] {
  const k = rgbCoefficients(matrixWeights(colour))
  const y = (luma - P010_LUMA_BLACK) * P010_LUMA_SCALE
  const u = (cb - P010_CHROMA_ZERO) * P010_CHROMA_SCALE
  const v = (cr - P010_CHROMA_ZERO) * P010_CHROMA_SCALE
  const out = (code: number) => Math.max(0, code / P010_FULL_CODE)
  return [out(y + k.crR * v), out(y + k.cbG * u + k.crG * v), out(y + k.cbB * u)]
}

const f = (value: number): string => {
  const text = String(value)
  return /[.e]/.test(text) ? text : `${text}.0`
}
const vec4 = (values: readonly number[]): string => `vec4f(${values.map(f).join(', ')})`

/** The shader for one colour description: every constant is computed above and written in. */
export function p010InShader(colour: ColourTags): string {
  const [hEven, hOdd] = chromaTaps(P010_CHROMA_SITING[0])
  const [vEven, vOdd] = chromaTaps(P010_CHROMA_SITING[1])
  const k = rgbCoefficients(matrixWeights(colour))
  return /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

// p010le's planes as written: each 16-bit word holds a 10-bit code in its top ten bits.
@group(0) @binding(0) var lumaPlane: texture_2d<u32>;
@group(0) @binding(1) var chromaPlane: texture_2d<u32>;

const H_OFFSET = vec2i(${hEven.offset}, ${hOdd.offset});
const V_OFFSET = vec2i(${vEven.offset}, ${vOdd.offset});
const H_EVEN = ${vec4(hEven.weights)};
const H_ODD = ${vec4(hOdd.weights)};
const V_EVEN = ${vec4(vEven.weights)};
const V_ODD = ${vec4(vOdd.weights)};

// The half float nearest to v (ties to even), computed in f32: exactly representable, so the target's conversion to
// rgba16float (which truncates on Apple GPUs) leaves it as it is. Below 2^-14 the step is the subnormals' 2^-24.
fn nearestHalf(v: vec3f) -> vec3f {
  let a = abs(v);
  let exponent = max(vec3i((bitcast<vec3u>(a) >> vec3u(23u)) & vec3u(0xffu)) - vec3i(127), vec3i(-14));
  let step = bitcast<vec3f>(vec3u(exponent - vec3i(10) + vec3i(127)) << vec3u(23u));
  return sign(v) * round(a / step) * step;
}

fn chromaCode(sample: vec2i, last: vec2i) -> vec2f {
  return vec2f(textureLoad(chromaPlane, clamp(sample, vec2i(0), last), 0).rg >> vec2u(6u));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = vec2i(position.xy);
  let luma = f32(textureLoad(lumaPlane, pixel, 0).r >> 6u);

  let block = pixel >> vec2u(1u);
  let odd = (pixel & vec2i(1)) == vec2i(1);
  let hw = select(H_EVEN, H_ODD, odd.x);
  let vw = select(V_EVEN, V_ODD, odd.y);
  let first = block + vec2i(select(H_OFFSET.x, H_OFFSET.y, odd.x), select(V_OFFSET.x, V_OFFSET.y, odd.y));
  let last = vec2i(textureDimensions(chromaPlane)) - vec2i(1);

  var chroma = vec2f(0.0);
  for (var row = 0; row < 4; row += 1) {
    var across = vec2f(0.0);
    for (var column = 0; column < 4; column += 1) {
      across += hw[column] * chromaCode(first + vec2i(column, row), last);
    }
    chroma += vw[row] * across;
  }

  let y = (luma - ${f(P010_LUMA_BLACK)}) * ${f(P010_LUMA_SCALE)};
  let uv = (chroma - vec2f(${f(P010_CHROMA_ZERO)})) * ${f(P010_CHROMA_SCALE)};
  let rgb = vec3f(
    y + ${f(k.crR)} * uv.y,
    y + ${f(k.cbG)} * uv.x + ${f(k.crG)} * uv.y,
    y + ${f(k.cbB)} * uv.x,
  );
  return vec4f(nearestHalf(max(rgb / ${f(P010_FULL_CODE)}, vec3f(0.0))), 1.0);
}
`
}

// The WebGPU flags, as the spec numbers them (the module loads where there is no GPU).
const TEXTURE_BINDING = 0x04
const COPY_DST = 0x02
const SHADER_STAGE_FRAGMENT = 0x2

/** What a pass is made for: one source's size and colour. */
export interface P010InOptions {
  readonly width: number
  readonly height: number
  readonly colour: ColourTags
}

/** One source file's conversion: its two staging planes and its pipeline. */
export interface P010InPass {
  /**
   * Uploads one `p010le` frame (exactly `preciseFrameBytes('p010le', width, height)` bytes, packed as FFmpeg's raw
   * stream carries it) and converts it into `target`, an `rgba16float` texture of the source's size with
   * `RENDER_ATTACHMENT`. The bytes are copied into the queue before this returns, so the caller may reuse them; the
   * conversion is submitted, so work that reads `target` must be submitted after this call.
   */
  convert(data: Uint8Array, target: GPUTexture): void
  /** Releases the staging planes. */
  destroy(): void
}

/** Throws unless `data` is one tightly packed `p010le` frame of this size: a wrong length would upload shifted planes. */
export function assertP010Frame(data: Uint8Array, width: number, height: number): void {
  const expected = precisePlaneLayout('p010le', width, height).reduce(
    (total, plane) => total + plane.sizeBytes,
    0,
  )
  if (data.byteLength !== expected) {
    throw new Error(
      `p010 pass: a ${width}x${height} p010le frame is ${expected} bytes, got ${data.byteLength}`,
    )
  }
}

/** Creates the pass for one source: refuses a colour description the shader does not convert. */
export function createP010InPass(device: GPUDevice, options: P010InOptions): P010InPass {
  const { width, height, colour } = options
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`p010 pass: the size must be positive integers, got ${width}x${height}`)
  }
  if (!p010Supports(colour)) {
    throw new Error(
      `p010 pass: ${colour.matrix} ${colour.range}-range sources take the gbrp10le path, where FFmpeg converts`,
    )
  }
  const [lumaLayout, chromaLayout] = precisePlaneLayout('p010le', width, height)
  if (lumaLayout === undefined || chromaLayout === undefined)
    throw new Error('p010 pass: no plane layout')
  const chromaPairs = chromaLayout.width / 2

  const luma = device.createTexture({
    label: 'p010-luma',
    size: { width, height },
    format: 'r16uint',
    usage: TEXTURE_BINDING | COPY_DST,
  })
  const chroma = device.createTexture({
    label: 'p010-chroma',
    size: { width: chromaPairs, height: chromaLayout.height },
    format: 'rg16uint',
    usage: TEXTURE_BINDING | COPY_DST,
  })

  const module = device.createShaderModule({ label: 'p010-in', code: p010InShader(colour) })
  const layout = device.createBindGroupLayout({
    label: 'p010-in-layout',
    entries: [0, 1].map((binding) => ({
      binding,
      visibility: SHADER_STAGE_FRAGMENT,
      texture: { sampleType: 'uint' as const },
    })),
  })
  const pipeline = device.createRenderPipeline({
    label: 'p010-in',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: PRECISE_RENDER_FORMAT }] },
    primitive: { topology: 'triangle-list' },
  })
  const bindGroup = device.createBindGroup({
    label: 'p010-in-bindings',
    layout,
    entries: [
      { binding: 0, resource: luma.createView() },
      { binding: 1, resource: chroma.createView() },
    ],
  })
  /** One view per target texture: the provider's textures are reused, so their views are too. */
  const views = new WeakMap<GPUTexture, GPUTextureView>()

  return {
    convert(data, target) {
      assertP010Frame(data, width, height)
      if (target.width !== width || target.height !== height) {
        throw new Error(
          `p010 pass: the target is ${target.width}x${target.height}, the source ${width}x${height}`,
        )
      }
      device.queue.writeTexture(
        { texture: luma },
        data.subarray(lumaLayout.offset, lumaLayout.offset + lumaLayout.sizeBytes),
        { bytesPerRow: lumaLayout.stride, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      )
      device.queue.writeTexture(
        { texture: chroma },
        data.subarray(chromaLayout.offset, chromaLayout.offset + chromaLayout.sizeBytes),
        { bytesPerRow: chromaLayout.stride, rowsPerImage: chromaLayout.height },
        { width: chromaPairs, height: chromaLayout.height, depthOrArrayLayers: 1 },
      )
      let view = views.get(target)
      if (view === undefined) {
        view = target.createView()
        views.set(target, view)
      }
      const encoder = device.createCommandEncoder({ label: 'p010-in' })
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    },

    destroy() {
      luma.destroy()
      chroma.destroy()
    },
  }
}
