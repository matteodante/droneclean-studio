// The optical-flow golden case's input and check (task 11.12).
//
// The clip: 6 raw 10-bit frames of 256 x 128, a smooth grey texture (the same pattern the CPU twin's tests move,
// `src/studio/optical-flow/cpu-reference.test.ts`) that moves 6 px right and 2 px down a frame. Played at 0.5x with
// smooth slow motion in optical-flow mode, odd output frames lie halfway between two source frames and are made by the
// flow; even ones are source frames. The flow runs at half the frame (128 x 64, two pyramid levels).
//
// The check reads the picture the float composite delivers (unorm16 RGBA) and compares an interpolated frame with the
// pattern moved halfway, computed here, over the frame less a 16 px border: its mean error must be a fraction of the
// error the plain blend of the two frames has there. A source frame must come out as the file's codes.

export const FLOW_WIDTH = 256
export const FLOW_HEIGHT = 128
export const FLOW_SOURCE_FRAMES = 6
const STEP_X = 6
const STEP_Y = 2
const BLACK = 64
const RANGE = 876
const MAX_CODE = 1023
const BORDER = 16
/** A source frame passes through: within this many levels of 1023 of the file's code (the half-float round trip) */
const SOURCE_TOLERANCE = 1
/** The interpolated frame's mean error over the interior, in levels of 1023, at most */
const FLOW_MEAN_LIMIT = 1.5
/** ... and at most this share of the blend's mean error over the same pixels */
const FLOW_SHARE_OF_BLEND = 0.1

/** The texture, 0..1 (0.2..0.8 in fact), defined everywhere so a moved copy is exact at any shift */
function pattern(x, y) {
  return (
    0.5 +
    0.15 * Math.sin((2 * Math.PI * x) / 23 + 0.3) * Math.sin((2 * Math.PI * y) / 17 + 1.1) +
    0.1 * Math.sin((2 * Math.PI * (x + 0.6 * y)) / 31) +
    0.05 * Math.cos((2 * Math.PI * (0.4 * x - y)) / 13)
  )
}

/** The code of pixel (x, y) at source time `k` (a real number of frames): the pattern moved by k steps */
const codeAt = (x, y, k, step = [STEP_X, STEP_Y]) => BLACK + RANGE * pattern(x - step[0] * k, y - step[1] * k)

/** One `gbrp10le` frame: planes G, B, R, 16-bit little endian, every plane the same grey */
function frame(k, step = [STEP_X, STEP_Y]) {
  const plane = FLOW_WIDTH * FLOW_HEIGHT * 2
  const bytes = Buffer.alloc(plane * 3)
  for (let y = 0; y < FLOW_HEIGHT; y++) {
    for (let x = 0; x < FLOW_WIDTH; x++) {
      const code = Math.round(codeAt(x, y, k, step))
      for (let p = 0; p < 3; p++) bytes.writeUInt16LE(code, p * plane + (y * FLOW_WIDTH + x) * 2)
    }
  }
  return bytes
}

/** The case's source file: `FLOW_SOURCE_FRAMES` frames */
export function flowPatternFile() {
  return Buffer.concat(Array.from({ length: FLOW_SOURCE_FRAMES }, (_, k) => frame(k)))
}

/**
 * The vector blur cases' clip (design 9.2): the same moving texture, `VECTOR_SOURCE_FRAMES` frames long. (At twice the
 * speed the flow at this size fails: its coarse pyramid level aliases the texture, and the blur vanishes.)
 */
export const VECTOR_SOURCE_FRAMES = 12
const VECTOR_STEP = [STEP_X, STEP_Y]

/** The vector blur cases' source file */
export function vectorPatternFile() {
  return Buffer.concat(Array.from({ length: VECTOR_SOURCE_FRAMES }, (_, k) => frame(k, VECTOR_STEP)))
}

/** A still clip of the texture (six identical frames): the blur must leave it exactly as it is */
export function stillPatternFile() {
  return Buffer.concat(Array.from({ length: FLOW_SOURCE_FRAMES }, () => frame(0, [0, 0])))
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)

/** The texture blurred over the source times [from, to): its mean in linear light, as a code of 1023 */
function blurredCode(x, y, from, to, samples = 96) {
  let sum = 0
  for (let i = 0; i < samples; i++) {
    sum += srgbToLinear(codeAt(x, y, from + ((i + 0.5) / samples) * (to - from), VECTOR_STEP) / MAX_CODE)
  }
  return linearToSrgb(sum / samples) * MAX_CODE
}

/** The texture blended from whole source frames `frames` in linear light, as a code of 1023 (today's frame blend) */
function blendedCode(x, y, frames) {
  const sum = frames.reduce((total, k) => total + srgbToLinear(Math.round(codeAt(x, y, k, VECTOR_STEP)) / MAX_CODE), 0)
  return linearToSrgb(sum / frames.length) * MAX_CODE
}

/** The vector blur's mean error over the interior (a 24 px border left out: the blur clamps at the frame's edge) */
const VECTOR_BORDER = 24
/** ... at most this many levels of 1023 */
const VECTOR_MEAN_LIMIT = 1.5
/**
 * ... and at most this share of the error of what it replaces (the sharp frame, or today's blend of frames). On this
 * smooth texture both are only 2.6 to 2.8 levels off at 180 degrees and at 4x, so the limit above is what tells them
 * apart; the blur's own floor is about 1.1 levels (the texture read between its pixels, as the CPU twin measures too).
 */
const VECTOR_SHARE_OF_OTHER = 0.5

/**
 * The check of a vector blur case: output frame `n` is the texture blurred over the source times `window(n)` (the
 * union of every sample's shutter interval, centred on its time), within `VECTOR_MEAN_LIMIT` levels on average and
 * far closer to it than `other(n)` (the source frames it would otherwise show: one sharp frame, or a frame blend).
 */
export function checkVectorBlur(window, other) {
  return (image, frameNumber) => {
    const [from, to] = window(frameNumber)
    const frames = other(frameNumber)
    const { blur, alternative } = vectorErrors(image, from, to, frames)
    const problems = []
    if (blur > VECTOR_MEAN_LIMIT) {
      problems.push(`frame ${frameNumber} is ${blur.toFixed(2)} levels of 1023 from the texture blurred over [${from}, ${to}), on average (at most ${VECTOR_MEAN_LIMIT})`)
    }
    if (blur > VECTOR_SHARE_OF_OTHER * alternative) {
      problems.push(`frame ${frameNumber} is ${blur.toFixed(2)} levels from the blurred texture, the source frames ${frames.join(', ')} ${alternative.toFixed(2)}: the blur must be under ${VECTOR_SHARE_OF_OTHER} of their error`)
    }
    return problems
  }
}

/** The mean errors of the picture, and of the blend of `frames`, against the texture blurred over [from, to) */
function vectorErrors(image, from, to, frames) {
  let blur = 0
  let alternative = 0
  let count = 0
  for (let y = VECTOR_BORDER; y < image.height - VECTOR_BORDER; y += 2) {
    for (let x = VECTOR_BORDER; x < image.width - VECTOR_BORDER; x += 2) {
      const truth = blurredCode(x, y, from, to)
      blur += Math.abs(levelOf(image, x, y) - truth)
      alternative += Math.abs(blendedCode(x, y, frames) - truth)
      count++
    }
  }
  return { blur: blur / count, alternative: alternative / count }
}

const levelOf = (image, x, y, channel = 1) => (image.data[(y * image.width + x) * 4 + channel] / 65535) * MAX_CODE

/**
 * Source frame `k` as the file has it: within `SOURCE_TOLERANCE` of its codes (`codeOf`, the pattern's by default), on a
 * grid of every third pixel
 */
function sourceFrameProblems(image, k, codeOf = codeAt) {
  let worst = 0
  for (let y = 0; y < image.height; y += 3) {
    for (let x = 0; x < image.width; x += 3) {
      worst = Math.max(worst, Math.abs(levelOf(image, x, y) - Math.round(codeOf(x, y, k))))
    }
  }
  return worst > SOURCE_TOLERANCE ? [`source frame ${k} is off by up to ${worst.toFixed(2)} levels of 1023`] : []
}

/** The mean errors of the picture and of the blend of its two source frames against the pattern at time `k` */
function meanErrors(image, k) {
  const first = Math.floor(k)
  let flow = 0
  let blend = 0
  let count = 0
  for (let y = BORDER; y < image.height - BORDER; y++) {
    for (let x = BORDER; x < image.width - BORDER; x++) {
      const truth = codeAt(x, y, k)
      flow += Math.abs(levelOf(image, x, y) - truth)
      blend += Math.abs((Math.round(codeAt(x, y, first)) + Math.round(codeAt(x, y, first + 1))) / 2 - truth)
      count++
    }
  }
  return { flow: flow / count, blend: blend / count }
}

/** A frame halfway between two source frames: close to the pattern moved halfway, far closer than the blend */
function halfwayProblems(image, k) {
  const { flow, blend } = meanErrors(image, k)
  const problems = []
  if (flow > FLOW_MEAN_LIMIT) {
    problems.push(
      `the frame halfway is ${flow.toFixed(2)} levels of 1023 from the pattern moved halfway, on average (at most ${FLOW_MEAN_LIMIT})`,
    )
  }
  if (flow > FLOW_SHARE_OF_BLEND * blend) {
    problems.push(
      `the frame halfway is ${flow.toFixed(2)} levels from the pattern moved halfway, the blend ${blend.toFixed(2)}: the flow must be under ${FLOW_SHARE_OF_BLEND} of the blend's error`,
    )
  }
  return problems
}

/**
 * The problems of output frame `frameNumber` of the 0.5x clip: an even frame is source frame n/2, as the file has it;
 * an odd one lies halfway between source frames (n-1)/2 and (n+1)/2, close to the pattern moved halfway and far closer
 * than the blend of the two (which doubles every edge of the texture).
 */
export function checkFlowHalfway(image, frameNumber) {
  const k = frameNumber / 2
  return Number.isInteger(k) ? sourceFrameProblems(image, k) : halfwayProblems(image, k)
}

// --- The occlusion case (design 11.24) -----------------------------------------------------------------------------
// 6 raw 10-bit frames of the same size: a textured square moving 8 px right a frame over a background moving 4 px left,
// so the square covers background at its leading edge and uncovers it at its trailing edge. Played at 0.5x in
// optical-flow mode, odd output frames lie halfway and are made by the forward warp. The check compares an interpolated
// frame with the scene at that moment (exact: the scene is a formula) over the frame less a 16 px border: its mean error
// must be under a share of the plain blend's error there (the CPU twin measures 0.47 for the forward warp and 0.56 for
// the 11.12 interpolation, which searched backwards), and a source frame must come out as the file's codes.

export const OCCLUSION_SOURCE_FRAMES = 6
const SQUARE = { x: 60, y: 40, side: 44, step: 8, background: -4 }
/** The interpolated frame's mean error over the interior, at most this share of the blend's */
const OCCLUSION_SHARE_OF_BLEND = 0.52
/**
 * ... and with the optical flow's two settings off their defaults (design 11.24: high motion detail, hard edges on the
 * nearest frame) and no blur: the CPU twin measures 0.42 there, against 0.47 at the defaults
 */
const OCCLUSION_TUNED_SHARE_OF_BLEND = 0.46

const insideSquare = (x, y, k) => {
  const left = SQUARE.x + SQUARE.step * k
  return x >= left && x < left + SQUARE.side && y >= SQUARE.y && y < SQUARE.y + SQUARE.side
}

/** The scene's value (0..1) at a point at source time `k`: the square's own texture where it is, else the background */
function sceneAt(x, y, k) {
  const left = SQUARE.x + SQUARE.step * k
  if (insideSquare(x, y, k)) return 0.05 + 0.6 * pattern(1.7 * (x - left) + 5, 1.7 * (y - SQUARE.y) + 9)
  return pattern(x - SQUARE.background * k, y)
}

/** The code of pixel (x, y) at source time `k`, sampled at the pixel's centre */
const occlusionCodeAt = (x, y, k) => BLACK + RANGE * sceneAt(x + 0.5, y + 0.5, k)

/** One `gbrp10le` frame of the occlusion scene */
function occlusionFrame(k) {
  const plane = FLOW_WIDTH * FLOW_HEIGHT * 2
  const bytes = Buffer.alloc(plane * 3)
  for (let y = 0; y < FLOW_HEIGHT; y++) {
    for (let x = 0; x < FLOW_WIDTH; x++) {
      const code = Math.round(occlusionCodeAt(x, y, k))
      for (let p = 0; p < 3; p++) bytes.writeUInt16LE(code, p * plane + (y * FLOW_WIDTH + x) * 2)
    }
  }
  return bytes
}

/** The occlusion case's source file: `OCCLUSION_SOURCE_FRAMES` frames */
export function flowOcclusionFile() {
  return Buffer.concat(Array.from({ length: OCCLUSION_SOURCE_FRAMES }, (_, k) => occlusionFrame(k)))
}

/** A frame halfway in the occlusion clip: its mean error against the scene under a share of the blend's */
function occlusionHalfwayProblems(image, k, limit) {
  const first = Math.floor(k)
  let made = 0
  let blend = 0
  let count = 0
  for (let y = BORDER; y < image.height - BORDER; y++) {
    for (let x = BORDER; x < image.width - BORDER; x++) {
      const truth = occlusionCodeAt(x, y, k)
      made += Math.abs(levelOf(image, x, y) - truth)
      blend += Math.abs((Math.round(occlusionCodeAt(x, y, first)) + Math.round(occlusionCodeAt(x, y, first + 1))) / 2 - truth)
      count++
    }
  }
  const share = made / blend
  if (share <= limit) return []
  return [
    `the frame halfway is ${(made / count).toFixed(2)} levels of 1023 from the scene on average, the blend ${(blend / count).toFixed(2)}: ${share.toFixed(3)} of the blend's error, at most ${limit}`,
  ]
}

/**
 * The problems of output frame `frameNumber` of the 0.5x occlusion clip: an even frame is source frame n/2, as the file
 * has it; an odd one lies halfway, and its mean error against the scene at that moment is under a share of the blend's.
 */
export function checkFlowOcclusion(image, frameNumber) {
  return occlusionProblems(image, frameNumber, OCCLUSION_SHARE_OF_BLEND)
}

/** The same for the case whose clip has high motion detail and nearest-frame hard edges (design 11.24) */
export function checkFlowOcclusionTuned(image, frameNumber) {
  return occlusionProblems(image, frameNumber, OCCLUSION_TUNED_SHARE_OF_BLEND)
}

function occlusionProblems(image, frameNumber, limit) {
  const k = frameNumber / 2
  return Number.isInteger(k) ? sourceFrameProblems(image, k, occlusionCodeAt) : occlusionHalfwayProblems(image, k, limit)
}
