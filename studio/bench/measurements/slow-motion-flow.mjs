// 13. Optical-flow slow motion, the export cost (task 11.12): a 2 s section of clip 0020 at 0.5x (4 s, 240 output
// frames at 59.94) exported at 3840x2880 through the app's own path three times, each in a fresh browser: smooth slow
// motion off (every source frame shown twice), by frame blending, and by optical flow. Half the output frames lie
// between two source frames; the flow measures each source gap once (quarter-size flow, 960x720) and interpolates
// the frame inside it. The record gives each export's wall time and rate, and the flow's cost over the blend per
// output frame and per interpolated frame. Two output frames of the blend and the flow exports, one on a source frame
// and one between two, are also written as PNGs straight from the render path (`stills`, in the cache, not in git) to
// look at.
//
//   node bench/run.mjs slow-motion-flow     (opt-in: three 4K exports, about two minutes)
import path from 'node:path'
import { dialogSettings, PROJECT_FPS } from '../lib/context.mjs'
import { runOneExport } from '../lib/exports.mjs'
import { describeExport } from './describe.mjs'

export const name = 'slow-motion-flow'

const SPEED = 0.5
const SOURCE_SECONDS = 2
const SHUTTER_DEGREES = 360
/** Output frame 120 is source frame 60; 121 lies halfway between 60 and 61 */
const STILLS = [120, 121]

const rateOf = (described) => ({
  frames: described.timing.frames,
  wallSeconds: described.timing.wallSeconds,
  framesPerSecond: described.timing.framesPerSecond,
  steadyFramesPerSecond: described.timing.steadyFramesPerSecond,
  msPerFrame: Math.round((described.timing.wallSeconds * 1000 * 100) / described.timing.frames) / 100,
  peakBrowserGiB: described.memory.peakBrowserGiB,
})

/**
 * What the flow costs over the blend: per output frame, and per interpolated frame (half the frames at 0.5x).
 * @param {{wallSeconds:number, frames:number}} blend
 * @param {{wallSeconds:number, frames:number}} flow
 * @param {number} interpolatedFrames output frames that lie between two source frames
 */
export function flowCost(blend, flow, interpolatedFrames) {
  const extraMs = (flow.wallSeconds - blend.wallSeconds) * 1000
  return {
    extraSeconds: Math.round(extraMs) / 1000,
    flowOverBlendWallTime: Math.round((flow.wallSeconds / blend.wallSeconds) * 1000) / 1000,
    extraMsPerOutputFrame: Math.round((extraMs / flow.frames) * 100) / 100,
    extraMsPerInterpolatedFrame: Math.round((extraMs / interpolatedFrames) * 100) / 100,
  }
}

export async function measure(ctx) {
  const { config } = ctx
  const segment = await ctx.segment(SOURCE_SECONDS)
  const outDir = path.join(config.cache, 'exports')
  const base = {
    mediaFile: segment.file,
    project: { width: 3840, height: 2880, fps: PROJECT_FPS },
    settings: dialogSettings(config, 'custom'),
    forceRender: true,
    speed: SPEED,
  }
  const exportRun = async (id, motionBlur, stills = []) => {
    console.log(`   export ${id}`)
    const run = await runOneExport(config, { id, ...base, motionBlur, stills }, outDir)
    return { run, described: describeExport(run) }
  }

  const held = await exportRun('slow-held-0.5x', { shutterDegrees: SHUTTER_DEGREES })
  const blend = await exportRun(
    'slow-blend-0.5x',
    { shutterDegrees: SHUTTER_DEGREES, smoothSlowMotion: 'blend' },
    STILLS,
  )
  const flow = await exportRun(
    'slow-flow-0.5x',
    { shutterDegrees: SHUTTER_DEGREES, smoothSlowMotion: 'optical-flow' },
    STILLS,
  )
  const frames = flow.described.timing.frames
  // At 0.5x with equal rates, every odd output frame lies halfway between two source frames
  const interpolated = Math.floor(frames / 2)
  const rates = { held: rateOf(held.described), blend: rateOf(blend.described), flow: rateOf(flow.described) }

  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      sourceSeconds: SOURCE_SECONDS,
      speed: SPEED,
      outputFrames: frames,
      interpolatedFrames: interpolated,
      shutterDegrees: SHUTTER_DEGREES,
      project:
        '3840x2880 at 59.94 fps (60000/1001), H.265 MP4, custom 120 Mbps, the +0.01 dB gain of the other measurements',
      flowSize: '960x720 (a quarter of the 3840x2880 source frame), 5 pyramid levels',
      motionBlurSwitch: 'turned on by the page with setFeatureOverride, as the golden kit does',
      stills: STILLS,
    },
    result: {
      rates,
      flowOverBlend: flowCost(rates.blend, rates.flow, interpolated),
      blendOverHeld: flowCost(rates.held, rates.blend, interpolated),
      stills: { blend: blend.run.stills, flow: flow.run.stills },
      exports: { held: held.described, blend: blend.described, flow: flow.described },
      notMeasured:
        'the preview (the same code draws it, frame by frame); a stabilized clip at 0.5x (the interpolated frame asks the engine for its fractional moment); quality against real frames (design 11.12 measured it: 4 to 7 dB over the blend)',
    },
  }
}
