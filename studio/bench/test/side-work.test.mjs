// Unit tests for the import side-work measurement's arithmetic and file helpers (no browser, no footage).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  busyCoresOf,
  copyGyroPackage,
  loadOf,
  parsePsTime,
  probeStreamTypes,
  summariseSideWork,
} from '../lib/side-work.mjs'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-side-work-test-'))
after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

describe('summariseSideWork', () => {
  it('adds the kinds up, names the longest and halves the serial time', () => {
    const summary = summariseSideWork({
      importSeconds: 1,
      kindSeconds: { filmstrips: 20, proxies: 100, 'motion-data': 30 },
      togetherSeconds: 110,
    })
    assert.equal(summary.sideWorkSerialSeconds, 150)
    assert.equal(summary.serialSeconds, 151)
    assert.equal(summary.togetherSavedSeconds, 40)
    assert.deepEqual(summary.longestKind, { kind: 'proxies', seconds: 100 })
    assert.equal(summary.longestKindShare, 0.67)
    assert.equal(summary.halfOfSerialSeconds, 75.5)
  })

  it('has no saving when the together phase did not run', () => {
    const summary = summariseSideWork({
      importSeconds: 1,
      kindSeconds: { proxies: 5 },
      togetherSeconds: null,
    })
    assert.equal(summary.togetherSeconds, null)
    assert.equal(summary.togetherSavedSeconds, null)
  })
})

describe('loadOf', () => {
  it('turns percent of the machine into cores kept busy', () => {
    const load = loadOf({
      samples: 10,
      cpu: {
        coreCount: 10,
        overallPercent: { mean: 35, peak: 60 },
        perCorePercent: [{ mean: 90 }, { mean: 60 }, { mean: 10 }],
      },
      gpu: { busyPercent: { mean: 5, peak: 9 } },
      browserMemory: { peakBytes: 123 },
    })
    assert.equal(load.busyCoresMean, 3.5)
    assert.equal(load.busyCoresPeak, 6)
    assert.equal(load.coresOver50PercentMean, 2)
    assert.equal(load.browserPeakBytes, 123)
  })
})

describe('gyro package and ffprobe helpers', () => {
  it('says why the gyro package is missing instead of skipping silently', () => {
    const result = copyGyroPackage(path.join(tempDir, 'dist'), path.join(tempDir, 'studio'))
    assert.equal(result.available, false)
    assert.match(result.reason, /build\.sh/)
  })

  it('copies the worker and the package under the paths the app serves', () => {
    const studio = path.join(tempDir, 'repo', 'studio')
    const wasm = path.join(tempDir, 'repo', 'gyroflow', 'wasm')
    fs.mkdirSync(studio, { recursive: true })
    fs.mkdirSync(path.join(wasm, 'js'), { recursive: true })
    fs.mkdirSync(path.join(wasm, 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(wasm, 'js', 'gyro-worker.js'), 'x')
    fs.writeFileSync(path.join(wasm, 'pkg', 'gyroflow_wasm_bg.wasm'), 'w')
    const dist = path.join(tempDir, 'dist2')
    assert.deepEqual(copyGyroPackage(dist, studio), { available: true })
    assert.ok(fs.existsSync(path.join(dist, 'gyroflow', 'wasm', 'js', 'gyro-worker.js')))
    assert.ok(fs.existsSync(path.join(dist, 'gyroflow', 'wasm', 'pkg', 'gyroflow_wasm_bg.wasm')))
  })

  it('reports an unreadable file instead of "no audio"', () => {
    const result = probeStreamTypes(path.join(tempDir, 'nothing.mp4'))
    assert.ok(result.error)
    assert.equal(result.hasAudio, undefined)
  })
})

describe('browser CPU time', () => {
  it('reads ps TIME in minutes and hours', () => {
    assert.equal(parsePsTime('0:00.05'), 0.05)
    assert.equal(parsePsTime('1:02.50'), 62.5)
    assert.equal(parsePsTime('1:02:03.00'), 3723)
    assert.equal(parsePsTime('garbage'), null)
  })

  it('turns CPU seconds over wall seconds into cores', () => {
    assert.equal(busyCoresOf(10, 40, 10), 3)
    assert.equal(busyCoresOf(null, 40, 10), null)
    assert.equal(busyCoresOf(10, 40, 0), null)
  })
})
