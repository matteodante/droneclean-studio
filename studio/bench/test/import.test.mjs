// Unit tests for the import measurement's input list and its pass/fail arithmetic (no browser).
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IMPORT_CLIP_NAMES, resolveImportClips, summariseImport } from '../lib/imports.mjs'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-import-test-'))
after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

function makeClips(names = IMPORT_CLIP_NAMES, bytes = 1000) {
  for (const [index, name] of names.entries()) {
    fs.writeFileSync(path.join(tempDir, name), Buffer.alloc(bytes + index))
  }
  return names
}

describe('import measurement inputs', () => {
  it('describes the six clips in order with their size and modification time', () => {
    makeClips()
    const clips = resolveImportClips(tempDir)

    assert.equal(clips.length, 6)
    assert.deepEqual(
      clips.map((clip) => clip.fileName),
      IMPORT_CLIP_NAMES,
    )
    assert.equal(clips[0].bytes, 1000)
    assert.equal(clips[5].bytes, 1005)
    assert.match(clips[0].path, new RegExp(`${IMPORT_CLIP_NAMES[0]}$`))
    assert.ok(Number.isFinite(clips[0].lastModifiedMs))
  })

  it('names a missing clip instead of importing a shorter list', () => {
    assert.throws(
      () => resolveImportClips(tempDir, ['DJI_20261115114020_0019_D.MP4', 'not-there.MP4']),
      /not-there\.MP4/,
    )
  })
})

describe('import measurement summary', () => {
  const timings = [
    { fileName: 'a', seconds: 1 },
    { fileName: 'b', seconds: 2 },
  ]

  it('passes only under both limits', () => {
    const summary = summariseImport({
      timings,
      totalSeconds: 9.99,
      workspaceGrowthBytes: 50 * 2 ** 20 - 1,
      timeLimitSeconds: 10,
      growthLimitBytes: 50 * 2 ** 20,
    })

    assert.equal(summary.allClipsImported, true)
    assert.equal(summary.slowestClipSeconds, 2)
    assert.equal(summary.meetsTimeLimit, true)
    assert.equal(summary.meetsGrowthLimit, true)
  })

  it('fails at exactly the limits and on a failed clip', () => {
    const summary = summariseImport({
      timings: [...timings, { fileName: 'c', seconds: 0.1, error: 'boom' }],
      totalSeconds: 10,
      workspaceGrowthBytes: 50 * 2 ** 20,
      timeLimitSeconds: 10,
      growthLimitBytes: 50 * 2 ** 20,
    })

    assert.equal(summary.allClipsImported, false)
    assert.equal(summary.clipsImported, 2)
    assert.equal(summary.clipsFailed, 1)
    assert.equal(summary.meetsTimeLimit, false)
    assert.equal(summary.meetsGrowthLimit, false)
  })
})
