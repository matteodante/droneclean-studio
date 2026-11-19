// Tests for the licence check (`checks/licenses.mjs`): a production dependency with a licence outside the
// allow-list (or none) fails and is named, a dev dependency is ignored, and OR / AND expressions are judged by
// their parts. Run with `node --test checks/test/*.test.mjs`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { findingsInLock, isAllowedExpression } from '../licenses.mjs'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'licenses.mjs')
const STUDIO = path.resolve(import.meta.dirname, '..', '..')

/** A lock file with the given `packages` (path under `node_modules/` -> fields). */
function lockWith(packages) {
  const entries = { '': { name: 'fake', version: '1.0.0' } }
  for (const [name, fields] of Object.entries(packages)) {
    entries[`node_modules/${name}`] = { version: '1.0.0', ...fields }
  }
  return { name: 'fake', lockfileVersion: 3, packages: entries }
}

/** A temporary studio-shaped folder with the two lock files. */
function folderWith(studioLock, desktopLock = lockWith({ fine: { license: 'MIT' } })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-licenses-'))
  fs.mkdirSync(path.join(dir, 'desktop'))
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(studioLock))
  fs.writeFileSync(path.join(dir, 'desktop', 'package-lock.json'), JSON.stringify(desktopLock))
  return dir
}

function run(folder) {
  const args = folder === undefined ? [SCRIPT] : [SCRIPT, folder]
  return spawnSync(process.execPath, args, { encoding: 'utf8' })
}

test('a forbidden licence on a production package fails and names the package and the licence', () => {
  for (const license of ['CC-BY-NC-4.0', 'SSPL-1.0']) {
    const dir = folderWith(lockWith({ good: { license: 'MIT' }, 'bad-pkg': { license } }))
    try {
      const result = run(dir)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /bad-pkg@1\.0\.0/)
      assert.ok(result.stderr.includes(license))
      assert.doesNotMatch(result.stderr, /good@/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('the desktop lock file is checked too', () => {
  const dir = folderWith(lockWith({ good: { license: 'MIT' } }), lockWith({ 'desktop-bad': { license: 'SSPL-1.0' } }))
  try {
    const result = run(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /desktop[/\\]package-lock\.json: desktop-bad@1\.0\.0/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a package with no licence field fails; a scoped package is named with its scope', () => {
  const findings = findingsInLock(lockWith({ '@scope/none': {} }))
  assert.deepEqual(findings, [{ name: '@scope/none', version: '1.0.0', license: '(none declared)' }])
})

test('a dev dependency, a link and the root are ignored', () => {
  const lock = lockWith({
    'dev-only': { license: 'SSPL-1.0', dev: true },
    linked: { link: true, license: 'SSPL-1.0' },
  })
  lock.packages[''].license = 'SSPL-1.0'
  assert.deepEqual(findingsInLock(lock), [])
})

test('a clean pair of lock files passes with exit 0', () => {
  const dir = folderWith(lockWith({ a: { license: 'MIT' }, b: { license: 'Apache-2.0' } }))
  try {
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /licences ok/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing lock file is exit 2, not a pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-licenses-'))
  try {
    assert.equal(run(dir).status, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('expressions: OR needs one allowed alternative, AND needs all, anything unknown fails', () => {
  assert.equal(isAllowedExpression('MIT'), true)
  assert.equal(isAllowedExpression('(MIT OR CC0-1.0)'), true)
  assert.equal(isAllowedExpression('MIT OR SSPL-1.0'), true)
  assert.equal(isAllowedExpression('Apache-2.0 AND LGPL-3.0-or-later AND MIT'), true)
  assert.equal(isAllowedExpression('(MIT AND (ISC OR GPL-2.0-only))'), true)
  assert.equal(isAllowedExpression('MIT AND SSPL-1.0'), false)
  assert.equal(isAllowedExpression('CC-BY-NC-4.0'), false)
  assert.equal(isAllowedExpression('GPL-2.0-only WITH Classpath-exception-2.0'), false)
  assert.equal(isAllowedExpression('MIT OR'), false)
  assert.equal(isAllowedExpression('(MIT'), false)
  assert.equal(isAllowedExpression('MIT ISC'), false)
  assert.equal(isAllowedExpression(''), false)
})

test("the repository's own lock files pass", () => {
  const result = run(STUDIO)
  assert.equal(result.status, 0, result.stderr)
})
