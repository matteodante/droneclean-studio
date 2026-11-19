// The synthetic frame of the stabilization stage's golden case: a grid picture, one frame's Gyroflow kernel
// parameters and a 2880-row rotation, all built here in code. No footage and no random numbers: the same code
// produces the same bytes on every run, and `kit.test.mjs` pins those bytes.
//
// The values are the module's own where the module has them. `max_pixel_value` and `pixel_value_limit` are **255**,
// as `frameData` reports them for its 8-bit CPU warp (`gyroflow/wasm/README.md`), so `stage.ts`'s rewrite of both to
// 1.0 is part of what the stored frame holds; `flags` is `FIX_COLOR_RANGE`, which Gyroflow sets for limited-range
// footage, so the shader has to read the frame's flags from the uniform (transform 5) for the colours to be right.

/** The source frame: 4:3, as clip 0020's 3840x2880 sensor frame is. */
export const INPUT_WIDTH = 320
export const INPUT_HEIGHT = 240
/** The stabilized picture: 16:9, as the engine's 3840x2160 output is, so the case also holds the two sizes apart. */
export const OUTPUT_WIDTH = 320
export const OUTPUT_HEIGHT = 180
/** A 4K frame's row count: one row matrix per sensor row, as `frameData` gives for clip 0020. */
export const MATRIX_COUNT = 2880
/** Floats per row matrix (`matrixStride`). */
export const MATRIX_STRIDE = 16
/** Gyroflow's `KernelParams`, the bytes the stage's uniform holds (`stage.ts`). */
export const PARAMS_BYTES = 416
/** Gyroflow's `coeffs` table, `stabilization/cpu_undistort.rs::COEFFS`. */
export const COEFFS_FLOATS = 496
/** The `interpolation` pipeline constant: bilinear, the only interpolation this module's CPU warp produces. */
export const INTERPOLATION = 2
/** `KernelParamsFlags::FIX_COLOR_RANGE`: the frame's colours pass through `remap_colorrange`. */
export const FLAGS = 1
/** The roll one row matrix carries at the first and last row, in degrees: 3 degrees either side of upright. */
const ROLL_DEGREES = 3
/** The lens: a 160 px focal length and the input's centre, an `opencv_fisheye` model with the engine's first four
 * coefficients, so the lens functions' polynomial branch is exercised (clip 0020's pinhole is the zero case). */
const FOCAL_LENGTH = 160
const DISTORTION = [-0.06, 0.015, 0, 0]

/**
 * The source frame: a slow red/green gradient (every bilinear weight shows in the value between two pixels), a
 * white line every 16 pixels with a black one half a cell later (a whole-pixel shift moves them, a half-pixel shift
 * changes the values either side of them), and a red and a blue square that show a rotation or a flip at a glance.
 */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function gridFrame() {
  const data = new Uint8Array(INPUT_WIDTH * INPUT_HEIGHT * 4)
  for (let y = 0; y < INPUT_HEIGHT; y++) {
    for (let x = 0; x < INPUT_WIDTH; x++) {
      let r = Math.floor((x * 255) / (INPUT_WIDTH - 1))
      let g = Math.floor((y * 255) / (INPUT_HEIGHT - 1))
      let b = 96
      if (x % 16 === 0 || y % 16 === 0) {
        r = 255
        g = 255
        b = 255
      } else if (x % 16 === 8 || y % 16 === 8) {
        r = 0
        g = 0
        b = 0
      }
      if (x >= 24 && x < 56 && y >= 24 && y < 56) {
        r = 255
        g = 32
        b = 32
      } else if (x >= INPUT_WIDTH - 56 && x < INPUT_WIDTH - 24 && y >= INPUT_HEIGHT - 56 && y < INPUT_HEIGHT - 24) {
        r = 32
        g = 32
        b = 255
      }
      const i = (y * INPUT_WIDTH + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width: INPUT_WIDTH, height: INPUT_HEIGHT, data }
}

function setFloats(view, offset, values) {
  values.forEach((value, index) => view.setFloat32(offset + index * 4, value, true))
}

/**
 * One frame's `KernelParams` at the offsets `stage.ts` and Gyroflow's struct name (`max_pixel_value` at 352 and
 * `pixel_value_limit` at 364 are the CPU warp's 255; the stage must rewrite them to 1.0).
 */
export function kernelParams() {
  const bytes = new Uint8Array(PARAMS_BYTES)
  const view = new DataView(bytes.buffer)
  view.setInt32(0, INPUT_WIDTH, true)
  view.setInt32(4, INPUT_HEIGHT, true)
  view.setInt32(8, INPUT_WIDTH * 4, true)
  view.setInt32(12, OUTPUT_WIDTH, true)
  view.setInt32(16, OUTPUT_HEIGHT, true)
  view.setInt32(20, OUTPUT_WIDTH * 4, true)
  view.setInt32(24, MATRIX_COUNT, true)
  view.setInt32(28, INTERPOLATION, true)
  view.setInt32(32, 0, true) // background mode: fill with the background
  view.setInt32(36, FLAGS, true)
  view.setInt32(40, 4, true) // bytes per pixel
  view.setInt32(44, 4, true) // elements per pixel
  view.setFloat32(48, 0.2, true) // background: the corners the rotation leaves the input show it
  view.setFloat32(52, 0.4, true)
  view.setFloat32(56, 0.6, true)
  view.setFloat32(60, 1, true)
  view.setFloat32(64, FOCAL_LENGTH, true)
  view.setFloat32(68, FOCAL_LENGTH, true)
  view.setFloat32(72, INPUT_WIDTH / 2, true) // the lens centre
  view.setFloat32(76, INPUT_HEIGHT / 2, true)
  setFloats(view, 80, [...DISTORTION, ...new Array(20).fill(0)])
  view.setFloat32(176, 1, true) // fov: the whole correction
  view.setFloat32(184, 1, true) // lens correction amount: the lens's own, no digital lens
  view.setFloat32(188, 1, true) // vertical stretch
  view.setFloat32(192, 1, true) // horizontal stretch
  view.setFloat32(204, 1, true) // canvas scale
  view.setFloat32(336, 0, true) // safe area: the whole output, or every pixel would be halved
  view.setFloat32(340, 0, true)
  view.setFloat32(344, OUTPUT_WIDTH, true)
  view.setFloat32(348, OUTPUT_HEIGHT, true)
  view.setInt32(240, 0, true) // source rect: the whole input
  view.setInt32(244, 0, true)
  view.setInt32(248, INPUT_WIDTH, true)
  view.setInt32(252, INPUT_HEIGHT, true)
  view.setInt32(256, 0, true) // output rect: the whole output
  view.setInt32(260, 0, true)
  view.setInt32(264, OUTPUT_WIDTH, true)
  view.setInt32(268, OUTPUT_HEIGHT, true)
  view.setFloat32(352, 255, true) // the CPU warp's values: `stage.ts` rewrites both to 1.0
  view.setFloat32(364, 255, true)
  view.setFloat32(368, 1, true) // light refraction coefficient: none
  return bytes
}

/**
 * The frame's row matrices: a roll about the optical axis that changes by row - the same picture a rolling shutter
 * gives a real frame - so the matrix count, the row index, the 16-float stride and the middle matrix's own pass are
 * all load-bearing. Only the first nine floats of a row are read with this frame's flags (the 3x3 rotation); the
 * sensor shift and the focus-breathing scale are 0.
 */
export function rowMatrices() {
  const matrices = new Float32Array(MATRIX_COUNT * MATRIX_STRIDE)
  for (let row = 0; row < MATRIX_COUNT; row++) {
    const degrees = ((row / (MATRIX_COUNT - 1)) * 2 - 1) * ROLL_DEGREES
    const radians = (degrees * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const at = row * MATRIX_STRIDE
    matrices[at + 0] = cos
    matrices[at + 1] = -sin
    matrices[at + 2] = 0
    matrices[at + 3] = sin
    matrices[at + 4] = cos
    matrices[at + 5] = 0
    matrices[at + 6] = 0
    matrices[at + 7] = 0
    matrices[at + 8] = 1
  }
  return matrices
}

/**
 * Gyroflow's coefficient table for bilinear sampling, built from the formula `cpu_undistort.rs::COEFFS` holds: 32
 * pairs of `(1 - k/32, k/32)` at offset 0. Every other entry (bicubic, Lanczos, the drawing colours) is 0: this
 * frame's interpolation is bilinear and its flags keep the drawing branch off, so nothing reads them.
 */
export function coefficients() {
  const coeffs = new Float32Array(COEFFS_FLOATS)
  for (let k = 0; k < 32; k++) {
    coeffs[k * 2] = 1 - k / 32
    coeffs[k * 2 + 1] = k / 32
  }
  return coeffs
}
