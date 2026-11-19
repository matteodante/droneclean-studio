#!/usr/bin/env node
// The web build lives under /studio/: `npm run build:web` (STUDIO_BASE_PATH=/studio/) into dist-web/.
//
//   node checks/web-base.mjs [--skip-build] [--dist <dir>]
//
// Serves dist-web/ under /studio/ the way the static server in web/ does (cross-origin isolation headers, a
// single-page fallback for unknown paths under /studio/), opens it in headless Chrome and checks that:
//   - /studio/ loads, is cross-origin isolated, `window.studio` exists, and lands on /studio/projects;
//   - the deep link /studio/projects loads (the fallback answers index.html), renders, and a first visit's folder
//     picker points to the desktop app;
//   - the stabilization worker (gyroflow/wasm/js/gyro-worker.js, under the base) answers `smoothingMethods`;
//   - no manifest is linked and no service worker is registered; a worker and shell cache left by the earlier
//     build are removed at startup;
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
    await page.waitForURL(`${origin}${BASE}projects`, { timeout: 30_000 }).catch(() => {})
    await page
      .waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 30_000 })
      .catch(() => {})
    const root = await page.evaluate(() => ({
      isolated: window.crossOriginIsolated,
      studio: typeof window.studio,
      path: window.location.pathname,
      text: document.body.innerText.trim().length,
    }))
    if (!root.isolated) fail('/studio/ is not cross-origin isolated')
    if (root.studio !== 'object') fail('window.studio is missing')
    if (root.path !== `${BASE}projects`) fail(`/studio/ landed on ${root.path}, not ${BASE}projects`)
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
      // A first visit has no workspace yet: the folder picker is what it sees, and it points to the desktop app.
      desktopNotice: [...document.querySelectorAll('a')].some((a) => a.href.endsWith('/#get-studio')),
    }))
    if (deep.path !== `${BASE}projects`) fail(`/studio/projects became ${deep.path}`)
    if (deep.studio !== 'object') fail('window.studio is missing on /studio/projects')
    if (!deep.desktopNotice) fail('the first screen of the web editor does not point to the desktop app')
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

    // The editor is not a web app: no manifest is linked and no service worker is registered.
    const noPwa = await page.evaluate(async () => ({
      manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
    }))
    if (noPwa.manifestLinks !== 0) fail(`the page links a web manifest (${noPwa.manifestLinks})`)
    else if (noPwa.registrations !== 0) fail(`${noPwa.registrations} service worker(s) registered by the app`)
    else console.log('no manifest linked, no service worker registered')
    for (const file of ['sw.js', 'manifest.webmanifest']) {
      if (fs.existsSync(path.join(dist, file))) fail(`${distArg}/${file} is still built`)
    }

    // A visitor of the earlier build still has its worker and shell cache: the app removes both at startup.
    const staleWorker = path.join(dist, 'sw.js')
    fs.writeFileSync(
      staleWorker,
      "self.addEventListener('install', (e) => e.waitUntil(caches.open('freecut-app-shell-stale').then(() => self.skipWaiting())))\n",
    )
    try {
      const seeded = await page.evaluate(async (base) => {
        await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
        await navigator.serviceWorker.ready
        return {
          registrations: (await navigator.serviceWorker.getRegistrations()).length,
          caches: (await caches.keys()).filter((n) => n.startsWith('freecut-app-shell-')),
        }
      }, BASE)
      if (seeded.registrations !== 1 || seeded.caches.length !== 1) {
        fail(`the stale worker was not seeded: ${JSON.stringify(seeded)}`)
      }
      await page.goto(`${origin}${BASE}projects`, { waitUntil: 'load' })
      await page.waitForFunction(() => 'studio' in window, null, { timeout: 30_000 })
      const left = await page.waitForFunction(
        async () => {
          const registrations = (await navigator.serviceWorker.getRegistrations()).length
          const names = (await caches.keys()).filter((n) => n.startsWith('freecut-app-shell-'))
          return registrations === 0 && names.length === 0 ? { registrations, names } : false
        },
        null,
        { timeout: 20_000 },
      ).then(() => true, () => false)
      if (!left) fail('the app left the earlier build\'s service worker or shell cache in place')
      else console.log('earlier build\'s service worker and shell cache removed at startup')
    } finally {
      fs.rmSync(staleWorker, { force: true })
    }

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
