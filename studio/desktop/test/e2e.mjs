/**
 * End-to-end check of the desktop app (task 1.1).
 *
 * Launches the app with Playwright's Electron driver and checks, in the running app: the projects page and cross-origin
 * isolation, WebGPU, HEVC Main 10 decoding of clip 0020, H.264 and AAC encoding,
 * the bridge, persistence across a restart (IndexedDB and the workspace folder's
 * file-system permission), and a real project: workspace, new project, clip
 * imported by a drop, clip on the timeline, playback. Then two flows on generated clips
 * (`flows/`): looks (task 5.2: a `.cube` added to the library, chosen on a clip, seen in
 * the preview, exported, seen in the exported file, undone) and subclips (task 1.6: made
 * in the source monitor with Alt+S, saved, the app restarted, the subclip found in the
 * library, dropped on the timeline, exported, the output's duration and first frame
 * checked against the range).
 *
 * Prints one JSON result and exits non-zero if any check fails.
 *
 * Two modes, both away from the real profile (review finding E1):
 *
 * - **packaged** (default, `npm run e2e`): the packaged test variant,
 *   `dist/test-app/mac-arm64/DroneClean Studio Test.app` from `npm run package:test`
 *   — the same build as the real app with another product name and app id, so its
 *   profile is `~/Library/Application Support/DroneClean Studio Test`, which this
 *   check empties before and after. The real app is never launched.
 * - **main** (`npm run e2e:quick`, `DRONECLEAN_E2E_MODE=main`): the built main
 *   process (`out/main/index.js`) under `test/support/throwaway-profile.cjs`, with
 *   a throwaway profile folder.
 *
 * The workspace is always throwaway and removed afterwards, and the launcher
 * refuses the real profile (`test/support/e2e-profile.mjs`, tested by
 * `test/e2e-profile.test.mjs`).
 * The workspace is not in the system's temporary folder, because the app
 * refuses a workspace there; it is under `dist/`, which git ignores. The real
 * app may stay open while this runs.
 */
import { _electron } from 'playwright-core'
import { dropFiles, installDropProbe, seedWorkspaceFromDrop } from './support/drop-files.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  e2eLaunch,
  e2ePackagedLaunch,
  testProfileDir,
} from './support/e2e-profile.mjs'
import { dragCardToTimeline, waitForMatchDialog } from './support/timeline-drag.mjs'
import { routeDownloadsTo } from './support/flow-page.mjs'
import { runLooksFlow } from './flows/looks.mjs'
import { createSubclipFlow, reopenSubclipFlow } from './flows/subclips.mjs'
import { isTemporaryFolder } from '../out/main/workspace-lock.js'

const here = path.dirname(new URL(import.meta.url).pathname)
const desktopDir = path.resolve(here, '..')
const electronPath = createRequire(import.meta.url)('electron')
const builtMain = path.join(desktopDir, 'out', 'main', 'index.js')
const MODE = process.env.DRONECLEAN_E2E_MODE === 'main' ? 'main' : 'packaged'
const testApp = path.join(
  desktopDir, 'dist', 'test-app', 'mac-arm64', 'DroneClean Studio Test.app', 'Contents', 'MacOS', 'DroneClean Studio Test',
)
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(desktopDir, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version

// No default: the footage is the maintainer's own. Set DRONECLEAN_E2E_CLIP to a long HEVC clip.
const CLIP = process.env.DRONECLEAN_E2E_CLIP || ''
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg'
const LANGUAGE_KEY = 'freecut-language'

const results = []
const observations = {}
const openApps = new Set()
const allMainOutput = []
let lastPage = null
/** The throwaway profile, workspace and clip excerpt: removed at the end, pass or fail. */
let work = null
let profileRoot = null
let packagedProfile = null
/** Screenshots and page text of a run: kept only when the run fails. */
let artifacts = null

function check(name, ok, details) {
  results.push({ name, ok: Boolean(ok), details })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${details === undefined ? '' : ' ' + JSON.stringify(details)}`)
  return ok
}

function fatal(message) {
  throw new Error(message)
}

async function dumpState(page, label) {
  if (!artifacts) return
  try {
    await page.screenshot({ path: path.join(artifacts, `${label}.png`) })
    fs.writeFileSync(path.join(artifacts, `${label}.txt`), await page.evaluate(() => document.body.innerText))
  } catch (error) {
    console.error(`dump ${label} failed: ${String(error)}`)
  }
}

async function waitForRender(page) {
  await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, {
    timeout: 120000,
  })
}

async function launch() {
  const startedAt = Date.now()
  const options =
    MODE === 'main'
      ? e2eLaunch({ profileRoot, desktopDir, electronPath })
      : e2ePackagedLaunch({ appBinary: testApp })
  const app = await _electron.launch({
    ...options,
    args: [...options.args, '--use-fake-device-for-media-stream'],
  })
  openApps.add(app)
  const mainOutput = []
  allMainOutput.push(mainOutput)
  app.process().stdout?.on('data', (chunk) => mainOutput.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk) => mainOutput.push(chunk.toString()))
  const page = await app.firstWindow()
  lastPage = page
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ text: message.text(), url: message.location()?.url ?? null })
    }
  })
  page.on('requestfailed', (request) => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? null })
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('crash', () => pageErrors.push('the renderer crashed'))
  app.process().once('exit', (code, signal) => {
    observations[`exit${Object.keys(observations).filter((key) => key.startsWith('exit')).length + 1}`] = { code, signal }
  })
  await page.waitForURL(/^droneclean:\/\/app\//, { timeout: 60000 })
  try {
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, {
      timeout: 120000,
    })
  } catch (error) {
    const state = await page
      .evaluate(() => ({ html: document.body.innerHTML.slice(0, 500), href: location.href }))
      .catch(() => 'page not reachable')
    fatal(
      `the app did not render within 120 s: ${JSON.stringify(state)}\n` +
        `console: ${JSON.stringify(consoleErrors)}\npage errors: ${JSON.stringify(pageErrors)}\n` +
        `main process: ${mainOutput.join('').slice(0, 2000)}\n${String(error)}`,
    )
  }
  observations[`startupMs${Object.keys(observations).filter((key) => key.startsWith('startupMs')).length + 1}`] =
    Date.now() - startedAt
  return { app, page, consoleErrors, pageErrors, failedRequests, mainOutput }
}

async function removeDropProbe(page, id) {
  await page.evaluate((elementId) => document.getElementById(elementId)?.remove(), id)
}

async function mediaPanelCentre(page) {
  return page.evaluate(() => {
    const container = document.querySelector('div.relative.h-full.overflow-y-auto.px-4.pb-4')
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return { x: Math.round(rect.x + Math.min(120, rect.width / 2)), y: Math.round(rect.y + 60) }
  })
}

async function readTransport(page) {
  return page.evaluate(() => {
    const matches = document.body.innerText.match(/\d\d:\d\d:\d\d/g) ?? []
    const toFrames = (value) => {
      const [minutes = '0', seconds = '0', frames = '0'] = value.split(':')
      return (Number(minutes) * 60 + Number(seconds)) * 30 + Number(frames)
    }
    return {
      current: matches[0] ?? null,
      total: matches[1] ?? null,
      currentFrame: toFrames(matches[0] ?? '00:00:00'),
      pauseButtonShown: [...document.querySelectorAll('button')].some(
        (button) => button.getAttribute('aria-label') === 'Pause',
      ),
    }
  })
}

async function main() {
  if (!fs.existsSync(builtMain)) fatal(`the built main process is missing: ${builtMain}\nRun "npm run build" first.`)
  if (MODE === 'packaged') {
    if (!fs.existsSync(testApp)) fatal(`the packaged test app is missing: ${testApp}\nRun "npm run package:test" first.`)
    // A fresh profile for the test variant (never the real one: testProfileDir refuses it).
    packagedProfile = testProfileDir()
    fs.rmSync(packagedProfile, { recursive: true, force: true })
  }
  if (!CLIP) fatal('DRONECLEAN_E2E_CLIP is not set: point it at a long HEVC clip (usage: DRONECLEAN_E2E_CLIP=/path/to/clip.mp4 npm run e2e)')
  if (!fs.existsSync(CLIP)) fatal(`the clip is missing: ${CLIP}`)

  // Everything the run creates lives in one folder under `dist/` (git ignores it): the app
  // refuses a workspace in the system's temporary folder, so the workspace cannot be there.
  artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-e2e-artifacts-'))
  fs.mkdirSync(path.join(desktopDir, 'dist'), { recursive: true })
  work = fs.mkdtempSync(path.join(desktopDir, 'dist', 'e2e-work-'))
  profileRoot = path.join(work, 'profile')
  fs.mkdirSync(profileRoot)
  const workspaceDir = path.join(work, 'workspace')
  fs.mkdirSync(workspaceDir)
  if (isTemporaryFolder(workspaceDir)) fatal(`the throwaway workspace is in a temporary folder: ${workspaceDir}`)
  fs.writeFileSync(path.join(workspaceDir, 'droneclean-e2e.txt'), 'workspace is readable after a restart\n')

  // The project flow imports a 10 s stream copy of clip 0020 (170 MB), because the
  // editor copies every imported file into the project folder (PLAN.md 3.1) and then
  // builds its filmstrips: the full clip (3.76 GB, 3m57s) makes the run slow and, on a
  // loaded machine, timing-sensitive. DRONECLEAN_E2E_FULL_CLIP=1 imports clip 0020
  // itself; the <video> check above always uses clip 0020.
  const projectClip = process.env.DRONECLEAN_E2E_FULL_CLIP === '1' ? CLIP : path.join(work, 'clip-0020-cut.mp4')
  if (projectClip !== CLIP) {
    execFileSync(FFMPEG, ['-nostdin', '-loglevel', 'error', '-ss', '60', '-t', '10', '-i', CLIP, '-c', 'copy', projectClip], {
      stdio: 'inherit',
    })
  }

  // ── first launch: isolation, GPU, codecs, bridge, workspace seeding ────────
  const first = await launch()
  const profile = await first.app.evaluate(({ app }) => app.getPath('userData'))
  observations.profile = profile
  const expectedProfile = MODE === 'main' ? profileRoot : packagedProfile
  if (!path.resolve(profile).startsWith(path.resolve(expectedProfile) + (MODE === 'main' ? path.sep : ''))) {
    fatal(`the app is not running in the throwaway profile: ${profile}`)
  }
  check('the run uses a throwaway profile', true, { userData: profile })
  await first.page.evaluate((key) => localStorage.setItem(key, 'en'), LANGUAGE_KEY)
  await first.page.reload()
  await waitForRender(first.page)
  await first.page.waitForTimeout(1000)

  {
    const start = await first.page.evaluate(() => ({
      href: location.href,
      origin: location.origin,
      crossOriginIsolated: window.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      platform: window.dronecleanDesktop?.platform ?? null,
      bridgeVersion: window.dronecleanDesktop?.version ?? null,
      bridgeKeys: window.dronecleanDesktop ? Object.keys(window.dronecleanDesktop) : [],
      rootChildren: document.getElementById('root')?.childElementCount ?? 0,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
    }))
    observations.start = start
    check(
      'the projects page renders at launch',
      start.href === 'droneclean://app/projects' && start.rootChildren > 0 && start.text.length > 20,
      { href: start.href, text: start.text },
    )
    check('the page is cross-origin isolated', start.crossOriginIsolated === true && start.sharedArrayBuffer, {
      crossOriginIsolated: start.crossOriginIsolated,
      sharedArrayBuffer: start.sharedArrayBuffer,
      origin: start.origin,
    })
    check('no uncaught errors and no console errors at launch', first.pageErrors.length === 0 && first.consoleErrors.length === 0, {
      pageErrors: first.pageErrors,
      consoleErrors: first.consoleErrors,
    })
  }

  {
    const gpu = await first.page.evaluate(async () => {
      if (!('gpu' in navigator)) return { adapter: null }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) return { adapter: null }
      const info = adapter.info
      const device = await adapter.requestDevice()
      return {
        adapter: info
          ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }
          : null,
        features: device ? [...device.features] : [],
        maxTextureDimension2D: device?.limits.maxTextureDimension2D ?? null,
        maxStorageBufferBindingSize: device?.limits.maxStorageBufferBindingSize ?? null,
      }
    })
    observations.webgpu = gpu
    check('WebGPU adapter and device', Boolean(gpu.adapter) && Array.isArray(gpu.features), gpu)
  }

  {
    // The app carries its own FFmpeg (scripts/build-ffmpeg.sh): until 19 Nov 2026 the packaged app used whatever FFmpeg
    // was on PATH, so a Mac without one had no 10-bit masters and no native decode
    const ffmpeg = await first.app.evaluate(async ({ app }) => {
      const load = (id) => (process.mainModule ? Promise.resolve(process.mainModule.require(id)) : import(id))
      const { execFileSync } = await load('node:child_process')
      const path = await load('node:path')
      const binary = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg')
      try {
        const encoders = execFileSync(binary, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
        return {
          packaged: app.isPackaged,
          binary,
          hevcVideoToolbox: encoders.includes('hevc_videotoolbox'),
          proresKs: encoders.includes('prores_ks'),
        }
      } catch (error) {
        return { packaged: app.isPackaged, binary, error: String(error).slice(0, 200) }
      }
    })
    observations.ffmpeg = ffmpeg
    check(
      'the app carries its own FFmpeg with the Mac encoders',
      process.platform !== 'darwin' || (ffmpeg.hevcVideoToolbox === true && ffmpeg.proresKs === true),
      ffmpeg,
    )
  }

  {
    // The stabilization engine ships with the app: its module worker starts from the app's own origin, loads the wasm
    // and answers a request that needs no clip. Until 19 Nov 2026 no build carried `/gyroflow/wasm/` at all.
    const gyro = await first.page.evaluate(async () => {
      const worker = new Worker('/gyroflow/wasm/js/gyro-worker.js', { type: 'module' })
      try {
        return await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: 'no answer in 30 s' }), 30_000)
          worker.onerror = (event) => {
            clearTimeout(timer)
            resolve({ ok: false, error: event.message || 'the worker failed to start' })
          }
          worker.onmessage = (event) => {
            clearTimeout(timer)
            const methods = event.data?.result
            resolve({
              ok: Array.isArray(methods) && methods.length > 0,
              methods: Array.isArray(methods) ? methods.length : null,
              error: event.data?.error ?? null,
            })
          }
          worker.postMessage({ id: 1, type: 'smoothingMethods' })
        })
      } finally {
        worker.terminate()
      }
    })
    observations.gyroEngine = gyro
    check('the stabilization engine starts and answers', gyro.ok, gyro)
  }

  {
    const hevc = await first.page.evaluate(async () => {
      const config = { codec: 'hvc1.2.4.L153.B0', codedWidth: 3840, codedHeight: 2880 }
      try {
        const support = await VideoDecoder.isConfigSupported(config)
        return { config, supported: support.supported === true, resolved: support.config ?? null }
      } catch (error) {
        return { config, supported: false, error: String(error) }
      }
    })
    observations.hevcConfig = hevc
    check('HEVC Main 10 decode configuration is supported', hevc.supported, hevc)

    // Play clip 0020 itself: a File from an <input type=file> stays backed by the
    // disk (setInputFiles gives Chromium the path, not the bytes).
    await first.page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'droneclean-e2e-clip'
      document.body.appendChild(input)
    })
    await first.page.setInputFiles('#droneclean-e2e-clip', CLIP)
    const playback = await first.page.evaluate(async () => {
      const file = document.getElementById('droneclean-e2e-clip').files[0]
      const pathFromBridge = window.dronecleanDesktop.getPathForFile(file)
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      document.body.appendChild(video)
      const url = URL.createObjectURL(file)
      video.src = url
      try {
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true })
          video.addEventListener('error', () => reject(new Error(video.error?.message ?? 'video error')), { once: true })
          setTimeout(() => reject(new Error('metadata timeout')), 60000)
        })
        const meta = { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
        await video.play()
        const startedAt = video.currentTime
        let frames = 0
        const firstTimestamps = []
        await new Promise((resolve) => {
          const deadline = performance.now() + 3000
          const onFrame = (_now, metadata) => {
            frames += 1
            if (firstTimestamps.length < 4) firstTimestamps.push(Math.round(metadata.mediaTime * 1000) / 1000)
            if (performance.now() < deadline) video.requestVideoFrameCallback(onFrame)
            else resolve()
          }
          video.requestVideoFrameCallback(onFrame)
          setTimeout(resolve, 5000)
        })
        const advanced = video.currentTime - startedAt
        video.pause()
        return { ...meta, frames, advanced, firstTimestamps, pathFromBridge, fileSize: file.size }
      } catch (error) {
        return { error: String(error), pathFromBridge, fileSize: file.size }
      } finally {
        URL.revokeObjectURL(url)
        video.remove()
      }
    })
    observations.clipPlayback = playback
    check(
      'clip 0020 decodes and plays in a <video>',
      playback.width === 3840 && playback.height === 2880 && playback.frames >= 150 && playback.advanced > 2,
      {
        width: playback.width,
        height: playback.height,
        framesIn3Seconds: playback.frames,
        secondsAdvanced: Math.round((playback.advanced ?? 0) * 100) / 100,
        fileSize: playback.fileSize,
        firstFrameTimes: playback.firstTimestamps,
        pathFromBridge: playback.pathFromBridge,
        error: playback.error,
      },
    )
  }

  {
    const encode = await first.page.evaluate(async () => {
      const config = { codec: 'avc1.640033', width: 3840, height: 2160, bitrate: 20000000, framerate: 60 }
      const support = await VideoEncoder.isConfigSupported(config)
      if (!support.supported) return { supported: false, chunks: 0, bytes: 0 }
      const canvas = document.createElement('canvas')
      canvas.width = 3840
      canvas.height = 2160
      const context = canvas.getContext('2d')
      let chunks = 0
      let bytes = 0
      let encoderError = null
      const started = performance.now()
      const encoder = new VideoEncoder({
        output: (chunk) => {
          chunks += 1
          bytes += chunk.byteLength
        },
        error: (error) => {
          encoderError = String(error)
        },
      })
      encoder.configure(config)
      for (let index = 0; index < 60; index += 1) {
        context.fillStyle = `hsl(${(index * 6) % 360} 70% 45%)`
        context.fillRect(0, 0, 3840, 2160)
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((index * 1_000_000) / 60),
          duration: Math.round(1_000_000 / 60),
        })
        encoder.encode(frame, { keyFrame: index % 30 === 0 })
        frame.close()
      }
      await encoder.flush()
      encoder.close()
      return { supported: true, chunks, bytes, ms: Math.round(performance.now() - started), encoderError }
    })
    observations.h264 = encode
    check('H.264 encodes 60 frames at 3840x2160', encode.supported && encode.chunks > 0 && encode.bytes > 0, encode)
  }

  {
    const encode = await first.page.evaluate(async () => {
      const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }
      const support = await AudioEncoder.isConfigSupported(config)
      if (!support.supported) return { supported: false, chunks: 0, bytes: 0 }
      let chunks = 0
      let bytes = 0
      let encoderError = null
      const encoder = new AudioEncoder({
        output: (chunk) => {
          chunks += 1
          bytes += chunk.byteLength
        },
        error: (error) => {
          encoderError = String(error)
        },
      })
      encoder.configure(config)
      // One second of a 440 Hz sine in ten frames of 4800 samples.
      const samplesPerFrame = 4800
      for (let index = 0; index < 10; index += 1) {
        const samples = new Float32Array(samplesPerFrame * 2)
        for (let sample = 0; sample < samplesPerFrame; sample += 1) {
          const value = Math.sin((2 * Math.PI * 440 * (index * samplesPerFrame + sample)) / 48000) * 0.5
          samples[sample * 2] = value
          samples[sample * 2 + 1] = value
        }
        const data = new AudioData({
          format: 'f32',
          sampleRate: 48000,
          numberOfFrames: samplesPerFrame,
          numberOfChannels: 2,
          timestamp: index * 100_000,
          data: samples,
        })
        encoder.encode(data)
        data.close()
      }
      await encoder.flush()
      encoder.close()
      return { supported: true, chunks, bytes, encoderError }
    })
    observations.aac = encode
    check('AAC encodes one second at 48 kHz stereo', encode.supported && encode.chunks > 0 && encode.bytes > 0, encode)
  }

  {
    // The bridge: the interface task 1.2 reads, plus the path of a picked and of a
    // dropped file, and of a File that comes from a FileSystemFileHandle.
    await installDropProbe(first.page, 'droneclean-e2e-drop', '__e2eDrop')
    await dropFiles(first.page, 50, 50, [CLIP])
    await first.page.waitForFunction(() => window.__e2eDrop !== null, null, { timeout: 30000 })
    const bridge = await first.page.evaluate(async () => {
      const { file, handle } = window.__e2eDrop
      const fromHandle = handle && handle.kind === 'file' ? await handle.getFile() : null
      const fromInput = document.getElementById('droneclean-e2e-clip').files[0]
      const pathOf = (candidate) => {
        try {
          return window.dronecleanDesktop.getPathForFile(candidate)
        } catch (error) {
          return `threw: ${String(error)}`
        }
      }
      return {
        version: window.dronecleanDesktop.version,
        platform: window.dronecleanDesktop.platform,
        bridgeKeys: Object.keys(window.dronecleanDesktop),
        pathForInputFile: pathOf(fromInput),
        pathForDroppedFile: pathOf(file),
        pathForHandleFile: fromHandle ? pathOf(fromHandle) : 'no handle',
        handleKind: handle?.kind ?? null,
      }
    })
    observations.bridge = bridge
    await removeDropProbe(first.page, 'droneclean-e2e-drop')
    check(
      'the bridge is v1 and gives the path of disk files',
      bridge.version === 1 &&
        bridge.platform === process.platform &&
        bridge.pathForInputFile === CLIP &&
        bridge.pathForDroppedFile === CLIP &&
        bridge.bridgeKeys.sort().join(',') ===
          'exportFile,getPathForFile,mediaPaths,microphone,nativeMedia,platform,shadowSession,version',
      bridge,
    )
    check(
      'getPathForFile of a File from FileSystemFileHandle.getFile() is empty (measured)',
      bridge.pathForHandleFile === '',
      { pathForHandleFile: bridge.pathForHandleFile, handleKind: bridge.handleKind },
    )
  }

  {
    // Permissions the editor uses; Electron grants nothing the shell's policy does not allow.
    const microphone = await first.page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        const tracks = stream.getAudioTracks().length
        stream.getTracks().forEach((track) => track.stop())
        return { ok: tracks > 0, tracks }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    })
    observations.microphone = microphone
    check('microphone access (mic recording)', microphone.ok, microphone)

    const clipboard = await first.page.evaluate(async () => {
      try {
        await navigator.clipboard.writeText('droneclean-e2e-clipboard')
        const text = await navigator.clipboard.readText()
        return { ok: text === 'droneclean-e2e-clipboard', text }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    })
    observations.clipboard = clipboard
    check('clipboard write and read (copy/paste of projects)', clipboard.ok, clipboard)

  }

  {
    // The scheme has no allowServiceWorkers; the app's registration must fail harmlessly.
    const serviceWorker = await first.page.evaluate(async () => {
      try {
        await navigator.serviceWorker.register('/sw.js')
        return { registered: true }
      } catch (error) {
        return { registered: false, error: String(error) }
      }
    })
    observations.serviceWorker = serviceWorker
    check(
      'a failed service worker registration is harmless',
      serviceWorker.registered === false && first.pageErrors.length === 0,
      serviceWorker,
    )
  }

  {
    // Seed the workspace the way the app stores it, from a folder dropped on the page
    // (the pickers are native dialogs; a drop hands the page the same directory handle).
    const folderName = await seedWorkspaceFromDrop(first.page, {
      workspaceDir,
      probeId: 'droneclean-e2e-folder',
      windowKey: '__e2eDrop',
      workspaceId: 'droneclean-e2e',
      timeout: 30000,
    })
    const seeded = await first.page.evaluate(async (name) => {
      // A value that must still be there after the app is closed and opened again.
      const values = await new Promise((resolve, reject) => {
        const request = indexedDB.open('droneclean-e2e', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('values')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const nonce = `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`
      await new Promise((resolve, reject) => {
        const transaction = values.transaction('values', 'readwrite')
        transaction.objectStore('values').put(nonce, 'persisted')
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
      })
      return { name, nonce }
    }, folderName)
    observations.seeded = seeded
    check('workspace folder handle stored in the app database', seeded.name === 'workspace', { name: seeded.name })

    await first.page.reload()
    await waitForRender(first.page)
    await first.page.waitForTimeout(1500)
    const gate = await first.page.evaluate(() => ({
      newProjectLinks: document.querySelectorAll('a[href="/projects/new"]').length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120),
    }))
    observations.gate = gate
    check('the workspace opens after a page reload (no prompt, no click)', gate.newProjectLinks > 0, gate)
  }

  observations.firstLaunchErrors = {
      pageErrors: first.pageErrors,
      consoleErrors: first.consoleErrors,
      failedRequests: first.failedRequests,
    }
  await first.app.close()
  openApps.delete(first.app)

  // ── second launch: persistence and a real project ─────────────────────────
  const second = await launch()

  {
    const persistence = await second.page.evaluate(async () => {
      const values = await new Promise((resolve, reject) => {
        const request = indexedDB.open('droneclean-e2e', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const stored = await new Promise((resolve, reject) => {
        const get = values.transaction('values', 'readonly').objectStore('values').get('persisted')
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => reject(get.error)
      })
      const handles = await new Promise((resolve, reject) => {
        const request = indexedDB.open('freecut-handles-db', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const record = await new Promise((resolve, reject) => {
        const get = handles.transaction('handles', 'readonly').objectStore('handles').get('workspace:current')
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => reject(get.error)
      })
      const result = { stored, workspaceName: record?.name ?? null }
      if (record) {
        const handle = record.handle
        result.queryPermission = await handle.queryPermission({ mode: 'readwrite' })
        try {
          result.requestPermission = await handle.requestPermission({ mode: 'readwrite' })
        } catch (error) {
          result.requestPermissionError = String(error)
        }
        try {
          const fileHandle = await handle.getFileHandle('droneclean-e2e.txt')
          result.fileText = await (await fileHandle.getFile()).text()
        } catch (error) {
          result.readError = String(error)
        }
      }
      return result
    })
    observations.persistence = persistence
    check('an IndexedDB value survives a restart', /^nonce-/.test(persistence.stored ?? ''), {
      stored: persistence.stored,
    })
    check(
      'the workspace folder is readable after a restart with no prompt and no click',
      persistence.queryPermission === 'granted' &&
        persistence.fileText === 'workspace is readable after a restart\n',
      {
        queryPermission: persistence.queryPermission,
        requestPermission: persistence.requestPermission,
        fileText: persistence.fileText,
        readError: persistence.readError,
      },
    )

    // The gate opens the workspace's project list asynchronously; wait for the page
    // rather than for a fixed time.
    await second.page
      .waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, {
        timeout: 60000,
      })
      .catch(() => {})
    const gate = await second.page.evaluate(() => ({
      href: location.href,
      newProjectLinks: document.querySelectorAll('a[href="/projects/new"]').length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120),
    }))
    observations.restartGate = gate
    check('the projects page opens on a fresh launch', gate.newProjectLinks > 0, gate)
  }

  {
    // A project: new project → drop clip 0020 into the media library → drag the
    // clip to the timeline → play.
    const newProjectLinks = await second.page.evaluate(() =>
      [...document.querySelectorAll('a[href="/projects/new"]')].map((element) => ({
        text: element.textContent?.trim().slice(0, 40),
        rect: element.getBoundingClientRect().toJSON(),
      })),
    )
    observations.newProjectLinks = newProjectLinks
    let navigation = 'link'
    try {
      await second.page.locator('a[href="/projects/new"]').first().click({ timeout: 20000 })
    } catch (error) {
      // The projects page re-renders while its list loads; fall back to the route
      // itself (which also exercises the scheme's SPA fallback).
      navigation = `url after ${String(error).split('\n')[0]}`
      await second.page.goto('droneclean://app/projects/new')
    }
    await second.page.waitForURL(/\/projects\/new/, { timeout: 60000 })
    observations.projectNavigation = navigation
    await second.page.fill('#name', 'Desktop shell check')
    await second.page.locator('form button[type="submit"]').click()
    await second.page.waitForURL(/\/editor\//, { timeout: 120000 })
    await second.page.waitForTimeout(3000)
    check('a new project opens in the editor', /\/editor\//.test(second.page.url()), { href: second.page.url() })

    const panel = await mediaPanelCentre(second.page)
    if (!panel) fatal('the media library panel was not found')
    const importStarted = Date.now()
    await dropFiles(second.page, panel.x, panel.y, [projectClip])
    const projectClipName = path.basename(projectClip)
    await second.page.getByText(projectClipName, { exact: true }).first().waitFor({ timeout: 300000 })
    // The card is draggable only once the app has finished copying the file, and it
    // shows the clip's duration (0:10) only once the media has been probed — the
    // placement planner needs that duration, so wait for both.
    await second.page.waitForFunction(
      (name) => {
        const card = [...document.querySelectorAll('[data-testid="media-card"]')].find((element) =>
          element.textContent?.includes(name),
        )
        return Boolean(card) && /\d+:\d\d/.test(card.textContent ?? '')
      },
      projectClipName,
      { timeout: 300000 },
    )
    const importSeconds = Math.round((Date.now() - importStarted) / 100) / 10
    check('the clip is imported into the project by a drop', true, {
      file: projectClipName,
      secondsToReady: importSeconds,
    })

    // The first video opens "Match Project To First Video?", a modal that blocks every later drag
    // until it is answered; keep the current canvas (the shared step of the feature pass).
    observations.matchDialogBeforeDrag = await waitForMatchDialog(second.page)

    const drags = [await dragCardToTimeline(second.page, projectClipName, observations)]
    observations.drags = drags
    observations.matchDialogAfterDrag = await waitForMatchDialog(second.page)
    await second.page.waitForFunction(
      () => document.querySelectorAll('[data-timeline-item][data-item-id]').length > 0,
      null,
      { timeout: 60000 },
    )
    const timeline = await second.page.evaluate(() => ({
      clips: document.querySelectorAll('[data-timeline-item][data-item-id]').length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 140),
    }))
    observations.timeline = timeline
    check('the clip is on the timeline', timeline.clips >= 1, timeline)

    await second.page.waitForTimeout(2000)
    const before = await readTransport(second.page)
    await second.page.getByRole('button', { name: 'Play', exact: true }).first().click()
    await second.page.waitForTimeout(4000)
    const after = await readTransport(second.page)
    await second.page.getByRole('button', { name: 'Pause', exact: true }).first().click()
    observations.playback = { before, after }
    check(
      'the timeline plays clip 0020',
      after.currentFrame > before.currentFrame + 30 && before.total !== null && after.pauseButtonShown,
      {
        before: before.current,
        after: after.current,
        duration: after.total,
        framesAdvanced: after.currentFrame - before.currentFrame,
        pauseButtonWhilePlaying: after.pauseButtonShown,
      },
    )
    await second.page.screenshot({ path: path.join(artifacts, 'project.png') })
  }

  // ── the looks flow (task 5.2) and the first half of the subclips flow (task 1.6), in the same launch ─────
  const nextDownload = await routeDownloadsTo(second.app, path.join(work, 'downloads'))
  const flowResultsFrom = results.length
  await runLooksFlow({ page: second.page, check, observations, work, nextDownload })
  if (results.slice(flowResultsFrom).some((result) => !result.ok)) await dumpState(second.page, 'looks-failed')
  await createSubclipFlow({ page: second.page, check, observations, work })
  const savedSubclip = observations.subclip
  if (!savedSubclip) fatal('no subclip was made, so there is nothing to reopen')
  observations.secondLaunchErrors = {
    pageErrors: second.pageErrors,
    consoleErrors: second.consoleErrors,
    failedRequests: second.failedRequests,
  }
  await second.app.close()
  openApps.delete(second.app)

  // ── third launch: the project with the subclip, reopened after a restart ─────────────────────────────────
  const third = await launch()
  const thirdDownload = await routeDownloadsTo(third.app, path.join(work, 'downloads-third'))
  const reopenResultsFrom = results.length
  await reopenSubclipFlow({ page: third.page, check, observations, work, nextDownload: thirdDownload, savedSubclip })
  if (results.slice(reopenResultsFrom).some((result) => !result.ok)) await dumpState(third.page, 'subclips-failed')

  {
    observations.thirdLaunchErrors = {
      pageErrors: third.pageErrors,
      consoleErrors: third.consoleErrors,
      failedRequests: third.failedRequests,
    }
    // The editor logs its own console errors while a preview video is disposed
    // (`[VideoFrameExtractor] ... InputDisposedError`) and aborts blob: requests; those
    // say nothing about the shell, so they are recorded, not fatal. An uncaught error
    // is fatal everywhere.
    check(
      'no uncaught errors during the whole run',
      second.pageErrors.length === 0 && first.pageErrors.length === 0 && third.pageErrors.length === 0,
      { first: first.pageErrors, second: second.pageErrors, third: third.pageErrors },
    )
  }
}

let failure = null
try {
  await main()
} catch (error) {
  failure = error
  results.push({ name: 'run completed', ok: false, details: String(error) })
  console.error(error)
  if (lastPage) await dumpState(lastPage, 'failure')
} finally {
  for (const app of openApps) {
    try {
      await app.close()
    } catch {
      // already gone
    }
  }
}

const failures = results.filter((result) => !result.ok)
const output = {
  ok: failures.length === 0 && failure === null,
  mode: MODE,
  app: MODE === 'main' ? builtMain : testApp,
  electron: electronVersion,
  clip: CLIP,
  failed: failures.map((result) => result.name),
  checks: results,
  observations,
}
console.log('\nE2E RESULT\n' + JSON.stringify(output, null, 2))

// The throwaway profile, workspace and clip excerpt always go; the screenshots stay on a failure.
if (work) fs.rmSync(work, { recursive: true, force: true })
if (packagedProfile) fs.rmSync(packagedProfile, { recursive: true, force: true })
if (artifacts) {
  if (output.ok) fs.rmSync(artifacts, { recursive: true, force: true })
  else console.error(`artifacts kept in ${artifacts}`)
}
process.exit(output.ok ? 0 : 1)
