import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import './ui-fonts'

const moduleSource = readFileSync(resolve('src/studio/fonts/ui-fonts.ts'), 'utf8')
const appStyles = readFileSync(resolve('src/index.css'), 'utf8')

const EXPECTED_STYLESHEETS = [
  '@fontsource/ibm-plex-sans/300.css',
  '@fontsource/ibm-plex-sans/400.css',
  '@fontsource/ibm-plex-sans/500.css',
  '@fontsource/ibm-plex-sans/600.css',
  '@fontsource/ibm-plex-sans/700.css',
  '@fontsource/ibm-plex-mono/400.css',
  '@fontsource/ibm-plex-mono/500.css',
  '@fontsource/ibm-plex-mono/600.css',
]

describe('bundled interface fonts', () => {
  it('imports the IBM Plex weights the interface uses', () => {
    const imported = [...moduleSource.matchAll(/import '(@fontsource\/[^']+)'/g)].flatMap(
      (match) => (match[1] ? [match[1]] : []),
    )

    expect(imported).toEqual(EXPECTED_STYLESHEETS)
  })

  it('declares the same families src/index.css names', () => {
    for (const specifier of EXPECTED_STYLESHEETS) {
      const path = resolve('node_modules', specifier)
      expect(existsSync(path), `${specifier} is not on disk`).toBe(true)

      const stylesheet = readFileSync(path, 'utf8')
      const family = stylesheet.match(/font-family: '([^']+)'/)?.[1]

      expect(family).toBeDefined()
      expect(appStyles).toContain(`'${family}'`)
    }
  })
})
