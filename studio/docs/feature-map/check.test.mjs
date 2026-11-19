import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkFeatureMap, parseSdkMethods } from './check.mjs'

const STUDIO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

const GOOD_ENTRY = `### Split
- Where: Editor › Properties › Video tab
- Does: Cuts the selected clip in two at the playhead.
- SDK: \`studio.clips.split\`
- Code: \`src/studio/sdk/types.ts\`
`

function withFixture(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-map-check-'))
  fs.writeFileSync(path.join(dir, 'fixture.md'), source)
  return dir
}

test('a good entry passes', () => {
  const { errors, entryCount } = checkFeatureMap({
    mapDir: withFixture(`# Fixture\n\n${GOOD_ENTRY}`),
    studioRoot: STUDIO_ROOT,
  })
  assert.deepEqual(errors, [])
  assert.equal(entryCount, 1)
})

test('a code file that does not exist fails with file, entry and problem', () => {
  const source = GOOD_ENTRY.replace(
    'src/studio/sdk/types.ts',
    'src/features/gone/nowhere.tsx',
  )
  const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fixture\.md › Split: code file not found: src\/features\/gone\/nowhere\.tsx/)
})

test('an SDK method that does not exist fails with file, entry and problem', () => {
  const source = GOOD_ENTRY.replace('studio.clips.split', 'studio.clips.explode')
  const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fixture\.md › Split: unknown SDK method studio\.clips\.explode/)
})

test('a missing field fails with file, entry and the field name', () => {
  const source = GOOD_ENTRY.replace(
    '- Does: Cuts the selected clip in two at the playhead.\n',
    '',
  )
  const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
  assert.equal(errors.length, 1)
  assert.equal(errors[0], 'fixture.md › Split: missing Does')
})

const FREECUT_CODE = 'src/features/editor/components/properties-sidebar/clip-panel/index.tsx'

test('`none` is accepted as the SDK value for FreeCut code', () => {
  const source = GOOD_ENTRY.replace('studio.clips.split', 'none').replace(
    'src/studio/sdk/types.ts',
    FREECUT_CODE,
  )
  const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
  assert.deepEqual(errors, [])
})

test('an fenced example is not an entry', () => {
  const source = `# Fixture\n\n\`\`\`\n${GOOD_ENTRY}\`\`\`\n\n${GOOD_ENTRY}`
  const { errors, entryCount } = checkFeatureMap({
    mapDir: withFixture(source),
    studioRoot: STUDIO_ROOT,
  })
  assert.deepEqual(errors, [])
  assert.equal(entryCount, 1)
})

test('the SDK parser reads every namespace and method of the real types', () => {
  const source = fs.readFileSync(path.join(STUDIO_ROOT, 'src/studio/sdk/types.ts'), 'utf8')
  const methods = parseSdkMethods(source)
  assert.ok(methods.has('studio.clips.split'))
  assert.ok(methods.has('studio.markers.setIn'))
  assert.ok(methods.has('studio.export.start'))
  assert.ok(!methods.has('studio.clips.explode'))
  assert.equal(methods.size, 107)
})

const FORK_ENTRY = GOOD_ENTRY.replace('src/studio/sdk/types.ts', 'src/studio/looks/LooksSection.tsx')

test('a feature of the fork with SDK `none` fails', () => {
  const source = FORK_ENTRY.replace('`studio.clips.split`', '`none`')
  const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fixture\.md › Split: a feature of the fork \(src\/studio\/looks\/LooksSection\.tsx\) needs an SDK method/)
})

test('a feature of the fork passes with an SDK method or with `none (view only)`', () => {
  for (const sdk of ['`studio.clips.split`', 'none (view only)']) {
    const source = FORK_ENTRY.replace('`studio.clips.split`', sdk)
    const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
    assert.deepEqual(errors, [], sdk)
  }
})

test('FreeCut code with SDK `none` still passes: the rule is for the fork\'s own features', () => {
  const source = GOOD_ENTRY.replace('`studio.clips.split`', '`none`').replace(
    'src/studio/sdk/types.ts',
    FREECUT_CODE,
  )
  const { errors } = checkFeatureMap({ mapDir: withFixture(source), studioRoot: STUDIO_ROOT })
  assert.deepEqual(errors, [])
})
