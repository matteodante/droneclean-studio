// Vector motion blur probe (design 9.2): times per-pixel vector blur on real 3840x2880 frames of the benchmark clip
// and writes stills and contact sheets to look at, with each method's distance from a reference made of many
// flow-interpolated frames. Nothing here is product code.
//
//   ../scripts/heavy.sh -- node bench/blur-probe/run.mjs [--cache DIR] [--pairs 16] [--smoke]
//
// Needs the benchmark clip (BENCH_CLIP, see scripts/local-paths.env), FFmpeg, Google Chrome with a real GPU. Frames
// are decoded once to raw RGBA8 in the cache (44 MB each); nothing enters git. Uses the flow probe's kernels.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeLaunchArgs } from '../../headless/lib/cli.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.dirname(HERE)
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const smoke = args.includes('--smoke')
const cache = path.resolve(opt('cache', path.join(os.tmpdir(), 'droneclean-blur-probe')))
const pairs = Number(opt('pairs', smoke ? 3 : 16))
const clip = process.env.BENCH_CLIP
if (!clip || !fs.existsSync(clip)) throw new Error('set BENCH_CLIP to the benchmark clip (scripts/local-paths.env)')
fs.mkdirSync(cache, { recursive: true })

const W = 3840
const H = 2880
const FRAME = W * H * 4
/** Flow at a quarter of the frame (960x720), as the editor measures it above twice a 1080p frame */
const SCALE = 4
/** Tiles of 12 flow pixels: 48 frame pixels */
const TILE = 12
const SETS = {
  k15: { start: 15, n: pairs + 4 },
  ...(smoke ? {} : { s15: { start: 15, n: 8 }, s60: { start: 60.06, n: 8 }, s85: { start: 85, n: 8 }, s90: { start: 90, n: 8 } }),
}
// --sets s15,s85 keeps only those still sections
const only = opt('sets', null)
if (only) for (const name of Object.keys(SETS)) if (name.startsWith('s') && !only.split(',').includes(name)) delete SETS[name]
if (smoke) SETS.s15 = { start: 15, n: 8 }

function extract(name, { start, n }) {
  const file = path.join(cache, `${name}-${n}.rgba`)
  if (fs.existsSync(file) && fs.statSync(file).size === n * FRAME) return file
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-i', clip, '-fps_mode', 'passthrough', '-frames:v', String(n), '-pix_fmt', 'rgba', '-f', 'rawvideo', file], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`)
  return file
}
const files = {}
for (const [name, s] of Object.entries(SETS)) files[name] = extract(name, s)

const outDir = path.join(cache, 'out')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/frame') {
    const name = url.searchParams.get('set')
    const i = Number(url.searchParams.get('i'))
    const fd = fs.openSync(files[name], 'r')
    const b = Buffer.alloc(FRAME)
    fs.readSync(fd, b, 0, FRAME, i * FRAME)
    fs.closeSync(fd)
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(b)
  } else if (url.pathname === '/out' && req.method === 'POST') {
    const out = fs.createWriteStream(path.join(outDir, `${url.searchParams.get('name')}.rgba`))
    req.pipe(out).on('finish', () => res.writeHead(204).end())
  } else {
    const rel = url.pathname === '/' ? 'blur-probe/page.html' : url.pathname.slice(1)
    const f = path.join(BENCH, rel)
    const allowed = f.startsWith(path.join(BENCH, 'blur-probe')) || f.startsWith(path.join(BENCH, 'flow-probe'))
    if (!allowed || !fs.existsSync(f)) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }).end(fs.readFileSync(f))
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const { chromium } = await import('playwright')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-blur-profile-'))
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, args: chromeLaunchArgs() })
const page = context.pages()[0] ?? (await context.newPage())
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.error('[page]', m.text()))
page.on('pageerror', (e) => console.error('[pageerror]', e.message))
page.setDefaultTimeout(600_000)
await page.goto(`${base}/blur-probe/page.html`)
await page.waitForFunction(() => window.probeReady, null, { timeout: 30_000 })

const result = {
  date: new Date().toISOString(),
  loadAverageAtStart: os.loadavg(),
  chrome: context.browser().version(),
  clip: path.basename(clip),
  frame: [W, H],
  flowScale: SCALE,
  tileFlowPixels: TILE,
  gpu: await page.evaluate(() => window.probe.init()),
  timing: null,
  stills: [],
}
if (result.gpu.isFallbackAdapter) throw new Error('software WebGPU adapter: the probe needs the real GPU')
console.log('GPU', JSON.stringify(result.gpu), 'load', result.loadAverageAtStart.map((x) => x.toFixed(1)).join(' '))

result.timing = await page.evaluate((c) => window.probe.timing(c), { set: 'k15', W, H, scale: SCALE, T: TILE, pairs })
for (const [k, s] of Object.entries(result.timing.stagesMs)) console.log(`timing ${k}: ${s.median.toFixed(2)} ms (min ${s.min.toFixed(2)}, max ${s.max.toFixed(2)}, n ${s.n})`)
for (const m of result.timing.motionPerFrame) console.log(`motion frame ${m.frame}: mean ${m.meanPx.toFixed(1)} p95 ${m.p95Px.toFixed(1)} max ${m.maxPx.toFixed(1)} px`)

const stillSets = Object.keys(SETS).filter((n) => n.startsWith('s'))
for (const set of stillSets) {
  const r = await page.evaluate((c) => window.probe.stills(c), { set, W, H, scale: SCALE, T: TILE, tag: set })
  result.stills.push(r)
  console.log('stills', set, JSON.stringify(r.motion))
}
await context.close()
server.close()
fs.rmSync(profile, { recursive: true, force: true })

// --- Scores and sheets ---------------------------------------------------------------------------------------------

const read = (tag, name) => fs.readFileSync(path.join(outDir, `${tag}_${name}.rgba`))
const BORDER = 48
/** PSNR (dB) of the RGB code values of two RGBA8 frames, the border left out */
function psnr(a, b) {
  let se = 0
  let n = 0
  for (let y = BORDER; y < H - BORDER; y++) {
    for (let x = BORDER; x < W - BORDER; x++) {
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        const d = a[i + c] - b[i + c]
        se += d * d
      }
      n += 3
    }
  }
  return 10 * Math.log10((255 * 255) / (se / n))
}
/** The 960x720 cell (of a 4x4 grid) where two frames differ most */
function busiestCell(a, b) {
  let best = { x: 0, y: 0, d: -1 }
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      let d = 0
      for (let y = cy * 720; y < (cy + 1) * 720; y += 4) {
        for (let x = cx * 960; x < (cx + 1) * 960; x += 4) {
          const i = (y * W + x) * 4
          d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
        }
      }
      if (d > best.d) best = { x: cx * 960, y: cy * 720, d }
    }
  }
  return best
}

result.scores = {}
for (const set of stillSets) {
  const s = {}
  for (const deg of [180, 360]) {
    const ref = read(set, `ref${deg}`)
    s[`1x ${deg}`] = Object.fromEntries(['frame', `line${deg}`, `two${deg}`, `recon${deg}`, `preview${deg}`, `light${deg}`].map((m) => [m, psnr(read(set, m), ref)]))
  }
  const ref4 = read(set, 'ref4')
  s['4x 360'] = Object.fromEntries(['blend4', 'vfill4two', 'vfill4recon'].map((m) => [m, psnr(read(set, m), ref4)]))
  result.scores[set] = s
  console.log('scores', set, JSON.stringify(s, (_key, v) => (typeof v === 'number' ? Number(v.toFixed(2)) : v)))

  // Contact sheets at 1:1, the cell where today's 4x blend is furthest from the reference
  const cell = busiestCell(read(set, 'blend4'), ref4)
  const sheet = (name, row) => {
    const inputs = row.flatMap((m) => ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', path.join(outDir, `${set}_${m}.rgba`)])
    const crops = row.map((_, i) => `[${i}]crop=960:720:${cell.x}:${cell.y},format=rgb24[c${i}]`).join(';')
    const stack = `${row.map((_, i) => `[c${i}]`).join('')}hstack=inputs=${row.length}`
    const out = path.join(cache, `sheet-${set}-${name}.png`)
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${crops};${stack}`, '-frames:v', '1', out], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`sheet ${set} ${name}`)
    return out
  }
  result.scores[set].sheetCell = { x: cell.x, y: cell.y }
  result.scores[set].sheets = {
    '1x-180 (frame, one line, two halves, two halves + edges, preview, reference)': sheet('1x-180', ['frame', 'line180', 'two180', 'recon180', 'preview180', 'ref180']),
    '1x-360 (frame, one line, two halves, two halves + edges, preview, reference)': sheet('1x-360', ['frame', 'line360', 'two360', 'recon360', 'preview360', 'ref360']),
    'look (frame, 90, 180, 270, 360 degrees, two halves + edges)': sheet('look', ['frame', 'recon90', 'recon180', 'recon270', 'recon360']),
    '4x-360 (today blend, vector fill two halves, vector fill + edges, reference)': sheet('4x-360', ['blend4', 'vfill4two', 'vfill4recon', 'ref4']),
  }
}
fs.writeFileSync(path.join(cache, 'results.json'), JSON.stringify(result, null, 2))
console.log('results', path.join(cache, 'results.json'))
