import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import type { Plugin } from 'vite-plus'
import { fontsourceWoff2Only } from './fontsource-woff2-only'

/**
 * Run the plugin's transform hook the way the build does. The hook is declared
 * as Vite's `ObjectHook`, which a test cannot call without narrowing it.
 */
function transform(css: string, id: string): string | null {
  const plugin: Plugin = fontsourceWoff2Only()
  const hook = plugin.transform as ((code: string, id: string) => string | null) | undefined
  if (typeof hook !== 'function') {
    throw new Error('the plugin has no transform hook')
  }
  return hook.call({} as never, css, id)
}

// Fontsource's own stylesheet, as Vite loads it.
const FONTSOURCE_CSS = readFileSync(resolve('node_modules/@fontsource/roboto/400.css'), 'utf8')

describe('fontsourceWoff2Only', () => {
  it('keeps every woff2 source of a Fontsource stylesheet and drops every woff one', () => {
    const result = transform(FONTSOURCE_CSS, '/repo/node_modules/@fontsource/roboto/400.css')
    expect(result).not.toBeNull()
    const rewritten = result ?? ''

    expect(FONTSOURCE_CSS.match(/format\('woff2'\)/g)).not.toHaveLength(0)
    expect(rewritten.match(/format\('woff2'\)/g)).toHaveLength(
      FONTSOURCE_CSS.match(/format\('woff2'\)/g)?.length ?? 0,
    )
    expect(rewritten).not.toMatch(/format\('woff'\)/)
    expect(rewritten).not.toMatch(/\.woff\)/)
    expect(rewritten).toContain("url(./files/roboto-latin-400-normal.woff2) format('woff2')")
  })

  it('leaves a stylesheet outside Fontsource untouched', () => {
    const css = '@font-face { src: url(./app.woff2) format("woff2"), url(./app.woff) format("woff"); }'
    expect(transform(css, '/repo/src/styles/app.css')).toBeNull()
    expect(transform(css, '/repo/node_modules/some-package/styles.css')).toBeNull()
  })
})
