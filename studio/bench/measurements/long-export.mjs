/* eslint-disable no-console -- a command-line tool */
// 11. Long export (task 3.5, design 3.1 section 4.8): the six clips of 15 Nov end to end on one timeline, exported
// through the app's own path, with the memory of the benchmark browser recorded over time, the output file's growth
// and the time. Memory must stay flat (judged by lib/memory-curve.mjs) and under the limit (6 GiB by default): when
// the sampler sees the browser pass the limit the export is aborted and the measurement fails.
//
//   node bench/run.mjs long-export [--long-seconds N]     (default: the whole timeline, about 20 minutes)
//
// Where the export goes (BENCH_LONG_EXPORT_DESTINATION; the app's own route is `desktop` since task 3.5):
//   desktop      the desktop app's own process (Electron, a throwaway profile): its save dialog (answered by this driver
//                with a path in bench/.cache/exports), the `droneclean-export:` scheme and the shell's temporary file,
//                renamed to the final name at the end. Needs `npm --prefix desktop run build:main`. The default.
//   file-handle  headless Chrome, the muxer writing into an OPFS file handle (the web build's save-picker route).
//   download     headless Chrome, the old route: a scratch file in the browser's storage, then a blob download that
//                copies it a second time (the 19 Nov first measurement).
// BENCH_LONG_EXPORT_CANCEL_AFTER_S=N (desktop only) cancels the export after N seconds instead of finishing it, and
// checks that no file is left and that a file already at the chosen name is untouched.
//
// The clips are copied into the browser's storage, as the app's import does, so only the clips the export reaches
// are copied; the run refuses to start without the disk it needs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBenchPage } from '../lib/browser.mjs'
import { openBenchPageInElectron } from '../lib/electron-page.mjs'
import { dialogSettings, PROJECT_FPS } from '../lib/context.mjs'
import { resolveImportClips } from '../lib/imports.mjs'
import { startMemoryWatch } from '../lib/memory-watch.mjs'
import { busyness, gitState, machineInfo } from '../lib/machine.mjs'
import {
  diskNeededBytes,
  downsample,
  judgeFlatMemory,
  judgeOutputGrowth,
  memoryExceedsLimit,
  perMinute,
  planTimeline,
} from '../lib/memory-curve.mjs'
import { duBytes, ffprobeJson } from '../lib/proc.mjs'
import { probeVideoFile } from '../lib/probe.mjs'

export const name = 'long-export'

const PAGE_PATH = '/bench/page/long-export.html'
const GIB = 2 ** 30
const WATCH_INTERVAL_MS = 250
const PROGRESS_INTERVAL_MS = 2000
/** After the abort the export gets this long to wind down before the browser is closed under it. */
const ABORT_GRACE_MS = 60_000

const DESTINATIONS = ['desktop', 'file-handle', 'download']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`${label} did not answer within ${ms / 1000} s`)
    }),
  ])

function durationSecondsOf(file) {
  const info = ffprobeJson(file, ['-show_format'])
  return Number(info.format.duration)
}

function freeBytes(dir) {
  const stats = fs.statfsSync(dir)
  return stats.bavail * stats.bsize
}

/** The size of a file, or null when it is not there. */
function sizeOrNull(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return null
  }
}

export async function measure(ctx) {
  const { config } = ctx
  const limitBytes = config.memoryLimitGiB * GIB
  const destination = process.env.BENCH_LONG_EXPORT_DESTINATION ?? 'desktop'
  if (!DESTINATIONS.includes(destination)) {
    throw new Error(`BENCH_LONG_EXPORT_DESTINATION must be one of ${DESTINATIONS.join(', ')}, got ${destination}`)
  }
  const cancelAfterSeconds = process.env.BENCH_LONG_EXPORT_CANCEL_AFTER_S
    ? Number(process.env.BENCH_LONG_EXPORT_CANCEL_AFTER_S)
    : null
  if (cancelAfterSeconds !== null && (destination !== 'desktop' || !(cancelAfterSeconds > 0))) {
    throw new Error('BENCH_LONG_EXPORT_CANCEL_AFTER_S is a number of seconds and needs the desktop destination')
  }

  const clips = resolveImportClips(config.importDir).map((clip) => ({
    ...clip,
    durationSeconds: durationSecondsOf(clip.path),
  }))
  const plan = planTimeline(clips, { limitSeconds: config.longExportSeconds })
  const needed = plan.clips.filter((c) => c.needed)
  const diskNeeded = diskNeededBytes({
    neededBytes: plan.neededBytes,
    exportSeconds: plan.exportSeconds,
  })
  const diskFree = freeBytes(os.tmpdir())
  if (diskFree < diskNeeded) {
    throw new Error(
      `not enough free disk for this run: ${(diskNeeded / GIB).toFixed(1)} GiB needed (the clips copied into the browser's storage, the output twice, 4 GiB spare), ${(diskFree / GIB).toFixed(1)} GiB free on ${os.tmpdir()}. Export fewer seconds with --long-seconds N.`,
    )
  }
  const limitFrames =
    config.longExportSeconds === null ? null : Math.round(plan.exportSeconds * PROJECT_FPS)
  console.log(
    `   ${needed.length} of ${clips.length} clips, ${plan.exportSeconds.toFixed(0)} s of ${plan.totalSeconds.toFixed(0)} s, abort over ${config.memoryLimitGiB} GiB`,
  )

  const media = Object.fromEntries(needed.map((c, i) => [`clip${i}`, c.path]))
  const bench =
    destination === 'desktop'
      ? await openBenchPageInElectron({ cache: config.cache, media, pagePath: PAGE_PATH })
      : await openBenchPage({ cache: config.cache, media, pagePath: PAGE_PATH })
  const { page } = bench
  const watch = startMemoryWatch(
    bench.profileDir,
    bench.memoryReader ? { readBrowser: bench.memoryReader } : undefined,
  )
  const header = {
    measurement: name,
    schemaVersion: 1,
    date: new Date().toISOString(),
    git: gitState(),
    machine: machineInfo(),
    machineBusyAtStart: busyness(),
    browser: { chromeVersion: bench.chromeVersion, webgpuAdapter: bench.gpu },
  }
  const outFile = path.join(config.cache, 'exports', `long-export-${Math.round(plan.exportSeconds)}s.mp4`)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const partialFile = path.join(path.dirname(outFile), `.${path.basename(outFile)}.droneclean-partial`)
  fs.rmSync(outFile, { force: true })
  fs.rmSync(partialFile, { force: true })
  // A cancelled export must leave a file that was already there as it was.
  const KEEP_ME = 'a file the pilot already had at this name'
  if (cancelAfterSeconds !== null) fs.writeFileSync(outFile, KEEP_ME)

  let exportResult = null
  let exportError = null
  let exceeded = null
  let prepared = null
  const points = []
  let series = []
  let downloadRecord = null
  let cancelRecord = null
  let appearance = null
  let sampleWindow = null
  let timing = { prepareSeconds: 0, profileBaseline: null }
  try {
    const importStarted = Date.now()
    prepared = await page.evaluate((input) => window.longExport.prepare(input), {
      project: { width: 3840, height: 2880, fps: PROJECT_FPS },
      clips: needed.map((c, i) => ({
        mediaId: `clip${i}`,
        url: bench.mediaUrl(`clip${i}`),
        fileName: c.fileName,
      })),
      limitFrames,
    })
    const prepareSeconds = (Date.now() - importStarted) / 1000
    // Let the page go quiet (probe finished, workers idle) so the baseline is the editor's, not the import's.
    await sleep(2000)

    const profileBaseline = duBytes(bench.profileDir)
    const settings = dialogSettings(config, 'auto')
    const t0 = watch.now()
    const started = Date.now()
    if (destination === 'desktop') await bench.pickFile(outFile)
    const exportPromise = page
      .evaluate((input) => window.longExport.runExport(input.settings, input.destination), {
        settings: { ...settings, smartCopy: false },
        destination,
      })
      .then(
        (result) => ({ result }),
        (error) => ({ error: error.message }),
      )
    let exportDone = false
    exportPromise.then(() => {
      exportDone = true
    })

    // The watch: every 250 ms compare the sampler's newest reading with the limit; every 2 s record progress and
    // how far the browser profile (where the OPFS output lives) has grown.
    let lastProgress = 0
    let cancelled = false
    appearance = { finalFileSeenWhileRunning: false, partialPeakBytes: 0 }
    while (!exportDone) {
      await Promise.race([sleep(WATCH_INTERVAL_MS), exportPromise])
      if (exportDone) break
      if (destination === 'desktop') {
        // The final name must not show up before the end (a cancelled run's marker file is the exception: it is the old one).
        // The commit renames the file a moment before the export call returns, so a sighting in the finalizing phase
        // is the end, not an early appearance.
        if (cancelAfterSeconds === null && !appearance.finalFileSeenWhileRunning && fs.existsSync(outFile)) {
          const now = await withTimeout(page.evaluate(() => window.longExport.progress()), 5000, 'progress').catch(
            () => null,
          )
          if (now && now.phase !== 'finalizing' && now.phase !== 'done') appearance.finalFileSeenWhileRunning = true
        }
        appearance.partialPeakBytes = Math.max(appearance.partialPeakBytes, sizeOrNull(partialFile) ?? 0)
      }
      if (
        cancelAfterSeconds !== null &&
        !cancelled &&
        (Date.now() - started) / 1000 >= cancelAfterSeconds
      ) {
        cancelled = true
        cancelRecord = {
          atSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
          partialBytesWhenCancelled: sizeOrNull(partialFile),
        }
        await withTimeout(page.evaluate(() => window.longExport.abort()), 10_000, 'abort')
      }
      const latest = watch.latest()
      if (!exceeded && memoryExceedsLimit(latest, limitBytes)) {
        exceeded = {
          browserBytes: latest.browserBytes,
          atSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
        }
        console.error(
          `   memory ${(latest.browserBytes / GIB).toFixed(2)} GiB is over ${config.memoryLimitGiB} GiB: aborting the export`,
        )
        await withTimeout(page.evaluate(() => window.longExport.abort()), 10_000, 'abort').catch(
          () => {},
        )
        const settled = await Promise.race([exportPromise, sleep(ABORT_GRACE_MS).then(() => null)])
        if (!settled) await bench.context.close().catch(() => {})
        break
      }
      if (Date.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
        lastProgress = Date.now()
        try {
          const [progress, scratch] = await withTimeout(
            Promise.all([
              page.evaluate(() => window.longExport.progress()),
              page.evaluate(() => window.longExport.scratchFiles()),
            ]),
            5000,
            'progress',
          )
          points.push({
            seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            frame: progress.frame,
            growthBytes: duBytes(bench.profileDir) - profileBaseline,
            opfsVisibleBytes: scratch.reduce((sum, f) => sum + f.size, 0),
            ...(destination === 'desktop' ? { partialFileBytes: sizeOrNull(partialFile) } : {}),
          })
        } catch {
          // A busy page may miss one reading; the next one catches up.
        }
      }
    }
    const done = await exportPromise
    const t1 = watch.now()
    series = watch.series({ since: t0, until: t1 })
    sampleWindow = { t0, t1 }
    exportResult = done.result ?? null
    exportError = done.error ?? null

    if (destination === 'desktop' && cancelAfterSeconds !== null) {
      cancelRecord = {
        ...cancelRecord,
        exportAborted: Boolean(exportResult?.aborted),
        partialFileLeft: fs.existsSync(partialFile),
        existingFileUntouched: sizeOrNull(outFile) === KEEP_ME.length && fs.readFileSync(outFile, 'utf8') === KEEP_ME,
      }
    }
    if (destination === 'download' && exportResult && !exportResult.aborted && !exceeded) {
      // The app's Save: a blob download, which makes a second copy of the output on disk.
      const before = duBytes(bench.profileDir)
      const downloadStarted = Date.now()
      const downloadPromise = page.waitForEvent('download', { timeout: 10 * 60_000 })
      await page.evaluate((fileName) => window.longExport.download(fileName), path.basename(outFile))
      await (await downloadPromise).saveAs(outFile)
      const downloadSeconds = (Date.now() - downloadStarted) / 1000
      const t2 = watch.now()
      const during = watch.series({ since: t1, until: t2 })
      downloadRecord = {
        seconds: Number(downloadSeconds.toFixed(1)),
        profileGrowthBytes: duBytes(bench.profileDir) - before,
        peakBrowserBytes: during.reduce((m, s) => Math.max(m, s.browserBytes ?? 0), 0),
      }
    }
    timing = { prepareSeconds, profileBaseline }
  } finally {
    await watch.stop()
    await bench.close()
  }

  const memory = judgeFlatMemory(series, { limitBytes, targetSeconds: 20 * 60 })
  const finished = exportResult && !exportResult.aborted && !exceeded
  const file = finished && fs.existsSync(outFile) ? probeVideoFile(outFile) : null
  const direct =
    destination === 'desktop' && finished
      ? {
          finalFileBytes: sizeOrNull(outFile),
          partialFileGone: !fs.existsSync(partialFile),
          finalNameAppearedOnlyAtTheEnd: !appearance.finalFileSeenWhileRunning,
          partialFilePeakBytes: appearance.partialPeakBytes,
          // The one file written: its bytes on disk, against what the export reported.
          sizeMatchesExport: sizeOrNull(outFile) === exportResult.fileSize,
          profileGrowthBytesAtEnd: points.at(-1)?.growthBytes ?? null,
        }
      : null
  const growth = finished
    ? judgeOutputGrowth(
        destination === 'desktop'
          ? points.map((p) => ({ ...p, growthBytes: p.partialFileBytes ?? p.growthBytes }))
          : points,
        {
          totalFrames: exportResult.frames,
          finalBytes: exportResult.fileSize,
        },
      )
    : { verdict: 'no-data', writtenAsItGoes: false }
  if ((finished || cancelAfterSeconds !== null) && process.env.BENCH_KEEP_OUTPUT !== '1') {
    fs.rmSync(outFile, { force: true })
    fs.rmSync(partialFile, { force: true })
  }

  let failure = null
  if (cancelAfterSeconds !== null) {
    if (!cancelRecord?.exportAborted) failure = 'the export was not cancelled (it finished or failed first)'
    else if (cancelRecord.partialFileLeft) failure = 'a cancelled export left its temporary file'
    else if (!cancelRecord.existingFileUntouched) failure = 'a cancelled export touched the file that was already there'
  } else if (exceeded) {
    failure = `memory passed ${config.memoryLimitGiB} GiB (${(exceeded.browserBytes / GIB).toFixed(2)} GiB at ${exceeded.atSeconds} s): the export was aborted`
  } else if (exportError) {
    failure = `the export failed: ${exportError}`
  } else if (!finished) {
    failure = 'the export did not finish'
  } else if (direct && !(direct.partialFileGone && direct.finalNameAppearedOnlyAtTheEnd && direct.sizeMatchesExport)) {
    failure = `the direct output is not as designed: ${JSON.stringify(direct)}`
  } else if (!memory.flat) {
    failure = `memory is not flat: ${memory.verdict} (slope ${memory.slopeMiBPerMinute ?? 'n/a'} MiB/min, peak ${(memory.peakBytes / GIB).toFixed(2)} GiB)`
  }

  return {
    ...header,
    inputs: { folder: config.importDir, clips: plan.clips.map(describeClip) },
    parameters: {
      project: '3840x2880 at 59.94 fps (60000/1001); the six clips end to end on one video track',
      exportedSeconds: Number(plan.exportSeconds.toFixed(1)),
      timelineSeconds: Number(plan.totalSeconds.toFixed(1)),
      clipsCopiedIntoBrowserStorage: needed.length,
      destination,
      cancelAfterSeconds,
      settings: 'H.265, MP4, ultra, automatic bitrate, smart copy off (what the export dialog hands over)',
      forcedFrameByFrame: 'each clip carries a +0.01 dB gain (no audio) so that no copy shortcut replaces the render',
      memoryLimitBytes: limitBytes,
      gpuMemorySource: watch.gpuSource,
      memorySource:
        'resident memory (RSS, ps) summed over every process of the benchmark browser, sampled every 500 ms (lib/memory-watch.mjs); shared pages are counted in each process, an upper bound',
      outputSource:
        "growth of the benchmark browser's profile folder (du) every 2 s since before the export: the OPFS temporary file lives there, and its bytes are invisible to OPFS until its writer closes (opfsVisibleBytes)",
      flatDefinition:
        'over the second half of the export, the least-squares slope of browser memory is at most 25 MiB a minute, and the peak is under the limit',
      diskFreeBytesAtStart: diskFree,
      diskNeededBytes: diskNeeded,
    },
    result: {
      passed: failure === null,
      failure,
      aborted: Boolean(exceeded),
      export: exportResult && {
        ...exportResult,
        wallSeconds: Number((exportResult.wallMs / 1000).toFixed(1)),
        framesPerSecond: exportResult.frames
          ? Number((exportResult.frames / (exportResult.wallMs / 1000)).toFixed(2))
          : null,
        prepareSeconds: Number(timing.prepareSeconds.toFixed(1)),
      },
      exportError,
      timeline: prepared,
      memory: {
        judgement: memory,
        perMinute: perMinute(series),
        series: downsample(series, 600),
        sampleWindowMs: sampleWindow,
      },
      output: {
        growth,
        finalFileBytes: exportResult?.fileSize ?? null,
        outputKind: exportResult?.outputKind ?? null,
        profileBaselineBytes: timing.profileBaseline,
        points,
        download: downloadRecord,
        direct,
        cancel: cancelRecord,
        file,
      },
    },
    failure,
  }
}

function describeClip(clip) {
  return {
    fileName: clip.fileName,
    bytes: clip.bytes,
    durationSeconds: Number(clip.durationSeconds.toFixed(2)),
    startSeconds: Number(clip.startSeconds.toFixed(2)),
    copiedIntoBrowserStorage: clip.needed,
  }
}
