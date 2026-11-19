// 12. The page's main thread during an export (task 8.3, design 3.6 section 2.15): how busy the page stays while the
// 10 s segment of the clip is exported, plain and with the D-Log M input colour stage, and at what speed.
//
//   node bench/run.mjs main-thread-export      (opt-in: `all` leaves it out; two exports, about two minutes)
//
// Two independent readings of the page's main thread, both from Chrome itself, over the export (runExport, the
// export's preparation included):
//
//   trace     Chrome's own trace (`toplevel` category): every task each thread of the page's renderer ran; the busy
//             share is the time covered by the page's main thread's tasks over the wall time, and the same for each
//             worker thread, which shows where the work went;
//   counters  the DevTools protocol's `Performance.getMetrics`: `TaskDuration`, the summed duration of the main
//             thread's tasks, over `Timestamp`.
//
// The verdict takes the larger of the two, and checks the picture: the first frames of each export are compared with
// the source's (SSIM, and PSNR for the plain run), because an export whose decoder failed renders black at full speed
// with a quiet main thread (task 8.3 found a worker that could not open its `blob:` source doing exactly that). Two
// in-page probes say what the pilot would feel: the long tasks the page
// ran (over 50 ms, `PerformanceObserver`), and how late a 50 ms timer fired. The export goes through the app's own path
// (`runRender` in `render-pipeline.ts`), which says whether the worker or the main thread rendered it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { openBenchPage, sampleBrowserMemory, startMemorySampler } from '../lib/browser.mjs'
import { exportSpec } from '../lib/context.mjs'
import { preparePage } from '../lib/exports.mjs'
import { parsePsnr, parseSsim } from '../lib/quality.mjs'
import { describeExport } from './describe.mjs'

export const name = 'main-thread-export'

/** Task 8.3's targets: the page's main thread under 20 % busy, and not slower than today's plain export */
const TARGETS = { mainThreadBusyShareBelow: 0.2, framesPerSecondAtLeast: 43.6 }
/** Seconds the browser's memory is left to settle after the export before it is read again */
const AFTER_EXPORT_SECONDS = 3
/** How many leading frames of an export are compared with the source's */
const CHECKED_FRAMES = 60
/** Below these the export is not the source's picture: a black or frozen export scores far lower (SSIM ~0) */
const PICTURE = { ssimAtLeast: 0.5, plainPsnrYAtLeast: 30 }
/** The trace events that are one task of a thread's loop */
const TASK_EVENTS = new Set(['ThreadControllerImpl::RunTask', 'RunTask'])
const GIB = 2 ** 30

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const round = (value, digits) => (value === null ? null : Number(value.toFixed(digits)))

/** The two counters of `Performance.getMetrics` this measurement reads, in seconds */
async function mainThreadCounters(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const byName = Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]))
  return {
    timestamp: byName.Timestamp,
    taskSeconds: byName.TaskDuration,
    scriptSeconds: byName.ScriptDuration,
  }
}

/** The length of the union of `[start, end]` intervals, in their unit */
function coveredLength(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let [start, end] = sorted[0] ?? [0, 0]
  for (const [s, e] of sorted.slice(1)) {
    if (s > end) {
      total += end - start
      start = s
      end = e
    } else if (e > end) end = e
  }
  return total + (end - start)
}

/**
 * Each renderer thread's busy share from a `toplevel` trace: the time its tasks cover over `wallMs`. The page's main
 * thread is the busiest `CrRendererMain` (the other renderers of the benchmark browser are idle); its process's
 * `DedicatedWorker thread`s are the export worker and the workers it starts.
 */
function threadBusyFromTrace(traceEvents, wallMs) {
  const names = new Map()
  const intervals = new Map()
  const open = new Map()
  for (const event of traceEvents) {
    const thread = `${event.pid}:${event.tid}`
    if (event.ph === 'M' && event.name === 'thread_name') names.set(thread, event.args?.name)
    if (!TASK_EVENTS.has(event.name)) continue
    if (event.ph === 'X' && typeof event.dur === 'number') {
      const list = intervals.get(thread) ?? []
      list.push([event.ts, event.ts + event.dur])
      intervals.set(thread, list)
    } else if (event.ph === 'B') {
      open.set(thread, event.ts)
    } else if (event.ph === 'E' && open.has(thread)) {
      const list = intervals.get(thread) ?? []
      list.push([open.get(thread), event.ts])
      intervals.set(thread, list)
      open.delete(thread)
    }
  }
  const threads = [...intervals].map(([thread, list]) => ({
    thread,
    pid: thread.split(':')[0],
    name: names.get(thread) ?? 'unnamed',
    busyShare: coveredLength(list) / 1000 / wallMs,
  }))
  const mains = threads.filter((t) => t.name === 'CrRendererMain').sort((a, b) => b.busyShare - a.busyShare)
  const main = mains[0]
  if (main === undefined) return null
  const workers = threads
    .filter((t) => t.pid === main.pid && t.name === 'DedicatedWorker thread')
    .sort((a, b) => b.busyShare - a.busyShare)
  return {
    mainThreadBusyShare: round(main.busyShare, 3),
    workerThreadBusyShares: workers.map((t) => round(t.busyShare, 3)),
  }
}

/** SSIM and PSNR of the export's first frames against the source's, both as 10-bit 4:2:0, paired by position */
function comparePicture(outputFile, sourceFile) {
  const side = (index, label) =>
    `[${index}:v]trim=end_frame=${CHECKED_FRAMES},setpts=N/(60*TB),format=yuv420p10le,split[${label}1][${label}2]`
  const graph = [side(0, 'a'), side(1, 'b'), '[a1][b1]psnr[p]', '[a2][b2]ssim[s]'].join(';')
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', outputFile, '-i', sourceFile, '-filter_complex', graph]
      .concat(['-map', '[p]', '-f', 'null', '-', '-map', '[s]', '-f', 'null', '-']),
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  )
  if (result.status !== 0) throw new Error(`ffmpeg psnr/ssim failed:\n${result.stderr.slice(-1500)}`)
  return { frames: CHECKED_FRAMES, psnrDb: parsePsnr(result.stderr), ssim: parseSsim(result.stderr) }
}

/** Starts the in-page probes: long tasks and a 50 ms heartbeat's lateness */
function startPageProbes(page) {
  return page.evaluate(() => {
    const state = { longTasks: [], lateMs: [] }
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
    })
    observer.observe({ type: 'longtask' })
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      state.lateMs.push(Math.max(0, now - last - 50))
      last = now
    }, 50)
    window.__mainThreadProbe = {
      stop() {
        clearInterval(timer)
        observer.disconnect()
        return state
      },
    }
  })
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** One export of the spec in a fresh browser, with the page's main thread watched while it runs */
async function runWatchedExport(config, spec) {
  const outDir = path.join(config.cache, 'exports')
  const mediaId = 'bench-clip'
  const bench = await openBenchPage({ cache: config.cache, media: { [mediaId]: spec.mediaFile } })
  try {
    const { page } = bench
    const browser = bench.context.browser()
    const prepared = await preparePage(bench, mediaId, spec)
    // The import's own work (probe, workers) is over before the readings start
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' })
    await startPageProbes(page)
    await browser.startTracing(page, { categories: ['toplevel', '__metadata'] })
    const sampler = startMemorySampler(bench.profileDir)
    const before = await mainThreadCounters(cdp)
    const started = performance.now()
    let record
    let memory
    let after
    let wallMs
    let trace
    try {
      record = await page.evaluate((settings) => window.bench.runExport(settings), spec.settings)
    } finally {
      wallMs = performance.now() - started
      after = await mainThreadCounters(cdp)
      memory = sampler.stop()
      trace = JSON.parse((await browser.stopTracing()).toString('utf8'))
    }
    const probes = await page.evaluate(() => window.__mainThreadProbe.stop())
    await sleep(AFTER_EXPORT_SECONDS * 1000)
    const settled = sampleBrowserMemory(bench.profileDir)

    const extension = record.effective.container ?? 'mp4'
    const outFile = path.join(outDir, `${spec.id}.${extension}`)
    const download = page.waitForEvent('download', { timeout: 5 * 60_000 })
    await page.evaluate((fileName) => window.bench.download(fileName), path.basename(outFile))
    await (await download).saveAs(outFile)

    const watchedSeconds = after.timestamp - before.timestamp
    const taskSeconds = after.taskSeconds - before.taskSeconds
    const traced = threadBusyFromTrace(trace.traceEvents ?? trace, wallMs)
    const counted = taskSeconds / watchedSeconds
    return {
      run: {
        id: spec.id,
        outFile,
        prepared,
        export: record,
        memory,
        chromeVersion: bench.chromeVersion,
        gpu: bench.gpu,
        pageErrors: bench.pageErrors.slice(0, 20),
      },
      mainThread: {
        busyShare: round(Math.max(counted, traced?.mainThreadBusyShare ?? 0), 3),
        trace: traced,
        counters: {
          busyShare: round(counted, 3),
          taskSeconds: round(taskSeconds, 2),
          scriptSeconds: round(after.scriptSeconds - before.scriptSeconds, 2),
          watchedSeconds: round(watchedSeconds, 2),
        },
        longTasks: {
          count: probes.longTasks.length,
          totalMs: Math.round(probes.longTasks.reduce((sum, ms) => sum + ms, 0)),
          maxMs: probes.longTasks.length === 0 ? 0 : Math.round(Math.max(...probes.longTasks)),
        },
        heartbeat50ms: {
          ticks: probes.lateMs.length,
          lateP95Ms: round(percentile(probes.lateMs, 95), 1),
          lateMaxMs: round(probes.lateMs.length === 0 ? null : Math.max(...probes.lateMs), 1),
        },
      },
      memoryAfterExportGiB: settled === null ? null : round(settled.total / GIB, 2),
    }
  } finally {
    await bench.close()
  }
}

function judge(label, watched, picture, { fpsTarget }) {
  const failures = []
  const e = watched.run.export
  if (!(picture.ssim?.all >= PICTURE.ssimAtLeast)) {
    failures.push(`${label}: the export is not the source's picture (SSIM ${picture.ssim?.all})`)
  }
  if (label === 'plain' && !(picture.psnrDb?.y >= PICTURE.plainPsnrYAtLeast)) {
    failures.push(`${label}: the export is not the source's picture (PSNR Y ${picture.psnrDb?.y} dB)`)
  }
  if (e.renderPath !== 'worker') {
    failures.push(`${label}: rendered on the ${e.renderPath} (${e.workerFallbackReason})`)
  }
  if (watched.mainThread.busyShare >= TARGETS.mainThreadBusyShareBelow) {
    failures.push(`${label}: the page's main thread was ${watched.mainThread.busyShare} busy`)
  }
  return {
    failures,
    meetsFps: fpsTarget === null ? null : e.fps >= fpsTarget,
  }
}

export async function measure(ctx) {
  const { config } = ctx
  const segment = await ctx.segment(config.segmentSeconds)
  const runs = {}
  const failures = []
  for (const [label, inputColor] of [
    ['plain', undefined],
    ['dlogM', 'dlog-m'],
  ]) {
    const id = `main-thread-${label}-${config.segmentSeconds}s`.replace(/\./g, '_')
    const spec = await exportSpec(ctx, {
      id,
      what: 'segment',
      kind: 'auto',
      seconds: config.segmentSeconds,
      inputColor,
    })
    console.log(`   exporting ${label}`)
    const watched = await runWatchedExport(config, spec)
    const picture = comparePicture(watched.run.outFile, segment.file)
    const verdict = judge(label, watched, picture, {
      fpsTarget: label === 'plain' ? TARGETS.framesPerSecondAtLeast : null,
    })
    failures.push(...verdict.failures)
    runs[label] = {
      ...describeExport(watched.run),
      mainThread: watched.mainThread,
      memoryAfterExportGiB: watched.memoryAfterExportGiB,
      pictureAgainstSource: picture,
      meetsFpsTarget: verdict.meetsFps,
    }
    const workers = watched.mainThread.trace?.workerThreadBusyShares ?? []
    console.log(
      `   ${label}: ${runs[label].path.renderPath}, ${runs[label].timing.framesPerSecond} fps, SSIM ${picture.ssim?.all}, PSNR Y ${picture.psnrDb?.y}, main thread ${watched.mainThread.busyShare} busy (trace ${watched.mainThread.trace?.mainThreadBusyShare}, counters ${watched.mainThread.counters.busyShare}), workers [${workers.join(', ')}]`,
    )
  }
  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: config.segmentSeconds,
      project: '3840x2880 at 59.94 fps (60000/1001), the clip rate exactly',
      runs: 'plain: the clip untouched but for a +0.01 dB audio gain (it has no audio) that keeps the packet copy away; dlogM: the same with the D-Log M input colour stage',
      busyShare:
        "the larger of two readings over runExport (the export's preparation included): the share of the wall time the page's main thread's tasks cover in Chrome's `toplevel` trace, and Chrome's TaskDuration over Timestamp (DevTools protocol, Performance.getMetrics)",
      targets: TARGETS,
      picture: `the first ${CHECKED_FRAMES} frames against the source's: SSIM at least ${PICTURE.ssimAtLeast} (both runs), PSNR Y at least ${PICTURE.plainPsnrYAtLeast} dB (plain run; the D-Log M run changes the colours on purpose)`,
    },
    result: runs,
    ...(failures.length > 0 ? { failure: failures.join('; ') } : {}),
  }
}
