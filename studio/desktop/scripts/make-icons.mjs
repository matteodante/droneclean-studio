// Regenerates resources/icon.icns (macOS) and resources/icon.ico (Windows) from
// ../public/brand/app-icon.svg. macOS only (Google Chrome, sips, iconutil).
// Usage: node scripts/make-icons.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const svgPath = join(here, '../../public/brand/app-icon.svg')
const outDir = join(here, '../resources')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const work = mkdtempSync(join(tmpdir(), 'dc-icon-'))

try {
  // The brand square, shrunk to the 824 px body of Apple's icon grid and given its
  // rounded corners, on a transparent 1024 px canvas.
  const svg = readFileSync(svgPath, 'utf8')
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
.i{position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:185px;overflow:hidden}
.i svg{width:824px;height:824px;display:block}</style><div class="i">${svg}</div>`
  const htmlPath = join(work, 'icon.html')
  const master = join(work, 'master.png')
  writeFileSync(htmlPath, html)
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', '--window-size=1024,1024',
    `--screenshot=${master}`, `file://${htmlPath}`,
  ], { stdio: 'ignore' })

  const resize = (px, out) => execFileSync('sips', ['-z', String(px), String(px), master, '--out', out], { stdio: 'ignore' })

  const iconset = join(work, 'icon.iconset')
  mkdirSync(iconset)
  for (const s of [16, 32, 128, 256, 512]) {
    resize(s, join(iconset, `icon_${s}x${s}.png`))
    resize(s * 2, join(iconset, `icon_${s}x${s}@2x.png`))
  }
  mkdirSync(outDir, { recursive: true })
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(outDir, 'icon.icns')])

  // .ico: PNG-compressed entries.
  const sizes = [16, 32, 48, 64, 128, 256]
  const pngs = sizes.map((s) => {
    const p = join(work, `ico-${s}.png`)
    resize(s, p)
    return readFileSync(p)
  })
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    head[e] = s === 256 ? 0 : s
    head[e + 1] = s === 256 ? 0 : s
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(pngs[i].length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([head, ...pngs]))
} finally {
  rmSync(work, { recursive: true, force: true })
}
