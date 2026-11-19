// 7c. Speed ramp with stabilization: does a stabilized, ramped export show, for each output frame, the stabilized
// picture of the source frame the curve predicts, with the gyro data of that same source frame?
//
// Clip 0020 is read from the ORIGINAL DJI file (a plain FFmpeg cut drops the gyro metadata), starting at frame 0, and
// exported twice through the app's own path with stabilization at the engine's default settings:
//  - the design's ramp (1x, 4x from frame 30 to 570, 1x at 600: 600 output frames, 2,310 source frames), and
//  - the same clip at speed 1 over the 2,310 source frames the ramp consumes (the reference: stabilization has no
//    notion of speed, so its frame `i` is the stabilized picture of source frame `i`).
// Output frame k of the ramp must be the reference's frame `predicted[k]`: found by the closest picture within 4 frames
// of the prediction (`matchAroundPrediction`), counting repeats, skips and the worst error in source frames.
// The stabilization host is watched during the ramp export: the source frames it was asked for must be exactly the
// frames the curve names, and the kernel parameters and matrices the engine answered for the frames of Gyroflow's
// reference file that the ramp shows (0, 1, 2 and 1000, where shown) are hashed and compared with it bit for bit.
//
//   node bench/run.mjs speed-ramp-stabilized     (opt-in: about 10 minutes, copies the 3.76 GB clip into the
//                                                  browser's storage twice)
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../lib/config.mjs'
import { openBenchPage } from '../lib/browser.mjs'
import { dialogSettings } from '../lib/context.mjs'
import { decodeSmallGrey } from '../lib/frames.mjs'
import { describeExport } from './describe.mjs'
import { exportOnPage, PROJECT_FPS, shownSourceFrame } from './ramp-support.mjs'
import { matchAroundPrediction, RAMP_KEYS, summariseSpeedRamp } from './speed-ramp.mjs'

export const name = 'speed-ramp-stabilized'

// A 16:9 project: the reference file was recorded with the engine's 3840x2160 output (task 6.1's spike), and since
// wave 16 a stabilized clip is made at the project's aspect, so a 4:3 project gives other kernel parameters and the
// hashes could not match. The clip (4:3) is stabilized into the 16:9 frame the reference was made for.
const PROJECT = { width: 3840, height: 2160, fps: PROJECT_FPS }
/** Output frames whose source frame's stabilization data are compared between the ramp and the plain export: both ramps, the hold, the ends. */
const SAMPLED_OUTPUT_FRAMES = [0, 1, 15, 29, 30, 31, 100, 300, 569, 570, 585, 599]
const REFERENCE_FILE = path.join(REPO_ROOT, '..', 'gyroflow', 'wasm', 'test', 'reference', 'clip-0020.json')

/** A page whose engine has the clip's motion data cached after the first export is loaded again, as a user's second export would be. */
async function reload(bench) {
  await bench.page.reload({ waitUntil: 'load', timeout: 60_000 })
  await bench.page.waitForFunction(() => Boolean(window.bench?.ready), { timeout: 30_000 })
}

/**
 * Which source frames the stabilization host was asked for, against the frames the curve predicts. The export worker's
 * host fetches the `lookahead` source frames after each one it misses (`engine-relay.ts`, LOOKAHEAD), assuming
 * sequential playback, so frames the curve skips are looked up too: they must each follow a predicted frame closely,
 * and every predicted frame must be among them.
 * @param {number[]} predicted source frame of each output frame
 * @param {number[]} lookedUp distinct source frames the host answered
 */
export function judgeLookups(predicted, lookedUp, lookahead = 8) {
  const wanted = new Set(predicted)
  const got = new Set(lookedUp)
  const missing = [...wanted].filter((frame) => !got.has(frame))
  const unpredicted = [...got].filter((frame) => !wanted.has(frame))
  const unexplained = unpredicted.filter((frame) => {
    for (let back = 1; back <= lookahead; back++) if (wanted.has(frame - back)) return false
    return true
  })
  return {
    predictedDistinct: wanted.size,
    lookedUpDistinct: got.size,
    predictedFramesNeverLookedUp: missing.length,
    lookedUpButNotPredicted: unpredicted.length,
    notPredictedAndNotWithinLookahead: unexplained.length,
    everyPredictedFrameLookedUp: missing.length === 0,
    onlyPredictedFramesAndTheirLookahead: unexplained.length === 0,
    firstMissing: missing.slice(0, 10),
    firstUnexplained: unexplained.slice(0, 10),
  }
}

/**
 * The hashes of the engine's data for frames the ramp used, against Gyroflow's reference.
 * @param {Array<{frame:number,matricesSha256:string,kernelParamsBytes:number,kernelParamsSha256:string}>} hashes
 * @param {Array<{frame:number,matrices_sha256:string,kernel_params_bytes:number,kernel_params_sha256:string}>} reference
 */
export function judgeKernelAgainstReference(hashes, reference) {
  const byFrame = new Map(reference.map((entry) => [entry.frame, entry]))
  const frames = hashes.map((h) => {
    const expected = byFrame.get(h.frame)
    return {
      frame: h.frame,
      matricesMatch: expected !== undefined && h.matricesSha256 === expected.matrices_sha256,
      kernelParamsMatch:
        expected !== undefined &&
        h.kernelParamsBytes === expected.kernel_params_bytes &&
        h.kernelParamsSha256 === expected.kernel_params_sha256,
    }
  })
  return {
    framesCompared: frames.length,
    allMatch: frames.length > 0 && frames.every((f) => f.matricesMatch && f.kernelParamsMatch),
    frames,
  }
}

/**
 * The engine's data for each watched source frame in the ramp export against the same frame's data in the plain export:
 * the same index must give the same matrices and kernel parameters, whatever the speed the clip plays at.
 * @param {Array<{frame:number,matricesSha256:string,kernelParamsSha256:string}>} ramp
 * @param {Array<{frame:number,matricesSha256:string,kernelParamsSha256:string}>} plain
 */
export function judgeSameData(ramp, plain) {
  const other = new Map(plain.map((h) => [h.frame, h]))
  const compared = ramp.filter((h) => other.has(h.frame))
  const different = compared.filter((h) => {
    const o = other.get(h.frame)
    return o.matricesSha256 !== h.matricesSha256 || o.kernelParamsSha256 !== h.kernelParamsSha256
  })
  return {
    framesCompared: compared.length,
    framesDifferent: different.length,
    same: compared.length > 0 && different.length === 0,
    differentFrames: different.map((h) => h.frame),
  }
}

export async function measure(ctx) {
  const { config } = ctx
  const reference = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'))
  const stat = fs.statSync(config.clip)
  if (stat.size !== reference.clip_bytes) {
    throw new Error(`${config.clip} is ${stat.size} bytes; the reference was recorded on a file of ${reference.clip_bytes} bytes (clip 0020 of 15 Nov)`)
  }
  const settings = {
    ...dialogSettings(config, 'custom'),
    resolution: { width: PROJECT.width, height: PROJECT.height },
    smartCopy: false,
  }
  const outDir = path.join(config.cache, 'exports')
  const common = {
    mediaFile: config.clip,
    project: PROJECT,
    settings,
    stabilization: {},
    fileLastModified: Math.floor(stat.mtimeMs),
  }
  // The source frames whose stabilization data are hashed in both exports: the reference's, and those the curve shows at the sampled output frames
  const watchList = [
    ...new Set([
      ...reference.frames.map((f) => f.frame),
      ...SAMPLED_OUTPUT_FRAMES.map((k) => shownSourceFrame(RAMP_KEYS, k)),
    ]),
  ].sort((a, b) => a - b)
  const bench = await openBenchPage({ cache: config.cache, media: { 'bench-clip': config.clip }, requireGyro: true })
  let ramped
  let flat
  let control
  try {
    console.log('   ramped, stabilized export')
    ramped = await exportOnPage(
      bench,
      { ...common, id: 'speed-ramp-stabilized', speedCurve: { keys: RAMP_KEYS }, watchFrames: watchList },
      outDir,
    )
    // The control: the engine's data for the reference's frames, asked of the same session's host in the page's own
    // way (what the stabilized-export measurement proves), so a difference from the reference in the ramp's own
    // lookups is told from a session that gives other data.
    control = await bench.page.evaluate((list) => window.bench.proveKernelParameters(list), reference.frames)
    await bench.page.evaluate(() => window.bench.clearBenchFiles())
    await reload(bench)
    const consumed = ramped.prepared.speedCurve.sourceEnd - ramped.prepared.speedCurve.sourceStart
    console.log(`   reference: the same ${consumed} source frames at speed 1, stabilized`)
    flat = await exportOnPage(
      bench,
      { ...common, id: 'speed-ramp-stabilized-reference', sourceWindow: { startFrame: 0, frames: consumed }, watchFrames: watchList },
      outDir,
    )
  } finally {
    await bench.close()
  }
  const facts = ramped.prepared.speedCurve
  console.log('   decoding both exports')
  const referenceFrames = await decodeSmallGrey(flat.outFile)
  const outputFrames = await decodeSmallGrey(ramped.outFile)
  const compared = matchAroundPrediction(referenceFrames, outputFrames, facts.predictedSourceFrames)
  const picture = summariseSpeedRamp(facts.predictedSourceFrames, compared.matched, {
    ambiguousOutputFrames: compared.ambiguousOutputFrames,
  })
  const lookups = judgeLookups(facts.predictedSourceFrames, ramped.seatLog.distinct)
  const inReference = (h) => reference.frames.some((f) => f.frame === h.frame)
  const kernel = judgeKernelAgainstReference(ramped.seatLog.hashes.filter(inReference), reference.frames)
  const controlJudged = judgeKernelAgainstReference(
    control.frames.map((f) => ({ frame: f.frame, matricesSha256: f.matricesSha256, kernelParamsBytes: f.kernelParamsBytes, kernelParamsSha256: f.kernelParamsSha256 })),
    reference.frames,
  )
  const shown = new Set(facts.predictedSourceFrames)
  const sameData = judgeSameData(ramped.seatLog.hashes, flat.seatLog.hashes)
  const failures = []
  if (outputFrames.length !== facts.predictedSourceFrames.length) failures.push(`the ramp export has ${outputFrames.length} frames, ${facts.predictedSourceFrames.length} were predicted`)
  if (referenceFrames.length !== facts.sourceEnd) failures.push(`the reference export has ${referenceFrames.length} frames, ${facts.sourceEnd} were expected`)
  if (!picture.everyPredictedFrameShownInOrder) failures.push('the stabilized ramp does not show the predicted frames in order')
  if (!lookups.everyPredictedFrameLookedUp) failures.push('the stabilization host was not asked for every predicted source frame')
  if (!lookups.onlyPredictedFramesAndTheirLookahead) failures.push('the stabilization host was asked for source frames the curve does not name and its lookahead does not explain')
  if (!sameData.same) failures.push('the engine gave other data for the same source frame in the ramp and in the plain export')
  if (!kernel.allMatch) failures.push('the kernel parameters of a shown reference frame differ from Gyroflow’s reference')
  return {
    ...(await ctx.header(name, {})),
    browser: { chromeVersion: ramped.chromeVersion, webgpuAdapter: ramped.gpu },
    parameters: {
      clip: path.basename(config.clip),
      exportSettings: `H.265 MP4, custom ${settings.videoBitrate / 1e6} Mbps, ${PROJECT.width}x${PROJECT.height}, project ${PROJECT_FPS} fps, stabilization at the engine's defaults`,
      speedCurve: { keys: RAMP_KEYS },
      method: 'the ramp export is compared, frame by frame, with the reference export (the same source frames at speed 1, stabilized): output frame k is matched to the closest reference frame within 4 frames of the prediction; the stabilization host is watched for the source frames it answered; the engine data for reference frames are hashed',
    },
    result: {
      picture,
      stabilizationLookups: { ...lookups, totalLookups: ramped.seatLog.lookups },
      kernelParameters: {
        ...kernel,
        seenByTheRampExport: ramped.seatLog.hashes,
        control: controlJudged,
        rampAgainstPlainExport: { ...sameData, watched: watchList },
        referenceFramesNotShownByTheRamp: reference.frames.map((f) => f.frame).filter((f) => !shown.has(f)),
      },
      firstPredictedFrames: facts.predictedSourceFrames.slice(0, 12),
      firstMatchedFrames: compared.matched.slice(0, 12),
      ramped: describeExport(ramped),
      reference: describeExport(flat),
      pageErrors: [...ramped.pageErrors, ...flat.pageErrors],
    },
    ...(failures.length > 0 ? { failure: failures.join('; ') } : {}),
  }
}
