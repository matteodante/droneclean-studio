import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createStaticServer, contentTypeFor, resolveRequestPath } from '../lib/server.mjs'

const INDEX_HTML = '<!doctype html><title>network check</title>'

let distDir
let server

function request(pathname, method = 'GET') {
  const { port } = new URL(server.base)
  return new Promise((resolve, reject) => {
    const call = http.request(
      { host: '127.0.0.1', port, path: pathname, method },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    call.on('error', reject)
    call.end()
  })
}

before(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-check-dist-'))
  fs.writeFileSync(path.join(distDir, 'index.html'), INDEX_HTML)
  fs.writeFileSync(path.join(distDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  fs.mkdirSync(path.join(distDir, 'assets'))
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("app")\n')
  server = await createStaticServer({ distDir })
})

after(async () => {
  await server?.close()
  if (distDir) fs.rmSync(distDir, { recursive: true, force: true })
})

test('the served page carries the isolation headers the editor needs', async () => {
  const response = await request('/')
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8')
  assert.match(response.body, /network check/)
  assert.equal(response.headers['cross-origin-opener-policy'], 'same-origin')
  assert.equal(response.headers['cross-origin-embedder-policy'], 'require-corp')
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin')
})

test('an extension-less route falls back to index.html', async () => {
  for (const pathname of ['/projects', '/projects/new', '/editor/some-project', '/docs']) {
    const response = await request(pathname)
    assert.equal(response.status, 200, pathname)
    assert.equal(response.body, INDEX_HTML, pathname)
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8', pathname)
  }
})

test('a file that exists is served as itself', async () => {
  const script = await request('/assets/app.js')
  assert.equal(script.status, 200)
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8')
  assert.match(script.body, /console\.log/)

  const icon = await request('/favicon.svg')
  assert.equal(icon.status, 200)
  assert.equal(icon.headers['content-type'], 'image/svg+xml')
})

test('a missing file is a 404, not the app', async () => {
  const response = await request('/assets/missing.js')
  assert.equal(response.status, 404)
  assert.doesNotMatch(response.body, /network check/)
})

test('the browser favicon probe is answered without a body', async () => {
  const response = await request('/favicon.ico')
  assert.equal(response.status, 204)
  assert.equal(response.body, '')
})

test('HEAD sends the headers without a body, other methods are refused', async () => {
  const head = await request('/', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-length'], String(Buffer.byteLength(INDEX_HTML)))
  assert.equal(head.body, '')

  const post = await request('/', 'POST')
  assert.equal(post.status, 405)
})

test('paths that would leave the build folder are refused', async () => {
  for (const pathname of [
    '/assets/..%2f..%2fpackage.json',
    '/..%2fpackage.json',
    '/%2e%2e/package.json',
    '/a%00b.js',
  ]) {
    const response = await request(pathname)
    assert.equal(response.status, 400, pathname)
  }
})

test('content types follow the file extension', () => {
  assert.equal(contentTypeFor('/app/assets/main.js'), 'text/javascript; charset=utf-8')
  assert.equal(contentTypeFor('/app/manifest.webmanifest'), 'application/manifest+json')
  assert.equal(contentTypeFor('/app/model.wasm'), 'application/wasm')
  assert.equal(contentTypeFor('/app/file.unknown'), 'application/octet-stream')
})

test('resolveRequestPath answers for a folder, a missing asset and the routes', () => {
  assert.deepEqual(resolveRequestPath(distDir, '/'), { kind: 'index' })
  assert.deepEqual(resolveRequestPath(distDir, '/projects?x=1'), { kind: 'index' })
  assert.deepEqual(resolveRequestPath(distDir, '/assets'), { kind: 'index' })
  assert.deepEqual(resolveRequestPath(distDir, '/assets/app.js'), {
    kind: 'file',
    filePath: path.join(distDir, 'assets', 'app.js'),
  })
  assert.deepEqual(resolveRequestPath(distDir, '/assets/nope.js'), { kind: 'not-found' })
  assert.deepEqual(resolveRequestPath(distDir, '/../package.json'), { kind: 'bad-request' })
})
