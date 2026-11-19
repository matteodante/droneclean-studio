import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { LUT_SIZE, benchCubeText, benchLutTable, writeBenchLut } from '../lib/lut.mjs'
import { parseCube } from '../lib/inputs.mjs'

const PINNED_SHA256 = '54f7a81d03318ebe1f884960b1b0b5f6aa244d7b99e78f758976a6ab0fc746f4'
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')
const at = (r, g, b) => benchLutTable()[r + LUT_SIZE * (g + LUT_SIZE * b)]

test('the generated LUT is deterministic: same bytes every run, hash pinned', () => {
  assert.equal(benchCubeText(), benchCubeText())
  assert.equal(sha256(benchCubeText()), PINNED_SHA256)
})

test('the file is a 33-point .cube that parseCube accepts', () => {
  const text = benchCubeText()
  assert.match(text, /^TITLE "DroneClean bench grade"\nLUT_3D_SIZE 33\n/)
  assert.equal(text.includes('\r'), false)
  const lut = parseCube(text)
  assert.equal(lut.lutSize, '33')
  assert.equal(Buffer.from(lut.lutData, 'base64').length, 33 ** 3 * 4)
})

test('each channel is monotonic along its own axis and its slope stays at 1.2 or less', () => {
  const n = LUT_SIZE - 1
  for (let c = 0; c < 3; c++) {
    // The other two axes at their middle value: only channel c's own axis matters (the grade is per channel).
    const mid = (n / 2) | 0
    let previous = null
    let maxSlope = 0
    for (let i = 0; i < LUT_SIZE; i++) {
      const index = [mid, mid, mid]
      index[c] = i
      const value = at(...index)[c]
      if (previous !== null) {
        assert.ok(value >= previous, `channel ${c} falls at step ${i}`)
        maxSlope = Math.max(maxSlope, (value - previous) * n)
      }
      previous = value
    }
    assert.ok(maxSlope <= 1.2, `channel ${c} slope ${maxSlope}`)
    assert.ok(maxSlope > 0.8, `channel ${c} is not a grade at all (${maxSlope})`)
  }
  // The other axes do not change a channel's value.
  assert.deepEqual(at(10, 0, 0)[0], at(10, 32, 32)[0])
})

test('it is a mild warm grade: black stays black, red lifts and blue lowers in the highlights', () => {
  assert.deepEqual(at(0, 0, 0), [0, 0, 0])
  const white = at(32, 32, 32)
  assert.equal(white[0], 1)
  assert.equal(white[1], 1)
  assert.ok(white[2] < 1 && white[2] > 0.95)
  const mid = at(16, 16, 16)
  assert.ok(mid[0] > mid[1] && mid[1] > mid[2])
})

test('writeBenchLut writes the same bytes into a new folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-lut-'))
  const file = writeBenchLut(path.join(dir, 'sub', 'bench-grade.cube'))
  assert.equal(sha256(fs.readFileSync(file, 'utf8')), PINNED_SHA256)
  fs.rmSync(dir, { recursive: true })
})
