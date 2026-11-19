/**
 * The preload's copy of the native media channels (`preload/index.ts`) against the
 * main process's (`shared/native-media.ts`).
 *
 * A sandboxed preload may only require `electron`, so it cannot import the shared
 * module and the channel names are written out there. This test reads the
 * compiled preload — `npm test` builds it first — and holds the two together: a
 * renamed channel fails here instead of leaving `decode.start` unanswered.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { NATIVE_MEDIA_CHANNELS } from '../out/shared/native-media.js'

const here = path.dirname(new URL(import.meta.url).pathname)
const preload = fs.readFileSync(path.resolve(here, '..', 'out', 'preload', 'index.js'), 'utf8')

test('the preload carries every channel it exposes, with the main process’s name', () => {
  for (const name of ['decodeStart', 'encodeStart', 'cancel', 'progress', 'capabilities']) {
    assert.ok(
      preload.includes(`'${NATIVE_MEDIA_CHANNELS[name]}'`),
      `the preload should carry ${name} as ${NATIVE_MEDIA_CHANNELS[name]}`,
    )
  }
})

test('the preload loads nothing but electron', () => {
  // A sandboxed preload's `require` resolves `electron` and little else, so a
  // relative import would fail at launch, not at build time.
  const required = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(required)], ['electron'])
})

test('the preload exposes the engine and nothing else', () => {
  assert.match(preload, /exposeInMainWorld\('dronecleanDesktop'/)
  assert.ok(preload.includes('nativeMedia'), 'the bridge carries the native media member')
})
