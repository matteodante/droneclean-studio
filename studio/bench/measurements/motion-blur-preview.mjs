// 13. Motion blur in the preview (design 7.2, slice D's measurement): the preview-mode renderer (what the preview pump
// creates) on a clip at 4x with the blur on, asked for consecutive frames back to back (what playing asks for), and for a
// paused frame (a jump to it, and a redraw of it), at the project's full 3840x2880 and at the preview's usual size
// (`getRealtimePreviewRenderSize`: 1,920 x 1,080 pixels' worth, 1664x1248 for this project). The 4x clip with the blur
// off is the same run for comparison, and a 1x clip with the vector blur at 180 degrees (design 9.2) the cost at normal
// speed. Both blurred clips are checked to draw a different frame from the clip with the blur off (so the run did draw a
// blur, at 1x too).
//
// Not included: presenting the canvas, the pump's scheduling, the interface, audio. 59.94 fps is kept when the mean
// frame time is under 16.68 ms and the tail (p99) is not far above it; `keeps5994` states both.
import { PROJECT_FPS } from '../lib/context.mjs'
import { runOnePreview, withPreparedPage } from '../lib/exports.mjs'
import { formatSummary, marksFromEntries, summariseMarks } from '../lib/timings.mjs'

export const name = 'motion-blur-preview'

const FRAME_BUDGET_MS = 1001 / 60
/** The preview's usual canvas for this project: 1664 x 1248 of 3840 x 2880. */
const USUAL_SCALE = 1664 / 3840
const SIZES = [
  { label: 'usual', scale: USUAL_SCALE },
  { label: 'full', scale: 1 },
]
const PLAY_FRAMES = 180
const WARM_FRAMES = 10
const START_FRAME = 20
/** Frames left out of the mark statistics. */
const WARM_UP_MARK_FRAMES = 10
/** Frames far apart in the 4x clip's 299 output frames (and the 1x clip's 1,199). */
const PAUSED_FRAMES = [200, 40, 120, 260, 80]

/** Whether a run of frame times keeps 59.94 fps: the mean inside the budget and 99 % of frames under twice it. */
export function keeps5994(times) {
  return {
    keeps: times.meanMs <= FRAME_BUDGET_MS && times.p99Ms <= 2 * FRAME_BUDGET_MS,
    budgetMs: FRAME_BUDGET_MS,
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** The paused numbers of a run: the median first draw after a jump, and the median redraw. */
export function summarisePaused(paused) {
  return {
    jumps: paused.length,
    medianSeekMs: median(paused.map((p) => p.seekMs)),
    maxSeekMs: Math.max(...paused.map((p) => p.seekMs)),
    medianRedrawMs: median(paused.flatMap((p) => p.redrawMs)),
    maxRedrawMs: Math.max(...paused.flatMap((p) => p.redrawMs)),
  }
}

export async function measure(ctx) {
  const { config } = ctx
  const seconds = config.fidelitySeconds
  const segment = await ctx.segment(seconds)
  const base = {
    mediaFile: segment.file,
    project: { width: 3840, height: 2880, fps: PROJECT_FPS },
    forceRender: true,
  }
  const probe = (scale, spec) =>
    withPreparedPage(config, { ...base, ...spec }, (bench) =>
      bench.page.evaluate((o) => window.bench.runPreviewProbe(o), {
        scale,
        playFrames: PLAY_FRAMES,
        warmFrames: WARM_FRAMES,
        startFrame: START_FRAME,
        pausedFrames: PAUSED_FRAMES,
      }),
    )
  const runs = []
  for (const size of SIZES) {
    for (const variant of [
      {
        label: '4x blur on',
        spec: { speed: 4, motionBlur: { shutterDegrees: 360 } },
      },
      { label: '4x blur off', spec: { speed: 4 } },
      { label: '1x blur on', spec: { motionBlur: { shutterDegrees: 180 } } },
    ]) {
      console.log(`   preview ${variant.label}, ${size.label} size`)
      try {
        const result = await probe(size.scale, variant.spec)
        runs.push({
          variant: variant.label,
          size: size.label,
          canvas: result.size,
          firstFrameMs: result.firstFrameMs,
          playing: { ...result.playing, ...keeps5994(result.playing) },
          paused: { ...summarisePaused(result.paused), draws: result.paused },
        })
      } catch (error) {
        runs.push({ variant: variant.label, size: size.label, ran: false, error: error.message })
      }
    }
  }
  // Where the time of a 4x blur-on frame goes (stage marks: decode, upload, gather.record, gather.resolve, gather.gpu)
  console.log('   stage marks, 4x blur on, usual size')
  let stageMarks
  try {
    const marked = await runOnePreview(
      config,
      { id: 'blur-preview-marks', ...base, speed: 4, motionBlur: { shutterDegrees: 360 } },
      { frames: PLAY_FRAMES, scale: USUAL_SCALE },
    )
    const summary = summariseMarks(marksFromEntries(marked.preview.timingMarks), {
      skipFrames: WARM_UP_MARK_FRAMES,
    })
    stageMarks = {
      steadyFramesPerSecond: marked.preview.steadyFps,
      summary,
      text: formatSummary('4x blur on, usual size', summary, {
        wallMsPerFrame: marked.preview.wallMs / marked.preview.frames,
      }),
    }
  } catch (error) {
    stageMarks = { ran: false, error: error.message }
  }
  const compare = (spec) =>
    withPreparedPage(config, { ...base, ...spec }, (bench) =>
      bench.page.evaluate((o) => window.bench.compareBlurSwitch(o), {
        scale: USUAL_SCALE,
        frames: [0, 100, 150],
      }),
    )
  console.log('   a different frame at 1x and at 4x')
  const oneX = await compare({ motionBlur: { shutterDegrees: 180 } })
  const fourX = await compare({ speed: 4, motionBlur: { shutterDegrees: 360 } })
  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: seconds,
      playingFrames: PLAY_FRAMES,
      warmUpFrames: WARM_FRAMES,
      pausedFrames: PAUSED_FRAMES,
      sizes: SIZES.map((s) => ({
        ...s,
        canvas: `${Math.round(3840 * s.scale)}x${Math.round(2880 * s.scale)}`,
      })),
      motionBlurSwitch: 'hidden in the app; the page turns it on with setFeatureOverride',
      method:
        'createCompositionRenderer in preview mode, frames asked back to back from frame 20 after a warm-up (the pump while playing, without presenting); a paused frame is the first draw after a jump and three redraws',
    },
    result: {
      runs,
      stageMarks,
      oneXBlurOnVersusOff: {
        blurDrawn: oneX.every((f) => !f.identical),
        frames: oneX,
      },
      fourXBlurOnVersusOff: {
        blurDrawn: fourX.every((f) => !f.identical),
        frames: fourX,
      },
    },
  }
}
