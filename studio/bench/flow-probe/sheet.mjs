// Contact sheet of the worst frame of one method (design 11.12), from the cache of run.mjs.
//   node bench/flow-probe/sheet.mjs --cache DIR --tag m015_g4 --method blend [--a blend --b flow1] [--frame K]
// Row 1: the real frame, method a, method b. Row 2: the nearest frame, |a - real| x4, |b - real| x4. `--a` and `--b`
// (design 11.24) compare two other methods; `--frame` picks a frame instead of the worst of `--method`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (n, def) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : def)
const cache = path.resolve(opt('cache'))
const tag = opt('tag')
const method = opt('method')
const results = JSON.parse(fs.readFileSync(path.join(cache, 'results.json'), 'utf8'))
const methodA = opt('a', 'blend')
const methodB = opt('b', 'flow1')
const k = opt('frame') !== undefined ? Number(opt('frame')) : results.scores[tag].methods[method].worstIndex
const FRAME = 1920 * 1080 * 4
const slice = (name) => {
  const src = path.join(cache, 'out', `${tag}_${name}.rgba`)
  const dst = path.join(cache, 'out', `sheet-${tag}-${name}-${k}.rgba`)
  const fd = fs.openSync(src, 'r')
  const b = Buffer.alloc(FRAME)
  fs.readSync(fd, b, 0, FRAME, k * FRAME)
  fs.closeSync(fd)
  fs.writeFileSync(dst, b)
  return dst
}
const names = ['truth', methodA, methodB, 'nearest']
const files = names.map(slice)
const inputs = files.flatMap((f) => [
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgba',
  '-s',
  '1920x1080',
  '-i',
  f,
])
const small = (i, o) => `[${i}]scale=640:360:flags=area,format=rgb24[${o}]`
const diff = (i, o) =>
  `[${i}][0]blend=all_mode=difference,lutrgb=r='clip(val*4,0,255)':g='clip(val*4,0,255)':b='clip(val*4,0,255)',scale=640:360:flags=area,format=rgb24[${o}]`
const filter = [
  small(0, 't'),
  small(1, 'b'),
  small(2, 'f'),
  small(3, 'n'),
  diff(1, 'db'),
  diff(2, 'df'),
  '[t][b][f]hstack=3[r1]',
  '[n][db][df]hstack=3[r2]',
  '[r1][r2]vstack=2[out]',
].join(';')
const out = path.join(cache, `sheet_${tag}_${opt('frame') !== undefined ? `frame${k}` : `worst-of-${method}`}_${methodA}-vs-${methodB}.png`)
const r = spawnSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-frames:v',
    '1',
    out,
  ],
  { stdio: 'inherit' },
)
for (const f of files) fs.rmSync(f)
if (r.status !== 0) process.exit(1)
const m = results.scores[tag].methods
console.log(
  out,
  `frame ${k}: ${methodA} ${m[methodA].perFramePsnr[k].toFixed(2)} dB, ${methodB} ${m[methodB].perFramePsnr[k].toFixed(2)} dB, nearest ${m.nearest.perFramePsnr[k].toFixed(2)} dB`,
)
