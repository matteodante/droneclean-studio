/* eslint-disable no-console -- a command-line tool */
// 13. Stabilized export, the proof of task 6.4: 60 seconds of clip 0020, read from the ORIGINAL DJI file (a plain
// FFmpeg `-c copy` cut drops the gyro metadata), exported through the app's own path with stabilization on at the
// engine's default settings, and the stabilized preview of the same clip.
//
//   node bench/run.mjs stabilized-export          (opt-in; about 15 minutes; copies the 3.76 GB clip into the
//                                                  browser's storage several times: 12 GB of free disk are needed)
//
// What it records, each in a browser of its own unless it says it reloads the page (the reload keeps the origin's
// storage, which is where the motion cache lives):
//  - Cold export: a fresh profile, so the motion cache is empty and the export's own open reads the file. Frames per
//    second over the whole export (the open included) and over its steady part, browser memory over time (peak and
//    the least-squares slope of the second half, judged as the long export judges it), the output file's facts.
//  - Warm export: the page reloaded in the same profile, so the cache holds the clip's motion data. Same numbers, and
//    `bytes_read` of the engine's open (0 means the cache answered and the file was not read).
//  - Kernel parameters: the engine's data for the six frames of Gyroflow's reference
//    (`gyroflow/wasm/test/reference/clip-0020.json`), hashed and compared with the reference bit for bit.
//  - Pictures: frames of the exported file and of the render path, with and without stabilization, written outside
//    git (`studio/tmp/stabilized-export/`) for a look by eye.
//  - Preview: the preview renderer's frame rate at the usual preview size (1664 wide) and at full size, and the time
//    of the first frame (a paused frame after opening the clip), on a cold motion cache and a warm one. The rate is
//    what the renderer answers back to back; presenting the canvas on screen and the pump's scheduling are not in it.
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../lib/config.mjs'
import { openBenchPage } from '../lib/browser.mjs'
import { dialogSettings, PROJECT_FPS } from '../lib/context.mjs'
import { preparePage } from '../lib/exports.mjs'
import { busyness, gitState, machineInfo } from '../lib/machine.mjs'
import { startMemoryWatch } from '../lib/memory-watch.mjs'
import { downsample, judgeFlatMemory, perMinute } from '../lib/memory-curve.mjs'
import { spawnSync } from 'node:child_process'
import { run as runTool } from '../lib/proc.mjs'
import { probeVideoFile } from '../lib/probe.mjs'

export const name = 'stabilized-export'

const GIB = 2 ** 30
const MEDIA_ID = 'bench-clip'
const PROJECT = { width: 3840, height: 2880, fps: PROJECT_FPS }
/** The preview size of the editor's usual window, and the full size of the project */
const PREVIEW_SIZES = [
  { label: 'usual 1664x1248', scale: 1664 / 3840 },
  { label: 'full 3840x2880', scale: 1 },
]
const PREVIEW_FRAMES = 300
const PREVIEW_TARGET_FPS = 60000 / 1001
/** Output frames looked at by eye: the first, the reference's frame 1000, and one late */
const STILL_FRAMES = [0, 1000, 3000]
const REFERENCE_FILE = path.join(REPO_ROOT, '..', 'gyroflow', 'wasm', 'test', 'reference', 'clip-0020.json')
const TMP_DIR = path.join(REPO_ROOT, 'tmp', 'stabilized-export')

const round = (value, digits = 2) => Number(value.toFixed(digits))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The verdict on the warm export's open: the cache answered when the engine read nothing from the file.
 * @param {Array<{bytesRead:number|null, kind:string}>} opens the page's recorded opens
 */
export function judgeMotionCache(opens) {
  const answered = opens.filter((o) => o.bytesRead !== null)
  const problems = []
  if (answered.length === 0) problems.push('no open of the engine was seen')
  for (const open of answered) {
    if (open.bytesRead !== 0) problems.push(`an open read ${open.bytesRead} bytes of the file`)
  }
  return { hit: problems.length === 0, opens: answered.length, problems }
}

/**
 * The verdict on the kernel-parameter comparison.
 * @param {Array<{frame:number, matricesMatch:boolean, kernelParamsMatch:boolean, kernelParamsBytesMatch:boolean}>} frames
 */
export function judgeKernelParameters(frames) {
  const problems = []
  for (const f of frames) {
    if (!f.matricesMatch) problems.push(`frame ${f.frame}: matrices differ from the reference`)
    if (!f.kernelParamsBytesMatch) problems.push(`frame ${f.frame}: kernel parameters have another length`)
    if (!f.kernelParamsMatch) problems.push(`frame ${f.frame}: kernel parameters differ from the reference`)
  }
  return { allMatch: frames.length > 0 && problems.length === 0, framesCompared: frames.length, problems }
}

/** A browser on the original clip, with the gyro engine's worker and package served. */
async function openOnClip(config) {
  const bench = await openBenchPage({ cache: config.cache, media: { [MEDIA_ID]: config.clip }, requireGyro: true })
  return bench
}

/** The clip prepared for a stabilized run: the file's own modification time, the first `frames` source frames. */
function prepareStabilized(bench, clipInfo, frames) {
  return preparePage(bench, MEDIA_ID, {
    mediaFile: clipInfo.file,
    project: PROJECT,
    stabilization: {},
    fileLastModified: clipInfo.mtimeMs,
    sourceWindow: { startFrame: 0, frames },
  })
}

/** Let the page go quiet so the memory baseline is the editor's, not the import's. */
const settle = (page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)))

/** Reloads the page (the origin's storage stays) and waits for the benchmark page to be ready again. */
async function reload(bench) {
  await bench.page.reload({ waitUntil: 'load', timeout: 60_000 })
  await bench.page.waitForFunction(() => Boolean(window.bench?.ready), { timeout: 30_000 })
}

/** One export with the browser's memory watched; the page's opens go with it. */
async function exportWatched(bench, settings, { download = null } = {}) {
  const { page } = bench
  await page.evaluate(() => window.bench.takeOpens())
  const watch = startMemoryWatch(bench.profileDir)
  let record
  let t0
  let t1
  try {
    t0 = watch.now()
    record = await page.evaluate((s) => window.bench.runExport(s, { timings: false }), settings)
    t1 = watch.now()
  } finally {
    await watch.stop()
  }
  const series = watch.series({ since: t0, until: t1 })
  const opens = await page.evaluate(() => window.bench.takeOpens())
  let file = null
  if (download) {
    const downloadPromise = page.waitForEvent('download', { timeout: 10 * 60_000 })
    await page.evaluate((n) => window.bench.download(n), path.basename(download))
    await (await downloadPromise).saveAs(download)
    file = download
  }
  return { record, series, opens, file, gpuSource: watch.gpuSource }
}

/** The numbers of one export, in the units the plan uses. */
function describe(run, limitBytes) {
  const e = run.record
  const memory = judgeFlatMemory(run.series, { limitBytes, targetSeconds: 20 * 60 })
  // The engine's open (a step of a few GiB in the first seconds on a cold cache) is not what a long export would keep
  // growing by: the same judgement over the series after the first 20 s
  const afterOpen = judgeFlatMemory(
    run.series.filter((s) => s.t >= run.series[0].t + 20_000),
    { limitBytes, targetSeconds: 20 * 60 },
  )
  return {
    renderPath: e.renderPath,
    workerFallbackReason: e.workerFallbackReason,
    frames: e.frames,
    wallSeconds: round(e.wallMs / 1000),
    framesPerSecond: round(e.fps, 1),
    steadyFramesPerSecond: e.steadyFps === null ? null : round(e.steadyFps, 1),
    firstFrameSeconds: e.firstFrameMs === null ? null : round(e.firstFrameMs / 1000),
    fileSizeBytes: e.fileSize,
    smartCopy: e.smartCopy,
    packetRemuxPlanned: e.packetRemuxPlanned,
    opens: run.opens,
    memory: {
      peakBrowserGiB: round(memory.peakBytes / GIB),
      startBrowserGiB: round(memory.startBytes / GIB),
      endBrowserGiB: round(memory.endBytes / GIB),
      judgement: memory,
      judgementAfterFirst20Seconds: afterOpen,
      perMinute: perMinute(run.series),
      series: downsample(run.series, 300),
      note: 'resident memory (RSS, ps) summed over every process of the benchmark browser, sampled every 500 ms; shared pages are counted in each process, an upper bound',
    },
  }
}

/**
 * Preview playback at each size in a page that is already prepared (`runStabilizedPreview`: the engine opened first, the
 * first frame drawn for real, late frames counted). Each size is a renderer of its own; the engine's open is timed in the
 * first and is instant in the second.
 */
async function previewSizes(bench) {
  const out = {}
  for (const size of PREVIEW_SIZES) {
    const run = await bench.page.evaluate(
      (options) => window.bench.runStabilizedPreview(options.frames, { scale: options.scale }),
      { frames: PREVIEW_FRAMES, scale: size.scale },
    )
    out[size.label] = {
      size: run.size,
      frames: run.frames,
      steadyFramesPerSecond: round(run.steadyFps, 1),
      wholeRunFramesPerSecond: round(run.wholeRunFps, 1),
      engineOpenSeconds: round(run.openMs / 1000, 2),
      firstFrameSeconds: round(run.firstFrameMs / 1000, 2),
      firstFrameAttempts: run.firstFrameAttempts,
      lateFrames: run.late,
      worstFrameMs: round(run.worstFrameMs, 1),
      drawnAtEnd: run.drawnAtEnd,
      meetsTarget: run.steadyFps >= PREVIEW_TARGET_FPS,
    }
  }
  return out
}

/** A frame of a file, as a PNG (ffmpeg's `select` by frame number), and a 1280-wide copy to look at. */
function extractFrame(file, frame, outPng) {
  runTool('ffmpeg', [
    '-v', 'error', '-y', '-i', file,
    '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-fps_mode', 'passthrough', outPng,
  ])
  const small = outPng.replace(/\.png$/, '-small.png')
  runTool('ffmpeg', ['-v', 'error', '-y', '-i', outPng, '-vf', 'scale=1280:-1', small])
  return { full: outPng, small }
}

/** Stills straight from the render path, stabilized and not, for the frames looked at; saved in `TMP_DIR`. */
async function renderStills(bench, frames) {
  const out = {}
  for (const frame of frames) {
    for (const stabilized of [true, false]) {
      const file = path.join(TMP_DIR, `render-${stabilized ? 'stabilized' : 'plain'}-frame${frame}.png`)
      const download = bench.page.waitForEvent('download', { timeout: 5 * 60_000 })
      await bench.page.evaluate(
        ([n, fileName, options]) => window.bench.renderStill(n, fileName, options),
        [frame, path.basename(file), { stabilized }],
      )
      await (await download).saveAs(file)
      out[`${stabilized ? 'stabilized' : 'plain'}-${frame}`] = file
    }
  }
  return out
}

/** PSNR in dB between two PNGs of the same size (ffmpeg's psnr filter), or null when it cannot say. */
function psnrBetween(a, b) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], {
    encoding: 'utf8',
  })
  const match = /average:([\d.inf]+)/.exec(result.stderr ?? '')
  return match ? match[1] : null
}

export async function measure(ctx) {
  const { config } = ctx
  const seconds = Number(process.env.BENCH_STABILIZED_SECONDS ?? 60)
  const frames = Math.round(seconds * PROJECT_FPS)
  const limitBytes = config.memoryLimitGiB * GIB
  const reference = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'))
  const stat = fs.statSync(config.clip)
  const clipInfo = { file: config.clip, bytes: stat.size, mtimeMs: Math.floor(stat.mtimeMs) }
  if (clipInfo.bytes !== reference.clip_bytes) {
    throw new Error(
      `${config.clip} is ${clipInfo.bytes} bytes; the reference was recorded on a file of ${reference.clip_bytes} bytes (clip 0020 of 15 Nov)`,
    )
  }
  const free = fs.statfsSync(path.join(config.cache)).bavail * fs.statfsSync(config.cache).bsize
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const settings = { ...dialogSettings(config, 'custom'), smartCopy: false }
  const header = {
    measurement: name,
    schemaVersion: 1,
    date: new Date().toISOString(),
    git: gitState(),
    machine: machineInfo(),
    machineBusyAtStart: busyness(),
  }
  console.log(`   ${seconds} s = ${frames} frames of ${path.basename(config.clip)}, free disk ${(free / GIB).toFixed(0)} GiB`)

  // 1. Preview on a cold motion cache: a fresh profile, so the first frame includes the engine's read of the file.
  console.log('   preview, cold motion cache')
  let chromeVersion
  let gpu
  let previewCold
  {
    const bench = await openOnClip(config)
    try {
      chromeVersion = bench.chromeVersion
      gpu = bench.gpu
      await prepareStabilized(bench, clipInfo, frames)
      await settle(bench.page)
      previewCold = await previewSizes(bench)
      previewCold.pageErrors = bench.pageErrors.slice(0, 10)
    } finally {
      await bench.close()
    }
  }

  // 2. The cold export in a fresh profile, then, reloading the page in the same profile (the motion cache stays in its
  // storage), the warm preview and the warm export with the kernel parameters and the pictures.
  const exportFile = path.join(config.cache, 'exports', `${name}-${seconds}s.mp4`)
  fs.mkdirSync(path.dirname(exportFile), { recursive: true })
  let cold
  let previewWarm
  let warm
  let kernel
  let stills
  let prepared
  const pageErrors = []
  const bench = await openOnClip(config)
  try {
    console.log('   export, cold motion cache')
    prepared = await prepareStabilized(bench, clipInfo, frames)
    await settle(bench.page)
    const coldRun = await exportWatched(bench, settings, { download: exportFile })
    cold = describe(coldRun, limitBytes)
    pageErrors.push(...bench.pageErrors.splice(0))

    console.log('   preview, warm motion cache')
    await reload(bench)
    console.log(`   cleared ${await bench.page.evaluate(() => window.bench.clearBenchFiles())} copies of the clip`)
    await prepareStabilized(bench, clipInfo, frames)
    await settle(bench.page)
    previewWarm = await previewSizes(bench)

    console.log('   export, warm motion cache')
    await reload(bench)
    await bench.page.evaluate(() => window.bench.clearBenchFiles())
    await prepareStabilized(bench, clipInfo, frames)
    await settle(bench.page)
    const warmRun = await exportWatched(bench, settings)
    warm = describe(warmRun, limitBytes)

    console.log('   kernel parameters against the reference')
    await bench.page.evaluate(() => window.bench.takeOpens())
    const proved = await bench.page.evaluate(
      (list) => window.bench.proveKernelParameters(list),
      reference.frames,
    )
    kernel = {
      ...judgeKernelParameters(proved.frames),
      frames: proved.frames,
      opensAfterExport: await bench.page.evaluate(() => window.bench.takeOpens()),
    }

    console.log('   stills')
    stills = await renderStills(bench, STILL_FRAMES)
    pageErrors.push(...bench.pageErrors.splice(0))
  } finally {
    await bench.close()
  }

  // 3. The pictures: the exported file's frames beside the render path's, and how far stabilization moved the picture.
  const exported = {}
  for (const frame of STILL_FRAMES) {
    exported[frame] = extractFrame(exportFile, frame, path.join(TMP_DIR, `export-frame${frame}.png`))
  }
  const pictures = {
    directory: TMP_DIR,
    exportedFrames: exported,
    renderPathStills: stills,
    psnrStabilizedVsPlain: Object.fromEntries(
      STILL_FRAMES.map((frame) => [
        frame,
        psnrBetween(stills[`stabilized-${frame}`], stills[`plain-${frame}`]),
      ]),
    ),
    note: 'PSNR (dB) between the render path\'s stabilized and plain still of the same output frame; the stabilized picture is 3840x2160 shown in the project\'s 3840x2880 frame, so the two differ in size and the comparison is only a sign that the picture moved',
  }
  const file = probeVideoFile(exportFile)
  const sizeOfFile = fs.statSync(exportFile).size
  if (process.env.BENCH_KEEP_OUTPUT !== '1') fs.rmSync(exportFile, { force: true })

  const motionCache = {
    coldOpen: judgeColdOpen(cold.opens),
    warmOpen: judgeMotionCache(warm.opens),
    kernelProofOpen: judgeMotionCache(kernel.opensAfterExport),
    previewWarmOpen: { openSeconds: previewWarm['usual 1664x1248'].engineOpenSeconds },
    previewColdOpen: { openSeconds: previewCold['usual 1664x1248'].engineOpenSeconds },
  }
  const failures = []
  if (cold.renderPath !== 'worker') failures.push(`the cold export ran on the ${cold.renderPath} path`)
  if (warm.renderPath !== 'worker') failures.push(`the warm export ran on the ${warm.renderPath} path`)
  if (file.frameCount !== frames) failures.push(`the exported file has ${file.frameCount} frames, expected ${frames}`)
  if (!kernel.allMatch) failures.push(`kernel parameters differ: ${kernel.problems.join('; ')}`)
  if (!motionCache.warmOpen.hit) failures.push(`the warm export read the file: ${motionCache.warmOpen.problems.join('; ')}`)
  if (!motionCache.coldOpen.read) failures.push('the cold export did not read the file (the cache was not empty)')
  const failure = failures.length ? failures.join(' | ') : null

  return {
    ...header,
    browser: { chromeVersion, webgpuAdapter: gpu },
    inputs: {
      clip: { path: config.clip, bytes: clipInfo.bytes, modifiedMs: clipInfo.mtimeMs },
      reference: path.relative(path.join(REPO_ROOT, '..'), REFERENCE_FILE),
    },
    parameters: {
      seconds,
      frames,
      sourceWindow: `source frames 0 to ${frames - 1} of the original file (59.94 fps in a 59.94 project, speed 1)`,
      project: '3840x2880 at 59.94 fps (60000/1001)',
      settings: 'H.265, MP4, custom 120 Mbps, smart copy off (what the export dialog hands over)',
      stabilization: 'the engine defaults a clip gets when switched on: method Default, smoothness 0.5, zoom 1, no horizon lock, 4 s adaptive zoom',
      file: 'the 3.76 GB original is copied into the browser storage as the app would import it, and handed to the page with its own modification time, so that the motion cache (keyed by name, size and modification time) can be found by a second run',
      reload: 'the warm runs reload the page in the same browser profile (the motion cache is in the origin storage); the in-memory cache of the page is gone',
      memoryLimitBytes: limitBytes,
      gpuMemorySource: 'ioreg (system-wide GPU driver memory)',
      freeDiskBytesAtStart: free,
    },
    result: {
      passed: failure === null,
      failure,
      prepared,
      export: {
        cold,
        warm,
        warmOverCold: round(warm.framesPerSecond / cold.framesPerSecond, 2),
        file: { ...file, bytes: sizeOfFile },
      },
      motionCache,
      kernelParameters: kernel,
      pictures,
      preview: {
        targetFramesPerSecond: round(PREVIEW_TARGET_FPS, 2),
        cold: previewCold,
        warm: previewWarm,
        frames: PREVIEW_FRAMES,
        note: 'back-to-back frames of the preview renderer from the start of the clip, no presenting and no pump; the first frame of a size is preload plus the first draw (the engine\'s open is in it when the cache is cold)',
      },
      pageErrors: pageErrors.slice(0, 20),
      notProved:
        'the export looked at for wobble; the stabilized picture against the module\'s CPU warp on this export (task 6.3\'s probe holds that: stabilize-proof compares the kernel parameters and looks at frames); real playback on screen',
    },
    failure,
  }
}

/** The cold export's open: it read the file. */
function judgeColdOpen(opens) {
  const answered = opens.filter((o) => o.bytesRead !== null)
  const bytes = answered.reduce((max, o) => Math.max(max, o.bytesRead), 0)
  return { read: bytes > 0, maxBytesRead: bytes, opens: answered.length, openSeconds: answered.map((o) => round(o.ms / 1000, 2)) }
}
