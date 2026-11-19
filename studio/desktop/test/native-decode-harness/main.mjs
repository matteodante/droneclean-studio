/**
 * Electron main process of the native decoder's measurement harness (task 3.1, P4).
 *
 * It runs the shell's real pieces, not copies: the frame protocol from
 * `out/main/media/frame-protocol.js` (which also registers the scheme), the real
 * preload from `out/preload/index.js`, and the page `vite.config.mjs` built — over
 * the same `droneclean://app` scheme and with the same isolation headers the app
 * serves, so the page's origin, its CORS situation and its sandbox are the
 * product's.
 *
 *   electron desktop/test/native-decode-harness/main.mjs \
 *     --mode=clip --file=<clip> --start=60 --frames=600
 *   electron ... --mode=ramp --file=<ramp10.mp4> --row=1024 --frames=10
 *
 * Prints one `REPORT {json}` line with the page's measurement, the machine's load
 * average at both ends and the peak resident memory of Electron's processes, then
 * exits 0; a page error prints the same line with `error` and exits 1.
 */
import { app, BrowserWindow, protocol } from 'electron'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(new URL(import.meta.url).pathname)
const pageRoot = path.join(here, '..', '.cache', 'native-decode', 'page')
const pageFile = path.join(pageRoot, 'desktop', 'test', 'native-decode-harness', 'harness.html')

// The shell's real frame protocol (handler, IPC and the scheme's privileges) and
// the app's own scheme: one `registerSchemesAsPrivileged` call, because a second
// call replaces the first on Electron 45.
const { NATIVE_FRAME_SCHEME_PRIVILEGES, registerNativeFrameProtocol } = require('../../out/main/media/frame-protocol.js')
const { APP_SCHEME, APP_HOST, ISOLATION_HEADERS } = require('../../out/main/protocol.js')

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
  NATIVE_FRAME_SCHEME_PRIVILEGES,
])

const flag = (name, fallback) => {
  const hit = process.argv.find((argument) => argument.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const mode = flag('mode', 'clip')
const query = new URLSearchParams({ mode })
for (const name of ['file', 'start', 'frames', 'row', 'repeats', 'body', 'upload']) {
  const value = flag(name, null)
  if (value !== null) query.set(name, value)
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/** The built harness page and its assets, with the isolation headers the app sends. */
function serve(request) {
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname)
  const file =
    pathname === '/' || pathname === '/harness.html'
      ? pageFile
      : pathname.startsWith('/assets/')
        ? path.join(pageRoot, 'assets', pathname.slice('/assets/'.length))
        : null
  if (file === null || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
  return new Response(fs.readFileSync(file), {
    headers: { ...ISOLATION_HEADERS, 'Content-Type': type },
  })
}

const memory = { peak: 0 }
function sampleMemory() {
  const bytes = app
    .getAppMetrics()
    .reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0) * 1024, 0)
  if (bytes > memory.peak) memory.peak = bytes
}

const startedAt = Date.now()
const loadStart = os.loadavg()[0]

void app.whenReady().then(async () => {
  registerNativeFrameProtocol()
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })
    return serve(request)
  })

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(here, '..', '..', 'out', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  const timer = setInterval(sampleMemory, 250)
  const timeout = setTimeout(() => {
    console.error(`REPORT ${JSON.stringify({ mode, error: 'the harness timed out', loadAverage: os.loadavg() })}`)
    app.exit(1)
  }, 300_000)

  window.webContents.on('console-message', (event) => {
    const text = String(event.message ?? '')
    if (!text.startsWith('HARNESS_REPORT ')) {
      if (/error|fatal/i.test(text)) console.error(`[page] ${text}`)
      return
    }
    clearInterval(timer)
    clearTimeout(timeout)
    const page = JSON.parse(text.slice('HARNESS_REPORT '.length))
    const report = {
      ...page,
      loadAverageStart: Number(loadStart.toFixed(2)),
      loadAverageEnd: Number(os.loadavg()[0].toFixed(2)),
      loadAverages: os.loadavg().map((value) => Number(value.toFixed(2))),
      peakWorkingSetBytes: memory.peak,
      harnessSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      ffmpeg: process.env.DRONECLEAN_FFMPEG ?? 'from PATH',
    }
    console.log(`REPORT ${JSON.stringify(report)}`)
    app.exit(page.error === undefined ? 0 : 1)
  })

  await window.loadURL(`${APP_SCHEME}://${APP_HOST}/harness.html?${query.toString()}`)
})

app.on('window-all-closed', () => app.quit())
