// 12. Motion blur, the export proof (design 9.2, after design 7.2 slice E): a clip at 4x with a 360 degree shutter and a
// clip at 1x with a 180 degree shutter (RSMB 0.5), exported through the app's own path, against the same clip with the
// blur off and a plain 1x export.
//
//  - Decodes: the export decodes every source frame of the span once (the vector blur also reads the frame before the
//    span and the one after it). The page counts the chunks given to the decoders during the export.
//  - Exactness: a few output frames of the 4x clip are rendered through the export renderer twice, each by a renderer of
//    its own, and their float accumulators are read through the golden kit's test sink: they must be the same bit for
//    bit. Each is also compared with the frame blend design 7.2 drew (the plan's bare source frames averaged in linear
//    light on the CPU): how far the vector blur moves the picture from the copies, in levels of 1023 (reported, not
//    judged). The exported file is not compared: it is 8-bit and lossy HEVC.
//  - Rate: the export's frames per second with the blur on at 4x and at 1x, with it off at 4x, and a plain 1x, against
//    the rate in `bench/baseline/export-speed-and-format.json`.
import fs from 'node:fs'
import path from 'node:path'
import { dialogSettings, PROJECT_FPS } from '../lib/context.mjs'
import { runOneExport, withPreparedPage } from '../lib/exports.mjs'
import { describeExport } from './describe.mjs'

export const name = 'motion-blur'

const SPEED = 4
const SHUTTER_DEGREES = 360
/** The shutter of the 1x export: RSMB's 0.5, the default (design 9.2, section 0). */
const ONE_X_SHUTTER_DEGREES = 180
/** Frames written as PNGs straight from the render path, with the blur on and off, to look at (in the cache, not in git) */
const STILLS_4X = [37, 150]
const STILLS_1X = [148, 600]
/** Output frames the proof reads back (each costs six 88 MB readbacks): the first, the second, and three inside. */
const PROOF_FRAMES = [0, 1, 37, 150, 297]

/**
 * Whether the export decoded each source frame of the span once. The vector blur also reads the frame before the span
 * and the frame after it (the gaps around the first and last frames), so up to two more frames are fine.
 * @param {{calls:number, distinctTimestamps:number, keyChunks:number}} decodes the page's counter
 * @param {number} spanFrames source frames the clip covers
 */
export function judgeDecodes(decodes, spanFrames) {
  const problems = []
  if (decodes.distinctTimestamps < spanFrames)
    problems.push(
      `${decodes.distinctTimestamps} different frames were decoded, the span has ${spanFrames}`,
    )
  if (decodes.calls !== decodes.distinctTimestamps)
    problems.push(
      `${decodes.calls} chunks were decoded for ${decodes.distinctTimestamps} frames: some more than once`,
    )
  return {
    everyFrameOnce: problems.length === 0,
    spanFrames,
    framesDecodedBeyondSpan: Math.max(0, decodes.distinctTimestamps - spanFrames),
    ...decodes,
    problems,
  }
}

/**
 * The proof's verdict: every frame repeats bit for bit, and how far the vector blur is from the frame blend.
 * @param {Array<{outputFrame:number, repeatMaxDiffLevels:number, meanDiffLevels:number, maxDiffLevels:number, weightSum:number}>} frames
 */
export function judgeProof(frames) {
  const problems = []
  for (const f of frames) {
    if (f.repeatMaxDiffLevels !== 0)
      problems.push(`frame ${f.outputFrame}: a second render differs by up to ${f.repeatMaxDiffLevels.toFixed(3)} levels of 1023`)
    if (Math.abs(f.weightSum - 1) > 1e-6) problems.push(`frame ${f.outputFrame}: weights sum to ${f.weightSum}`)
  }
  const mean = frames.reduce((sum, f) => sum + f.meanDiffLevels, 0) / Math.max(1, frames.length)
  return {
    repeatsExactly: problems.length === 0,
    framesCompared: frames.length,
    differenceFromFrameBlend: {
      meanLevels: mean,
      maxLevels: frames.reduce((max, f) => Math.max(max, f.maxDiffLevels), 0),
      note: 'levels of 1023 between the vector blur and the frame blend of the same source frames (design 7.2); the copies the blend showed are where it differs',
    },
    problems,
  }
}

/** The 120 Mbps export of the baseline record, or null when it has none. */
function baselineRate() {
  const file = new URL('../baseline/export-speed-and-format.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  const run = record.result?.custom120Mbps
  return run
    ? {
        framesPerSecond: run.timing.framesPerSecond,
        steadyFramesPerSecond: run.timing.steadyFramesPerSecond,
        date: record.date,
        project: record.parameters?.project,
        segmentSeconds: record.parameters?.segmentSeconds,
      }
    : null
}

const rateOf = (described) => ({
  frames: described.timing.frames,
  wallSeconds: described.timing.wallSeconds,
  framesPerSecond: described.timing.framesPerSecond,
  steadyFramesPerSecond: described.timing.steadyFramesPerSecond,
  peakBrowserGiB: described.memory.peakBrowserGiB,
})

export async function measure(ctx) {
  const { config } = ctx
  const seconds = config.fidelitySeconds
  const segment = await ctx.segment(seconds)
  const outDir = path.join(config.cache, 'exports')
  const base = {
    mediaFile: segment.file,
    project: { width: 3840, height: 2880, fps: PROJECT_FPS },
    settings: dialogSettings(config, 'custom'),
    forceRender: true,
  }
  const exportRun = async (id, extra) => {
    console.log(`   export ${id}`)
    const run = await runOneExport(config, { id, ...base, ...extra }, outDir)
    return { run, described: describeExport(run) }
  }

  // The rates, one export each in a fresh browser; the blurred one counts decodes.
  const plain = await exportRun(`blur-plain-1x-${seconds}s`, { countDecodes: true, stills: STILLS_1X })
  const off = await exportRun(`blur-off-${SPEED}x-${seconds}s`, {
    speed: SPEED,
    countDecodes: true,
    stills: STILLS_4X,
  })
  const on = await exportRun(`blur-on-${SPEED}x-${SHUTTER_DEGREES}-${seconds}s`, {
    speed: SPEED,
    motionBlur: { shutterDegrees: SHUTTER_DEGREES },
    countDecodes: true,
    stills: STILLS_4X,
  })
  const onOneX = await exportRun(`blur-on-1x-${ONE_X_SHUTTER_DEGREES}-${seconds}s`, {
    motionBlur: { shutterDegrees: ONE_X_SHUTTER_DEGREES },
    countDecodes: true,
    stills: STILLS_1X,
  })
  const span = on.run.prepared.clip
  const spanFrames = span.sourceEnd - span.sourceStart

  // The arithmetic, in a browser of its own.
  const lastFrame = span.durationInFrames - 1
  const frames = PROOF_FRAMES.filter((n) => n < lastFrame)
  console.log(`   proof, output frames ${frames.join(', ')}`)
  const proved = await withPreparedPage(
    config,
    { ...base, speed: SPEED, motionBlur: { shutterDegrees: SHUTTER_DEGREES } },
    async (bench) => {
      // Which accumulator the run used follows the device: `rgba32float` when the adapter offers float32-blendable
      // (the app asks for it wherever it makes its device), else `rgba16float`.
      const adapter = await bench.page.evaluate(async () => {
        const a = await navigator.gpu.requestAdapter()
        return { float32Blendable: a ? a.features.has('float32-blendable') : false }
      })
      const compared = await bench.page.evaluate((list) => window.bench.proveBlur(list), frames)
      return { compared, adapter }
    },
  )
  const proof = proved.compared
  const adapterOffers = proved.adapter
  const expectedSamples = SPEED * (SHUTTER_DEGREES / 360)
  const planProblems = []
  for (const f of proof) {
    const ok =
      f.samples.length === expectedSamples &&
      f.samples.every(
        (s, i) =>
          s.sourceFrame === f.outputFrame * SPEED + i &&
          Math.abs(s.weight - 1 / expectedSamples) < 1e-9,
      )
    if (!ok) planProblems.push(`frame ${f.outputFrame}: samples ${JSON.stringify(f.samples)}`)
  }

  const baseline = baselineRate()
  const fps = (r) => r.described.timing.framesPerSecond
  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: seconds,
      speed: SPEED,
      wholeSource:
        'the whole segment is exported: the last output frame covers source frames 1196..1199 of the 1,199 frame file, and the plan drops the missing 1199 (weights 1/3 on 1196..1198)',
      shutterDegrees: SHUTTER_DEGREES,
      oneXShutterDegrees: ONE_X_SHUTTER_DEGREES,
      project:
        '3840x2880 at 59.94 fps (60000/1001), H.265 MP4, custom 120 Mbps, the +0.01 dB gain of the other measurements',
      motionBlurSwitch:
        'hidden in the app; the page turns it on with setFeatureOverride, as the golden kit does',
      proofFrames: frames,
      method:
        "the blurred frame is the export renderer's float accumulator read through the test sink, rendered twice by two renderers (must be identical); the frame blend it is compared with is the same renderer's bare frames of the source frames the plan names (the clip shifted, at a 1 degree shutter, which passes every pixel through), averaged in linear light (sRGB curve) with the plan's weights on the CPU; differences are in levels of 1023 over the three colour channels",
    },
    result: {
      decodes: {
        blurOn4x: judgeDecodes(on.run.decodes, spanFrames),
        blurOff4x: { ...off.run.decodes, spanFrames },
        blurOn1x: judgeDecodes(onOneX.run.decodes, onOneX.run.prepared.clip.sourceEnd - onOneX.run.prepared.clip.sourceStart),

        plain1x: {
          ...plain.run.decodes,
          spanFrames: plain.run.prepared.clip.sourceEnd - plain.run.prepared.clip.sourceStart,
        },
      },
      exactness: {
        ...judgeProof(proof),
        accumulatorFormat: adapterOffers.float32Blendable ? 'rgba32float' : 'rgba16float',
        adapterOffersFloat32Blendable: adapterOffers.float32Blendable,
        planIsFourFramesAtQuarter: planProblems.length === 0,
        planProblems,
        frames: proof,
      },
      rate: {
        baseline,
        plain1x: rateOf(plain.described),
        blurOff4x: rateOf(off.described),
        blurOn4x: rateOf(on.described),
        blurOn1x: rateOf(onOneX.described),
        blurOnOverBlurOff4x: fps(on) / fps(off),
        blurOnOverPlain1x: fps(on) / fps(plain),
        blurOn1xOverPlain1x: fps(onOneX) / fps(plain),
        note: 'the baseline is the record of the baseline folder (older commit, project at 60 fps); the three runs here are taken on the same machine in this process, so they are the fair comparison',
      },
      exports: { plain1x: plain.described, blurOff4x: off.described, blurOn4x: on.described, blurOn1x: onOneX.described },
      stills: { plain1x: plain.run.stills, blurOn1x: onOneX.run.stills, blurOff4x: off.run.stills, blurOn4x: on.run.stills },
      notCompared:
        'the exported file: 8-bit, lossy HEVC, not comparable to one level of 1023; the colour of the source path against FFmpeg (both sides of the proof share it)',
    },
  }
}
