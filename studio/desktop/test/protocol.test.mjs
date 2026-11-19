/**
 * Unit tests of the request mapping of `droneclean://app/` (main/protocol.ts).
 *
 * The traversal cases are the point: none of them may resolve to a file, and the
 * handler adds a realpath check against symlinks on top of these decisions.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_URL,
  ISOLATION_HEADERS,
  contentTypeOf,
  extensionOf,
  isPathInside,
  mapRequestUrl,
} from '../out/main/protocol.js'

const file = (url) => {
  const mapping = mapRequestUrl(url)
  assert.equal(mapping.kind, 'file', `${url} should map to a file, got ${JSON.stringify(mapping)}`)
  return mapping
}

const rejected = (url, reason) => {
  const mapping = mapRequestUrl(url)
  assert.equal(mapping.kind, 'rejected', `${url} should be rejected, got ${JSON.stringify(mapping)}`)
  assert.equal(mapping.reason, reason)
}

test('the app opens on the projects page', () => {
  assert.equal(APP_URL, 'droneclean://app/projects')
})

test('every response carries the isolation headers', () => {
  assert.deepEqual(ISOLATION_HEADERS, {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
})

test('the root and extension-less routes serve the SPA entry', () => {
  for (const url of [
    'droneclean://app/',
    'droneclean://app/projects',
    'droneclean://app/projects/new',
    'droneclean://app/projects/abc123',
    'droneclean://app/editor/abc123',
    'droneclean://app/docs',
    'droneclean://app/docs/getting-started',
    'droneclean://app/changelog',
    'droneclean://app/projects/',
  ]) {
    const mapping = file(url)
    assert.equal(mapping.relativePath, 'index.html', url)
    assert.equal(mapping.contentType, 'text/html; charset=utf-8', url)
  }
})

test('files of the build keep their type', () => {
  const cases = [
    ['droneclean://app/index.html', 'index.html', 'text/html; charset=utf-8'],
    ['droneclean://app/assets/index-abc123.js', 'assets/index-abc123.js', 'text/javascript; charset=utf-8'],
    ['droneclean://app/assets/worker-abc123.mjs', 'assets/worker-abc123.mjs', 'text/javascript; charset=utf-8'],
    ['droneclean://app/assets/index-abc123.css', 'assets/index-abc123.css', 'text/css; charset=utf-8'],
    ['droneclean://app/assets/index-abc123.js.map', 'assets/index-abc123.js.map', 'application/json; charset=utf-8'],
    ['droneclean://app/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['droneclean://app/sw.js', 'sw.js', 'text/javascript; charset=utf-8'],
    ['droneclean://app/moss-tts/moss_tts.worker.js', 'moss-tts/moss_tts.worker.js', 'text/javascript; charset=utf-8'],
    ['droneclean://app/assets/ort-wasm-simd-threaded.jsep.wasm', 'assets/ort-wasm-simd-threaded.jsep.wasm', 'application/wasm'],
    ['droneclean://app/favicon.svg', 'favicon.svg', 'image/svg+xml'],
    ['droneclean://app/icons/icon-192.png', 'icons/icon-192.png', 'image/png'],
    ['droneclean://app/assets/font.woff2', 'assets/font.woff2', 'font/woff2'],
    ['droneclean://app/assets/data.json', 'assets/data.json', 'application/json; charset=utf-8'],
  ]
  for (const [url, relativePath, contentType] of cases) {
    const mapping = file(url)
    assert.equal(mapping.relativePath, relativePath, url)
    assert.equal(mapping.contentType, contentType, url)
  }
})

test('a file name is judged by its last segment only', () => {
  assert.equal(extensionOf('assets/index-abc123.js'), '.js')
  assert.equal(extensionOf('index.html'), '.html')
  assert.equal(extensionOf('assets/LICENSE'), '')
  assert.equal(extensionOf('assets/.hidden'), '')
  assert.equal(extensionOf('assets/index-abc123.JS'), '.js')
  assert.equal(extensionOf('projects/abc.123'), '.123')
})

test('an unknown extension is not guessed', () => {
  assert.equal(contentTypeOf('assets/blob.xyz'), 'application/octet-stream')
  assert.equal(contentTypeOf('no-extension-at-all'), 'application/octet-stream')
})

test('a query string or a hash does not change the file', () => {
  assert.equal(file('droneclean://app/assets/index-abc123.js?v=2').relativePath, 'assets/index-abc123.js')
  assert.equal(file('droneclean://app/projects?tab=trash').relativePath, 'index.html')
})

test('a plain traversal is normalised away by the URL parser and never leaves the folder', () => {
  // The WHATWG parser collapses `.` and `..` in a standard URL before the handler
  // sees it, so these become the SPA entry instead of a path of their own.
  for (const url of [
    'droneclean://app/../etc/passwd',
    'droneclean://app/assets/../../etc/passwd',
    'droneclean://app/assets/..',
    'droneclean://app/./index.html',
    'droneclean://app//etc/passwd',
    // The URL parser treats an encoded dot segment as a dot segment too.
    'droneclean://app/%2e%2e/etc/passwd',
    'droneclean://app/assets/%2E%2E/%2E%2E/etc/passwd',
  ]) {
    const mapping = file(url)
    assert.equal(mapping.relativePath, 'index.html', url)
  }
})

test('a traversal hidden behind an encoded separator is refused', () => {
  // `%2F` is not a separator while the URL is parsed, so the parser does not see a
  // dot segment; the mapping decodes first and then refuses the `..` it finds.
  rejected('droneclean://app/%2E%2E%2Fetc%2Fpasswd', 'path-traversal')
  rejected('droneclean://app/assets/..%2F..%2Fetc%2Fpasswd', 'path-traversal')
  rejected('droneclean://app/assets/%2e%2e%2fapp.js', 'path-traversal')
})

test('another host, another scheme, a broken URL or a broken escape is refused', () => {
  rejected('droneclean://other/index.html', 'wrong-host')
  rejected('droneclean://app:1234/index.html', 'wrong-host')
  rejected('https://app/index.html', 'wrong-scheme')
  rejected('not a url', 'unparsable-url')
  rejected('droneclean://app/assets/a%zz.js', 'malformed-escape')
  rejected('droneclean://app/index.html%00.js', 'nul-byte')
})

test('a backslash cannot become a separator', () => {
  rejected('droneclean://app/assets\\..\\..\\etc\\passwd', 'backslash')
  rejected('droneclean://app/assets/a%5Cb.js', 'backslash')
})

test('a colon is refused, so no drive letter or stream name survives', () => {
  rejected('droneclean://app/C:/Windows/System32/calc.exe', 'colon')
  rejected('droneclean://app/assets/file.txt:stream', 'colon')
})

test('an encoded separator is a separator, and the result stays below dist/', () => {
  assert.equal(file('droneclean://app/assets%2Fapp.js').relativePath, 'assets/app.js')
  assert.equal(file('droneclean://app/assets//app.js').relativePath, 'assets/app.js')
})

test('isPathInside is a strict, separator-aware prefix check', () => {
  assert.equal(isPathInside('/app/dist', '/app/dist/assets/a.js'), true)
  assert.equal(isPathInside('/app/dist', '/app/dist/index.html'), true)
  assert.equal(isPathInside('/app/dist', '/app/dist'), false)
  assert.equal(isPathInside('/app/dist', '/app/dist-other/a.js'), false)
  assert.equal(isPathInside('/app/dist', '/app/other/a.js'), false)
  assert.equal(isPathInside('/app/dist', '/etc/passwd'), false)
  assert.equal(isPathInside('/app/dist/', '/app/dist/a.js'), true)
})
