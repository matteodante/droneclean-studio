// Tests for the studio layer rules (`checks/studio-layers.mjs`): the core may not reach React, a store or
// src/features/; src/types/ may not reach studio UI; the baseline may only shrink. Each case writes a small
// `src/` tree and runs the real rules on it. Run with `node --test checks/test/*.test.mjs`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  collectStudioLayerViolations,
  compareWithBaseline,
  readBaseline,
  shrinkBaseline,
  writeBaseline,
} from '../studio-layers.mjs'

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-layers-'))
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const CLEAN = {
  'src/studio/time/rate.ts': 'export const rate = 1\n',
  'src/studio/speed/mapping.ts': "import { rate } from '@/studio/time/rate'\nexport const m = rate\n",
  'src/types/timeline.ts': "import type { rate } from '@/studio/time/rate'\nexport type T = typeof rate\n",
}

const keys = (violations) => violations.map((violation) => `${violation.rule} ${violation.from} ${violation.offender}`)

test('a clean tree has no violation', () => {
  const fixture = tree(CLEAN)
  try {
    assert.deepEqual(collectStudioLayerViolations(fixture.root), [])
  } finally {
    fixture.cleanup()
  }
})

test('a core module that imports React, a store or a feature is a violation, directly or through another module', () => {
  const fixture = tree({
    ...CLEAN,
    'src/studio/time/rate.ts': "import { useState } from 'react'\nexport const rate = useState\n",
    'src/studio/color/log.ts': "import { useStore } from '@/features/timeline/stores/timeline-store'\nexport const l = useStore\n",
    'src/studio/color/helper.ts': "import { create } from 'zustand'\nexport const h = create\n",
    'src/studio/color/cube.ts': "import { h } from './helper'\nexport const c = h\n",
    'src/studio/speed/index.ts': "import '../../shared/state/mic-store'\n",
    'src/shared/state/mic-store.ts': 'export const s = 1\n',
    'src/studio/stabilization/settings.ts': "import '@/studio/speed/index'\n",
  })
  try {
    const found = keys(collectStudioLayerViolations(fixture.root))
    assert.ok(found.includes('core-purity src/studio/time/rate.ts src/studio/time/rate.ts'), found.join('\n'))
    assert.ok(found.includes('core-purity src/studio/speed/mapping.ts src/studio/time/rate.ts'), 'reached through an import')
    assert.ok(found.includes('core-purity src/studio/color/log.ts src/studio/color/log.ts'), 'a feature store')
    assert.ok(found.includes('core-purity src/studio/color/cube.ts src/studio/color/helper.ts'), 'a store library, two hops')
    assert.ok(
      found.includes('core-purity src/studio/stabilization/settings.ts src/studio/speed/index.ts'),
      'a store module of shared/state',
    )
  } finally {
    fixture.cleanup()
  }
})

test('a module outside the core and its imports may use React freely', () => {
  const fixture = tree({
    ...CLEAN,
    'src/studio/speed/panel/Panel.tsx': "import { useState } from 'react'\nexport const P = useState\n",
  })
  try {
    assert.deepEqual(collectStudioLayerViolations(fixture.root), [])
  } finally {
    fixture.cleanup()
  }
})

test('src/types reaching a studio UI module is a violation, also through another module', () => {
  const fixture = tree({
    ...CLEAN,
    'src/studio/speed/panel/Panel.tsx': 'export const P = 1\n',
    'src/studio/speed/index.ts': "export * from './panel/Panel'\n",
    'src/types/project.ts': "import type { P } from '@/studio/speed/index'\nexport type X = typeof P\n",
    'src/types/export.ts': "import type { ui } from '@/studio/looks/ui/thing'\n",
    'src/studio/looks/ui/thing.ts': 'export const ui = 1\n',
  })
  try {
    const found = keys(collectStudioLayerViolations(fixture.root))
    assert.ok(found.includes('types-ui src/types/project.ts src/studio/speed/panel/Panel.tsx'), found.join('\n'))
    assert.ok(found.includes('types-ui src/types/export.ts src/studio/looks/ui/thing.ts'), 'a ui folder')
  } finally {
    fixture.cleanup()
  }
})

test('the baseline may only shrink: a new violation and a fixed entry both fail, and shrinking never adds', () => {
  const violations = [{ key: 'a' }, { key: 'b' }]
  assert.deepEqual(compareWithBaseline(violations, ['a', 'b']), { added: [], fixed: [] })
  assert.deepEqual(compareWithBaseline(violations, ['a']).added, [{ key: 'b' }])
  assert.deepEqual(compareWithBaseline(violations, ['a', 'b', 'c']).fixed, ['c'])

  const fixture = tree({})
  const baselinePath = path.join(fixture.root, 'baseline.json')
  try {
    writeBaseline(['a', 'c'], baselinePath)
    const removed = shrinkBaseline(violations, baselinePath)
    assert.deepEqual(removed, ['c'])
    assert.deepEqual(readBaseline(baselinePath), ['a'], 'b is a new violation and is not added')
  } finally {
    fixture.cleanup()
  }
})
