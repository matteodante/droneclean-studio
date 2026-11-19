/* eslint-disable no-console -- a command-line tool */
// The native 10-bit export, proved in the desktop app (design 3.6 slice 7, plan tasks 3.3 and 8.4): the built app in
// a throwaway profile, a real workspace and project, clip 0020 imported by path through the SDK and placed on the
// timeline, and the export started the way the export dialog starts one (`buildRenderJob`, the queue's
// `convertTimelineToComposition` and `resolveMediaUrls`, then `runRender`), with a `native` target. It checks:
//
//   - 10 s of clip 0020 as HEVC Main 10 and as ProRes 422 HQ: every frame, 10-bit, BT.709 tags, frames per second,
//     the peak memory of the app's processes and FFmpeg's;
//   - the 877-level grey ramp exported as HEVC Main 10 keeps its levels;
//   - a clip whose media record has no file path stops the export with a `SourceError` that says so.
//
// The output path stands in for the save dialog's choice: the proof grants it in the main process, as the dialog does.
// The page has no export dialog for 10-bit yet (its presets are another slice's), so the page must be built with a hook
// that hands the proof the export's own functions (`window.__nativeExportProof`, added locally for the run and never
// committed, as the media-paths proof did with its line).
//
//   BENCH_CLIP=/path/to/clip.mp4 node bench/native/app-export.mjs   (through scripts/heavy.sh; needs `vp build` and the desktop's `tsc`)
import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { REPO_ROOT, loadConfig, requireInputs } from '../lib/config.mjs'
import { ensureRamp, RAMP_SCORED_FROM_ROW } from '../lib/inputs.mjs'
import { decodeLuma10, distinctLevelsPerRow, summariseCounts } from '../lib/levels.mjs'

const desktopDir = path.join(REPO_ROOT, 'desktop')
const requireDesktop = createRequire(path.join(desktopDir, 'package.json'))
const { _electron } = requireDesktop('playwright-core')
const { seedWorkspaceFromDrop } = await import(path.join(desktopDir, 'test', 'support', 'drop-files.mjs'))

const FPS = { num: 60000, den: 1001 }
const START_FRAME = 3597 // the frame `-ss 60` lands on in clip 0020 (60000/1001, starting at 0)
const FRAMES = 599 // 10 s at 59.94
const BITRATE = 120_000_000

/** Each claim of the proof, with what was seen */
const results = []
const check = (name, ok, details) => {
  const passed = Boolean(ok)
  results.push({ name, ok: passed, details })
  console.log([passed ? 'ok  ' : 'FAIL', name, details === undefined ? '' : JSON.stringify(details)].join(' '))
}

/** The resident memory of a process tree (the app's processes and the FFmpeg ones it started), sampled */
function treeMemorySampler(rootPid) {
  const peak = { app: 0, ffmpeg: 0, total: 0 }
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    execFile('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8', maxBuffer: 16 << 20 }, (error, stdout) => {
      busy = false
      if (error) return
      const rows = stdout
        .split('\n')
        .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
        .filter(Boolean)
        .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, comm: m[4] }))
      const tree = new Set([rootPid])
      for (let grew = true; grew; ) {
        grew = false
        for (const row of rows) if (!tree.has(row.pid) && tree.has(row.ppid)) (tree.add(row.pid), (grew = true))
      }
      let app = 0
      let ffmpeg = 0
      for (const row of rows) {
        if (!tree.has(row.pid)) continue
        if (/ffmpeg/.test(row.comm)) ffmpeg += row.rss
        else app += row.rss
      }
      peak.app = Math.max(peak.app, app)
      peak.ffmpeg = Math.max(peak.ffmpeg, ffmpeg)
      peak.total = Math.max(peak.total, app + ffmpeg)
    })
  }, 1000)
  return {
    reset() {
      peak.app = 0
      peak.ffmpeg = 0
      peak.total = 0
    },
    peak: () => ({ ...peak }),
    stop: () => clearInterval(timer),
  }
}

function probe(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,color_range,color_space,color_transfer,color_primaries', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  return JSON.parse(result.stdout).streams[0]
}

/**
 * A new project, opened in the editor (where the media library takes it as its project), with `file` imported by
 * path and placed on a video track; `range` is the source frames, the whole file when absent.
 */
async function projectWith(page, { name, fps, file, range }) {
  const created = await page.evaluate(
    async (input) => (await window.studio.project.create({ name: input.name, width: 3840, height: 2880, fps: input.fps })).id,
    { name, fps },
  )
  await page.goto(`droneclean://app/editor/${created}`)
  await page.waitForFunction(() => typeof window.__nativeExportProof === 'function', null, { timeout: 180000 })
  await page.evaluate(async () => {
    window.__nativeProofStore = (await window.__nativeExportProof()).mediaStore
  })
  // The editor loads the project into the media library: then an import has somewhere to go.
  await page.waitForFunction(
    (id) => window.studio?.project?.current()?.id === id && window.__nativeProofStore.getState().currentProjectId === id,
    created,
    { timeout: 180000, polling: 500 },
  )
  return page.evaluate(
    async (input) => {
      const [media] = await window.studio.media.import([input.file])
      const track =
        window.studio.tracks.list().find((entry) => entry.kind === 'video') ?? { id: window.studio.tracks.add({ kind: 'video' }) }
      const clipId = window.studio.clips.add({
        mediaId: media.id,
        trackId: track.id,
        from: 0,
        ...(input.range === null ? {} : { sourceStart: input.range[0], sourceEnd: input.range[1] }),
      })
      const proof = await window.__nativeExportProof()
      return {
        mediaId: media.id,
        clipId,
        filePath: proof.mediaStore.getState().mediaById[media.id]?.filePath ?? null,
        duration: window.studio.project.duration(),
      }
    },
    { file, range: range ?? null },
  )
}

/** The export, as the dialog runs it, in the page; resolves with its timing or the error it stopped with */
async function exportInPage(page, native) {
  return page.evaluate(async (target) => {
    const proof = await window.__nativeExportProof()
    const settings = {
      codec: 'h265',
      quality: 'ultra',
      resolution: { width: window.studio.project.current().width, height: window.studio.project.current().height },
      mode: 'video',
      videoContainer: 'mp4',
      smartCopy: false,
      renderWholeProject: true,
    }
    const job = await proof.buildRenderJob({ settings })
    const s = job.snapshot
    const composition = proof.convertTimelineToComposition(
      s.tracks, s.items, s.transitions, s.fps, s.width, s.height, job.inPoint, job.outPoint, s.keyframes,
      s.backgroundColor, s.busAudioEq, s.masterBusDb,
    )
    composition.tracks = await proof.resolveMediaUrls(composition.tracks, { useProxy: false })
    const started = performance.now()
    let firstFrameAt = null
    try {
      const outcome = await proof.runRender({
        clientSettings: job.clientSettings,
        exportMode: job.exportMode,
        composition,
        signal: new AbortController().signal,
        onProgress: (progress) => {
          if (firstFrameAt === null && progress.phase === 'rendering' && (progress.currentFrame ?? 0) >= 1) {
            firstFrameAt = performance.now()
          }
        },
        native: target,
      })
      const done = performance.now()
      return {
        ok: true,
        frames: composition.durationInFrames,
        seconds: (done - started) / 1000,
        fromFirstFrameSeconds: firstFrameAt === null ? null : (done - firstFrameAt) / 1000,
        renderPath: outcome.renderPath,
        blobBytes: outcome.result.blob.size,
      }
    } catch (error) {
      return { ok: false, name: error?.name, message: error?.message, mediaId: error?.mediaId }
    }
  }, native)
}

async function main() {
  const config = loadConfig(process.env, {})
  requireInputs(config)
  const clip = config.clip
  const ramp = await ensureRamp(config)
  const outDir = path.join(REPO_ROOT, 'tmp', 'native-app')
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(path.join(desktopDir, 'dist'), { recursive: true })
  const work = fs.mkdtempSync(path.join(desktopDir, 'dist', 'native-proof-'))
  const profileRoot = path.join(work, 'profile')
  const workspaceDir = path.join(work, 'workspace')
  fs.mkdirSync(profileRoot)
  fs.mkdirSync(workspaceDir)

  const app = await _electron.launch({
    executablePath: requireDesktop('electron'),
    args: [path.join(desktopDir, 'test', 'support', 'throwaway-profile.cjs')],
    cwd: desktopDir,
    env: { ...process.env, DRONECLEAN_PROFILE_ROOT: profileRoot },
  })
  const memory = treeMemorySampler(app.process().pid)
  const pageLog = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => {
      if (message.type() === 'error' || /native|export/i.test(message.text())) pageLog.push(message.text().slice(0, 400))
    })
    page.on('pageerror', (error) => pageLog.push(`pageerror: ${error.message}`))
    await page.waitForURL(/^droneclean:\/\/app\//, { timeout: 90000 })
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 180000 })
    const profile = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    check('the app runs in a throwaway profile', profile.startsWith(profileRoot), { userData: profile })
    const hooked = await page.evaluate(() => typeof window.__nativeExportProof === 'function')
    if (!hooked) throw new Error('the page was not built with the proof hook (window.__nativeExportProof)')

    await seedWorkspaceFromDrop(page, { workspaceDir, probeId: 'native-proof-drop', windowKey: '__nativeProofDrop', workspaceId: 'native-proof', timeout: 60000 })
    await page.reload()
    // The workspace gate has opened the folder once the projects page shows its "new project" link.
    await page.waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, {
      timeout: 180000,
    })

    const grant = (files) =>
      app.evaluate(({ app: _app }, { module, files: paths }) => {
        const { outputGrants } = process.mainModule.require(module)
        for (const file of paths) outputGrants.grant(file)
      }, { module: path.join(desktopDir, 'out', 'main', 'media', 'output-file.js'), files })

    // ── clip 0020, 10 s from 60 s, in a 59.94 project at its size ────────────────────────────
    const placed = await projectWith(page, {
      name: 'Native proof',
      fps: FPS,
      file: clip,
      range: [START_FRAME, START_FRAME + FRAMES],
    })
    check('the clip is on the timeline with its file path', placed.filePath !== null && placed.duration === FRAMES, placed)

    const exports = {}
    for (const [format, extension] of [
      ['hevc-main10', 'mp4'],
      ['prores-422-hq', 'mov'],
    ]) {
      const out = path.join(outDir, `app-${format}.${extension}`)
      fs.rmSync(out, { force: true })
      await grant([out])
      memory.reset()
      const loadBefore = os.loadavg()[0]
      const outcome = await exportInPage(page, { format, path: out, bitrate: BITRATE })
      const peak = memory.peak()
      const load = [Number(loadBefore.toFixed(2)), Number(os.loadavg()[0].toFixed(2))]
      const info = outcome.ok ? probe(out) : null
      exports[format] = { outcome, peak, load, probe: info, bytes: outcome.ok ? fs.statSync(out).size : 0 }
      check(`${format}: the export finished in the worker`, outcome.ok && outcome.renderPath === 'worker', outcome)
      if (info !== null) {
        check(`${format}: every frame, 10-bit, BT.709`, Number(info.nb_read_frames) === FRAMES && /10le$/.test(info.pix_fmt) && info.color_space === 'bt709' && info.color_transfer === 'bt709' && info.color_primaries === 'bt709' && info.color_range === 'tv' && info.r_frame_rate === '60000/1001', info)
        check(`${format}: frames per second, peak memory`, true, {
          fps: Number((FRAMES / outcome.seconds).toFixed(2)),
          fpsFromFirstFrame: outcome.fromFirstFrameSeconds === null ? null : Number((FRAMES / outcome.fromFirstFrameSeconds).toFixed(2)),
          peakGiB: { app: +(peak.app / 2 ** 30).toFixed(2), ffmpeg: +(peak.ffmpeg / 2 ** 30).toFixed(2), total: +(peak.total / 2 ** 30).toFixed(2) },
          loadAverage: load,
        })
      }
      if (format === 'prores-422-hq') fs.rmSync(out, { force: true })
    }

    // ── a clip with no file path: the export stops with a SourceError ────────────────────────
    const noPath = await page.evaluate(async (mediaId) => {
      const proof = await window.__nativeExportProof()
      const store = proof.mediaStore
      const before = store.getState().mediaById[mediaId]
      const { filePath: _gone, ...withoutPath } = before
      store.setState({ mediaById: { ...store.getState().mediaById, [mediaId]: withoutPath } })
      return before.filePath
    }, placed.mediaId)
    const noPathOut = path.join(outDir, 'app-no-path.mp4')
    fs.rmSync(noPathOut, { force: true })
    await grant([noPathOut])
    const refused = await exportInPage(page, { format: 'hevc-main10', path: noPathOut, bitrate: BITRATE })
    check('a clip with no file path stops the export with a SourceError', !refused.ok && refused.name === 'SourceError' && /no file path/.test(refused.message) && !fs.existsSync(noPathOut), refused)
    await page.evaluate(async ({ mediaId, filePath }) => {
      const store = (await window.__nativeExportProof()).mediaStore
      store.setState({ mediaById: { ...store.getState().mediaById, [mediaId]: { ...store.getState().mediaById[mediaId], filePath } } })
    }, { mediaId: placed.mediaId, filePath: noPath })

    // ── the grey ramp, in a 30 fps project, as HEVC Main 10 ──────────────────────────────────
    await projectWith(page, { name: 'Native ramp', fps: { num: 30, den: 1 }, file: ramp.file })
    const rampOut = path.join(outDir, 'app-ramp-hevc.mp4')
    fs.rmSync(rampOut, { force: true })
    await grant([rampOut])
    const rampOutcome = await exportInPage(page, { format: 'hevc-main10', path: rampOut, bitrate: BITRATE })
    let rampLevels = null
    if (rampOutcome.ok) {
      const perRow = distinctLevelsPerRow(decodeLuma10(rampOut, 3840, 2880, 0), 3840, 2880)
      rampLevels = { fromRow: RAMP_SCORED_FROM_ROW, ...summariseCounts(perRow.slice(RAMP_SCORED_FROM_ROW)) }
    }
    check('the grey ramp keeps 877 levels in every scored row', rampOutcome.ok && rampLevels.min >= 877, { outcome: rampOutcome, levels: rampLevels, probe: rampOutcome.ok ? probe(rampOut) : null })

    const record = { results, exports, refused, ramp: { outcome: rampOutcome, levels: rampLevels }, pageLog: pageLog.slice(-40) }
    fs.writeFileSync(path.join(outDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`)
    console.log(`wrote ${path.join(outDir, 'record.json')}`)
  } finally {
    memory.stop()
    await app.close().catch(() => {})
    fs.rmSync(work, { recursive: true, force: true })
  }
  if (results.some((result) => !result.ok)) {
    console.log(pageLog.slice(-20).join('\n'))
    process.exitCode = 1
  }
}

await main()
