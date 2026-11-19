// 7. Speed ramp: does an export of a clipped speed curve show the source frame the curve predicts, in order?
//
// The design's ramp (docs/designs/7.1-speed-ramps.md, section 5.2) — 1x, accelerate to 4x, hold, back to 1x — over
// 600 output frames at 59.94, which consume 2,310 source frames. The prediction is the app's own `sourceFrameAt`, one
// value per output frame, computed by the benchmark page from the clip the export renders. Every output frame of the
// exported file is then matched to a source frame around that prediction, and the record counts what the export
// showed: the distance to the prediction, the frames repeated, and the frames skipped beyond what the curve asked.
import path from 'node:path'
import { openBenchPage } from '../lib/browser.mjs'
import { decodeSmallGrey } from '../lib/frames.mjs'
import { describeExport } from './describe.mjs'
import { exportOnPage, PROJECT_FPS } from './ramp-support.mjs'

export const name = 'speed-ramp'

/** The design's ramp: 1x at the clip's first frame, 4x from frame 30 to 570, 1x at frame 600. */
export const RAMP_KEYS = [
  { frame: 0, speed: 1 },
  { frame: 30, speed: 4 },
  { frame: 570, speed: 4 },
  { frame: 600, speed: 1 },
]
/** Source frames the ramp consumes: what `sourceFrameAt` answers at the clip's end (section 5.2). */
export const RAMP_SOURCE_FRAMES = 2310
/** The cut of the source must hold the whole ramp: 40 s is 2,398 frames at 59.94. */
const SOURCE_SECONDS = 40
/** How far around the prediction a source frame is looked for, in frames. */
const MATCH_WINDOW = 4

/**
 * The export dialog's state for this measurement: H.265, MP4, "ultra", a custom 120 Mbps so that the encoder's
 * noise stays far below the difference between two source frames (the frame-fidelity measurement's choice). These are
 * the values `lib/context.mjs` passes for a `custom` export.
 */
const SETTINGS = {
  codec: 'h265',
  quality: 'ultra',
  resolution: { width: 3840, height: 2880 },
  smartCopy: true,
  mode: 'video',
  videoContainer: 'mp4',
  subtitleMode: 'burn',
  renderWholeProject: false,
  rateControl: 'variable',
  videoBitrate: 120_000_000,
}

function sad(a, b) {
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
  return total
}

/**
 * For each output frame, the source frame closest to its picture, searched in a window around the frame the curve
 * predicts (`MATCH_WINDOW` either side). Returns the matched source frames, their signed distance to the prediction
 * (`matched - predicted`), and whether the match was ambiguous: in a still scene the neighbouring source frames are
 * nearly the same picture, and `best / second > ambiguityRatio` says the count of repeats can be off by those.
 *
 * @param {Uint8Array[]} source small grey frames of the source, in order
 * @param {Uint8Array[]} output small grey frames of the export, in order
 * @param {number[]} predicted the source frame `sourceFrameAt` asks for at each output frame
 */
export function matchAroundPrediction(source, output, predicted, { ambiguityRatio = 0.85 } = {}) {
  if (output.length !== predicted.length) {
    throw new Error(`export has ${output.length} frames but ${predicted.length} were predicted`)
  }
  const matched = []
  const distances = []
  const ambiguousOutputFrames = []
  for (let k = 0; k < output.length; k++) {
    const predictedFrame = predicted[k]
    const from = Math.max(0, Math.min(source.length - 1, predictedFrame - MATCH_WINDOW))
    const to = Math.min(source.length - 1, predictedFrame + MATCH_WINDOW)
    let best = Infinity
    let second = Infinity
    let index = from
    for (let j = from; j <= to; j++) {
      const d = sad(output[k], source[j])
      if (d < best) {
        second = best
        best = d
        index = j
      } else if (d < second) {
        second = d
      }
    }
    matched.push(index)
    distances.push(index - predictedFrame)
    if (second !== Infinity && second > 0 && best / second > ambiguityRatio) {
      ambiguousOutputFrames.push(k)
    }
  }
  return { matched, distances, ambiguousOutputFrames }
}

/** Counts of the values a sequence shows, and the steps between them. */
function sequenceFacts(values) {
  if (values.length === 0) return { first: null, last: null, distinct: 0, repeats: 0, maxStep: 0 }
  let repeats = 0
  let maxStep = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] === values[i - 1]) repeats++
    const step = values[i] - values[i - 1]
    if (Math.abs(step) > Math.abs(maxStep)) maxStep = step
  }
  return {
    first: values[0],
    last: values[values.length - 1],
    distinct: new Set(values).size,
    repeats,
    maxStep,
  }
}

/**
 * What the matched frames say against the prediction.
 *
 * `skippedBeyondPrediction` counts the output frames whose step forward is larger than the prediction's: the export
 * jumped over source frames the curve asked for. `shortOfPrediction` counts the opposite — a smaller step, which
 * means a source frame was shown again or the export fell behind. `predictedSourceFramesMissing` lists predicted
 * frames no output frame shows, and `unpredictedSourceFramesShown` those shown that the curve never asked for.
 *
 * `everyPredictedFrameShownInOrder` is the measurement's headline: no predicted frame missing, no frame out of
 * order, and every output frame within one source frame of its prediction.
 */
export function summariseSpeedRamp(
  predicted,
  matched,
  { ambiguousOutputFrames = [], listLimit = 10 } = {},
) {
  const distances = matched.map((frame, k) => frame - predicted[k])
  const maxFrameDistance = distances.reduce((worst, d) => Math.max(worst, Math.abs(d)), 0)
  const predictedSet = new Set(predicted)
  const matchedSet = new Set(matched)
  const predictedSourceFramesMissing = [...predictedSet].filter((frame) => !matchedSet.has(frame))
  const unpredictedSourceFramesShown = [...matchedSet].filter((frame) => !predictedSet.has(frame))
  let skippedBeyondPrediction = 0
  let shortOfPrediction = 0
  let outOfOrderFrames = 0
  for (let k = 1; k < matched.length; k++) {
    const step = matched[k] - matched[k - 1]
    const predictedStep = predicted[k] - predicted[k - 1]
    if (step > predictedStep) skippedBeyondPrediction++
    else if (step < predictedStep) shortOfPrediction++
    if (step < 0) outOfOrderFrames++
  }
  const ambiguous = new Set(ambiguousOutputFrames)
  const worst = distances
    .map((distance, k) => ({
      outputFrame: k,
      predicted: predicted[k],
      matched: matched[k],
      distance,
      matchWasAmbiguous: ambiguous.has(k),
    }))
    .filter((entry) => entry.distance !== 0)
    .slice(0, listLimit)
  return {
    outputFrames: predicted.length,
    predicted: sequenceFacts(predicted),
    matched: sequenceFacts(matched),
    maxFrameDistance,
    exactMatches: distances.filter((d) => d === 0).length,
    aheadOfPredictionFrames: distances.filter((d) => d > 0).length,
    behindPredictionFrames: distances.filter((d) => d < 0).length,
    skippedBeyondPrediction,
    shortOfPrediction,
    outOfOrderFrames,
    predictedSourceFramesMissing: predictedSourceFramesMissing.length,
    unpredictedSourceFramesShown: unpredictedSourceFramesShown.length,
    ambiguousMatches: ambiguous.size,
    ambiguousOutputFrames: [...ambiguous].slice(0, 20),
    everyPredictedFrameShownInOrder:
      predictedSourceFramesMissing.length === 0 && outOfOrderFrames === 0 && maxFrameDistance <= 1,
    predictionExact: predictedSourceFramesMissing.length === 0 && maxFrameDistance === 0,
    worstMatches: worst,
  }
}

/**
 * One export of the curved clip: the page places the clip on a 59.94 project, gives it the ramp, and reports the
 * source frame it predicts for every output frame (and the frame the render path resolves, as a second opinion).
 */
async function runRampExport(config, segment) {
  const mediaId = 'bench-clip'
  const bench = await openBenchPage({
    cache: config.cache,
    media: { [mediaId]: segment.file },
  })
  try {
    return await exportOnPage(
      bench,
      {
        id: 'speed-ramp',
        mediaFile: segment.file,
        project: { width: 3840, height: 2880, fps: PROJECT_FPS },
        settings: SETTINGS,
        speedCurve: { keys: RAMP_KEYS },
      },
      path.join(config.cache, 'exports'),
    )
  } finally {
    await bench.close()
  }
}

export async function measure(ctx) {
  const segment = await ctx.segment(SOURCE_SECONDS)
  const run = await runRampExport(ctx.config, segment)
  const facts = run.prepared.speedCurve
  if (!facts) throw new Error('the benchmark page built no speed curve')
  const source = await decodeSmallGrey(segment.file)
  const output = await decodeSmallGrey(run.outFile)
  const compared = matchAroundPrediction(source, output, facts.predictedSourceFrames)
  const result = summariseSpeedRamp(facts.predictedSourceFrames, compared.matched, {
    ambiguousOutputFrames: compared.ambiguousOutputFrames,
  })
  const described = describeExport(run)
  return {
    ...(await ctx.header(name, { segment })),
    // This measurement drives the page itself, so the header's browser row comes from the run.
    browser: { chromeVersion: run.chromeVersion, webgpuAdapter: run.gpu },
    parameters: {
      segmentSeconds: SOURCE_SECONDS,
      exportSettings: `H.265 MP4, custom ${SETTINGS.videoBitrate / 1e6} Mbps, ${SETTINGS.resolution.width}x${SETTINGS.resolution.height}`,
      projectFps: PROJECT_FPS,
      projectRate: '60000/1001',
      speedCurve: {
        keys: facts.keys,
        averageSpeed: facts.averageSpeed,
        peakSpeed: Math.max(...facts.keys.map((key) => key.speed)),
      },
      clip: {
        from: facts.from,
        durationInFrames: facts.durationInFrames,
        outputSeconds: facts.durationInFrames / PROJECT_FPS,
        sourceStart: facts.sourceStart,
        sourceEnd: facts.sourceEnd,
        sourceFramesConsumed: (facts.sourceEnd ?? 0) - facts.sourceStart,
        designSourceFrames: RAMP_SOURCE_FRAMES,
      },
      method:
        'the page gives the clip the design’s ramp, then predicts each output frame with the app’s sourceFrameAt; every frame of the source and of the export is reduced to a 192x144 grey picture and each output frame is matched to the closest source frame within 4 frames of its prediction',
      matchingWindowFrames: MATCH_WINDOW,
    },
    result: {
      ...result,
      renderPath: {
        framesCompared: facts.predictedSourceFrames.length,
        disagreementsWithMapping: facts.renderPathDisagreements,
        sourceFrames: sequenceFacts(facts.renderPathSourceFrames),
      },
      firstPredictedFrames: facts.predictedSourceFrames.slice(0, 12),
      firstMatchedFrames: compared.matched.slice(0, 12),
      timestamps: described.file.timestamps,
      export: described,
    },
  }
}
