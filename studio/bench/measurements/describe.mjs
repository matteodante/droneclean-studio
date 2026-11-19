// How an export is written into a record (shared by every measurement that runs exports).
import { probeVideoFile } from '../lib/probe.mjs'

const GIB = 2 ** 30

/** The timing, memory and file facts of one export. `probe` is passed in when the caller already has it. */
export function describeExport(run, probe = probeVideoFile(run.outFile)) {
  const e = run.export
  const effective = e.effective
  return {
    id: run.id,
    requested: {
      codec: effective.codec,
      container: effective.container,
      quality: effective.quality,
      videoBitrateBitsPerSecond: effective.videoBitrate,
      bitrateMode: effective.bitrateMode,
      width: effective.resolution.width,
      height: effective.resolution.height,
      fps: effective.fps,
      codecFallback: effective.codecFallback,
    },
    path: {
      renderPath: e.renderPath,
      workerUsed: e.renderPath === 'worker',
      workerFallbackReason: e.workerFallbackReason,
      packetCopyPlanned: e.packetRemuxPlanned,
      smartCopy: e.smartCopy,
    },
    timing: {
      frames: e.frames,
      wallSeconds: round(e.wallMs / 1000, 2),
      framesPerSecond: round(e.fps, 1),
      steadyFramesPerSecond: e.steadyFps === null ? null : round(e.steadyFps, 1),
      firstFrameSeconds: e.firstFrameMs === null ? null : round(e.firstFrameMs / 1000, 2),
      prepSeconds: round(e.prepMs / 1000, 2),
    },
    memory: {
      peakBrowserGiB: round(run.memory.peakBytes / GIB, 2),
      baselineBeforeExportGiB:
        run.memory.baselineBytes === null ? null : round(run.memory.baselineBytes / GIB, 2),
      peakByProcessTypeGiB: Object.fromEntries(
        Object.entries(run.memory.peakByProcessType).map(([k, v]) => [k, round(v / GIB, 2)]),
      ),
      samples: run.memory.samples,
      note: 'resident memory (RSS, ps) summed over the browser, GPU, utility and renderer processes of the benchmark browser, polled every 250 ms; shared pages are counted in each process, so this is an upper bound',
    },
    file: probe,
    pageErrors: run.pageErrors,
  }
}

function round(value, digits) {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
