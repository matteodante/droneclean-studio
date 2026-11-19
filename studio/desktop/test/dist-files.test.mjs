/**
 * Unit tests of the last step between a request and a file: real paths and symlinks
 * (main/dist-files.ts). The lexical attempts are covered by protocol.test.mjs.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { resolveInsideDist } from '../out/main/dist-files.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-dist-'))
const dist = path.join(root, 'dist')
const outside = path.join(root, 'outside')

fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.mkdirSync(outside, { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>')
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'export {}')
fs.writeFileSync(path.join(dist, 'assets', 'ort-wasm.wasm'), 'wasm')
fs.writeFileSync(path.join(outside, 'secret.txt'), 'a secret outside the build')
// A symlink to a file outside the build, and one to a whole folder outside it.
fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dist, 'linked-file.js'))
fs.symlinkSync(outside, path.join(dist, 'linked-folder'))
// A symlink that stays inside the build is fine.
fs.symlinkSync(path.join(dist, 'index.html'), path.join(dist, 'alias.html'))

after(() => fs.rmSync(root, { recursive: true, force: true }))

test('files of the build resolve to their real path', async () => {
  const realDist = fs.realpathSync(dist)
  assert.equal(await resolveInsideDist(dist, 'index.html'), path.join(realDist, 'index.html'))
  assert.equal(
    await resolveInsideDist(dist, 'assets/app-abc123.js'),
    path.join(realDist, 'assets', 'app-abc123.js'),
  )
  assert.equal(await resolveInsideDist(dist, 'assets/ort-wasm.wasm'), path.join(realDist, 'assets', 'ort-wasm.wasm'))
})

test('a missing path, a folder or a different name resolves to nothing', async () => {
  assert.equal(await resolveInsideDist(dist, 'missing.js'), null)
  assert.equal(await resolveInsideDist(dist, 'assets'), null)
  assert.equal(await resolveInsideDist(dist, 'assets/app-abc123.js.bak'), null)
})

test('a symlink that points outside the build is refused', async () => {
  assert.equal(await resolveInsideDist(dist, 'linked-file.js'), null)
  assert.equal(await resolveInsideDist(dist, 'linked-folder/secret.txt'), null)
})

test('a symlink that stays inside the build is served', async () => {
  const realDist = fs.realpathSync(dist)
  assert.equal(await resolveInsideDist(dist, 'alias.html'), path.join(realDist, 'index.html'))
})

test('a lexical escape is refused even if it is handed in directly', async () => {
  assert.equal(await resolveInsideDist(dist, '../outside/secret.txt'), null)
  assert.equal(await resolveInsideDist(dist, '/etc/passwd'), null)
  assert.equal(await resolveInsideDist(dist, 'assets/../../outside/secret.txt'), null)
})

test('a dist folder that does not exist resolves to nothing', async () => {
  assert.equal(await resolveInsideDist(path.join(root, 'gone'), 'index.html'), null)
})
