#!/usr/bin/env node
// The web build lives under /studio/: `npm run build:web` (STUDIO_BASE_PATH=/studio/) into dist-web/.
//
//   node checks/web-base.mjs [--skip-build] [--dist <dir>]
//
// Serves dist-web/ under /studio/ the way the static server in web/ does (cross-origin isolation headers, a
// single-page fallback for unknown paths under /studio/), opens it in headless Chrome and checks that:
//   - /studio/ loads, is cross-origin isolated, `window.studio` exists, the router matched the base;
//   - the deep link /studio/projects loads (the fallback answers index.html) and renders;
//   - the stabilization worker (gyroflow/wasm/js/gyro-worker.js, under the base) answers `smoothingMethods`;
//   - the service worker installs under /studio/ with the scope /studio/ and caches the shell files under it;
//   - not one request went to a path outside /studio/ (a root-absolute URL the build did not follow).
// Exits non-zero on the first failure and names it.
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeLaunchArgs } from '../headless/lib/cli.mjs'

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = '/studio/'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function fail(message) {
  console.error(`web-base FAILED: ${message}`)
  process.exitCode = 1
}

/** Serves `dist` under /studio/; every request path is recorded, so one outside the base can be named. */
function startServer(dist) {
  const requested = []
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    requested.push(pathname)
    const headers = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    }
    if (!pathname.startsWith(BASE)) {
      response.writeHead(404, headers).end('outside the base')
      return
    }
    const relative = pathname.slice(BASE.length)
    let file = path.join(dist, relative)
    const inside = file.startsWith(dist + path.sep) || file === dist
    const isFile = inside && fs.existsSync(file) && fs.statSync(file).isFile()
    if (!isFile) {
      // The single-page fallback: a route (no extension) answers index.html, a missing file is a 404
      if (path.extname(relative) !== '') {
        response.writeHead(404, headers).end('not found')
        return
      }
      file = path.join(dist, 'index.html')
    }
    response.writeHead(200, {
      ...headers,
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    })
    fs.createReadStream(file).pipe(response)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requested, port: server.address().port }))
  })
}

async function main() {
  const distArg = argValue('--dist', 'dist-web')
  const dist = path.resolve(STUDIO, distArg)
  if (!process.argv.includes('--skip-build')) {
    const build = spawnSync('npm', ['run', 'build:web'], { cwd: STUDIO, stdio: 'inherit' })
    if (build.status !== 0) {
      fail('npm run build:web failed')
      return
    }
  }
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    fail(`${distArg}/index.html is missing: run npm run build:web`)
    return
  }
  const { server, requested, port } = await startServer(dist)
  const origin = `http://127.0.0.1:${port}`
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeLaunchArgs() })
  try {
    const page = await (await browser.newContext()).newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(`${origin}${BASE}`, { waitUntil: 'load' })
    await page.waitForFunction(() => 'studio' in window, null, { timeout: 30_000 })
    const root = await page.evaluate(() => ({
      isolated: window.crossOriginIsolated,
      studio: typeof window.studio,
      path: window.location.pathname,
      text: document.body.innerText.trim().length,
    }))
    if (!root.isolated) fail('/studio/ is not cross-origin isolated')
    if (root.studio !== 'object') fail('window.studio is missing')
    if (root.path !== BASE) fail(`the router moved / to ${root.path}`)
    if (root.text === 0) fail('/studio/ rendered no text')
    console.log(`/studio/: isolated=${root.isolated} window.studio=${root.studio} text=${root.text} chars`)

    await page.goto(`${origin}${BASE}projects`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, {
      timeout: 30_000,
    })
    const deep = await page.evaluate(() => ({
      path: window.location.pathname,
      text: document.body.innerText.trim().slice(0, 80),
      studio: typeof window.studio,
    }))
    if (deep.path !== `${BASE}projects`) fail(`/studio/projects became ${deep.path}`)
    if (deep.studio !== 'object') fail('window.studio is missing on /studio/projects')
    console.log(`/studio/projects: path=${deep.path} text="${deep.text.replace(/\s+/g, ' ')}"`)

    const methods = await page.evaluate(
      (url) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(url, { type: 'module' })
          const timer = setTimeout(() => reject(new Error('the gyro worker did not answer')), 30_000)
          worker.onmessage = (event) => {
            clearTimeout(timer)
            worker.terminate()
            resolve(event.data)
          }
          worker.onerror = (event) => {
            clearTimeout(timer)
            reject(new Error(`the gyro worker failed: ${event.message}`))
          }
          worker.postMessage({ id: 1, type: 'smoothingMethods' })
        }),
      `${BASE}gyroflow/wasm/js/gyro-worker.js`,
    )
    const list = methods?.result ?? methods?.methods ?? methods?.data ?? methods
    const names = Array.isArray(list) ? list : []
    if (names.length === 0) fail(`the gyro worker's smoothingMethods answer: ${JSON.stringify(methods).slice(0, 200)}`)
    else console.log(`gyro worker under the base: ${names.length} smoothing methods`)

    // The app registers its worker from a `load` listener that its lazily imported entry may add after `load`
    // has fired (as in the root build), so the check registers the same way main.tsx does and proves the worker
    // itself: it installs under the base, and its shell cache holds the pages under the base.
    const sw = await page.evaluate(async (base) => {
      const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(resolve, 20_000)),
      ])
      const names = (await caches.keys()).filter((n) => n.startsWith('freecut-app-shell-'))
      const keys = names.length ? (await (await caches.open(names[0])).keys()).map((r) => new URL(r.url).pathname) : []
      return { scope: new URL(registration.scope).pathname, keys }
    }, BASE)
    if (sw.scope !== BASE) fail(`the service worker scope is ${sw.scope}, not ${BASE}`)
    else if (!sw.keys.includes(`${BASE}index.html`) || !sw.keys.includes(`${BASE}icons/icon-192.png`)) {
      fail(`the service worker's shell cache is ${JSON.stringify(sw.keys)}`)
    } else console.log(`service worker scope ${sw.scope}, ${sw.keys.length} shell files cached under it`)

    const outside = [...new Set(requested.filter((p) => !p.startsWith(BASE)))]
    if (outside.length > 0) fail(`requests outside ${BASE}: ${outside.join(', ')}`)
    else console.log(`${requested.length} requests, none outside ${BASE}`)
    if (pageErrors.length > 0) fail(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`)
  } finally {
    await browser.close()
    server.close()
  }
  if (!process.exitCode) console.log('web-base OK')
}

main().catch((error) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error))
})
