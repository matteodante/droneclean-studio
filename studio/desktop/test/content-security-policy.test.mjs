/**
 * The Content-Security-Policy of `droneclean://app` (audit of 21 Nov 2026): the policy itself, pinned word for word so
 * a change to it is a change to this test, and the handler that puts it on every response of the app scheme, run on
 * the real `registerAppProtocol` against the stand-in `electron` (`test/support/fake-electron.cjs`).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const require = createRequire(import.meta.url)
const { install } = require('./support/fake-electron.cjs')

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-csp-')))
const dist = path.join(work, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/main.js"></script>')
fs.writeFileSync(path.join(dist, 'assets', 'main.js'), 'new Worker(new URL("./worker.js", import.meta.url))')
fs.writeFileSync(path.join(dist, 'assets', 'worker.js'), 'postMessage(1)')
const clip = path.join(work, 'clip.mp4')
fs.writeFileSync(clip, 'not really a video')

const electron = install({ isPackaged: false })
const {
  APP_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_HEADER,
  withContentSecurityPolicy,
} = require('../out/main/content-security-policy.js')
const { registerAppProtocol } = require('../out/main/protocol-handler.js')
const { NATIVE_ENCODE_SCHEME, NATIVE_FRAME_SCHEME } = require('../out/shared/native-media.js')
const { EXPORT_FILE_SCHEME } = require('../out/shared/export-file.js')

const media = registerAppProtocol(dist)
const handler = electron.state.protocolHandlers.get('droneclean')

after(() => {
  electron.restore()
  fs.rmSync(work, { recursive: true, force: true })
})

/** The policy as `{ directive: [sources] }`. */
function directives() {
  const parsed = {}
  for (const part of APP_CONTENT_SECURITY_POLICY.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    assert.equal(Object.hasOwn(parsed, name), false, `${name} is listed once`)
    parsed[name] = sources
  }
  return parsed
}

test('the policy, word for word', () => {
  assert.equal(
    APP_CONTENT_SECURITY_POLICY,
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https://*.lottiefiles.com",
      "font-src 'self' data:",
      "media-src 'self' blob:",
      "connect-src 'self' blob: data: droneclean-frame: droneclean-encode: droneclean-export: https: http:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  )
})

test('no inline script, no plugin, no foreign script or worker', () => {
  const policy = directives()
  assert.equal(policy['script-src'].includes("'unsafe-inline'"), false)
  assert.equal(policy['script-src'].some((source) => /^https?:|\*/.test(source)), false, 'scripts come from the app')
  assert.equal(policy['worker-src'].some((source) => /^https?:|\*/.test(source)), false, 'workers come from the app')
  assert.equal(policy['script-src'].includes('data:'), false)
  assert.deepEqual(policy['object-src'], ["'none'"])
  assert.deepEqual(policy['base-uri'], ["'none'"])
})

test('the shell’s own schemes are the ones the page fetches', () => {
  const connect = directives()['connect-src']
  for (const scheme of [NATIVE_FRAME_SCHEME, NATIVE_ENCODE_SCHEME, EXPORT_FILE_SCHEME]) {
    assert.ok(connect.includes(`${scheme}:`), `${scheme}: in connect-src`)
  }
})

test('withContentSecurityPolicy sets the header and keeps the response', () => {
  const response = new Response('x', { headers: { 'Content-Type': 'text/plain' } })
  assert.equal(withContentSecurityPolicy(response), response)
  assert.equal(response.headers.get(CONTENT_SECURITY_POLICY_HEADER), APP_CONTENT_SECURITY_POLICY)
  assert.equal(response.headers.get('Content-Type'), 'text/plain')
})

/** Ask the registered handler, as Chromium would. */
function ask(url, init) {
  return handler(new Request(url, init))
}

test('every response of the app scheme carries the policy: documents, workers, files, media and errors', async () => {
  const [clipEntry] = await media.describe([clip])
  const cases = [
    ['the entry', 'droneclean://app/', 200],
    ['a route', 'droneclean://app/projects', 200],
    ['a module', 'droneclean://app/assets/main.js', 200],
    ['a worker script', 'droneclean://app/assets/worker.js', 200],
    ['a missing file', 'droneclean://app/assets/missing.js', 404],
    ['a traversal', 'droneclean://app/%2e%2e/secret.txt', 404],
    ['a media file', clipEntry.url, 200],
    ['an unknown media id', 'droneclean://app/__media/unknown', 404],
    ['a POST', 'droneclean://app/', 405, { method: 'POST', body: 'x' }],
  ]
  for (const [label, url, status, init] of cases) {
    const response = await ask(url, init)
    assert.equal(response.status, status, `${label}: status`)
    assert.equal(response.headers.get(CONTENT_SECURITY_POLICY_HEADER), APP_CONTENT_SECURITY_POLICY, `${label}: policy`)
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp', `${label}: isolation kept`)
    await response.body?.cancel()
  }
})
