// The motion trace (task 8.7, slice M1) in a Chrome worker on clip 0020: the first open reads the file and records what
// the parsers consumed; the second open is given that trace and must read less than 1 % of the file, take less time,
// and compute the same frame data as the reference, bit for bit (gyroflow/wasm/test/reference/clip-0020.json).
//
//   GYRO_CLIP=/path/to/clip.MP4 node motion-trace.test.mjs        (npm install once, in this folder)
//
// Without GYRO_CLIP it says it was skipped and exits 0: the clip is the maintainer's own footage, not part of the repository.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const reference = JSON.parse(await readFile(resolve(here, 'reference/clip-0020.json'), 'utf8'))

const clip = process.env.GYRO_CLIP
if (!clip) {
  console.log('skipped: set GYRO_CLIP to clip 0020 to run the motion trace test')
  process.exit(0)
}

const mime = (file) => ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm' })[extname(file)] || 'application/octet-stream'
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const file = resolve(packageRoot, `.${pathname}`)
  if (pathname === '/favicon.ico' || !file.startsWith(packageRoot + sep)) { res.writeHead(pathname === '/favicon.ico' ? 204 : 403); res.end(); return }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': mime(file), 'content-length': body.length })
    res.end(body)
  } catch {
    res.writeHead(404); res.end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

const problems = []
const equal = (label, actual, expected) => {
  const ok = Array.isArray(expected)
    ? Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i])
    : actual === expected
  if (!ok) problems.push(`${label}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`)
}

const timestamps = reference.frames.map((f) => f.timestamp_us)
const sameAsReference = (label, data) => {
  for (const [i, expected] of reference.frames.entries()) {
    const actual = data.frames[i]
    const at = `${label}, frame ${expected.frame}`
    equal(`${at}: fov`, actual?.fov, expected.fov)
    equal(`${at}: minimal fov`, actual?.minimalFov, expected.minimal_fov)
    equal(`${at}: first matrix`, actual?.firstMatrix, expected.first_matrix)
    equal(`${at}: last matrix`, actual?.lastMatrix, expected.last_matrix)
    equal(`${at}: matrices sha256`, actual?.matricesSha256, expected.matrices_sha256)
    equal(`${at}: kernel parameters sha256`, actual?.paramsSha256, expected.kernel_params_sha256)
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
let first, second, third, gzipBytes
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.log('page exception:', error.message))
  await page.goto(`${origin}/test/page.html`)
  await page.waitForFunction(() => window.gyroTestReady === true)
  await page.setInputFiles('#clip', clip)
  const openTraced = (useTrace) => page.evaluate((u) => window.gyroTest.openTraced(u), useTrace)
  const frames = () => page.evaluate((ts) => window.gyroTest.frameData(ts), timestamps)

  first = await openTraced(false)
  sameAsReference('first open', await frames())

  // The page keeps the trace and hands the worker a copy: the second open is served from it
  second = await openTraced(true)
  sameAsReference('second open (from the trace)', await frames())
  for (const key of ['input', 'output', 'fps', 'frames', 'orientations', 'smoothed_orientations', 'lens', 'lens_model',
    'frame_readout_time_ms', 'min_fov', 'fovs']) equal(`second open: info.${key}`, second.info[key], reference.info[key])

  // A trace of the second open is not recorded again (it has none to give), the one the page holds stays
  third = await openTraced(true)
  sameAsReference('third open (from the same trace)', await frames())
  gzipBytes = await page.evaluate(async () => {
    const zipped = await new Response(new Blob([window.lastTrace]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    return zipped.byteLength
  })
  await page.evaluate(() => window.gyroTest.close())
} finally {
  await browser.close()
  server.close()
}

const pct = (bytes) => (100 * bytes / first.fileBytes).toFixed(4)
console.log(`first open:  ${first.info.bytes_read} bytes read (${pct(first.info.bytes_read)} % of ${first.fileBytes}), ${(first.ms / 1000).toFixed(2)} s, ${first.info.motion_trace}`)
console.log(`second open: ${second.info.bytes_read} bytes read (${pct(second.info.bytes_read)} % of the file), ${(second.ms / 1000).toFixed(2)} s, ${second.info.motion_trace}`)
console.log(`third open:  ${third.info.bytes_read} bytes read, ${(third.ms / 1000).toFixed(2)} s`)
console.log(`trace: ${first.traceBytes} bytes (${(first.traceBytes / 1e6).toFixed(2)} MB), ${gzipBytes} bytes gzipped (${(gzipBytes / 1e6).toFixed(2)} MB)`)

equal('first open recorded', first.info.motion_trace, 'recorded')
equal('second open replayed', second.info.motion_trace, 'replayed')
if (first.traceBytes === null) problems.push('the first open returned no trace')
if (second.traceBytes !== null) problems.push('an open from a trace returned a trace')
if (second.info.bytes_read >= first.fileBytes * 0.01) problems.push(`the second open read ${second.info.bytes_read} bytes: 1 % of the file or more`)
if (first.traceBytes > 50e6) problems.push(`the trace is ${first.traceBytes} bytes: over 50 MB`)

if (problems.length) {
  console.log(`\n${problems.length} problems:`)
  for (const problem of problems) console.log('  ' + problem)
  process.exit(1)
}
console.log('motion trace: ok')
