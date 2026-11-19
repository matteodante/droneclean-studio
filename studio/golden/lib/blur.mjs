// The motion-blur golden cases' input and checks (design 7.2 section 6 B).
//
// The clip: 12 raw 10-bit frames of 128 x 32. The top half of every frame is the same grey ramp (static), the bottom
// half is black with one white box that moves right by 10 px a frame (box k at x = 4 + 10 k, 6 px wide, a 4 px gap to
// the next). At 4x an output frame covers four source frames, so a 360 degree blur makes four boxes at 25 % of white and
// a 180 degree blur two at 50 %, both averaged in linear light; the static half must come out as it went in.
//
// The checks read the picture the float composite delivers (unorm16 RGBA) and compare it with numbers computed here from
// the file's codes, with a tolerance of 2 levels of 1023 (the half-float accumulator and the transfer round trip).

export const BLUR_WIDTH = 128
export const BLUR_HEIGHT = 32
export const BLUR_SOURCE_FRAMES = 12
const HALF = BLUR_HEIGHT / 2
const BLACK = 64
const WHITE = 940
const BOX_WIDTH = 6
const BOX_STEP = 10
const BOX_START = 4
const MAX_CODE = 1023
const TOLERANCE_CODES = 2

const rampCode = (x) => 100 + Math.floor((x * 800) / BLUR_WIDTH)
const boxX = (k) => BOX_START + BOX_STEP * k

/** One `gbrp10le` frame: planes G, B, R, 16-bit little endian; `codeAt(x, y)` is the grey code of a pixel */
function frame(codeAt) {
  const plane = BLUR_WIDTH * BLUR_HEIGHT * 2
  const bytes = Buffer.alloc(plane * 3)
  for (let p = 0; p < 3; p++) {
    for (let y = 0; y < BLUR_HEIGHT; y++) {
      for (let x = 0; x < BLUR_WIDTH; x++) bytes.writeUInt16LE(codeAt(x, y), p * plane + (y * BLUR_WIDTH + x) * 2)
    }
  }
  return bytes
}

/** The case's source file: `BLUR_SOURCE_FRAMES` frames */
export function blurBoxesFile() {
  const frames = []
  for (let k = 0; k < BLUR_SOURCE_FRAMES; k++) {
    frames.push(
      frame((x, y) => {
        if (y < HALF) return rampCode(x)
        return x >= boxX(k) && x < boxX(k) + BOX_WIDTH ? WHITE : BLACK
      }),
    )
  }
  return Buffer.concat(frames)
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)

/** The value (0..1) the blend of `parts` ([code, weight]) has, in linear light */
const blended = (parts) =>
  linearToSrgb(parts.reduce((sum, [code, weight]) => sum + srgbToLinear(code / MAX_CODE) * weight, 0))

const levelOf = (image, x, y) => (image.data[(y * image.width + x) * 4] / 65535) * MAX_CODE

/**
 * The problems of a blurred output frame whose source frames are `first` .. `first + covered - 1`, of which the first
 * `weighted` carry `1 / weighted` each (the shutter's share): the static half is the ramp, each weighted box is
 * `1 / weighted` white over black, the boxes of the frames outside the shutter and the gaps are black.
 */
function blurProblems(image, first, covered, weighted) {
  const problems = []
  const expect = (what, x, y, code) => {
    const got = levelOf(image, x, y)
    if (Math.abs(got - code) > TOLERANCE_CODES) {
      problems.push(`${what} at (${x}, ${y}) is level ${got.toFixed(2)} of ${MAX_CODE}, expected ${code.toFixed(2)}`)
    }
  }
  for (let x = 0; x < BLUR_WIDTH; x += 7) expect('the static half', x, 3, rampCode(x))
  const share = 1 / weighted
  const inBlend = blended([
    [WHITE, share],
    [BLACK, 1 - share],
  ]) * MAX_CODE
  const background = BLACK
  const y = HALF + 8
  for (let k = first; k < first + covered; k++) {
    const x = boxX(k)
    const middle = x + BOX_WIDTH / 2
    const code = k - first < weighted ? inBlend : background
    expect(`the box of source frame ${k}`, Math.floor(middle), y, code)
    expect(`the box of source frame ${k}`, x, y, code)
    expect(`the gap after source frame ${k}`, x + BOX_WIDTH + 1, y, background)
  }
  return problems
}

/** 4x, 360 degrees: output frame `n` is source frames 4n .. 4n+3, four boxes at 25 % */
export const checkFourTimes360 = (image, frameNumber) => blurProblems(image, 4 * frameNumber, 4, 4)

/** 4x, 180 degrees: the window covers the first two of the four, two boxes at 50 % */
export const checkFourTimes180 = (image, frameNumber) => blurProblems(image, 4 * frameNumber, 4, 2)
