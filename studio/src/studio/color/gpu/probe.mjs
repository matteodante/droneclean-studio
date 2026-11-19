// The probe for 5.1c's colour stage: the input colour pass and the look pass on this Mac's GPU,
// against the CPU references of `src/studio/color` — `transform()` for the input pass,
// `sampleTetrahedral()` and `sampleTetrahedralFloat32()` for the look pass.
//
//   node src/studio/color/gpu/probe.mjs [out.json]
//
// No footage: the inputs are a synthetic 10-bit ramp and a 65³ table generated from the transform
// itself, so the run repeats anywhere. Nothing is written into the repository: the record goes to
// the system's temporary folder.
//
// The targets, which the run checks and fails on (design 5.1 §5 and slice 5.1c's "done when"):
//
//   (a) the input pass, all 1024 codes written as `code/1023` in rgba16float, against
//       `transform()`: max difference under 1 level of 1023 for D-Log M and D-Log (the half-float
//       input's own storage is reported beside it). The bench ramp 64…940 keeps 857 distinct
//       levels, 0 non-monotone steps and a largest step of 2 levels of 1023 for D-Log M (§5 M7).
//   (b) the look pass on a generated 65³ table: the table's own half-float storage is the design's
//       0.079 mean / 0.243 max levels of 1023 (§5 M6), and the stage stays within that plus one
//       half-float step of its own output. Against `sampleTetrahedralFloat32` on the same
//       half-float table every value is within one half-float step, which is the shader's
//       arithmetic: this Chrome/Metal stores an rgba16float target by truncating toward zero (the
//       store counts in the record), so the output's step is one level of 1023 at worst.
//   (c) profile 'none' on rgba16float: every half-float bit identical.
//
// It also checks the 8-bit target (today's preview, within one 8-bit code), a combined `.cube`
// with a 1D shaper, the refusals a running pass makes, and what each pass costs a 4K frame.
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname, loadavg, tmpdir } from 'node:os'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const say = (line) => process.stdout.write(`${line}\n`)

// The design's numbers (5.1 §5 M6, M7) and the slice's own targets
const MAX_INPUT_LEVELS = 1
const DISTINCT_LEVELS = 857
const MAX_STEP_LEVELS = 2
// The design's table storage (5.1 §5 M6: 0.079 mean / 0.243 max on its own sample set) and what
// the stage may add on top of it: the output's own half-float step (one level of 1023 at worst)
const LOOK_TABLE_MEAN = 0.08
const LOOK_TABLE_MAX = 0.3
const LOOK_TOTAL_MEAN = 0.079 + 0.25
const LOOK_TOTAL_MAX = 0.243 + 1
const LOOK_STEP_MAX = 1
const SHAPED_MAX_LEVELS = 2
const EIGHT_BIT_MAX_CODES = 1

const scratch = join(tmpdir(), 'opencode', 'color-gpu-probe')
await mkdir(scratch, { recursive: true })
const outPath = process.argv[2] || join(scratch, 'probe.json')

// The passes are TypeScript: probe-page.ts (and the colour modules it imports) is bundled for the
// page by esbuild, which is what Vite builds the editor with
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

const pagePath = '/studio/src/studio/color/gpu/probe-page.html'
const pageHtml = await readFile(join(here, 'probe-page.html'))
const server = createServer((req, res) => {
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
  if (pathname === pagePath) {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': pageHtml.length })
    res.end(pageHtml)
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
  res.writeHead(404)
  res.end()
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
  task: '5.1c colour stage',
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
  await page.waitForFunction(() => window.colourProbeReady === true)

  const call = (name, ...args) =>
    page.evaluate(([name, args]) => window.colourProbe[name](...args), [name, args])

  const info = await call('info')
  record.info = info
  say(
    `WebGPU: ${info.adapter.vendor} / ${info.adapter.architecture} / ${info.adapter.description}; ` +
      `3D textures up to ${info.limits.maxTextureDimension3D}`,
  )

  // (a) The input pass on every 10-bit code, both profiles
  record.inputRamps = {}
  for (const profile of ['dlog-m', 'dlog']) {
    const ramp = await withTimeout(call('inputRamp', profile), 120_000, `inputRamp ${profile}`)
    record.inputRamps[profile] = ramp
    say(
      `${profile}: signed ${ramp.signed.min.toFixed(3)}..${ramp.signed.max.toFixed(3)} (${ramp.signed.positive} positive of ${ramp.signed.samples}); 1024 codes, ${ramp.stored.max.toFixed(3)} levels max against transform() of the ` +
        `stored code (mean ${ramp.stored.mean.toFixed(3)}), ${ramp.exact.max.toFixed(3)} against ` +
        `the exact code; the half-float input alone moves a code by up to ` +
        `${ramp.inputStorageMax.toFixed(3)} levels`,
    )
    if (!(ramp.stored.max < MAX_INPUT_LEVELS)) {
      problems.push(`${profile} differs from transform() by ${ramp.stored.max.toFixed(3)} levels`)
    }
  }

  // (a) The bench ramp's shape
  record.benchRamps = {}
  for (const profile of ['dlog-m', 'dlog']) {
    const bench = await withTimeout(call('benchRamp', profile), 120_000, `benchRamp ${profile}`)
    record.benchRamps[profile] = bench
    say(
      `${profile} on the 877-code bench ramp: ${bench.distinct} distinct levels ` +
        `(the CPU transform: ${bench.distinctCpu}), ${bench.nonMonotone} non-monotone steps, ` +
        `largest step ${bench.maxStep} levels of 1023 (the CPU transform: ${bench.maxStepCpu})`,
    )
    if (profile === 'dlog-m') {
      if (bench.distinct < DISTINCT_LEVELS) {
        problems.push(
          `the bench ramp keeps ${bench.distinct} distinct levels, under ${DISTINCT_LEVELS}`,
        )
      }
      if (bench.nonMonotone !== 0) {
        problems.push(`the bench ramp has ${bench.nonMonotone} non-monotone steps`)
      }
      if (bench.maxStep > MAX_STEP_LEVELS) {
        problems.push(`the bench ramp's largest step is ${bench.maxStep} levels of 1023`)
      }
    } else if (bench.nonMonotone !== 0) {
      problems.push(`D-Log's bench ramp has ${bench.nonMonotone} non-monotone steps`)
    }
  }

  // (a) The 8-bit target today's preview renders into
  record.inputEightBit = {}
  for (const profile of ['dlog-m', 'dlog']) {
    const eight = await withTimeout(
      call('inputEightBit', profile),
      120_000,
      `inputEightBit ${profile}`,
    )
    record.inputEightBit[profile] = eight
    say(
      `${profile} in 8 bits: ${eight.meanByteDifference.toFixed(3)} codes mean, ` +
        `${eight.maxByteDifference} max, ${eight.codesOffByMoreThanHalf} codes off by more than half`,
    )
    if (!(eight.maxByteDifference <= EIGHT_BIT_MAX_CODES)) {
      problems.push(
        `${profile}'s 8-bit target is ${eight.maxByteDifference} codes from the reference`,
      )
    }
  }

  // (c) The identity
  const identity = await withTimeout(call('identity'), 120_000, 'identity')
  record.identity = identity
  say(
    `'none' on rgba16float: ${identity.differing} of ${identity.channels} half-float values differ ` +
      `over ${identity.texels} texels`,
  )
  if (identity.differing !== 0) {
    problems.push(`'none' is not bit-exact: ${identity.differing} values differ`)
  }

  // (b) The look pass on a generated 65³ table
  const look = await withTimeout(call('look'), 300_000, 'look')
  record.look = look
  say(
    `look, 65³ (${look.tableBytes} bytes, generated in ${Math.round(look.tableMs)} ms, uploaded ` +
      `in ${look.uploadMs.toFixed(1)} ms): ${look.samples} samples. The table's own half-float ` +
      `storage: mean ${look.cpu.texels.mean.toFixed(4)} / max ${look.cpu.texels.max.toFixed(4)} ` +
      `levels of 1023 (the design's 0.079 / 0.243, §5 M6); interpolated, ${look.cpu.tableOnly.mean.toFixed(4)} / ` +
      `${look.cpu.tableOnly.max.toFixed(4)}. The stage against sampleTetrahedral: mean ` +
      `${look.total.mean.toFixed(4)} / max ${look.total.max.toFixed(4)}, against the float32 twin ` +
      `mean ${look.versusTwin.mean.toFixed(4)} / max ${look.versusTwin.max.toFixed(4)} ` +
      `(store: ${look.store.rounded} rounded, ${look.store.truncated} truncated, ` +
      `${look.store.neither} neither, signed mean ${look.store.signedMean.toFixed(4)})`,
  )
  if (!(look.cpu.texels.mean <= LOOK_TABLE_MEAN)) {
    problems.push(`the table's texel storage mean is ${look.cpu.texels.mean.toFixed(4)} levels`)
  }
  if (!(look.cpu.texels.max <= LOOK_TABLE_MAX)) {
    problems.push(`the table's texel storage max is ${look.cpu.texels.max.toFixed(4)} levels`)
  }
  if (!(look.total.mean <= LOOK_TOTAL_MEAN)) {
    problems.push(`the look's total mean is ${look.total.mean.toFixed(4)} levels`)
  }
  if (!(look.total.max <= LOOK_TOTAL_MAX)) {
    problems.push(`the look's total max is ${look.total.max.toFixed(4)} levels`)
  }
  if (!(look.versusTwin.max <= LOOK_STEP_MAX)) {
    problems.push(
      `the look is ${look.versusTwin.max.toFixed(4)} levels from its float32 twin, over one step`,
    )
  }
  if (look.store.neither > look.samples * 3 * 0.001) {
    problems.push(`${look.store.neither} look values are not a half-float store of the twin`)
  }

  // The 1D shaper of a combined .cube
  const shaped = await withTimeout(call('shapedLook'), 300_000, 'shapedLook')
  record.shapedLook = shaped
  say(
    `a combined 33³ table behind a 17-entry shaper: ${shaped.samples} samples, against ` +
      `sampleTetrahedral mean ${shaped.total.mean.toFixed(4)} / max ${shaped.total.max.toFixed(4)} ` +
      `levels; against the float32 twin mean ${shaped.versusTwin.mean.toFixed(4)} / max ` +
      `${shaped.versusTwin.max.toFixed(4)}`,
  )
  if (!(shaped.total.max <= SHAPED_MAX_LEVELS)) {
    problems.push(`the shaped look's max is ${shaped.total.max.toFixed(4)} levels`)
  }

  // A look's lifetime
  const lifecycle = await withTimeout(call('lookLifecycle'), 120_000, 'lookLifecycle')
  record.lookLifecycle = lifecycle
  say(
    `a look's lifetime: set and drawn (${lifecycle.first}), removed (${lifecycle.removed.slice(0, 60)}...), ` +
      `set again and drawn (${lifecycle.second}), stage destroyed`,
  )
  if (lifecycle.first !== 'drawn' || lifecycle.second !== 'drawn') {
    problems.push('a look could not be drawn after setLook')
  }
  if (!/is not loaded/.test(lifecycle.removed)) {
    problems.push('a removed look was still drawn')
  }

  // The refusals a running pass makes
  const rejects = await withTimeout(call('rejects'), 120_000, 'rejects')
  record.rejects = rejects
  for (const [name, message] of Object.entries(rejects)) {
    say(`refusal ${name}: ${message}`)
  }
  for (const [name, expected] of [
    ['unknownLook', /is not loaded/],
    ['shaperOnlyFile', /no LUT_3D_SIZE/],
    ['intensityAboveOne', /0 to 1/],
  ]) {
    if (!expected.test(rejects[name] ?? '')) problems.push(`refusal ${name} did not fire`)
  }

  // What each pass costs a 4K frame
  const timing = await withTimeout(call('timing'), 300_000, 'timing')
  record.timing = timing
  say(
    `4K (${timing.width}x${timing.height}), ${timing.frames} draws, no readback: ` +
      `input ${timing.input.rgba16float.toFixed(2)} ms/frame rgba16float, ` +
      `${timing.input.rgba8unorm.toFixed(2)} ms rgba8unorm; look ` +
      `${timing.look.rgba16float.toFixed(2)} ms rgba16float, ` +
      `${timing.look.rgba8unorm.toFixed(2)} ms rgba8unorm`,
  )

  // Any WebGPU validation error the page recorded fails the run
  const gpuErrors = await call('errors')
  record.gpuErrors = gpuErrors.errors
  if (gpuErrors.errors.length > 0) {
    for (const message of gpuErrors.errors) say(`GPU error: ${message}`)
    problems.push(`${gpuErrors.errors.length} WebGPU errors were reported`)
  }
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
  `\nOK: the input pass is ${record.inputRamps['dlog-m'].stored.max.toFixed(3)} levels from ` +
    `transform(), 'none' is bit-exact, the look's total is ${record.look.total.mean.toFixed(3)} / ` +
    `${record.look.total.max.toFixed(3)} levels (table storage ` +
    `${record.look.cpu.texels.mean.toFixed(3)} / ${record.look.cpu.texels.max.toFixed(3)}), ` +
    `${record.timing.input.rgba16float.toFixed(2)} + ${record.timing.look.rgba16float.toFixed(2)} ms ` +
    `per 4K frame`,
)
