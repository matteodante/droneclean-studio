/**
 * Launching the desktop app for the feature pass, always in a throwaway profile, and everything the pass records:
 * requests (pages, workers and the main process), data written, screenshots.
 */
import { _electron } from 'playwright-core'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { seedWorkspaceFromDrop } from '../../support/drop-files.mjs'
import { assertThrowawayProfile, isInside, realHome, realProfilePath, APP_NAME } from './profile.mjs'

const require = createRequire(import.meta.url)
const here = path.dirname(new URL(import.meta.url).pathname)
export const desktopDir = path.resolve(here, '..', '..', '..')
const packagedBinary = path.join(desktopDir, 'dist', 'mac-arm64', `${APP_NAME}.app`, 'Contents', 'MacOS', APP_NAME)
const throwawayMain = path.join(desktopDir, 'test', 'support', 'throwaway-profile.cjs')
const appDataProbe = path.join(desktopDir, 'test', 'support', 'print-appdata.cjs')

const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg'

/**
 * Chooses how to start the app so that its profile is inside `work`.
 * - `packaged`: the `.app`, with `$HOME` and `CFFIXED_USER_HOME` moved into `work` (the packaged app ignores
 *   `DRONECLEAN_USER_DATA`). Used only when a probe with Electron's own binary shows that `appData` follows.
 * - `built`: Electron's binary on `out/` + `studio/dist` with `throwaway-profile.cjs` (not `isPackaged`).
 */
export function chooseLaunchMode({ work, requested = 'auto' }) {
  const home = path.join(work, 'home')
  fs.mkdirSync(home, { recursive: true })
  const env = { ...process.env, HOME: home, CFFIXED_USER_HOME: home }
  let probe = null
  if (requested !== 'built' && fs.existsSync(packagedBinary)) {
    const result = spawnSync(require('electron'), [appDataProbe], { env, encoding: 'utf8', timeout: 60000 })
    const match = /APPDATA=(.*)/.exec(result.stdout ?? '')
    probe = match ? match[1].trim() : null
    if (probe && isInside(work, probe) && !isInside(realProfilePath(realHome()), probe)) {
      return { mode: 'packaged', env, probe, home }
    }
    if (requested === 'packaged') {
      throw new Error(`the packaged app would not keep its profile in the throwaway folder (appData=${probe}); refusing to launch`)
    }
  }
  return { mode: 'built', env: null, probe, home }
}

/** Starts the app; stops (and closes it) if its profile is not the throwaway one. */
export async function launchApp({ work, choice, extraArgs = [] }) {
  const root = path.join(work, 'profile-root')
  fs.mkdirSync(root, { recursive: true })
  const common = ['--use-fake-device-for-media-stream', ...extraArgs]
  const app =
    choice.mode === 'packaged'
      ? await _electron.launch({ executablePath: packagedBinary, args: common, env: choice.env })
      : await _electron.launch({
          executablePath: require('electron'),
          args: [throwawayMain, ...common],
          cwd: desktopDir,
          env: { ...process.env, DRONECLEAN_PROFILE_ROOT: root },
        })
  const paths = await app.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath('userData'),
    appData: electronApp.getPath('appData'),
    isPackaged: electronApp.isPackaged,
    version: electronApp.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }))
  try {
    assertThrowawayProfile({ userData: paths.userData, throwawayRoot: work })
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
  const mainOutput = []
  app.process().stdout?.on('data', (chunk) => mainOutput.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk) => mainOutput.push(chunk.toString()))
  return { app, paths, mainOutput }
}

/** Records every http(s)/ws request of the default session, and fetches made by the main process itself. */
export async function installMainNetworkLog(app) {
  await app.evaluate(({ session, net }) => {
    if (globalThis.__fpNet) return
    const log = (globalThis.__fpNet = [])
    const web = session.defaultSession.webRequest
    web.onBeforeRequest((details, callback) => {
      log.push({ id: details.id, t: Date.now(), url: details.url, method: details.method, type: details.resourceType, process: 'page' })
      callback({})
    })
    web.onCompleted((details) => {
      const length = details.responseHeaders?.['content-length'] ?? details.responseHeaders?.['Content-Length']
      log.push({ id: details.id, t: Date.now(), done: true, url: details.url, status: details.statusCode, fromCache: details.fromCache, bytes: length ? Number(Array.isArray(length) ? length[0] : length) : null })
    })
    web.onErrorOccurred((details) => {
      log.push({ id: details.id, t: Date.now(), done: true, url: details.url, error: details.error })
    })
    // Best effort: fetches made by main-process code through these entry points (a module that took a reference
    // to the original function before this ran is not seen).
    const mainEntry = (url, how) => log.push({ t: Date.now(), url: String(url), method: 'GET', type: how, process: 'main' })
    const originalFetch = globalThis.fetch
    if (originalFetch) globalThis.fetch = (input, init) => (mainEntry(input?.url ?? input, 'main fetch'), originalFetch(input, init))
    const originalNetFetch = net.fetch.bind(net)
    net.fetch = (input, init) => (mainEntry(input?.url ?? input, 'net.fetch'), originalNetFetch(input, init))
    const originalRequest = net.request.bind(net)
    net.request = (options) => (mainEntry(typeof options === 'string' ? options : (options?.url ?? options?.hostname), 'net.request'), originalRequest(options))
    for (const name of ['http', 'https']) {
      const mod = process.getBuiltinModule(`node:${name}`)
      const original = mod.request
      mod.request = function (...args) {
        const first = args[0]
        mainEntry(typeof first === 'string' ? first : (first?.href ?? `${name}://${first?.hostname ?? first?.host}${first?.path ?? ''}`), `${name}.request`)
        return original.apply(this, args)
      }
    }
  })
}

/** Takes (and clears) what the main-process log holds, merged per request id. */
export async function drainMainNetworkLog(app) {
  const entries = await app.evaluate(() => {
    const log = globalThis.__fpNet ?? []
    globalThis.__fpNet = log
    return log.splice(0, log.length)
  })
  const started = new Map()
  const out = []
  for (const entry of entries) {
    if (entry.done) {
      const start = started.get(entry.id)
      if (start) {
        start.status = entry.status ?? null
        start.bytes = entry.bytes ?? null
        start.fromCache = entry.fromCache ?? false
        start.error = entry.error ?? null
      } else out.push({ ...entry, process: 'page', method: 'GET', type: 'unknown' })
    } else {
      const record = { ...entry, status: null, bytes: null }
      if (entry.id !== undefined) started.set(entry.id, record)
      out.push(record)
    }
  }
  return out
}

/** Sizes of everything under `dir`, keyed by the first two path parts. */
export function folderSizes(dir) {
  const sizes = new Map()
  const visit = (current) => {
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) {
        const relative = path.relative(dir, full).split(path.sep)
        const key = relative.slice(0, Math.min(2, relative.length - 1)).join('/') || relative[0]
        sizes.set(key, (sizes.get(key) ?? 0) + fs.statSync(full).size)
      }
    }
  }
  visit(dir)
  return sizes
}

export function diffSizes(before, after, minimum = 1024) {
  const out = []
  for (const [key, size] of after) {
    const delta = size - (before.get(key) ?? 0)
    if (Math.abs(delta) >= minimum) out.push({ path: key, delta, size })
  }
  return out.sort((a, b) => b.delta - a.delta)
}

/** Files under the workspace folder that are new since `before` (a Map path → size). */
export function workspaceFiles(dir) {
  const files = new Map()
  const visit = (current) => {
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) files.set(path.relative(dir, full), fs.statSync(full).size)
    }
  }
  visit(dir)
  return files
}

export function newWorkspaceFiles(before, after) {
  const out = []
  for (const [file, size] of after) if (before.get(file) !== size) out.push({ path: file, size })
  return out.sort((a, b) => b.size - a.size).slice(0, 12)
}

/** Fixtures: tiny clips made with FFmpeg, speech made with `say`. No footage of the owner's is copied. */
export function makeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const ff = (args) => execFileSync(FFMPEG, ['-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
  const clip = path.join(dir, 'fp-clip.mp4')
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
  const clip2 = path.join(dir, 'fp-clip-two.mp4')
  ff(['-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip2])
  const urlClip = path.join(dir, 'fp-url-clip.mp4')
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', urlClip])
  const speechAiff = path.join(dir, 'speech.aiff')
  const speech = path.join(dir, 'fp-speech.wav')
  execFileSync('say', ['-o', speechAiff, 'Hello and welcome to the drone editor. Today we fly over the hills and the lake.'])
  ff(['-i', speechAiff, '-ar', '16000', '-ac', '1', speech])
  const fillersAiff = path.join(dir, 'fillers.aiff')
  const fillers = path.join(dir, 'fp-fillers.wav')
  execFileSync('say', ['-o', fillersAiff, 'So, um, today we are, uh, going to fly, um, over the hills, you know, and uh the lake.'])
  ff(['-i', fillersAiff, '-ar', '16000', '-ac', '1', fillers])
  // A clip with an embedded subtitle track, for "captions from an embedded subtitle track".
  const srt = path.join(dir, 'fp.srt')
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,500\nFirst embedded line\n\n2\n00:00:01,500 --> 00:00:03,000\nSecond embedded line\n')
  // The editor offers "Extract Embedded Subtitles" only for Matroska and WebM files (media-card.tsx).
  const subtitled = path.join(dir, 'fp-subtitled.mkv')
  ff(['-i', clip, '-i', srt, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt', subtitled])
  // The same speech with a black picture: an audio-only file cannot be placed on an empty timeline in the app
  // (a drag of its card or a drop of the file adds no clip), a video file can.
  const speechVideo = path.join(dir, 'fp-speech-video.mp4')
  ff(['-f', 'lavfi', '-i', 'color=c=black:size=320x240:rate=30', '-i', speech, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', speechVideo])
  const fillersVideo = path.join(dir, 'fp-fillers-video.mp4')
  ff(['-f', 'lavfi', '-i', 'color=c=black:size=320x240:rate=30', '-i', fillers, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fillersVideo])
  return { clip, clip2, speechVideo, fillersVideo, urlClip, speech, fillers, subtitled }
}

/** Seeds the workspace record the picker would have written, from a folder dropped on the page. */
export async function seedWorkspace(page, workspaceDir) {
  await seedWorkspaceFromDrop(page, {
    workspaceDir,
    probeId: 'fp-workspace-drop',
    windowKey: '__fpDrop',
    workspaceId: 'feature-pass',
    timeout: 60000,
  })
}

/**
 * Wraps the three file pickers so a click that reaches one is recorded, and answers as a user who cancelled the
 * native dialog (AbortError). Nothing is faked: a picker cannot be driven, so the feature is a manual step.
 */
export const PICKER_RECORDER = `
  (() => {
    window.__fpPickers = window.__fpPickers || []
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker', 'showDirectoryPicker']) {
      if (typeof window[name] !== 'function' || window[name].__fp) continue
      const wrapped = (options) => {
        window.__fpPickers.push({ name, options: JSON.stringify(options ?? {}).slice(0, 200), t: Date.now() })
        return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
      }
      wrapped.__fp = true
      window[name] = wrapped
    }
  })()
`

export async function waitForRender(page) {
  await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 180000 })
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}
