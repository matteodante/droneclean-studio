import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildKey, hashInputs, useCache } from '../build-cache.mjs'
import { buildSteps } from '../verify-runner.mjs'

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(studio, 'package.json'), 'utf8'))

/** The commands of the old one-line verify, with the headless suites opened into their parts. */
function expand(command) {
  return command.split(' && ').flatMap((part) => {
    const match = /^npm run (headless:test:[\w:]+)$/.exec(part)
    return match ? expand(pkg.scripts[match[1]]) : [part]
  })
}

test('the runner runs every command the serial verify runs, and nothing else', () => {
  const serial = pkg.scripts['verify:serial'] ?? pkg.scripts.verify
  const leaves = expand(serial)
  const fromSteps = []
  for (const step of buildSteps({ withQuick: true })) {
    const leaf = step.leaf ?? step.run
    if (fromSteps.at(-1) !== leaf) fromSteps.push(leaf)
  }
  // the order of the steps is their scheduling priority, so only the set of commands has to match
  assert.deepEqual([...fromSteps].sort(), [...leaves].sort())
})

test('the needs of the steps name existing steps and make no cycle', () => {
  const steps = buildSteps({ withQuick: true })
  const byId = new Map(steps.map((s) => [s.id, s]))
  assert.equal(byId.size, steps.length, 'step ids are unique')
  for (const step of steps) for (const need of step.needs) assert.ok(byId.has(need), `${step.id} needs ${need}`)
  const done = new Set()
  while (done.size < steps.length) {
    const next = steps.filter((s) => !done.has(s.id) && s.needs.every((n) => done.has(n)))
    assert.ok(next.length > 0, 'a cycle')
    for (const s of next) done.add(s.id)
  }
})

test('the key follows path and content of the inputs and the extras', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one')
    const base = hashInputs(dir, ['a.txt'], ['x'])
    assert.equal(hashInputs(dir, ['a.txt'], ['x']), base)
    assert.notEqual(hashInputs(dir, ['a.txt'], ['y']), base)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two')
    assert.notEqual(hashInputs(dir, ['a.txt'], ['x']), base)
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two')
    assert.notEqual(hashInputs(dir, ['a.txt', 'b.txt'], ['x']), hashInputs(dir, ['a.txt'], ['x']))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a cache entry is used only after a successful build, and --fresh rebuilds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'))
  const root = path.join(dir, 'cache')
  const target = path.join(dir, 'out')
  const quiet = () => {}
  let builds = 0
  const produce = () => {
    builds++
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'f'), `build ${builds}`)
  }
  const options = { kind: 'k', key: 'abc', parts: { out: target }, root, log: quiet }
  try {
    assert.throws(() => useCache({ ...options, produce: () => false }))
    assert.equal(useCache({ ...options, produce }), 'built')
    fs.rmSync(target, { recursive: true })
    assert.equal(useCache({ ...options, produce }), 'hit')
    assert.equal(fs.readFileSync(path.join(target, 'f'), 'utf8'), 'build 1')
    assert.equal(builds, 1)
    assert.equal(useCache({ ...options, produce, fresh: true }), 'built')
    assert.equal(builds, 2)
    assert.equal(useCache({ ...options, key: 'other', produce }), 'built')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the build key depends on the output folder and on the desktop dependencies', () => {
  const dist = buildKey()
  assert.equal(buildKey(), dist)
  assert.notEqual(buildKey({ outDir: 'golden/out/dist' }), dist)
  assert.notEqual(buildKey({ desktop: true }), dist)
})
