import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { FONT_CATALOG } from '@/shared/typography/font-catalog'
import { CATALOG_FONT_SOURCES } from './catalog-fonts'

const mapSource = readFileSync(resolve('src/studio/fonts/catalog-fonts.ts'), 'utf8')

describe('bundled catalogue fonts', () => {
  it('covers every catalogue family and weight, and nothing outside it', () => {
    const catalogueFamilies = new Set<string>()

    for (const entry of FONT_CATALOG) {
      catalogueFamilies.add(entry.value)
      const bundled = CATALOG_FONT_SOURCES.get(entry.value)

      expect(bundled, `${entry.value} has no bundled stylesheet`).toBeDefined()
      expect(bundled?.cssFamily, `${entry.value} declares another CSS family`).toBe(entry.family)
      expect([...(bundled?.weights.keys() ?? [])].sort((a, b) => a - b)).toEqual([...entry.weights])
    }

    const stray = [...CATALOG_FONT_SOURCES.keys()].filter((font) => !catalogueFamilies.has(font))
    expect(stray).toEqual([])
  })

  it('imports an existing Fontsource stylesheet for every weight it declares', () => {
    const declared = [...CATALOG_FONT_SOURCES.values()].reduce(
      (count, source) => count + source.weights.size,
      0,
    )
    const imported = [...mapSource.matchAll(/import\('(@fontsource\/[^']+)'\)/g)].flatMap(
      (match) => (match[1] ? [match[1]] : []),
    )

    expect(imported).toHaveLength(declared)
    expect(new Set(imported).size).toBe(imported.length)
    for (const specifier of imported) {
      expect(existsSync(resolve('node_modules', specifier)), `${specifier} is not on disk`).toBe(
        true,
      )
    }
  })

  it('never points at a font host', () => {
    expect(mapSource).not.toMatch(/https?:\/\//)
    expect(mapSource).not.toMatch(/googleapis|gstatic/)
  })
})
