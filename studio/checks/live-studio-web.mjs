// Checks the live web editor after a deploy of the `studio-web` service (studio/web/README.md): https://droneclean.app/studio/
// lands on /studio/projects, is cross-origin isolated (the gyro engine needs it), links no manifest and registers no
// service worker, points a first visit to the desktop app and to the docs, loads the agents' SDK (`globalThis.studio`),
// starts the gyro engine's worker and gets its smoothing methods, throws no page error, and sends no request outside
// the site. Network and Chrome: not part of `verify`. Usage, from studio/: npm run check:live-web
import { chromium } from 'playwright'

const site = process.env.STUDIO_SITE ?? 'https://droneclean.app'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext()).newPage()
const outside = []
const errors = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.origin !== new URL(site).origin && !['blob:', 'data:'].includes(url.protocol)) outside.push(request.url())
})
page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
let state
try {
  await page.goto(`${site}/studio/`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForURL(/\/studio\/projects/, { timeout: 30_000 })
  await page.waitForTimeout(2000)
  state = await page.evaluate(async () => ({
    path: location.pathname,
    isolated: globalThis.crossOriginIsolated,
    manifest: Boolean(document.querySelector('link[rel="manifest"]')),
    workers: ((await navigator.serviceWorker?.getRegistrations?.()) ?? []).length,
    desktopNotice: [...document.querySelectorAll('a')].some((a) => a.href.includes('/#get-studio')),
    docs: Boolean(document.querySelector('a[href*="/docs"]')),
    sdk: typeof globalThis.studio === 'object' && globalThis.studio !== null,
    // The gyro engine's worker, the way the editor starts it: a number of smoothing methods, or what went wrong
    gyroMethods: await new Promise((resolve) => {
      const worker = new Worker('/studio/gyroflow/wasm/js/gyro-worker.js', { type: 'module' })
      const timer = setTimeout(() => resolve('timeout'), 30_000)
      const finish = (value) => {
        clearTimeout(timer)
        worker.terminate()
        resolve(value)
      }
      worker.onmessage = (event) => finish(Array.isArray(event.data?.result) ? event.data.result.length : JSON.stringify(event.data).slice(0, 100))
      worker.onerror = (event) => finish(`error ${event.message}`)
      worker.postMessage({ id: 1, type: 'smoothingMethods' })
    }),
  }))
} finally {
  await browser.close()
}
const problems = [
  state.path !== '/studio/projects' && `landed on ${state.path}`,
  !state.isolated && 'not cross-origin isolated',
  state.manifest && 'a manifest is linked',
  state.workers > 0 && `${state.workers} service worker(s) registered`,
  !state.desktopNotice && 'no link to the desktop app',
  !state.docs && 'no link to the docs',
  !state.sdk && 'the agents\' SDK (globalThis.studio) is not loaded',
  !(typeof state.gyroMethods === 'number' && state.gyroMethods > 0) && `the gyro engine's worker gave ${state.gyroMethods}`,
  errors.length > 0 && `page errors: ${errors.join(' | ')}`,
  outside.length > 0 && `requests outside the site: ${outside.slice(0, 5).join(', ')}`,
].filter(Boolean)
console.log(JSON.stringify({ site, ...state, outside: outside.length, errors: errors.length }))
if (problems.length > 0) {
  console.error(`live-studio-web FAILED: ${problems.join('; ')}`)
  process.exit(1)
}
console.log('live-studio-web OK')
