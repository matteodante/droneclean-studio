import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { loadConfig, requireInputs } from '../lib/config.mjs'
import { framesForSeconds, parseCube } from '../lib/inputs.mjs'

test('there is no default clip, and the 10 s segment starts at 60 s', () => {
  const config = loadConfig({})
  assert.equal(config.clip, '')
  assert.equal(config.importDir, '')
  assert.throws(() => requireInputs(config, { clip: true }), /BENCH_CLIP is not set/)
  assert.throws(() => requireInputs(config, { clip: false, importDir: true }), /BENCH_IMPORT_DIR/)
  assert.equal(config.lut, path.join(config.cache, 'bench-grade.cube'))
  assert.equal(config.lutGenerated, true)
  assert.equal(config.startSeconds, 60)
  assert.equal(config.segmentSeconds, 10)
  assert.equal(config.fidelitySeconds, 20)
  assert.equal(config.customBitrate, 120_000_000)
})

test('the paths and lengths can be set by environment variable or flag', () => {
  const config = loadConfig(
    {
      BENCH_CLIP: '/x/clip.mp4',
      BENCH_LUT: '/x/a.cube',
      BENCH_CACHE: '/x/cache',
      BENCH_FIDELITY_SECONDS: '30',
    },
    { seconds: '5', out: '/x/out' },
  )
  assert.equal(config.clip, '/x/clip.mp4')
  assert.equal(config.lut, '/x/a.cube')
  assert.equal(config.lutGenerated, false)
  assert.equal(config.cache, path.resolve('/x/cache'))
  assert.equal(config.outDir, path.resolve('/x/out'))
  assert.equal(config.segmentSeconds, 5)
  assert.equal(config.fidelitySeconds, 30)
})

test('a length that is not a positive number is refused', () => {
  assert.throws(() => loadConfig({ BENCH_SEGMENT_SECONDS: 'abc' }), /BENCH_SEGMENT_SECONDS/)
  assert.throws(() => loadConfig({}, { seconds: '-3' }), /positive/)
})

test('a missing input stops with a message that names it and the variable to set', () => {
  const config = loadConfig({
    BENCH_CLIP: '/nowhere/clip.mp4',
    BENCH_LUT: '/nowhere/a.cube',
  })
  assert.throws(
    () => requireInputs(config, { clip: true, lut: true }),
    (error) => {
      assert.match(error.message, /\/nowhere\/clip\.mp4/)
      assert.match(error.message, /BENCH_CLIP/)
      assert.match(error.message, /BENCH_LUT/)
      return true
    },
  )
  assert.doesNotThrow(() => requireInputs(config, { clip: false, lut: false }))
})

test('the generated LUT is never reported missing: it is written when the run needs it', () => {
  const config = loadConfig({ BENCH_CACHE: '/nowhere/cache' })
  assert.doesNotThrow(() => requireInputs(config, { clip: false, lut: true }))
})

test('seconds of 59.94 fps footage in frames', () => {
  assert.equal(framesForSeconds(10), 599)
  assert.equal(framesForSeconds(20), 1199)
})

test("a .cube file becomes the editor's rgba8 LUT data", () => {
  const cube = [
    'TITLE "Tiny"',
    'LUT_3D_SIZE 2',
    ...Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`),
  ].join('\n')
  const lut = parseCube(cube)
  assert.equal(lut.lutName, 'Tiny')
  assert.equal(lut.lutSize, '2')
  const bytes = Buffer.from(lut.lutData, 'base64')
  assert.equal(bytes.length, 8 * 4)
  assert.deepEqual([...bytes.subarray(4, 8)], [255, 0, 0, 255])
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0'), /expected 8 LUT entries/)
})
