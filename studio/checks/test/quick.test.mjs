import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { QUICK_CHECKS } from '../quick.mjs'

const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'))

test('every quick check is a script of package.json', () => {
  for (const [, script] of QUICK_CHECKS) assert.ok(pkg.scripts[script], `${script} is not an npm script`)
})

test('verify runs check:quick first, so the fast checks live in one list', () => {
  assert.ok(pkg.scripts.verify.startsWith('npm run check:quick && '))
  const steps = pkg.scripts.verify.split(' && ')
  for (const [, script] of QUICK_CHECKS) {
    assert.ok(!steps.some((step) => step.endsWith(` ${script}`) && script !== 'check:quick'), `verify repeats ${script}`)
  }
})
