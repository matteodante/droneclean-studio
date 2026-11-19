// Runs Gyroflow's engine, built as WebAssembly, in a Chrome worker on clip 0020 and holds it to what the node spike
// computed: gyroflow/wasm/test/reference/clip-0020.json, recorded by test/make-reference.cjs. Every hash must be
// identical (bit for bit, also after wasm-opt) and every number equal.
//
// Then it changes the settings the worker exposes - smoothing, field of view, adaptive zoom, horizon lock, lens
// profile - and checks that each one reaches the frame data, and that putting the settings back reproduces the
// reference bit for bit.
//
//   npm install                                  (in this folder, once: playwright-core)
//   GYRO_CLIP=/path/to/clip.MP4 node chrome-worker.test.mjs
//
// Without GYRO_CLIP it says it was skipped and exits 0: the clip is the maintainer's own footage, not part of the repository.
import { createServer } from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const reference = JSON.parse(await readFile(resolve(here, 'reference/clip-0020.json'), 'utf8'))

const clip = process.env.GYRO_CLIP
if (!clip) {
  console.log('skipped: set GYRO_CLIP to clip 0020 (or any clip with DJI motion data) to run the Chrome worker test')
  process.exit(0)
}

// The frame the CPU warp is compared on, decoded by ffmpeg as the reference did: a decoder in the browser would be a
// second variable. It is served to the page, which hands it to the worker.
const scratch = await mkdtemp(resolve(tmpdir(), 'gyroflow-wasm-test-'))
const framePath = resolve(scratch, `frame-${reference.warp.frame}.rgba`)
const [inW, inH] = reference.info.input
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `select=eq(n\\,${reference.warp.frame})`, '-frames:v', '1',
  '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: inW * inH * 4 + 1024 * 1024 })
if (raw.length !== inW * inH * 4) throw new Error(`expected ${inW * inH * 4} bytes of frame ${reference.warp.frame}, got ${raw.length}`)
await writeFile(framePath, raw)

const mime = (file) => ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.d.ts': 'text/plain' })[extname(file)] || 'application/octet-stream'

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (pathname === `/frame-${reference.warp.frame}.rgba`) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': raw.length })
    res.end(raw)
    return
  }
  const file = resolve(packageRoot, `.${pathname}`)
  if (!file.startsWith(packageRoot + sep)) { res.writeHead(403); res.end(); return }
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

// How much memory the Chrome processes of this run take: the browser's whole process tree, sampled while the clip is
// read. Chrome must stream the file (FileReaderSync on slices), not hold 3.7 GB of it.
const processes = () => execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command=']).toString().trim().split('\n').map((line) => {
  const [pid, ppid, rss, ...command] = line.trim().split(/\s+/)
  return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss), command: command.join(' ') }
})

// Playwright's Chrome is a child of this process, with a profile directory named `playwright_<name>dev_profile-`
const findBrowserPid = () => processes().find((p) => p.ppid === process.pid && p.command.includes('dev_profile-'))?.pid

const peakRss = (rootPid) => {
  const all = processes()
  const children = new Map()
  for (const p of all) children.set(p.ppid, [...(children.get(p.ppid) || []), p.pid])
  const rss = new Map(all.map((p) => [p.pid, p.rss]))
  const seen = new Set([rootPid])
  const queue = [rootPid]
  while (queue.length) {
    for (const child of children.get(queue.shift()) || []) if (!seen.has(child)) { seen.add(child); queue.push(child) }
  }
  return [...seen].reduce((sum, pid) => sum + (rss.get(pid) || 0), 0)
}

const withTimeout = async (promise, ms, what) => {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} s`)), ms)
    })])
  } finally {
    clearTimeout(timer)
  }
}

const problems = []
// The reference's numbers are compared exactly, as they are: hashes are bit for bit, fovs are the same doubles
const equal = (label, actual, expected) => {
  const ok = Array.isArray(expected)
    ? Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i])
    : actual === expected
  if (!ok) problems.push(`${label}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`)
}
const close = (label, actual, expected) => {
  if (!(Math.abs(actual - expected) <= Math.abs(expected) * 1e-12)) problems.push(`${label}: ${actual} is not ${expected}`)
}
const changed = (label, actual, before) => { if (actual === before) problems.push(`${label}: nothing changed`) }

let peakKb = 0
let sampler = null
let open, data, warp, settingsMs
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const browserPid = findBrowserPid()
  if (browserPid) {
    peakKb = peakRss(browserPid)
    sampler = setInterval(() => { peakKb = Math.max(peakKb, peakRss(browserPid)) }, 250)
  } else {
    console.log('note: the browser process could not be found, so its memory is not measured')
  }

  const page = await browser.newPage()
  page.on('console', (message) => { if (message.type() === 'error') console.log('page error:', message.text()) })
  page.on('pageerror', (error) => console.log('page exception:', error.message))
  await page.goto(`${origin}/test/page.html`)
  await page.waitForFunction(() => window.gyroTestReady === true)

  // The path is handed to Chrome as it is: the browser reads the file, this test never does
  await page.setInputFiles('#clip', clip)

  const send = (name, ...args) => page.evaluate(([name, args]) => window.gyroTest[name](...args), [name, args])
  const frameData = (timestampsUs) => page.evaluate((ts) => window.gyroTest.frameData(ts), timestampsUs)

  // The engine's wasm heap before a clip is opened, for the one this clip costs (design 6.3 §5.6)
  const memoryBeforeOpen = await send('memory')
  if (memoryBeforeOpen.bytes === null) problems.push('memory did not report the engine heap before open')

  open = await withTimeout(send('open'), 300_000, 'open')
  console.log(`opened ${open.info.input.join('x')} clip (${open.fileBytes} bytes) in ${Math.round(open.ms)} ms, ` +
    `${open.info.bytes_read} bytes read, ${open.info.orientations} orientations, lens ${JSON.stringify(open.info.lens)}, ` +
    `output ${open.info.output.join('x')}`)

  // The progress `open` reports while it reads (task 6.3's progress bar), and the shader assets of the clip's own lens
  // profile - both are what the editor's stabilization stage needs
  const progress = open.progress || []
  console.log(`progress: ${progress.length} reports while opening, ` +
    `${progress.filter((p) => p.phase === 'reading').length} reading, ` +
    (progress.length ? `last ${progress[progress.length - 1].bytesRead} of ${progress[progress.length - 1].fileSize} bytes` : 'none'))
  if (!progress.length) problems.push('open reported no progress')
  for (const [i, report] of progress.entries()) {
    if (typeof report.bytesRead !== 'number' || report.bytesRead <= 0) problems.push(`progress ${i}: bytesRead is ${report.bytesRead}`)
    if (report.fileSize !== open.fileBytes) problems.push(`progress ${i}: fileSize is ${report.fileSize}, not ${open.fileBytes}`)
    if (i > 0 && report.bytesRead < progress[i - 1].bytesRead) problems.push(`progress ${i}: bytesRead went backwards`)
    if (report.phase === 'reading' && report.orientations !== null) problems.push(`progress ${i}: reading reports orientations`)
    if (report.phase === 'smoothing') {
      equal('the smoothing report: orientations', report.orientations, open.info.orientations)
      equal('the smoothing report: it is the last one', i, progress.length - 1)
    }
  }
  const lastReading = progress.filter((p) => p.phase === 'reading').at(-1)
  if (lastReading && lastReading.bytesRead > open.info.bytes_read) problems.push('progress read more bytes than info().bytes_read')
  if (progress.at(-1) && progress.at(-1).bytesRead !== open.info.bytes_read) {
    problems.push(`the last progress report read ${progress.at(-1).bytesRead} bytes, info().bytes_read says ${open.info.bytes_read}`)
  }
  const memoryAfterOpen = await send('memory')
  const clipProfile = await send('lensProfile')
  if (!clipProfile || typeof clipProfile !== 'object') problems.push('lensProfile did not answer a profile object')
  const assets = await send('shaderAssets', clipProfile?.distortion_model ?? null, clipProfile?.digital_lens ?? null)
  console.log(`lens profile ${JSON.stringify(clipProfile?.name)}: model ${assets.lensModel}, kernel ${assets.kernelWgslLength} chars, ` +
    `lens functions ${assets.lensWgslLength}, ${assets.coeffsLength} coefficients (sha256 ${assets.coeffsSha256})`)
  if (!assets.kernelHasPlaceholders) problems.push('the kernel template has lost its placeholders')
  if (assets.coeffsLength !== 496) problems.push(`the coefficients table is ${assets.coeffsLength} floats, not 496`)
  equal('the coefficients table', assets.coeffsSha256, 'b03ec1a86f4833d29fbd5610066d9b57e77329dfe406053d3aa02423b0b0e1c5')
  equal('the interpolation', assets.interpolation, 2)
  if (memoryAfterOpen.bytes === null) problems.push('memory did not report the engine heap after open')
  console.log(`engine heap: ${(memoryBeforeOpen.bytes / 1e6).toFixed(1)} MB before open, ` +
    `${(memoryAfterOpen.bytes / 1e6).toFixed(1)} MB after (${((memoryAfterOpen.bytes - memoryBeforeOpen.bytes) / 1e6).toFixed(1)} MB for the clip)`)

  const timestamps = reference.frames.map((f) => f.timestamp_us)
  data = await withTimeout(frameData(timestamps), 120_000, 'frameData')
  console.log(`frameData: ${data.frames.map((f) => f.ms.toFixed(1)).join(', ')} ms per frame (engine), ` +
    `${data.ms.toFixed(1)} ms for all ${data.frames.length}, ${data.roundTripMs.toFixed(0)} ms round trip`)

  warp = await withTimeout(page.evaluate(([ts, url]) => window.gyroTest.processRgba8(ts, url),
    [reference.warp.timestamp_us, `/frame-${reference.warp.frame}.rgba`]), 300_000, 'processRgba8')
  console.log(`CPU warp of frame ${reference.warp.frame}: ${Math.round(warp.ms)} ms (engine), ` +
    `${Math.round(warp.roundTripMs)} ms round trip, ${warp.backend}`)

  // The settings: each must reach the frame data, and putting them back must reproduce the reference exactly. The
  // rotations (the matrices) depend on the smoothing and the horizon lock, the kernel parameters on the lens and the fov
  const at = reference.frames[3].timestamp_us
  const baseline = data.frames[3]
  const frame = async () => (await frameData([at])).frames[0]
  const recompute = async () => { settingsMs = (await send('recompute')).ms }

  await recompute()
  const unchanged = await frame()
  equal('a recompute with no change: matrices', unchanged.matricesSha256, baseline.matricesSha256)
  equal('a recompute with no change: kernel parameters', unchanged.paramsSha256, baseline.paramsSha256)
  equal('a recompute with no change: fov', unchanged.fov, baseline.fov)

  await send('setHorizonLock', 100, 15)
  await recompute()
  changed('setHorizonLock(100, 15)', (await frame()).matricesSha256, baseline.matricesSha256)
  await send('setHorizonLock', 0, 0)
  await recompute()
  const unlocked = await frame()
  equal('horizon lock off again: matrices', unlocked.matricesSha256, baseline.matricesSha256)
  equal('horizon lock off again: fov', unlocked.fov, baseline.fov)

  await send('setFov', 1.2)
  await recompute()
  const zoomed = await frame()
  equal('setFov(1.2) keeps the rotations', zoomed.matricesSha256, baseline.matricesSha256)
  changed('setFov(1.2)', zoomed.paramsSha256, baseline.paramsSha256)
  close('setFov(1.2): the fov is 1.2 times the reference', zoomed.fov, baseline.fov * 1.2)
  await send('setFov', 1)
  await recompute()
  const unzoomed = await frame()
  equal('fov 1 again: kernel parameters', unzoomed.paramsSha256, baseline.paramsSha256)
  equal('fov 1 again: fov', unzoomed.fov, baseline.fov)

  await send('setAdaptiveZoom', 0)
  await recompute()
  changed('setAdaptiveZoom(0)', (await frame()).fov, baseline.fov)
  await send('setAdaptiveZoom', 4)
  await recompute()
  const adaptive = await frame()
  equal('adaptive zoom 4 s again: fov', adaptive.fov, baseline.fov)
  equal('adaptive zoom 4 s again: kernel parameters', adaptive.paramsSha256, baseline.paramsSha256)

  await send('setSmoothing', 'Fixed camera', { roll: 0, pitch: 0, yaw: 0 })
  await recompute()
  changed("setSmoothing('Fixed camera')", (await frame()).matricesSha256, baseline.matricesSha256)
  await send('setSmoothing', 'Default', {})
  await recompute()
  equal("smoothing 'Default' again: matrices", (await frame()).matricesSha256, baseline.matricesSha256)
  await send('setSmoothing', 'Default', { smoothness: 0.9 })
  await recompute()
  changed("setSmoothing('Default', { smoothness: 0.9 })", (await frame()).matricesSha256, baseline.matricesSha256)
  await send('setSmoothing', 'Default', { smoothness: 0.5 })
  await recompute()
  equal('smoothness 0.5 again: matrices', (await frame()).matricesSha256, baseline.matricesSha256)

  let rejected = false
  await send('setLensProfile', 'this is not a lens profile').then(() => {}, () => { rejected = true })
  if (!rejected) problems.push('setLensProfile accepted something that is not a profile')
  // A profile as a Gyroflow file has it (a valid one: name, calibration size, camera matrix, distortion coefficients)
  const profile = {
    name: 'the test\'s own profile',
    calibrator_version: '1.5.0',
    calib_dimension: { w: 3840, h: 2880 },
    orig_dimension: { w: 3840, h: 2880 },
    fisheye_params: { camera_matrix: [[1900, 0, 1920], [0, 1900, 1440], [0, 0, 1]], distortion_coeffs: [0.1, 0.01, -0.001, 0.0001] },
  }
  await send('setLensProfile', JSON.stringify(profile))
  await recompute()
  changed('setLensProfile(a profile)', (await frame()).paramsSha256, baseline.paramsSha256)

  console.log(`settings: a recompute takes ${Math.round(settingsMs)} ms`)
  await page.evaluate(() => window.gyroTest.close())
} finally {
  if (sampler) clearInterval(sampler)
  await browser.close()
  server.close()
  await rm(scratch, { recursive: true, force: true })
}

for (const [key, expected] of Object.entries(reference.info)) equal(`info.${key}`, open.info[key], expected)
for (const [i, expected] of reference.frames.entries()) {
  const actual = data.frames[i]
  const at = `frame ${expected.frame} (${expected.timestamp_us} us)`
  equal(`${at}: frame`, actual?.frame, expected.frame)
  equal(`${at}: fov`, actual?.fov, expected.fov)
  equal(`${at}: minimal fov`, actual?.minimalFov, expected.minimal_fov)
  equal(`${at}: matrix count`, actual?.matrixCount, expected.matrix_count)
  equal(`${at}: matrix stride`, actual?.matrixStride, expected.matrix_stride)
  equal(`${at}: first matrix`, actual?.firstMatrix, expected.first_matrix)
  equal(`${at}: last matrix`, actual?.lastMatrix, expected.last_matrix)
  equal(`${at}: matrices sha256`, actual?.matricesSha256, expected.matrices_sha256)
  equal(`${at}: kernel parameters length`, actual?.paramsLength, expected.kernel_params_bytes)
  equal(`${at}: kernel parameters sha256`, actual?.paramsSha256, expected.kernel_params_sha256)
}
equal(`warp ${reference.warp.frame}: input sha256`, warp.inputSha256, reference.warp.input_sha256)
equal(`warp ${reference.warp.frame}: output sha256`, warp.outputSha256, reference.warp.output_sha256)
equal(`warp ${reference.warp.frame}: backend`, warp.backend, reference.warp.backend)
equal(`warp ${reference.warp.frame}: fov`, warp.fov, reference.warp.fov)
equal(`warp ${reference.warp.frame}: minimal fov`, warp.minimal_fov, reference.warp.minimal_fov)
equal(`warp ${reference.warp.frame}: output bytes`, warp.outputLength, reference.warp.width * reference.warp.height * 4)

console.log(`Chrome peak resident memory: ${(peakKb / 1024).toFixed(0)} MB for a ${(open.fileBytes / 1e9).toFixed(2)} GB clip ` +
  `(the browser reads it in slices: ${(open.info.bytes_read / 1e9).toFixed(2)} GB went through the engine)`)

if (problems.length) {
  console.log(`\n${problems.length} of the reference's numbers differ:`)
  for (const problem of problems) console.log('  ' + problem)
  process.exit(1)
}
console.log(`\nOK: ${reference.frames.length} frames and the CPU warp of frame ${reference.warp.frame} match the reference bit for bit, ` +
  `and the settings work`)
