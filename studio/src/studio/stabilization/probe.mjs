// The probe for task 6.3's stage (design 6.3 slice B): the stabilization stage this folder ships, on frame 1000 of
// clip 0020, against the module's own CPU warp - the reference frame Gyroflow's engine computes. The stage is the
// product's, not a prototype: the same `stage.ts` the renderer will draw with, assembled from the assets the wasm
// module's `shaderAssets` returns.
//
//   GYRO_CLIP=/path/to/clip.MP4 node src/studio/stabilization/probe.mjs [out.json]
//
// Without GYRO_CLIP it says it was skipped and exits 0: the clip is footage, never part of the repository. It reads
// the clip only through Chrome (`setInputFiles`), needs ffmpeg on `PATH` and `playwright`, and the wasm package built
// (`gyroflow/wasm/build.sh`). Nothing is written into the repository: the frame and the record go to the system's
// temporary folder.
//
// The target is 45 dB (design 6.3 §5.2 measured 52.84 dB for the prototype's port in rgba16float). Under it, the run
// fails.
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname, loadavg, tmpdir } from 'node:os'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const studioRoot = resolve(here, '../../..')
const root = resolve(studioRoot, '..')
const say = (line) => process.stdout.write(`${line}\n`)

const clip = process.env.GYRO_CLIP
if (!clip) {
  say(
    'skipped: set GYRO_CLIP to clip 0020 (or any clip with DJI motion data) to run the stage probe',
  )
  process.exit(0)
}
if (!(await readFile(join(root, 'gyroflow/wasm/pkg/gyroflow_wasm.js')).catch(() => null))) {
  say('the wasm package is not built: run gyroflow/wasm/build.sh first')
  process.exit(1)
}

const scratch = join(tmpdir(), 'opencode', 'gyro-stage-probe')
await mkdir(scratch, { recursive: true })
const outPath = process.argv[2] || join(scratch, 'stage.json')
const TARGET_PSNR_DB = 45

// The frame the CPU warp is compared on, and its presentation time: the numbers the module's reference recorded for
// clip 0020 (gyroflow/wasm/test/reference/clip-0020.json), so the frame identity is checked, not assumed
const reference = JSON.parse(
  await readFile(join(root, 'gyroflow/wasm/test/reference/clip-0020.json'), 'utf8'),
)
const [inWidth, inHeight] = reference.info.input
const FRAME = reference.warp.frame
const timestampUs = reference.warp.timestamp_us

// The frame, decoded by ffmpeg as gyroflow/wasm/test/make-reference.cjs does: its SHA-256 is in the reference, so a
// wrong decode cannot pass unnoticed
const raw = execFileSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-i',
    clip,
    '-vf',
    `select=eq(n\\,${FRAME})`,
    '-frames:v',
    '1',
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  ],
  { maxBuffer: inWidth * inHeight * 4 + 1024 * 1024 },
)
if (raw.length !== inWidth * inHeight * 4)
  throw new Error(`expected a ${inWidth}x${inHeight} RGBA frame, got ${raw.length} bytes`)
say(`frame ${FRAME} (${timestampUs} us): ${raw.length} bytes decoded by ffmpeg`)

// The stage is TypeScript: probe-page.ts (and stage.ts, kernel.ts) is bundled for the page by esbuild, which is what
// Vite builds the editor with (pinned in package.json's overrides)
const bundle = await build({
  entryPoints: [join(here, 'probe-page.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  write: false,
  logLevel: 'silent',
})
const pageScript = bundle.outputFiles[0].text

const mime = (file) =>
  ({
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.wgsl': 'text/plain',
  })[extname(file)] || 'application/octet-stream'

const pagePath = '/studio/src/studio/stabilization/probe-page.html'
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (pathname === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }
  if (pathname === '/') {
    res.writeHead(302, { location: pagePath })
    res.end()
    return
  }
  if (pathname === '/frame.rgba') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': raw.length })
    res.end(raw)
    return
  }
  if (pathname === '/probe-page.js') {
    res.writeHead(200, {
      'content-type': 'text/javascript',
      'content-length': Buffer.byteLength(pageScript),
    })
    res.end(pageScript)
    return
  }
  const file = resolve(root, `.${pathname}`)
  if (!file.startsWith(root + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': mime(file), 'content-length': body.length })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

const withTimeout = async (promise, ms, what) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} did not finish within ${ms / 1000} s`)),
          ms,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const record = {
  task: '6.3 stage',
  clip,
  frame: FRAME,
  timestampUs,
  when: new Date().toISOString(),
  machine: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim(),
  host: hostname(),
  loadAverage: loadavg(),
  chrome: null,
}
const problems = []

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu'],
})
try {
  record.chrome = browser.version()
  const page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') say(`page error: ${message.text()}`)
  })
  page.on('pageerror', (error) => say(`page exception: ${error.message}`))
  await page.goto(`${origin}${pagePath}`)
  await page.waitForFunction(() => window.stageProbeReady === true)
  await page.setInputFiles('#clip', clip)

  const call = (name, ...args) =>
    page.evaluate(([name, args]) => window.stageProbe[name](...args), [name, args])

  const open = await withTimeout(call('open'), 300_000, 'open')
  record.open = open
  say(
    `opened ${open.info.input.join('x')} in ${Math.round(open.ms)} ms, ${open.info.bytes_read} bytes read, ` +
      `${open.info.orientations} orientations, lens ${JSON.stringify(open.info.lens)}, output ${open.info.output.join('x')}, ` +
      `model ${open.lensModel}`,
  )
  if (open.info.input[0] !== inWidth || open.info.input[1] !== inHeight) {
    problems.push(
      `the clip is ${open.info.input.join('x')}, not the ${inWidth}x${inHeight} frame the reference names`,
    )
  }

  const frameData = await withTimeout(call('frameData', timestampUs), 120_000, 'frameData')
  record.frameData = frameData
  say(
    `frameData(${timestampUs}): engine frame ${frameData.frame}, fov ${frameData.fov.toFixed(6)}, ` +
      `${frameData.matrixCount} matrices (${frameData.matricesBytes} bytes) + ${frameData.paramsBytes} param bytes, ` +
      `${frameData.ms.toFixed(1)} ms; kernel ${frameData.kernel.width}x${frameData.kernel.height} -> ` +
      `${frameData.kernel.outputWidth}x${frameData.kernel.outputHeight}, ${frameData.kernel.matrixCount} matrices, ` +
      `interpolation ${frameData.kernel.interpolation}, max_pixel_value ${frameData.kernel.maxPixelValue}`,
  )

  const frame = await call('fetchFrame', '/frame.rgba')
  say(
    `the frame the comparison is on: ${frame.bytes} bytes, sha256 ${frame.sha256.slice(0, 16)}...` +
      (frame.sha256 === reference.warp.input_sha256
        ? " (the reference's frame)"
        : ` (not the reference's frame: ${reference.warp.input_sha256.slice(0, 16)}...)`),
  )
  if (frame.sha256 !== reference.warp.input_sha256)
    problems.push(
      "the decoded frame is not the reference's: the comparison is not on clip 0020's frame 1000",
    )

  const cpu = await withTimeout(call('cpuWarp', timestampUs), 600_000, 'processRgba8')
  record.cpuWarp = cpu
  say(
    `CPU warp: ${Math.round(cpu.ms)} ms, ${cpu.backend}, output sha256 ${cpu.outputSha256.slice(0, 16)}...` +
      (cpu.outputSha256 === reference.warp.output_sha256
        ? " (the reference's warp)"
        : " (not the reference's warp)"),
  )
  if (cpu.outputSha256 !== reference.warp.output_sha256)
    problems.push("the CPU warp is not the reference's output")

  // The stage, at the format the precise path renders to and at today's 8-bit one
  record.warps = {}
  for (const format of ['rgba16float', 'rgba8unorm']) {
    const warp = await withTimeout(
      call('warpWithStage', format),
      120_000,
      `warpWithStage ${format}`,
    )
    const comparison = await call('compare')
    record.warps[format] = { ...warp, ...comparison }
    say(
      `${format}: ${comparison.psnrDb.toFixed(2)} dB, rms ${comparison.rms.toFixed(3)} levels, max ${comparison.maxDifference}, ` +
        `${(comparison.share * 100).toFixed(2)}% of pixels differ, warp ${warp.ms.toFixed(1)} ms with readback (${warp.readbackMs.toFixed(0)} ms)`,
    )
    if (!(comparison.psnrDb >= TARGET_PSNR_DB))
      problems.push(`${format} is ${comparison.psnrDb.toFixed(2)} dB, under ${TARGET_PSNR_DB}`)
  }

  // What a frame costs the renderer: 20 draws back to back, each with its frame data re-uploaded
  const timing = await withTimeout(call('timeOnGpu', 'rgba16float', 20), 300_000, 'timeOnGpu')
  record.timing = timing
  say(
    `the stage's cost: ${timing.msPerFrame.toFixed(2)} ms per frame over ${timing.frames} frames ` +
      `(rgba16float, the matrices uploaded every frame)`,
  )

  // The transforms must assemble and compile for every lens model, not just this clip's
  const poly3 = await withTimeout(call('compileModel', 'poly3'), 120_000, 'compileModel poly3')
  record.compileModel = poly3
  say(
    `assembled and compiled another lens model (${poly3.lensModel}) in ${Math.round(poly3.ms)} ms`,
  )

  await call('close')
} finally {
  await browser.close()
  server.close()
}

record.loadAverageAfter = loadavg()
await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`)
say(`load average ${record.loadAverage.map((value) => value.toFixed(2)).join(' / ')}`)
say(`wrote ${outPath}`)

if (problems.length) {
  say(`\n${problems.length} of the probe's checks failed:`)
  for (const problem of problems) say(`  - ${problem}`)
  process.exit(1)
}
say(
  `\nOK: the stage is ${record.warps.rgba16float.psnrDb.toFixed(2)} dB against the module's CPU warp ` +
    `(target ${TARGET_PSNR_DB}), ${record.timing.msPerFrame.toFixed(2)} ms per frame`,
)
