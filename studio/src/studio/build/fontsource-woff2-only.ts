import type { Plugin } from 'vite-plus'

/**
 * Fontsource's stylesheets list every face twice:
 *
 *   src: url(./files/roboto-latin-400-normal.woff2) format('woff2'),
 *        url(./files/roboto-latin-400-normal.woff) format('woff');
 *
 * Vite resolves both URLs and emits both files, so the build carries 214.6 MiB
 * of legacy woff that no browser this app runs in ever asks for: every Chromium
 * since 36 supports woff2, and a format list is tried in order. Dropping the
 * second source before Vite resolves the URLs leaves only the woff2 file.
 */

/** The one alternative Fontsource emits after the woff2 source. */
const LEGACY_WOFF_SOURCE = /,\s*url\([^)]*?\.woff\)\s*format\(\s*['"]woff['"]\s*\)/g

const FONTSOURCE_CSS_DIR = '/node_modules/@fontsource/'

/**
 * Remove every `url(…woff) format('woff')` alternative from a Fontsource
 * stylesheet, keeping the `url(…woff2) format('woff2')` source of each face.
 * Tested through the plugin's transform, the way the build calls it.
 */
function removeLegacyWoffSources(css: string): string {
  return css.replace(LEGACY_WOFF_SOURCE, '')
}

export function fontsourceWoff2Only(): Plugin {
  return {
    name: 'droneclean-fontsource-woff2-only',
    // Before Vite's own CSS plugin turns url() into emitted assets.
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/')
      if (!normalizedId.endsWith('.css') || !normalizedId.includes(FONTSOURCE_CSS_DIR)) {
        return null
      }
      return removeLegacyWoffSources(code)
    },
  }
}
