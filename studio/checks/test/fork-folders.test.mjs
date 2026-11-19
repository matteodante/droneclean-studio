// Tests for the fork folders check (`checks/fork-folders.mjs`): a file the fork
// adds inside one of FreeCut's folders fails, a file under a folder the fork
// owns passes. Each case builds a throwaway repository (see fork-fixture.mjs)
// and runs the real script on it.
// Run with `node --test checks/test/*.test.mjs` (or `npm run check:checks`).
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { createForkFixture, runCheck } from './fork-fixture.mjs'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'fork-folders.mjs')

test('a file the fork adds inside FreeCut\'s folders fails: exit 1, the file is named', () => {
  const fixture = createForkFixture({
    forkFiles: {
      'src/features/editor/a-test.ts': 'export const probe = true\n',
      'src/studio/new.ts': 'export const own = true\n',
    },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /src\/features\/editor\/a-test\.ts/)
    assert.match(result.stderr, /outside the folders the fork owns/)
    // The file under the fork's own folder is not reported with it.
    assert.doesNotMatch(result.stderr, /src\/studio\/new\.ts/)
  } finally {
    fixture.cleanup()
  }
})

test('every file the fork adds under a folder it owns passes: exit 0', () => {
  const fixture = createForkFixture()
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /PASS: every file the fork adds is under a folder the fork owns/)
  } finally {
    fixture.cleanup()
  }
})

test('a test beside the file it covers is allowed, with or without a qualifier', () => {
  const fixture = createForkFixture({
    upstreamFiles: {
      'src/features/editor/toolbar.tsx': 'export const Toolbar = 1\n',
      'src/runtime/renderer/gpu.ts': 'export const gpu = 1\n',
    },
    forkFiles: {
      'src/features/editor/toolbar.test.tsx': 'export {}\n',
      'src/runtime/renderer/gpu.shadow.test.ts': 'export {}\n',
    },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /tests beside their subject 2/)
  } finally {
    fixture.cleanup()
  }
})

test('a test whose subject does not exist beside it fails: exit 1', () => {
  const fixture = createForkFixture({
    forkFiles: { 'src/features/editor/orphan.test.ts': 'export {}\n' },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /src\/features\/editor\/orphan\.test\.ts/)
  } finally {
    fixture.cleanup()
  }
})

test('a file whose place a framework fixes passes when it is listed', () => {
  const fixture = createForkFixture({
    forkFiles: { 'src/routes/licenses.lazy.tsx': 'export {}\n' },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /src\/routes\/licenses\.lazy\.tsx 1/)
  } finally {
    fixture.cleanup()
  }
})
