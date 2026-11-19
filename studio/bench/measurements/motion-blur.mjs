// 12. Motion blur, the export proof (design 7.2, slice E): a clip at 4x with a 360 degree shutter, exported through the
// app's own path, against the same clip with the blur off and a plain 1x export.
//
//  - Decodes: the export decodes every source frame of the span once. The page counts the chunks given to the decoders
//    during the export (`VideoDecoder.decode`); the span's frames, each decoded once, are the expectation.
//  - Arithmetic: a few output frames are rendered through the export renderer with the blur on and their float
//    accumulator is read through the golden kit's test sink; the reference is the renderer's own frames of the same
//    source frames (the clip with a 90 degree shutter, one bare source frame per output frame, read the same way) averaged in linear light on the CPU with the plan's
//    weights. The two share the decoder and the source path, so the comparison isolates the gather (levels of 1023).
//    The exported file is not compared: it is 8-bit and lossy HEVC, which cannot be held to one level.
//  - Rate: the export's frames per second with the blur on, with it off at 4x, and at 1x, against the rate in
//    `bench/baseline/export-speed-and-format.json`.
import fs from 'node:fs'
import path from 'node:path'
import { dialogSettings, PROJECT_FPS } from '../lib/context.mjs'
import { runOneExport, withPreparedPage } from '../lib/exports.mjs'
import { describeExport } from './describe.mjs'

export const name = 'motion-blur'

const SPEED = 4
const SHUTTER_DEGREES = 360
/** The tolerance of the design: one level of 1023. */
const TOLERANCE_LEVELS = 1
/** Output frames the proof reads back (each costs five 88 MB readbacks): the first, the second, and three inside. */
const PROOF_FRAMES = [0, 1, 37, 150, 297]

/**
 * Whether the export decoded each source frame of the span once.
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
 * The proof's verdict on the frames the page compared.
 * @param {Array<{outputFrame:number, maxDiffLevels:number, samples:Array<{weight:number}>, weightSum:number}>} frames
 */
export function judgeProof(frames, { tolerance = TOLERANCE_LEVELS } = {}) {
  const worst = frames.reduce((a, f) => (f.maxDiffLevels > a.maxDiffLevels ? f : a), frames[0])
  const problems = []
  for (const f of frames) {
    if (f.maxDiffLevels > tolerance)
      problems.push(
        `frame ${f.outputFrame}: largest difference ${f.maxDiffLevels.toFixed(3)} levels of 1023, over ${tolerance}`,
      )
    if (Math.abs(f.weightSum - 1) > 1e-6)
      problems.push(`frame ${f.outputFrame}: weights sum to ${f.weightSum}`)
  }
  return {
    withinTolerance: problems.length === 0,
    toleranceLevels: tolerance,
    framesCompared: frames.length,
    maxDiffLevels: worst?.maxDiffLevels ?? null,
    worstFrame: worst?.outputFrame ?? null,
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
  const plain = await exportRun(`blur-plain-1x-${seconds}s`, { countDecodes: true })
  const off = await exportRun(`blur-off-${SPEED}x-${seconds}s`, {
    speed: SPEED,
    countDecodes: true,
  })
  const on = await exportRun(`blur-on-${SPEED}x-${SHUTTER_DEGREES}-${seconds}s`, {
    speed: SPEED,
    motionBlur: { shutterDegrees: SHUTTER_DEGREES },
    countDecodes: true,
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
      project:
        '3840x2880 at 59.94 fps (60000/1001), H.265 MP4, custom 120 Mbps, the +0.01 dB gain of the other measurements',
      motionBlurSwitch:
        'hidden in the app; the page turns it on with setFeatureOverride, as the golden kit does',
      proofFrames: frames,
      method:
        "the blurred frame is the export renderer's float accumulator read through the test sink; the reference is the same renderer's frames of the source frames the plan names (a 90 degree shutter: one sample, passed through the stages without the gather), averaged in linear light (sRGB curve) with the plan's weights on the CPU; differences are in levels of 1023 over the three colour channels",
    },
    result: {
      decodes: {
        blurOn4x: judgeDecodes(on.run.decodes, spanFrames),
        blurOff4x: { ...off.run.decodes, spanFrames },

        plain1x: {
          ...plain.run.decodes,
          spanFrames: plain.run.prepared.clip.sourceEnd - plain.run.prepared.clip.sourceStart,
        },
      },
      arithmetic: {
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
        blurOnOverBlurOff4x: fps(on) / fps(off),
        blurOnOverPlain1x: fps(on) / fps(plain),
        note: 'the baseline is the record of the baseline folder (older commit, project at 60 fps); the three runs here are taken on the same machine in this process, so they are the fair comparison',
      },
      exports: { plain1x: plain.described, blurOff4x: off.described, blurOn4x: on.described },
      notCompared:
        'the exported file: 8-bit, lossy HEVC, not comparable to one level of 1023; the colour of the source path against FFmpeg (both sides of the proof share it)',
    },
  }
}
