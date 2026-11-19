/**
 * End-to-end proof of media an agent names by path (task 2.2 slice 5, design
 * §4.5): the six clips of 15 Nov 2026, imported through `studio.media.import`
 * by absolute path in the desktop app, played and seeked in the preview, kept
 * out of the workspace, re-registered after a restart with no prompt, served
 * with `Range` (206 + `Content-Range`) and 404 for what the page never named.
 *
 * It runs the built app (`npm run build` in `studio/` and `npm run build:main`
 * in `studio/desktop/`) in a throwaway profile
 * (`test/support/throwaway-profile.cjs`), so the real one is not touched.
 * Requires `installAgentMedia()` to be called by the page's entry — the MCP
 * slice wires that line into `src/main.tsx`; this proof was run with it added
 * locally.
 *
 * Prints one JSON result and exits non-zero if any check fails.
 */
import { _electron } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { seedWorkspaceFromDrop } from './support/drop-files.mjs'
import { isTemporaryFolder } from '../out/main/workspace-lock.js'

const require = createRequire(import.meta.url)

const here = path.dirname(new URL(import.meta.url).pathname)
const desktopDir = path.resolve(here, '..')

// No default: the footage is the maintainer's own. Usage: DRONECLEAN_E2E_FOOTAGE=/path/to/folder node test/media-paths-e2e.mjs
// where the folder holds the six clips named below.
const FOOTAGE = process.env.DRONECLEAN_E2E_FOOTAGE
if (!FOOTAGE) throw new Error('DRONECLEAN_E2E_FOOTAGE is not set: point it at the folder with the six clips')
const PATHS = [
  'DJI_20261115114020_0019_D.MP4',
  'DJI_20261115124704_0020_D.MP4',
  'DJI_20261115125055_0021_D.MP4',
  'DJI_20261115130513_0022_D.MP4',
  'DJI_20261115130733_0023_D.MP4',
  'DJI_20261115131124_0024_D.MP4',
].map((name) => path.join(FOOTAGE, name))

const results = []
const observations = {}
const openApps = new Set()

function check(name, ok, details) {
  results.push({ name, ok: Boolean(ok), details })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${details === undefined ? '' : ' ' + JSON.stringify(details)}`)
  return ok
}

function fatal(message) {
  throw new Error(message)
}

/** Every file under `dir`, with its size. */
function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push({ path: path.relative(dir, full), size: fs.statSync(full).size })
  }
  return out
}

function folderBytes(dir) {
  return walk(dir).reduce((sum, file) => sum + file.size, 0)
}

/** The id the shell gives a path in the media route. */
function mediaIdFor(realPath) {
  return crypto.createHash('sha256').update(realPath, 'utf8').digest('base64url').slice(0, 22)
}

async function launch(profileRoot) {
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [path.join(desktopDir, 'test', 'support', 'throwaway-profile.cjs')],
    cwd: desktopDir,
    env: { ...process.env, DRONECLEAN_PROFILE_ROOT: profileRoot },
  })
  openApps.add(app)
  const mainOutput = []
  app.process().stdout?.on('data', (chunk) => mainOutput.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk) => mainOutput.push(chunk.toString()))
  const page = await app.firstWindow()
  const consoleErrors = []
  const pageErrors = []
  const dialogs = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  await page.waitForURL(/^droneclean:\/\/app\//, { timeout: 90000 })
  await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, {
    timeout: 180000,
  })
  return { app, page, consoleErrors, pageErrors, dialogs, mainOutput }
}

/** Seed the workspace the way the app stores it: a folder dropped on the page. */
async function seedWorkspace(page, workspaceDir) {
  await seedWorkspaceFromDrop(page, {
    workspaceDir,
    probeId: 'proof-workspace-drop',
    windowKey: '__proofDrop',
    workspaceId: 'media-paths-proof',
    timeout: 60000,
  })
}

/** The preview's video element when it plays a media-route URL. */
async function main() {
  for (const clip of PATHS) if (!fs.existsSync(clip)) fatal(`missing footage: ${clip}`)

  // Not in the system's temporary folder: the app refuses a workspace there (review finding E1).
  // `dist/` is ignored by git.
  fs.mkdirSync(path.join(desktopDir, 'dist'), { recursive: true })
  const work = fs.mkdtempSync(path.join(desktopDir, 'dist', 'media-paths-proof-'))
  if (isTemporaryFolder(work)) fatal(`the proof's folder is in a temporary folder: ${work}`)
  const profileRoot = path.join(work, 'profile')
  const workspaceDir = path.join(work, 'workspace')
  const outsideDir = path.join(work, 'outside')
  fs.mkdirSync(profileRoot)
  fs.mkdirSync(workspaceDir)
  fs.mkdirSync(outsideDir)
  // A media-looking file the page never names: its computed id must 404.
  fs.writeFileSync(path.join(outsideDir, 'outside.mp4'), Buffer.alloc(4096, 7))
  fs.writeFileSync(path.join(outsideDir, 'notes.txt'), 'not media\n')
  observations.work = work

  const footageBytes = PATHS.reduce((sum, clip) => sum + fs.statSync(clip).size, 0)

  // ── first launch: workspace, project, import by path, play and seek ──────
  const first = await launch(profileRoot)
  const profile = await first.app.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    appData: app.getPath('appData'),
  }))
  observations.profile = profile
  check(
    'the run uses a throwaway profile',
    profile.userData.startsWith(profileRoot),
    { userData: profile.userData },
  )

  await seedWorkspace(first.page, workspaceDir)
  await first.page.reload()
  await first.page.waitForFunction(
    () => document.querySelectorAll('a[href="/projects/new"]').length > 0,
    null,
    { timeout: 180000 },
  )

  // New project → the editor.
  await first.page.locator('a[href="/projects/new"]').first().click({ timeout: 60000 })
  await first.page.waitForURL(/\/projects\/new/, { timeout: 60000 })
  await first.page.fill('#name', 'Media paths proof')
  await first.page.locator('form button[type="submit"]').click()
  await first.page.waitForURL(/\/editor\//, { timeout: 180000 })
  await first.page.waitForTimeout(3000)
  const projectId = new URL(first.page.url()).pathname.split('/').filter(Boolean).pop()
  observations.projectId = projectId

  const sizeBefore = folderBytes(workspaceDir)
  const filesBefore = new Map(walk(workspaceDir).map((file) => [file.path, file.size]))
  const imported = await first.page.evaluate(async (paths) => {
    const started = performance.now()
    const infos = await window.studio.media.import(paths)
    const ms = performance.now() - started
    const urls = []
    for (const info of infos) urls.push({ id: info.id, url: await window.studio.media.url(info.id) })
    return {
      ms,
      infos: infos.map((info) => ({
        id: info.id,
        fileName: info.fileName,
        type: info.type,
        fileSize: info.fileSize,
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        codec: info.codec,
      })),
      urls,
      library: window.studio.media.list().length,
    }
  }, PATHS)
  observations.import = imported
  const sizeAfter = folderBytes(workspaceDir)
  const filesAfter = walk(workspaceDir)
  const addedFiles = filesAfter.filter((file) => filesBefore.get(file.path) !== file.size)
  observations.workspace = {
    before: sizeBefore,
    after: sizeAfter,
    added: sizeAfter - sizeBefore,
    footageBytes,
    files: addedFiles,
  }

  check(
    'all six paths import in one call, under 10 s',
    imported.infos.length === 6 && imported.ms < 10_000,
    { ms: Math.round(imported.ms), files: imported.infos.map((info) => info.fileName) },
  )
  check(
    'every clip was probed as 4K video with its duration',
    imported.infos.every(
      (info) =>
        info.type === 'video' &&
        info.width === 3840 &&
        info.height === 2880 &&
        info.duration > 100 &&
        info.fileSize > 1_000_000_000,
    ),
    imported.infos.map((info) => `${info.fileName}:${info.duration}s ${info.width}x${info.height}`),
  )
  check(
    'no footage was copied into the workspace',
    sizeAfter - sizeBefore < 1_000_000 &&
      addedFiles.every((file) => file.size < 100_000 && !/\.(mp4|m4v|mov|webm|mkv|avi|mp3|wav|aac|m4a|ogg|opus)$/i.test(file.path)),
    {
      addedBytes: sizeAfter - sizeBefore,
      footageBytes,
      largestAdded: addedFiles.reduce((max, file) => Math.max(max, file.size), 0),
      files: addedFiles.map((file) => `${file.path} (${file.size} B)`),
    },
  )
  check(
    'each media resolves to its own media-route URL',
    imported.urls.every((entry) => entry.url.startsWith('droneclean://app/__media/')),
    imported.urls,
  )

  // A non-media path is refused by the import, and a path never named has no id.
  const refused = await first.page.evaluate(async (textPath) => {
    try {
      await window.studio.media.import([textPath])
      return null
    } catch (error) {
      return { name: error?.name ?? null, code: error?.code ?? null, message: String(error?.message ?? error) }
    }
  }, path.join(outsideDir, 'notes.txt'))
  observations.refusedNonMedia = refused
  check(
    'the shell refuses a path that is not media',
    refused?.code === 'MEDIA_UNAVAILABLE' && /not video, audio or image/.test(refused.message),
    refused,
  )

  const play = await first.page.evaluate(async ({ mediaId }) => {
    const studio = window.studio
    const tracks = studio.tracks.list()
    const videoTrack = tracks.find((track) => (track.kind ?? 'video') === 'video')
    if (!videoTrack) return { error: 'no video track' }
    const clipId = studio.clips.add({ mediaId, trackId: videoTrack.id, from: 0 })
    studio.playback.seek(30)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    studio.playback.play()
    await new Promise((resolve) => setTimeout(resolve, 3500))
    const find = () => [...document.querySelectorAll('video')].find((video) =>
      String(video.currentSrc || video.src || '').startsWith('droneclean://app/__media/'))
    const during = find()
    const firstSample = during
      ? { currentTime: during.currentTime, readyState: during.readyState, paused: during.paused, videoWidth: during.videoWidth, videoHeight: during.videoHeight }
      : null
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const secondSample = find()
      ? { currentTime: find().currentTime, readyState: find().readyState }
      : null
    studio.playback.pause()
    const timecodesWhilePlaying = document.body.innerText.match(/\d\d:\d\d:\d\d/g) ?? []

    studio.playback.seek(150)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const afterSeek = find()
      ? { currentTime: find().currentTime, readyState: find().readyState, paused: find().paused, registered: find().currentSrc || find().src }
      : null
    const timecodesAfterSeek = document.body.innerText.match(/\d\d:\d\d:\d\d/g) ?? []
    await studio.project.save()
    return {
      clipId,
      firstSample,
      secondSample,
      advancedSeconds: firstSample && secondSample ? secondSample.currentTime - firstSample.currentTime : null,
      timecodesWhilePlaying,
      afterSeek,
      timecodesAfterSeek,
    }
  }, { mediaId: imported.infos[1].id })
  observations.playback = play
  check(
    'the clip plays in the preview: the decoder advances',
    Boolean(play.firstSample) &&
      play.firstSample.videoWidth === 3840 &&
      play.firstSample.readyState >= 2 &&
      play.advancedSeconds > 0.5,
    play.firstSample && play.secondSample
      ? { width: play.firstSample.videoWidth, height: play.firstSample.videoHeight, advancedSeconds: Math.round(play.advancedSeconds * 100) / 100, timecodes: play.timecodesWhilePlaying }
      : play,
  )
  check(
    'a seek in the preview lands on the new frame',
    Boolean(play.afterSeek) && Math.abs(play.afterSeek.currentTime - 5) < 1.5,
    play.afterSeek,
  )

  // Ranges over the media route: 1 MB at the start, a byte range 2 GB in and a
  // suffix read, then the 404s.
  const url = imported.urls[1].url
  const route = await first.page.evaluate(async ({ url, outsideUrl, unknownUrl }) => {
    const take = async (label, requestUrl, init = {}) => {
      try {
        const started = performance.now()
        const response = await fetch(requestUrl, init)
        const body = init.method === 'HEAD' ? null : await response.arrayBuffer()
        return {
          label,
          status: response.status,
          contentRange: response.headers.get('content-range'),
          contentLength: response.headers.get('content-length'),
          acceptRanges: response.headers.get('accept-ranges'),
          bytes: body ? body.byteLength : null,
          ms: Math.round((performance.now() - started) * 10) / 10,
        }
      } catch (error) {
        return { label, error: String(error) }
      }
    }
    return {
      head: await take('HEAD', url, { method: 'HEAD' }),
      firstMegabyte: await take('0-1048575', url, { headers: { range: 'bytes=0-1048575' } }),
      deep: await take('2000000000-2000001023', url, { headers: { range: 'bytes=2000000000-2000001023' } }),
      suffix: await take('-2048', url, { headers: { range: 'bytes=-2048' } }),
      outside: await take('outside', outsideUrl),
      unknown: await take('unknown', unknownUrl),
    }
  }, {
    url,
    outsideUrl: `droneclean://app/__media/${mediaIdFor(fs.realpathSync(path.join(outsideDir, 'outside.mp4')))}`,
    unknownUrl: 'droneclean://app/__media/never-named-by-the-page',
  })
  observations.route = route
  check(
    'a Range answers 206 with Content-Range and exactly those bytes',
    route.firstMegabyte.status === 206 &&
      route.firstMegabyte.contentRange === `bytes 0-1048575/${imported.infos[1].fileSize}` &&
      route.firstMegabyte.contentLength === '1048576' &&
      route.firstMegabyte.bytes === 1048576 &&
      route.firstMegabyte.acceptRanges === 'bytes',
    route.firstMegabyte,
  )
  check(
    'a range 2 GB into a 3.76 GB clip and a suffix range both answer 206',
    route.deep.status === 206 && route.deep.bytes === 1024 && route.suffix.status === 206 && route.suffix.bytes === 2048,
    { deep: route.deep, suffix: route.suffix },
  )
  check(
    'HEAD answers the whole file’s length without its bytes',
    route.head.status === 200 && route.head.contentLength === String(imported.infos[1].fileSize) && route.head.bytes === null,
    route.head,
  )
  check(
    'a path the page never named answers 404',
    route.outside.status === 404 && route.unknown.status === 404,
    { outside: route.outside, unknown: route.unknown },
  )

  const mediaDirsOnDisk = walk(path.join(workspaceDir, 'media')).map((file) => file.path)
  observations.mediaDirsOnDisk = mediaDirsOnDisk

  observations.firstLaunchErrors = {
    pageErrors: first.pageErrors,
    consoleErrors: first.consoleErrors.slice(0, 10),
    dialogs: first.dialogs,
  }
  check(
    'no uncaught error and no dialog in the first launch',
    first.pageErrors.length === 0 && first.dialogs.length === 0,
    { pageErrors: first.pageErrors, dialogs: first.dialogs },
  )
  await first.app.close()
  openApps.delete(first.app)

  // ── second launch: the restart ────────────────────────────────────────────
  const second = await launch(profileRoot)
  const restartedAt = Date.now()
  await second.page
    .waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, {
      timeout: 120000,
    })
    .catch(() => {})
  const gate = await second.page.evaluate(() => ({
    href: location.href,
    newProjectLinks: document.querySelectorAll('a[href="/projects/new"]').length,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
  }))
  observations.restartGate = gate
  check(
    'the workspace opens after the restart without a prompt',
    gate.newProjectLinks > 0 && gate.dialogs === 0,
    gate,
  )

  await second.page.goto(`droneclean://app/editor/${projectId}`)
  await second.page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, {
    timeout: 180000,
  })
  await second.page.waitForFunction(
    () => (window.studio?.media.list() ?? []).filter((item) => item.type === 'video').length >= 6,
    null,
    { timeout: 180000 },
  )
  // The page registers the URLs as the project's library loads; wait for the
  // last one the way a pilot waits for the clip to be playable.
  const urlsReady = await second.page
    .waitForFunction(
      async () => {
        const studio = window.studio
        for (const item of studio.media.list()) {
          if (!(await studio.media.url(item.id))) return false
        }
        return studio.media.list().length >= 6
      },
      null,
      { timeout: 120000 },
    )
    .then(() => true)
    .catch(() => false)
  const urlsReadyMs = Date.now() - restartedAt
  const registered = await second.page.evaluate(async () => {
    const studio = window.studio
    const items = studio.media.list()
    const urls = []
    for (const item of items) urls.push({ id: item.id, fileName: item.fileName, url: await studio.media.url(item.id) })
    return {
      items: items.length,
      urls,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 240),
    }
  })
  observations.restart = { ...registered, urlsReady, msFromLaunch: urlsReadyMs }
  check(
    'every path record re-registers its media-route URL after the restart',
    urlsReady && registered.urls.length === 6 &&
      registered.urls.every((entry) => entry.url?.startsWith('droneclean://app/__media/')),
    { msFromLaunch: urlsReadyMs, urls: registered.urls },
  )
  check('the restart shows no missing-media dialog', registered.dialogs === 0, { dialogs: registered.dialogs })

  const replay = await second.page.evaluate(async () => {
    const studio = window.studio
    const find = () => [...document.querySelectorAll('video')].find((video) =>
      String(video.currentSrc || video.src || '').startsWith('droneclean://app/__media/'))
    studio.playback.seek(60)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    studio.playback.play()
    await new Promise((resolve) => setTimeout(resolve, 3500))
    const firstSample = find() ? { currentTime: find().currentTime, readyState: find().readyState } : null
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const secondSample = find() ? { currentTime: find().currentTime, readyState: find().readyState } : null
    studio.playback.pause()
    studio.playback.seek(150)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const afterSeek = find() ? { currentTime: find().currentTime, readyState: find().readyState } : null
    return {
      clipOnTimeline: document.querySelectorAll('[data-timeline-item]').length,
      firstSample,
      secondSample,
      advancedSeconds: firstSample && secondSample ? secondSample.currentTime - firstSample.currentTime : null,
      afterSeek,
      timecodes: document.body.innerText.match(/\d\d:\d\d:\d\d/g) ?? [],
    }
  })
  observations.replay = replay
  check(
    'after the restart the clip plays and seeks with no import',
    Boolean(replay.firstSample) && replay.firstSample.readyState >= 2 && replay.advancedSeconds > 0.5 &&
      Boolean(replay.afterSeek) && Math.abs(replay.afterSeek.currentTime - 5) < 1.5,
    {
      clipOnTimeline: replay.clipOnTimeline,
      advancedSeconds: replay.advancedSeconds === null ? null : Math.round(replay.advancedSeconds * 100) / 100,
      afterSeek: replay.afterSeek,
      timecodes: replay.timecodes,
    },
  )

  const restartRoute = await second.page.evaluate(async ({ url, unknownUrl }) => {
    const ranged = await fetch(url, { headers: { range: 'bytes=0-99' } })
    const unknown = await fetch(unknownUrl)
    return {
      ranged: { status: ranged.status, contentRange: ranged.headers.get('content-range'), bytes: (await ranged.arrayBuffer()).byteLength },
      unknown: { status: unknown.status },
    }
  }, { url: registered.urls[1].url, unknownUrl: 'droneclean://app/__media/never-named-by-the-page' })
  observations.restartRoute = restartRoute
  check(
    'the re-registered URL still answers 206, and an unknown id 404',
    restartRoute.ranged.status === 206 && restartRoute.ranged.bytes === 100 && restartRoute.unknown.status === 404,
    restartRoute,
  )

  observations.secondLaunchErrors = {
    pageErrors: second.pageErrors,
    consoleErrors: second.consoleErrors.slice(0, 10),
    dialogs: second.dialogs,
  }
  check(
    'no uncaught error and no dialog in the second launch',
    second.pageErrors.length === 0 && second.dialogs.length === 0,
    { pageErrors: second.pageErrors, dialogs: second.dialogs },
  )
  await second.app.close()
  openApps.delete(second.app)
  console.log(JSON.stringify({ results, observations }, null, 1))
  if (results.some((result) => !result.ok)) process.exitCode = 1
}

let failure = null
try {
  await main()
} catch (error) {
  failure = error
  results.push({ name: 'run completed', ok: false, details: String(error) })
  console.error(error)
} finally {
  for (const app of openApps) {
    try {
      await app.close()
    } catch {
      // the app is already gone
    }
  }
  if (failure) {
    console.log(JSON.stringify({ results, observations, error: String(failure) }, null, 1))
    process.exitCode = 1
  }
}
