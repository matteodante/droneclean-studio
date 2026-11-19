// Tests for the reachability check (`checks/reachable.mjs`): modules not reachable from the production
// entries are found, tests and probes do not count as callers, and the baseline may only shrink.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { compareWithBaseline, measure } from '../reachable.mjs'

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-reach-'))
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const BASE = {
  'src/bootstrap.ts': "import('./app')\n",
  'src/app.ts': "import { a } from '@/studio/a'\nexport const app = a\n",
  'src/studio/a.ts': "export * from './b'\nexport const a = 1\n",
  'src/studio/b.ts': 'export const b = 1\n',
  'desktop/src/main/index.ts': "import { m } from '../shared/m.js'\nexport const x = m\n",
  'desktop/src/shared/m.ts': 'export const m = 1\n',
}

test('everything the entries load, through aliases, re-exports, dynamic imports and .js names, is reachable', () => {
  const fixture = tree(BASE)
  try {
    assert.deepEqual(measure(fixture.root).unreachable, [])
  } finally {
    fixture.cleanup()
  }
})

test('a module only a test or a probe loads is unreachable', () => {
  const fixture = tree({
    ...BASE,
    'src/studio/orphan.ts': 'export const o = 1\n',
    'src/studio/orphan.test.ts': "import { o } from './orphan'\nexport const t = o\n",
    'src/studio/probe.mjs': "import './probe-only'\n",
    'src/studio/probe-only.ts': 'export const p = 1\n',
  })
  try {
    assert.deepEqual(measure(fixture.root).unreachable, [
      'src/studio/orphan.ts',
      'src/studio/probe-only.ts',
      'src/studio/probe.mjs',
    ])
  } finally {
    fixture.cleanup()
  }
})

test('fixture folders and *.fixture files are not judged, a plain module only a test imports still is', () => {
  const fixture = tree({
    ...BASE,
    'src/studio/__fixtures__/fake.ts': 'export const f = 1\n',
    'src/studio/sub/__fixtures__/deep.ts': 'export const d = 1\n',
    'src/studio/data.fixture.ts': 'export const x = 1\n',
    'src/studio/data2.fixture.mjs': 'export const y = 1\n',
    'src/studio/helper.ts': 'export const h = 1\n',
    'src/studio/helper.test.ts': "import { h } from './helper'\nimport { f } from './__fixtures__/fake'\nexport const t = [h, f]\n",
  })
  try {
    assert.deepEqual(measure(fixture.root).unreachable, ['src/studio/helper.ts'])
  } finally {
    fixture.cleanup()
  }
})

test('a worker loaded by new URL and a glob import are followed', () => {
  const fixture = tree({
    ...BASE,
    'src/app.ts': "new Worker(new URL('./w.ts', import.meta.url))\nimport.meta.glob('./pages/*.ts', { eager: true })\n",
    'src/w.ts': "import '@/studio/a'\n",
    'src/pages/one.ts': "import '@/studio/c'\n",
    'src/studio/c.ts': 'export const c = 1\n',
  })
  try {
    assert.deepEqual(measure(fixture.root).unreachable, [])
  } finally {
    fixture.cleanup()
  }
})

test('the baseline may only shrink: a new unreachable module and a reachable entry both fail', () => {
  assert.deepEqual(compareWithBaseline(['a', 'b'], ['a']), { added: ['b'], fixed: [] })
  assert.deepEqual(compareWithBaseline(['a'], ['a', 'c']), { added: [], fixed: ['c'] })
  assert.deepEqual(compareWithBaseline(['a'], ['a']), { added: [], fixed: [] })
})
