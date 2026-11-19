import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { chromeLaunchArgs } from '../../headless/lib/cli.mjs'
import { createNetworkRecorder, summarizeOffenders } from '../lib/recorder.mjs'
import { createStaticServer } from '../lib/server.mjs'

// A deliberate run of the recorder against a page that does what it must catch:
// a dedicated worker fetching another origin, a service worker fetching while
// it installs, and a WebSocket to another origin. If any of these went
// unrecorded, `checks/network-origins.mjs` could pass while the editor talked
// to a third party.

let distDir
let served
let thirdParty
let thirdPartyOrigin
let browser
let recorder
let page

const quiet = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForEntry(predicate, description) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const entry = recorder.entries().find(predicate)
    if (entry) return entry
    await quiet(100)
  }
  assert.fail(`${description} was not recorded`)
}

before(async () => {
  thirdParty = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.end('third party\n')
  })
  thirdParty.on('upgrade', (request, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: network-check\r\n\r\n',
    )
    socket.destroy()
  })
  await new Promise((resolve) => thirdParty.listen(0, '127.0.0.1', resolve))
  thirdPartyOrigin = `http://127.0.0.1:${thirdParty.address().port}`

  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-check-recorder-'))
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    `<!doctype html><title>recorder</title>
<script>
  new Worker('/worker.js')
  navigator.serviceWorker.register('/sw.js').catch(() => {})
  new WebSocket('ws://127.0.0.1:${thirdParty.address().port}/socket')
</script>`,
  )
  fs.writeFileSync(
    path.join(distDir, 'worker.js'),
    `fetch('${thirdPartyOrigin}/from-worker').catch(() => {})`,
  )
  fs.writeFileSync(
    path.join(distDir, 'sw.js'),
    `self.addEventListener('install', (event) => {
  event.waitUntil(fetch('/from-service-worker'))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})`,
  )
  served = await createStaticServer({ distDir })

  browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeLaunchArgs() })
  const context = await browser.newContext()
  recorder = createNetworkRecorder({ context, servedOrigin: served.origin, step: 'probe' })
  page = await context.newPage()
  await page.goto(`${served.base}/`, { waitUntil: 'load', timeout: 30000 })
})

after(async () => {
  await browser?.close().catch(() => {})
  await served?.close()
  if (thirdParty) await new Promise((resolve) => thirdParty.close(resolve))
  if (distDir) fs.rmSync(distDir, { recursive: true, force: true })
})

test('a request made by a dedicated worker is recorded and refused', async () => {
  const entry = await waitForEntry(
    (candidate) => candidate.url === `${thirdPartyOrigin}/from-worker`,
    'the request a dedicated worker made',
  )
  assert.equal(entry.allowed, false)
  assert.equal(entry.origin, thirdPartyOrigin)
  assert.equal(entry.resourceType, 'fetch')
  assert.equal(entry.step, 'probe')
  assert.ok(
    recorder
      .workers()
      .some((worker) => worker.kind === 'dedicated' && worker.url.endsWith('/worker.js')),
    'the worker that made the request is not in the log',
  )
  // The log names the page that started the worker: Playwright reports a
  // worker's requests through the page that owns it.
  assert.equal(entry.initiator.kind, 'page')
})

test('a request made by the service worker is recorded with its worker', async () => {
  const entry = await waitForEntry(
    (candidate) => candidate.url === `${served.origin}/from-service-worker`,
    'the request the service worker made while installing',
  )
  assert.equal(entry.allowed, true)
  assert.equal(entry.initiator.kind, 'service-worker')
  assert.ok(
    recorder
      .workers()
      .some((worker) => worker.kind === 'service-worker' && worker.url.endsWith('/sw.js')),
    'the service worker is not in the log',
  )
})

test('a WebSocket handshake is recorded and refused outside the served origin', async () => {
  const entry = await waitForEntry(
    (candidate) => candidate.resourceType === 'websocket',
    'the WebSocket handshake',
  )
  assert.equal(entry.method, 'WS')
  assert.equal(entry.allowed, false)
  assert.equal(entry.origin, thirdPartyOrigin.replace('http:', 'ws:'))
})

test('the verdict separates the served origin from everything else', async () => {
  await waitForEntry((candidate) => candidate.url === `${thirdPartyOrigin}/from-worker`, 'worker')
  const offenders = summarizeOffenders(recorder.offending())
  assert.deepEqual(
    offenders.map((group) => group.origin),
    [thirdPartyOrigin, thirdPartyOrigin.replace('http:', 'ws:')].sort((a, b) => a.localeCompare(b)),
  )
  const document = recorder
    .entries()
    .find((entry) => entry.url === `${served.origin}/` && entry.allowed)
  assert.ok(document, 'the served document itself is missing from the log')
  assert.equal(document.status, 200, 'a finished request carries the status it got')
})
