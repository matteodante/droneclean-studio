import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import {
  buildSeededProject,
  TEXT_CLIP_ID,
  TEXT_FONT_FAMILY,
} from '../lib/seed-workspace.mjs'

const STUDIO = new URL('../../', import.meta.url)

function readSource(relativePath) {
  return fs.readFileSync(new URL(relativePath, STUDIO), 'utf8')
}

test('the seeded project uses the schema version the app currently writes', () => {
  const types = readSource('src/shared/projects/migrations/types.ts')
  const match = types.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/)
  assert.ok(match, 'CURRENT_SCHEMA_VERSION not found in src/shared/projects/migrations/types.ts')
  // The editor upgrades older projects before opening them, which would make
  // this check measure a migration, not the project it wrote.
  assert.equal(buildSeededProject().schemaVersion, Number(match[1]))
})

test('the text clip uses a catalogue font other than the default', () => {
  const catalog = readSource('src/shared/typography/font-catalog.ts')
  const defaultFont = catalog.match(/DEFAULT_TEXT_FONT_FAMILY\s*=\s*'([^']+)'/)
  assert.ok(defaultFont, 'DEFAULT_TEXT_FONT_FAMILY not found in font-catalog.ts')
  assert.notEqual(TEXT_FONT_FAMILY, defaultFont[1])
  // The font loader asks Google Fonts by the catalogue value, so the clip's
  // family has to be one of them.
  assert.match(catalog, new RegExp(`value:\\s*'${TEXT_FONT_FAMILY}'`))
})

test('the project holds one text clip on one visible track', () => {
  const project = buildSeededProject()
  const item = project.timeline.items.find((candidate) => candidate.id === TEXT_CLIP_ID)
  assert.ok(item, 'the seeded project has no text clip')
  assert.equal(item.type, 'text')
  assert.equal(item.fontFamily, TEXT_FONT_FAMILY)
  assert.ok(item.text.length > 0)
  const track = project.timeline.tracks.find((candidate) => candidate.id === item.trackId)
  assert.ok(track, 'the text clip is on a track the project does not describe')
  assert.equal(track.visible, true)
})
