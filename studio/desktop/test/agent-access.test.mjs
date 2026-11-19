/**
 * The Agent access preload (`preload/agent-access.ts`) against the channels the
 * main process registers (task 2.2 slices 6 and 7).
 *
 * A sandboxed preload may only require `electron`, so it cannot import the
 * shared module and the channel names are written out there. This test reads the
 * compiled preload — `npm test` builds it first — and holds the two together: a
 * renamed channel fails here instead of leaving the switch or the log
 * unanswered, the way `native-media.test.mjs` holds the native media names.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { AGENT_ACCESS_CHANNELS } from '../out/shared/agent-access.js'

const here = path.dirname(new URL(import.meta.url).pathname)
const preload = fs.readFileSync(
  path.resolve(here, '..', 'out', 'preload', 'agent-access.js'),
  'utf8',
)

test('the preload carries every channel it exposes, with the main process’s name', () => {
  for (const name of ['status', 'enable', 'disable', 'log']) {
    assert.ok(
      preload.includes(`'${AGENT_ACCESS_CHANNELS[name]}'`),
      `the preload should carry ${name} as ${AGENT_ACCESS_CHANNELS[name]}`,
    )
  }
})

test('the preload loads nothing but electron', () => {
  // A sandboxed preload's `require` resolves `electron` and little else, so a
  // relative import would fail at launch, not at build time.
  const required = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(required)], ['electron'])
})

test('the preload exposes the bridge for the version the page knows', () => {
  assert.match(preload, /exposeInMainWorld\('dronecleanAgentAccess'/)
  assert.equal(preload.match(/exposeInMainWorld\(/g)?.length, 1)
  assert.match(preload, /version:\s*1/)
  for (const method of ['status', 'enable', 'disable', 'log']) {
    assert.match(preload, new RegExp(`${method}\\(\\)\\s*\\{`), `the bridge has ${method}()`)
  }
})
