import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

const AMBER = '#FFB938'
const INK = '#0B0F17'
const ICONS = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-maskable-512.png', 512],
] as const
const BRAND_FILES = [
  'mark-on-dark.svg',
  'mark-small-on-dark.svg',
  'wordmark-on-dark.svg',
  'app-icon.svg',
] as const

const read = (path: string) => readFileSync(path, 'utf8')
const pathData = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1])

describe('DroneClean brand assets', () => {
  it('names the app DroneClean Studio and asks no third-party origin for fonts', () => {
    const html = read('index.html')
    expect(html).toContain('<title>DroneClean Studio</title>')
    expect(html).toContain('<meta name="application-name" content="DroneClean Studio" />')
    expect(html).not.toContain('fonts.googleapis.com')
    expect(html).not.toContain('fonts.gstatic.com')
    expect(html).not.toContain('FreeCut')

    const headless = read('headless.html')
    expect(headless).toContain('<title>DroneClean Studio Headless Render Harness</title>')
    expect(headless).not.toContain('FreeCut')
  })

  it('is not a web app: no manifest, no service worker', () => {
    expect(existsSync('public/manifest.webmanifest')).toBe(false)
    expect(existsSync('public/sw.js')).toBe(false)
    expect(read('index.html')).not.toContain('rel="manifest"')
    for (const [path] of ICONS) expect(readFileSync(path).length).toBeGreaterThan(0)
  })

  it('ships the DroneClean favicon and icon PNGs at their sizes', () => {
    const favicon = read('public/favicon.svg')
    expect(favicon).toContain(AMBER)
    expect(favicon).toContain(INK)

    for (const [path, size] of ICONS) {
      const png = readFileSync(path)
      expect(png.subarray(1, 4).toString('ascii'), path).toBe('PNG')
      expect(png.readUInt32BE(16), `${path} width`).toBe(size)
      expect(png.readUInt32BE(20), `${path} height`).toBe(size)
    }
  })

  it('inlines the same geometry as the brand files under public/brand', () => {
    const component = read('src/studio/brand/droneclean-logo.tsx')

    for (const file of BRAND_FILES) {
      const paths = pathData(read(`public/brand/${file}`))
      expect(paths.length, file).toBeGreaterThan(0)
      for (const d of paths) expect(component, `${file} path`).toContain(d)
    }
  })
})
