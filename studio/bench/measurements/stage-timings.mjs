// 9. Stage timings (task 8.2): where the time of a frame goes. The editor's own stages record marks when a flag is
// on (src/studio/render/timings.ts); each run below plays or exports the same 10 s cut with the flag on, and the
// marks become per-stage statistics (bench/lib/timings.mjs). `node bench/report.mjs` prints them next to the
// `ceiling` record and names the slowest stage.
//
// Four runs: the export of the plain clip, the export with the D-Log M input colour stage (the stage pipeline then
// decodes through the frame provider and uploads to the GPU, and the colour stage runs on it), and the same two in
// preview mode (no readback, encode or write there).
import path from 'node:path'
import { exportSpec, PROJECT_FPS } from '../lib/context.mjs'
import { runOnePreview } from '../lib/exports.mjs'
import { formatSummary, marksFromEntries, summariseMarks } from '../lib/timings.mjs'

export const name = 'stage-timings'

/** Frames left out of the statistics: the decoder starts, pipelines compile, the first frames are not steady. */
const WARM_UP_FRAMES = 10
/** Frames of a preview run (a few seconds of playback at 59.94). */
const PREVIEW_FRAMES = 180

export async function measure(ctx) {
  const segment = await ctx.segment(ctx.config.segmentSeconds)
  const runs = []

  for (const inputColor of [undefined, 'dlog-m']) {
    const run = await ctx.export({ what: 'segment', kind: 'auto', inputColor, timings: true })
    const marks = marksFromEntries(run.export.timingMarks ?? [])
    const summary = summariseMarks(marks, { skipFrames: WARM_UP_FRAMES })
    const wallMsPerFrame = run.export.wallMs / run.export.frames || null
    runs.push({
      label: `export${inputColor ? `, input colour ${inputColor}` : ', plain clip'}`,
      kind: 'export',
      inputColor: inputColor ?? null,
      frames: run.export.frames,
      wallSeconds: Number((run.export.wallMs / 1000).toFixed(2)),
      framesPerSecond: Number(run.export.fps.toFixed(1)),
      steadyFramesPerSecond:
        run.export.steadyFps === null ? null : Number(run.export.steadyFps.toFixed(1)),
      wallMsPerFrame: wallMsPerFrame && Number(wallMsPerFrame.toFixed(2)),
      markCount: marks.length,
      summary,
      pageErrors: run.pageErrors,
    })
  }

  for (const inputColor of [undefined, 'dlog-m']) {
    const label = `preview${inputColor ? `, input colour ${inputColor}` : ', plain clip'}`
    let run
    try {
      run = await runOnePreview(
        ctx.config,
        {
          id: `preview${inputColor ? `-${inputColor}` : ''}`,
          mediaFile: segment.file,
          project: { width: 3840, height: 2880, fps: PROJECT_FPS },
          forceRender: true,
          inputColor,
        },
        { frames: PREVIEW_FRAMES },
      )
    } catch (error) {
      runs.push({
        label,
        kind: 'preview',
        inputColor: inputColor ?? null,
        ran: false,
        error: error.message,
      })
      continue
    }
    const marks = marksFromEntries(run.preview.timingMarks)
    runs.push({
      label,
      kind: 'preview',
      inputColor: inputColor ?? null,
      ran: true,
      frames: run.preview.frames,
      canvas: run.preview.size,
      wallSeconds: Number((run.preview.wallMs / 1000).toFixed(2)),
      steadyFramesPerSecond: Number(run.preview.steadyFps.toFixed(1)),
      wallMsPerFrame: Number((run.preview.wallMs / run.preview.frames).toFixed(2)),
      markCount: marks.length,
      summary: summariseMarks(marks, { skipFrames: WARM_UP_FRAMES }),
      pageErrors: run.pageErrors,
    })
  }

  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: ctx.config.segmentSeconds,
      warmUpFramesLeftOut: WARM_UP_FRAMES,
      previewFrames: PREVIEW_FRAMES,
      howItIsMeasured:
        "the editor's own marks (User Timing measures named dc.<stage>, recorded only while the page sets the flag), read back by the page: decode and upload around the decoder and the draw or GPU copy; each source stage submitted alone and timed to completion; frame.render around renderFrame; readback, encode and write around the capture, the encoder and the muxer's file writes",
      caveats: [
        'stages overlap in an export (the encode of one frame runs while the next renders), so the stage times add up to more than the real time per frame',
        'with the flag on each source stage is submitted in its own command buffer, which costs a little speed: the run is a measurement, not a speed record',
        'the preview run is renderFrame called back to back by the page: the preview pump, presenting the canvas and the interface are not in it',
        'upload is CPU time of the call (a canvas draw or a queued GPU copy); the GPU time of the copy falls into the stages after it',
      ],
    },
    result: {
      runs,
      textTables: runs
        .filter((r) => r.summary)
        .map((r) => formatSummary(r.label, r.summary, { wallMsPerFrame: r.wallMsPerFrame })),
    },
  }
}
