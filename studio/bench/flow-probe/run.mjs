// Optical-flow slow-motion probe (design 11.12): times a WebGPU optical flow and a flow-based interpolation on real
// footage and scores them against the frames a 60 fps clip really has. Nothing here is product code.
//
//   ../scripts/heavy.sh -- node bench/flow-probe/run.mjs [--cache DIR] [--pairs 32] [--smoke]
//
// Needs the benchmark clip (BENCH_CLIP, see scripts/local-paths.env), FFmpeg, Google Chrome with a real GPU.
// Frames are decoded once to raw RGBA in the cache (about 2.3 GB at the full size); nothing enters git.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeLaunchArgs } from '../../headless/lib/cli.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const smoke = args.includes('--smoke')
const cache = path.resolve(opt('cache', path.join(os.tmpdir(), 'droneclean-flow-probe')))
const pairs = Number(opt('pairs', smoke ? 3 : 32))
const clip = process.env.BENCH_CLIP
if (!clip || !fs.existsSync(clip))
  throw new Error('set BENCH_CLIP to the benchmark clip (scripts/local-paths.env)')
fs.mkdirSync(cache, { recursive: true })

// Frame sets: a 16:9 window of the clip (3840x2880 source, cropped to 3840x2160), at 4K and scaled to 1080p.
const frames1080 = smoke ? 9 : 65
const SETS = {
  m060: { start: 60.06, n: frames1080, W: 1920, H: 1080 },
  ...(smoke
    ? {}
    : {
        m015: { start: 15, n: frames1080, W: 1920, H: 1080 },
        m085: { start: 85, n: frames1080, W: 1920, H: 1080 },
      }),
  k2160: { start: 15, n: pairs + 3, W: 3840, H: 2160 },
}

function extract(name, { start, n, W, H }) {
  const file = path.join(cache, `${name}-${n}.rgba`)
  if (fs.existsSync(file) && fs.statSync(file).size === n * W * H * 4) return file
  const scale = W === 3840 ? '' : `,scale=${W}:${H}:flags=area`
  const r = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      String(start),
      '-i',
      clip,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      String(n),
      '-vf',
      `crop=3840:2160${scale}`,
      '-pix_fmt',
      'rgba',
      '-f',
      'rawvideo',
      file,
    ],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`)
  return file
}
const files = {}
for (const [name, s] of Object.entries(SETS)) files[name] = extract(name, s)

// A tiny server: the page, the raw frames by index, and a sink for the predicted frames.
const outDir = path.join(cache, 'out')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/frame') {
    const set = SETS[url.searchParams.get('set')]
    const i = Number(url.searchParams.get('i'))
    const size = set.W * set.H * 4
    const fd = fs.openSync(files[url.searchParams.get('set')], 'r')
    const b = Buffer.alloc(size)
    fs.readSync(fd, b, 0, size, i * size)
    fs.closeSync(fd)
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(b)
  } else if (url.pathname === '/out' && req.method === 'POST') {
    const out = fs.createWriteStream(path.join(outDir, `${url.searchParams.get('name')}.rgba`), {
      flags: 'a',
    })
    req.pipe(out).on('finish', () => res.writeHead(204).end())
  } else {
    const f = path.join(HERE, url.pathname === '/' ? 'page.html' : url.pathname.slice(1))
    if (!f.startsWith(HERE) || !fs.existsSync(f)) return res.writeHead(404).end()
    res
      .writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' })
      .end(fs.readFileSync(f))
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const { chromium } = await import('playwright')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-flow-profile-'))
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  args: chromeLaunchArgs(),
})
const page = context.pages()[0] ?? (await context.newPage())
page.on(
  'console',
  (m) => ['error', 'warning'].includes(m.type()) && console.error('[page]', m.text()),
)
page.on('pageerror', (e) => console.error('[pageerror]', e.message))
await page.goto(`${base}/page.html`)
await page.waitForFunction(() => window.probeReady, null, { timeout: 30_000 })

const result = {
  date: new Date().toISOString(),
  loadAverageAtStart: os.loadavg(),
  chrome: context.browser().version(),
  clip: path.basename(clip),
  gpu: await page.evaluate(() => window.probe.init()),
  timing: [],
  quality: [],
}
if (result.gpu.isFallbackAdapter)
  throw new Error('software WebGPU adapter: the probe needs the real GPU')
console.log(
  'GPU',
  JSON.stringify(result.gpu),
  'load',
  result.loadAverageAtStart.map((x) => x.toFixed(1)).join(' '),
)

// 1 and 2: timing
const timingConfigs = [
  { set: 'm060', W: 1920, H: 1080, scale: 1 },
  { set: 'm060', W: 1920, H: 1080, scale: 2 },
  { set: 'k2160', W: 3840, H: 2160, scale: 1 },
  { set: 'k2160', W: 3840, H: 2160, scale: 2 },
  { set: 'k2160', W: 3840, H: 2160, scale: 4 },
]
for (const cfg of smoke ? timingConfigs.slice(1, 2) : timingConfigs) {
  const r = await page.evaluate((c) => window.probe.timing(c), { ...cfg, pairs })
  result.timing.push(r)
  const m = (k) => r.stagesMs[k].median.toFixed(1)
  console.log(
    `timing ${cfg.W}x${cfg.H} flow ${r.flowSize.join('x')}: pyramid ${m('pyramid')} fwd ${m('flowFwd')} bwd ${m('flowBwd')} interp ${m('interp')} whole ${m('whole')} ms (${r.levels} levels, ${r.stagesMs.whole.n} pairs)`,
  )
}

// 3: quality against the real frames
const qualityJobs = [
  ...Object.keys(SETS)
    .filter((n) => n.startsWith('m'))
    .flatMap((set) => [
      { set, gap: 2, ts: [0.5] },
      { set, gap: 4, ts: [0.25, 0.5, 0.75] },
    ]),
]
for (const j of qualityJobs) {
  const tag = `${j.set}_g${j.gap}`
  const r = await page.evaluate((c) => window.probe.quality(c), {
    ...j,
    W: 1920,
    H: 1080,
    nFrames: SETS[j.set].n,
    scales: [1, 2],
    tag,
  })
  r.job = j
  result.quality.push(r)
  console.log('quality pass done', tag, r.motion.length, 'pairs')
}
await context.close()
server.close()
fs.rmSync(profile, { recursive: true, force: true })

// Scoring with FFmpeg: PSNR and SSIM (RGB planes, 8 bit) of every predicted frame against the real one.
const FRAME = 1920 * 1080 * 4
const methods = ['nearest', 'blend', 'flow1', 'flow2']
function truthFile(job, tag) {
  const out = path.join(outDir, `${tag}_truth.rgba`)
  const set = SETS[job.set]
  const src = fs.openSync(files[job.set], 'r')
  const dst = fs.openSync(out, 'w')
  const b = Buffer.alloc(FRAME)
  let count = 0
  for (let i = 0; i + job.gap < set.n; i += job.gap)
    for (const t of job.ts) {
      fs.readSync(src, b, 0, FRAME, (i + Math.round(t * job.gap)) * FRAME)
      fs.writeSync(dst, b)
      count++
    }
  fs.closeSync(src)
  fs.closeSync(dst)
  return { out, count }
}
function score(pred, truth, stem) {
  const run = (filter, stats) =>
    spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        '1920x1080',
        '-i',
        pred,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        '1920x1080',
        '-i',
        truth,
        '-lavfi',
        `[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]${filter}=stats_file=${stats}`,
        '-f',
        'null',
        '-',
      ],
      { stdio: 'inherit' },
    )
  const ps = `${stem}.psnr.txt`
  const ss = `${stem}.ssim.txt`
  run('psnr', ps)
  run('ssim', ss)
  const psnr = fs
    .readFileSync(ps, 'utf8')
    .trim()
    .split('\n')
    .map((l) => Math.min(100, Number(/psnr_avg:(\S+)/.exec(l)[1].replace('inf', '100'))))
  const ssim = fs
    .readFileSync(ss, 'utf8')
    .trim()
    .split('\n')
    .map((l) => Number(/All:(\S+)/.exec(l)[1]))
  return { psnr, ssim }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
result.scores = {}
for (const r of result.quality) {
  const { job, tag } = r
  const truth = truthFile(job, tag)
  result.scores[tag] = { frames: truth.count, methods: {} }
  for (const m of methods) {
    const s = score(
      path.join(outDir, `${tag}_${m}.rgba`),
      truth.out,
      path.join(outDir, `${tag}_${m}`),
    )
    const worst = s.psnr.indexOf(Math.min(...s.psnr))
    result.scores[tag].methods[m] = {
      psnrMean: mean(s.psnr),
      psnrMedian: med(s.psnr),
      psnrWorst: Math.min(...s.psnr),
      ssimMean: mean(s.ssim),
      ssimWorst: Math.min(...s.ssim),
      worstIndex: worst,
      perFramePsnr: s.psnr,
      perFrameSsim: s.ssim,
    }
  }
  const o = result.scores[tag].methods
  console.log(
    tag,
    Object.entries(o)
      .map(([m, v]) => `${m} ${v.psnrMean.toFixed(2)}dB/${v.ssimMean.toFixed(4)}`)
      .join('  '),
  )
}
fs.writeFileSync(path.join(cache, 'results.json'), JSON.stringify(result, null, 2))
console.log('results:', path.join(cache, 'results.json'))
