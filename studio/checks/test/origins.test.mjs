import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyRequestUrl } from '../lib/origins.mjs'

const ORIGIN = 'http://127.0.0.1:5123'

test('a request to the served origin is allowed', () => {
  const result = classifyRequestUrl('http://127.0.0.1:5123/assets/main.js', ORIGIN)
  assert.equal(result.allowed, true)
  assert.equal(result.origin, ORIGIN)
  assert.equal(result.url, 'http://127.0.0.1:5123/assets/main.js')
})

test('another host or another port is not the served origin', () => {
  const otherPort = classifyRequestUrl('http://127.0.0.1:5124/', ORIGIN)
  assert.equal(otherPort.allowed, false)
  assert.equal(otherPort.origin, 'http://127.0.0.1:5124')

  const otherHost = classifyRequestUrl('http://localhost:5123/', ORIGIN)
  assert.equal(otherHost.allowed, false)
  assert.equal(otherHost.origin, 'http://localhost:5123')
})

test('another scheme on the same host:port is not the served origin', () => {
  const result = classifyRequestUrl('https://127.0.0.1:5123/', ORIGIN)
  assert.equal(result.allowed, false)
  assert.equal(result.origin, 'https://127.0.0.1:5123')
})

test('third-party requests are refused and their origin reported', () => {
  const fonts = classifyRequestUrl(
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400&display=swap',
    ORIGIN,
  )
  assert.equal(fonts.allowed, false)
  assert.equal(fonts.origin, 'https://fonts.googleapis.com')

  const github = classifyRequestUrl('https://api.github.com/repos/walterlow/freecut', ORIGIN)
  assert.equal(github.allowed, false)
  assert.equal(github.origin, 'https://api.github.com')
})

test('data: and blob: URLs are made in the page, not fetched', () => {
  for (const url of [
    'data:text/plain,hello',
    'blob:http://127.0.0.1:5123/6f1f3a7e-0000-4000-8000-000000000000',
  ]) {
    const result = classifyRequestUrl(url, ORIGIN)
    assert.equal(result.allowed, true, url)
    assert.equal(result.reason, 'made in the page')
  }
})

test('a websocket to the served server is the served origin, another one is not', () => {
  const own = classifyRequestUrl('ws://127.0.0.1:5123/socket', ORIGIN)
  assert.equal(own.allowed, true)
  assert.equal(own.origin, 'ws://127.0.0.1:5123')

  const other = classifyRequestUrl('ws://127.0.0.1:5124/socket', ORIGIN)
  assert.equal(other.allowed, false)

  const encrypted = classifyRequestUrl('wss://127.0.0.1:5123/socket', ORIGIN)
  assert.equal(encrypted.allowed, false)
})

test('a URL that cannot be parsed is refused instead of crashing the check', () => {
  const result = classifyRequestUrl('not a url', ORIGIN)
  assert.equal(result.allowed, false)
  assert.equal(result.origin, null)
})

test('a browser-internal scheme is refused', () => {
  const result = classifyRequestUrl('chrome-extension://abcdef/page.html', ORIGIN)
  assert.equal(result.allowed, false)
  assert.equal(result.origin, 'chrome-extension:')
})
