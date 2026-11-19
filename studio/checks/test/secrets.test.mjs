// Tests for the secrets check (`checks/secrets.mjs`): it fails on a finding, names it without quoting it, and
// says so when gitleaks is not installed. Run with `node --test checks/test/*.test.mjs`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'secrets.mjs')

/**
 * A GitHub token of the shape gitleaks' `github-pat` rule matches, assembled here so that this file itself
 * holds no contiguous secret: the check scans the repository, this test included.
 */
const TOKEN = `ghp${'_'}${'Zq4Lm8Rt2Vx6Bn0Pc5Kw9Yd3Hs7Jf1Ga4'.repeat(2).slice(0, 36)}`

function folderWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-secrets-'))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

function run(folder, env = process.env) {
  return spawnSync(process.execPath, [SCRIPT, folder], { encoding: 'utf8', env })
}

test('a secret in the scanned folder is a finding: exit 1, file and line named, secret not printed', () => {
  const dir = folderWith({ 'notes.txt': `deploy token: ${TOKEN}\n` })
  try {
    const result = run(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /notes\.txt:1/)
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN))
    assert.match(result.stderr, /gitleaks:allow/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a folder with nothing to find exits 0', () => {
  const dir = folderWith({ 'notes.txt': 'nothing to see here\n' })
  try {
    const result = run(dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /no findings/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('without gitleaks the check says so instead of passing quietly', () => {
  const dir = folderWith({ 'notes.txt': 'nothing to see here\n' })
  try {
    const result = run(dir, { ...process.env, PATH: '/nonexistent' })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /gitleaks is not installed/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** A git repository with `tracked` committed and `untracked` written beside them, never added. */
function repoWith({ tracked, untracked }) {
  const dir = folderWith({})
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'secrets-test@example.com')
  git('config', 'user.name', 'Secrets test')
  for (const [group, files] of [['tracked', tracked], ['untracked', untracked]]) {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
      fs.writeFileSync(path.join(dir, name), content)
    }
    if (group === 'tracked') {
      git('add', '-A')
      git('commit', '-q', '-m', 'tracked files')
    }
  }
  return dir
}

test('in a git repository only tracked files are scanned: a secret in an untracked folder is not a finding', () => {
  const dir = repoWith({
    tracked: { 'notes.txt': 'nothing to see here\n' },
    untracked: { 'cloud/deploy.txt': `deploy token: ${TOKEN}\n` },
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /1 tracked file\(s\)/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('in a git repository a secret in a tracked file is a finding, named by its path in the repository', () => {
  const dir = repoWith({
    tracked: { 'docs/notes.txt': `deploy token: ${TOKEN}\n` },
    untracked: { 'cloud/other.txt': 'nothing\n' },
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /docs\/notes\.txt:1/)
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
