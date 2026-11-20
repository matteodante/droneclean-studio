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
const codeAt = (x, y, k) => BLACK + RANGE * pattern(x - STEP_X * k, y - STEP_Y * k)

/** One `gbrp10le` frame: planes G, B, R, 16-bit little endian, every plane the same grey */
function frame(k) {
  const plane = FLOW_WIDTH * FLOW_HEIGHT * 2
  const bytes = Buffer.alloc(plane * 3)
  for (let y = 0; y < FLOW_HEIGHT; y++) {
    for (let x = 0; x < FLOW_WIDTH; x++) {
      const code = Math.round(codeAt(x, y, k))
      for (let p = 0; p < 3; p++) bytes.writeUInt16LE(code, p * plane + (y * FLOW_WIDTH + x) * 2)
    }
  }
  return bytes
}

/** The case's source file: `FLOW_SOURCE_FRAMES` frames */
export function flowPatternFile() {
  return Buffer.concat(Array.from({ length: FLOW_SOURCE_FRAMES }, (_, k) => frame(k)))
}

const levelOf = (image, x, y, channel = 1) => (image.data[(y * image.width + x) * 4 + channel] / 65535) * MAX_CODE

/** Source frame `k` as the file has it: within `SOURCE_TOLERANCE` of its codes, on a grid of every third pixel */
function sourceFrameProblems(image, k) {
  let worst = 0
  for (let y = 0; y < image.height; y += 3) {
    for (let x = 0; x < image.width; x += 3) {
      worst = Math.max(worst, Math.abs(levelOf(image, x, y) - Math.round(codeAt(x, y, k))))
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
