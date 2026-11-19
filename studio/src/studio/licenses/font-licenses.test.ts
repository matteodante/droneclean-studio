import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { FONT_CATALOG } from '@/shared/typography/font-catalog'
import { FONT_LICENSES } from './font-licenses'

interface FontsourceMetadata {
  family: string
  license?: { type?: string; attribution?: string }
}

function metadataOf(slug: string): FontsourceMetadata {
  return JSON.parse(readFileSync(resolve('node_modules/@fontsource', slug, 'metadata.json'), 'utf8'))
}

/** The Fontsource packages a module imports. */
function slugsOf(file: string): string[] {
  const source = readFileSync(resolve(file), 'utf8')
  return [...source.matchAll(/@fontsource\/([a-z0-9-]+)\//g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  )
}

const INTERFACE_SOURCES = 'src/studio/fonts/ui-fonts.ts'
const bundledFamilies = new Set([
  ...FONT_CATALOG.map((font) => font.family),
  ...slugsOf(INTERFACE_SOURCES).map((slug) => metadataOf(slug).family),
])
const listedFamilies = FONT_LICENSES.map((font) => font.family)
/** Every bundled package, by the family its metadata declares. */
const packages = new Map(
  [...slugsOf('src/studio/fonts/catalog-fonts.ts'), ...slugsOf(INTERFACE_SOURCES)].map((slug) => [
    metadataOf(slug).family,
    slug,
  ]),
)

describe('FONT_LICENSES', () => {
  it('lists every bundled family, and only bundled families', () => {
    expect(new Set(listedFamilies)).toEqual(bundledFamilies)
    expect(listedFamilies).toHaveLength(bundledFamilies.size)
  })

  it('gives every family a licence, a copyright notice and a source', () => {
    for (const font of FONT_LICENSES) {
      expect(['OFL-1.1', 'Apache-2.0', 'UFL-1.0']).toContain(font.license)
      expect(['http:', 'https:']).toContain(new URL(font.url).protocol)
    }
  })

  it('links IBM Plex to its project repository, which its notice does not name', () => {
    for (const family of ['IBM Plex Mono', 'IBM Plex Sans']) {
      expect(FONT_LICENSES.find((font) => font.family === family)?.url).toBe(
        'https://github.com/IBM/plex',
      )
    }
  })

  it('takes every notice from the package that ships the font', () => {
    for (const font of FONT_LICENSES) {
      const slug = packages.get(font.family)
      if (!slug) throw new Error(`${font.family} is not a bundled package`)

      const licence = readFileSync(resolve('node_modules/@fontsource', slug, 'LICENSE'), 'utf8')
      const lines = licence
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line !== '')
      const attribution = (metadataOf(slug).license?.attribution ?? '').replace(/\s+/g, ' ').trim()

      expect([...lines, attribution]).toContain(font.copyright)
    }
  })
})
