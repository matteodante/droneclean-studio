/**
 * Electron main process of the native 10-bit path's measurements (design 3.6 slice 7). It runs the shell's real
 * pieces, not copies: the frame and encode protocols from `desktop/out/main/media/` (handlers, IPC, privileges), the
 * real preload, and the page `vite.config.mjs` built, on the app's own `droneclean://app` scheme with the app's
 * isolation headers.
 *
 *   electron bench/native/main.mjs --mode=export --allow=<folder>,<folder> --grant=<output file> --out=<run folder> \
 *     --query=<the page's query string>
 *
 * `--allow` names the media folders the decoder may open (the media registry's grant), `--grant` the output files the
 * encoder may write (the save dialog's grant). `POST /__harness/save/<name>` writes a body into `--out`. Prints one
 * `REPORT {json}` line: the page's measurement, the load average, the peak working set of Electron's processes and
 * of the FFmpeg processes it started, and the CPU each Electron process used.
 */
import { app, BrowserWindow, protocol } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(new URL(import.meta.url).pathname)
const desktopOut = path.join(here, '..', '..', 'desktop', 'out')
const pageRoot = path.join(here, '..', '.cache', 'native-page')
const pageFile = path.join(pageRoot, 'bench', 'native', 'harness.html')

const frameProtocol = require(path.join(desktopOut, 'main', 'media', 'frame-protocol.js'))
const encodeProtocol = require(path.join(desktopOut, 'main', 'media', 'encode-protocol.js'))
const { OutputGrants } = require(path.join(desktopOut, 'main', 'media', 'output-file.js'))
const { MediaPathAccess } = require(path.join(desktopOut, 'main', 'media.js'))
const { APP_SCHEME, APP_HOST, ISOLATION_HEADERS } = require(path.join(desktopOut, 'main', 'protocol.js'))

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
  },
  frameProtocol.NATIVE_FRAME_SCHEME_PRIVILEGES,
  encodeProtocol.NATIVE_ENCODE_SCHEME_PRIVILEGES,
])

const flag = (name, fallback = null) => {
  const hit = process.argv.find((argument) => argument.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const mode = flag('mode', 'export')
const outDir = flag('out')
const query = flag('query', '')
const allow = (flag('allow', '') ?? '').split(',').filter(Boolean)
const grants = (flag('grant', '') ?? '').split(',').filter(Boolean)
const timeoutMs = Number(flag('timeout', '600000'))

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

async function serve(request) {
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname)
  if (pathname.startsWith('/__harness/save/') && request.method === 'POST') {
    const name = path.basename(pathname)
    fs.writeFileSync(path.join(outDir, name), Buffer.from(await request.arrayBuffer()))
    return new Response('saved', { headers: ISOLATION_HEADERS })
  }
  const file =
    pathname === '/' || pathname === '/harness.html'
      ? pageFile
      : pathname.startsWith('/assets/')
        ? path.join(pageRoot, 'assets', pathname.slice('/assets/'.length))
        : null
  if (file === null || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
  return new Response(fs.readFileSync(file), { headers: { ...ISOLATION_HEADERS, 'Content-Type': type } })
}

const memory = { electron: 0, ffmpeg: 0, total: 0 }
function sampleMemory() {
  const metrics = app.getAppMetrics()
  cpu.samples += 1
  for (const metric of metrics) {
    cpu.byType[metric.type] = (cpu.byType[metric.type] ?? 0) + (metric.cpu?.percentCPUUsage ?? 0)
  }
  const electronBytes = metrics.reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0) * 1024, 0)
  memory.electron = Math.max(memory.electron, electronBytes)
  // Asynchronous: the main process carries both streams, and a blocking `ps` would stall them.
  execFile('ps', ['-axo', 'ppid=,rss=,comm='], { encoding: 'utf8' }, (error, stdout) => {
    if (error) return
    let ffmpegBytes = 0
    for (const row of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row)
      if (match && Number(match[1]) === process.pid && /ffmpeg/.test(match[3])) ffmpegBytes += Number(match[2]) * 1024
    }
    memory.ffmpeg = Math.max(memory.ffmpeg, ffmpegBytes)
    memory.total = Math.max(memory.total, electronBytes + ffmpegBytes)
  })
}

/**
 * The main process's event loop, probed: a 20 ms timer's lateness. The loop carries both streams' bytes (the decode
 * pump, the readback body, FFmpeg's stdin), so a late timer says it is the leg that waits.
 */
const lag = { samples: 0, sum: 0, max: 0, over10: 0 }
let lagExpected = 0
function probeLag() {
  const now = performance.now()
  if (lagExpected > 0) {
    const late = Math.max(0, now - lagExpected)
    lag.samples += 1
    lag.sum += late
    lag.max = Math.max(lag.max, late)
    if (late > 10) lag.over10 += 1
  }
  lagExpected = now + 20
}

const startedAt = Date.now()
const loadStart = os.loadavg()[0]
/** Per Electron process type, the CPU it used (percent of one core), summed over the samples, and the sample count. */
const cpu = { samples: 0, byType: {} }

void app.whenReady().then(async () => {
  const media = new MediaPathAccess()
  await media.allow(allow)
  const outputGrants = new OutputGrants()
  for (const file of grants) outputGrants.grant(file)
  frameProtocol.registerNativeFrameProtocol(media)
  encodeProtocol.registerNativeEncodeProtocol(outputGrants)
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
      preload: path.join(desktopOut, 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  const timer = setInterval(sampleMemory, 1000)
  const lagTimer = setInterval(probeLag, 20)
  const timeout = setTimeout(() => {
    console.log(`REPORT ${JSON.stringify({ mode, error: 'the harness timed out', loadAverage: os.loadavg() })}`)
    app.exit(1)
  }, timeoutMs)

  window.webContents.on('console-message', (event) => {
    const text = String(event.message ?? '')
    if (!text.startsWith('HARNESS_REPORT ')) {
      console.error(`[page] ${text}`)
      return
    }
    clearInterval(timer)
    clearInterval(lagTimer)
    clearTimeout(timeout)
    sampleMemory()
    const page = JSON.parse(text.slice('HARNESS_REPORT '.length))
    const report = {
      ...page,
      loadAverageStart: Number(loadStart.toFixed(2)),
      loadAverageEnd: Number(os.loadavg()[0].toFixed(2)),
      peakWorkingSetBytes: memory,
      mainLoopLatenessMs: {
        mean: Number((lag.sum / Math.max(1, lag.samples)).toFixed(2)),
        max: Number(lag.max.toFixed(1)),
        shareOver10ms: Number((lag.over10 / Math.max(1, lag.samples)).toFixed(3)),
      },
      // The CPU each Electron process used, averaged over the run (all its threads), as `app.getAppMetrics` reports it
      // (Electron divides by the number of cores: 10 on this Mac).
      cpuPercentByProcess: Object.fromEntries(
        Object.entries(cpu.byType).map(([type, sum]) => [type, Number((sum / Math.max(1, cpu.samples - 1)).toFixed(1))]),
      ),
      harnessSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      ffmpeg: process.env.DRONECLEAN_FFMPEG ?? 'from PATH',
    }
    console.log(`REPORT ${JSON.stringify(report)}`)
    app.exit(page.error === undefined ? 0 : 1)
  })

  await window.loadURL(`${APP_SCHEME}://${APP_HOST}/harness.html?${query}`)
})

app.on('window-all-closed', () => app.quit())
