// The stabilization stage's golden case (design 6.3 §6, slice C3): the shipped WebGPU stage
// (`src/studio/stabilization/stage.ts`) warps a synthetic frame on the golden run's real GPU, and the picture is
// compared exactly with the stored frame like every other case. There is no project and no footage: the case drives
// the stage directly, because nothing in the renderer draws it yet (slice C2 seats it).
//
// The assets are Gyroflow's own, read from `gyroflow/` as the wasm module reads them (`include_str!`): the kernel
// template and the lens model's functions. The coefficient table is built in `stage-frame.mjs` from the formula
// `cpu_undistort.rs::COEFFS` holds, because `shaderAssets` would need the wasm package built (`gyroflow/wasm/build.sh`,
// Rust), which `npm run golden` does not; `kernel.test.ts` reads the same two files for the same reason.
//
// `warp-page.ts` is bundled with the app's own bundler (`vite-plus`, the `vp build` the golden run already builds the
// app with) and injected into the golden run's own page: it is the only way to run the stage without an entry in
// `vite.config.ts`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  COEFFS_FLOATS,
  FLAGS,
  INPUT_HEIGHT,
  INPUT_WIDTH,
  INTERPOLATION,
  MATRIX_COUNT,
  MATRIX_STRIDE,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  PARAMS_BYTES,
  coefficients,
  gridFrame,
  kernelParams,
  rowMatrices,
} from './stage-frame.mjs'

const GYROFLOW = new URL('../../../gyroflow/', import.meta.url)

/** One of Gyroflow's files, as the wasm module gets it: the same bytes, and the same line endings */
function gyroflow(path) {
  return readFileSync(new URL(path, GYROFLOW), 'utf8')
}

/** The digital lens the module returns for a profile without one (`IDENTITY_DIGITAL_LENS_WGSL`) */
const DIGITAL_LENS =
  'fn digital_undistort_point(uv: vec2<f32>) -> vec2<f32> { return uv; }\n' +
  'fn digital_distort_point  (uv: vec2<f32>) -> vec2<f32> { return uv; }'

/**
 * The case as `golden/cases.mjs` takes it: no `project`, a `warp` describing what the stage is given. Its stored
 * frame is 320x180, the stage's output size.
 */
export const STAGE_WARP_CASE = {
  id: 'stage-warp-rotation',
  group: 'stabilization stage',
  protects:
    "Gyroflow's warp shader through the shipped stage: a synthetic 320x240 grid warped with a roll that changes by " +
    'row (2880 row matrices, as a 4K sensor frame has), the engine\'s fisheye lens functions, a bilinear coefficient ' +
    "table and the frame's own limited-range flag, into a 320x180 picture. A difference means the kernel's assembly " +
    '(the eight transforms of design 6.3 §4.1), the bindings, the -0.5 px fragment correction or the coefficients ' +
    "changed the pixels. The frame carries `max_pixel_value` 255 as the module's `frameData` reports it, so a stage " +
    "that stopped rewriting it to 1.0 turns the background corners white; `params.flags` is 1, so a shader reading " +
    "the pipeline's constant flags instead of the uniform's loses the colour range remap.",
  frames: [0],
  warp: {
    input: [INPUT_WIDTH, INPUT_HEIGHT],
    output: [OUTPUT_WIDTH, OUTPUT_HEIGHT],
    matrices: MATRIX_COUNT,
    matrixStride: MATRIX_STRIDE,
    paramsBytes: PARAMS_BYTES,
    coeffsFloats: COEFFS_FLOATS,
    interpolation: INTERPOLATION,
    flags: FLAGS,
  },
}

/**
 * The float variant of the case (design 3.6 section 2.13): the same frame through the same stage with `rgba16float`
 * input and output, the picture read back exactly as unorm16 and stored as a 16-bit PNG. The 8-bit input is widened to
 * `value / 255`; the warp's bilinear weights then give values between the 255 levels that the 8-bit case rounds away.
 */
export const STAGE_WARP_FLOAT_CASE = {
  ...STAGE_WARP_CASE,
  id: 'float-stage-warp',
  group: 'float path',
  float: true,
  protects:
    "the stabilization stage in float: the synthetic frame of stage-warp-rotation through the stage with rgba16float input and output, read back as 16 bits. A difference means the stage's float formats, the float shader constants (`max_pixel_value` 1.0) or the warp's maths changed the float picture; the 8-bit case cannot see that, it rounds every value to 255 levels.",
}

/** What the page is given: the synthetic frame and data as bytes, and Gyroflow's text as it is */
let payload = null
function stageWarpPayload() {
  if (payload) return payload
  const frame = gridFrame()
  const params = kernelParams()
  const matrices = rowMatrices()
  const coeffs = coefficients()
  payload = {
    input: { width: frame.width, height: frame.height, rgba: Buffer.from(frame.data).toString('base64') },
    output: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    assets: {
      kernelWgsl: gyroflow('src/core/gpu/wgpu_undistort.wgsl'),
      lensWgsl: gyroflow('src/core/stabilization/distortion_models/opencv_fisheye.wgsl'),
      digitalLensWgsl: DIGITAL_LENS,
      interpolation: INTERPOLATION,
    },
    coeffs: Buffer.from(coeffs.buffer, coeffs.byteOffset, coeffs.byteLength).toString('base64'),
    frame: {
      params: Buffer.from(params).toString('base64'),
      matrices: Buffer.from(matrices.buffer, matrices.byteOffset, matrices.byteLength).toString('base64'),
    },
  }
  return payload
}

/** The page script, bundled once: `warp-page.ts` and the stage it imports, as one classic script */
let pageScript = null
async function bundleWarpPage() {
  if (pageScript) return pageScript
  const { build } = await import('vite-plus')
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'chrome120',
      lib: {
        entry: fileURLToPath(new URL('./warp-page.ts', import.meta.url)),
        formats: ['iife'],
        name: 'stageWarpPage',
        fileName: () => 'warp-page.js',
      },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const chunk = outputs[0].output.find((entry) => entry.type === 'chunk' && entry.isEntry)
  if (!chunk) throw new Error('the stage warp page did not bundle')
  pageScript = chunk.code
  return pageScript
}

const injected = new WeakSet()

/**
 * Warps the synthetic frame with the stage in `page` and returns the picture as RGBA8, the shape the golden kit
 * compares (`{ width, height, data }`). The page script is injected once per page; anything the page or the GPU
 * reported as an error fails the case instead of storing a quieter picture.
 */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export async function warpStageOnPage(page, { float = false } = {}) {
  if (!injected.has(page)) {
    await page.addScriptTag({ content: await bundleWarpPage() })
    await page.waitForFunction(() => Boolean(window.__stageWarp?.warp))
    injected.add(page)
  }
  const result = await page.evaluate(
    (given) => window.__stageWarp.warp(given),
    { ...stageWarpPayload(), float },
  )
  if (result.warnings.length > 0) {
    throw new Error(`the stage reported GPU errors: ${result.warnings.join('; ')}`)
  }
  const bytes = Buffer.from(result.rgba, 'base64')
  if (float) {
    const data = new Uint16Array(bytes.length / 2)
    for (let i = 0; i < data.length; i++) data[i] = bytes.readUInt16LE(i * 2)
    return { width: result.width, height: result.height, data, float: true }
  }
  return { width: result.width, height: result.height, data: new Uint8Array(bytes) }
}
