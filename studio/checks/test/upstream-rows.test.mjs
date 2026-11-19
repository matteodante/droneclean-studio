// Tests for the upstream rows check (`checks/upstream-rows.mjs`): a changed or
// deleted FreeCut file without a row fails, a row that no longer describes a
// change fails, and a table that matches the tree passes. Each case builds a
// throwaway repository (see fork-fixture.mjs) and runs the real script on it.
// Run with `node --test checks/test/*.test.mjs` (or `npm run check:checks`).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { CLEAN_ROWS, createForkFixture, runCheck } from './fork-fixture.mjs'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'upstream-rows.mjs')

/** The clean table without the row for the changed file. */
const ROWS_WITHOUT_CHANGED = CLEAN_ROWS.split('\n')
  .filter((line) => !line.includes('src/changed.ts'))
  .join('\n')

test('a changed FreeCut file with no row fails: exit 1, the file is named', () => {
  const fixture = createForkFixture({ rows: ROWS_WITHOUT_CHANGED })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /missing {2}src\/changed\.ts/)
    assert.match(result.stderr, /differs from FreeCut's file/)
  } finally {
    fixture.cleanup()
  }
})

test('a row for a file that no longer differs, or that FreeCut never had, fails: exit 1', () => {
  const rows = [
    CLEAN_ROWS,
    '| `src/base.ts` | An old change. | A test fixture. |',
    '| `src/features/unknown.ts` | A file FreeCut never had, wrongly tabled. | A test fixture. |',
  ].join('\n')
  const fixture = createForkFixture({ rows })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /stale {4}src\/base\.ts {2}\(same as FreeCut's file/)
    assert.match(
      result.stderr,
      /stale {4}src\/features\/unknown\.ts {2}\(not a file in FreeCut's imported tree\)/,
    )
  } finally {
    fixture.cleanup()
  }
})

test('a path the fork owns needs no row, even when the imported tree already had it', () => {
  const fixture = createForkFixture({
    upstreamFiles: { 'bench/tool.mjs': 'export const version = 1\n' },
    forkChanges: { 'bench/tool.mjs': 'export const version = 2\n' },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /bench\/tool\.mjs/)
  } finally {
    fixture.cleanup()
  }
})

test('a row naming a path the fork owns is ignored, not reported stale', () => {
  const rows = [CLEAN_ROWS, '| `bench/tool.mjs` | The fork changed it. | A test fixture. |'].join('\n')
  const fixture = createForkFixture({
    rows,
    upstreamFiles: { 'bench/tool.mjs': 'export const version = 1\n' },
    forkChanges: { 'bench/tool.mjs': 'export const version = 2\n' },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /bench\/tool\.mjs/)
  } finally {
    fixture.cleanup()
  }
})

test('a deleted FreeCut file needs a row whose change begins with "Deleted"', () => {
  const rows = [
    '| File | What we changed | Why |',
    '|---|---|---|',
    '| `src/changed.ts` | The fork changes the value. | A test fixture. |',
    '| `src/deleted.ts` | The file went away. | A test fixture. |',
  ].join('\n')
  const fixture = createForkFixture({ rows })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /stale {4}src\/deleted\.ts {2}\(deleted in studio\//)
    assert.match(result.stderr, /the row does not begin with "Deleted"/)
  } finally {
    fixture.cleanup()
  }
})

test('a table that describes every change and nothing else passes: exit 0', () => {
  const fixture = createForkFixture()
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /PASS: every changed FreeCut file has a row/)
  } finally {
    fixture.cleanup()
  }
})

test('a changed FreeCut file outside src/ with no row fails too', () => {
  const fixture = createForkFixture({
    upstreamFiles: { '.gitattributes': '* text=auto\n' },
    forkChanges: { '.gitattributes': '* text=auto eol=lf\n' },
  })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /missing {2}\.gitattributes {2}\(differs from FreeCut's file/)
  } finally {
    fixture.cleanup()
  }
})

test('the reference is upstream-studio/main, not the commit the first import names', () => {
  // The import names a prepped commit that already holds a fork change to src/base.ts; measured against
  // FreeCut's own branch that file is changed, so it needs a row.
  const fixture = createForkFixture({ preppedChanges: { 'src/base.ts': 'export const base = 2\n' } })
  try {
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /missing {2}src\/base\.ts {2}\(differs from FreeCut's file/)
  } finally {
    fixture.cleanup()
  }
})

test('without upstream-studio/main in the clone the check says so: exit 2', () => {
  const fixture = createForkFixture()
  try {
    spawnSync('git', ['-C', fixture.dir, 'update-ref', '-d', 'refs/remotes/upstream-studio/main'])
    const result = runCheck(SCRIPT, fixture.studio)
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /no merge base of HEAD and upstream-studio\/main/)
  } finally {
    fixture.cleanup()
  }
})
