import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSummary, marksFromEntries, percentile, summariseMarks } from '../lib/timings.mjs'

/** Three frames of 10 ms render each: 2 decode, 1 upload, 3 stabilize; readback 1; encode runs behind. */
function fixture() {
  const marks = []
  for (let f = 0; f < 3; f++) {
    const t = f * 20
    marks.push({ name: 'frame.render', start: t, duration: 10, frame: f })
    marks.push({ name: 'decode', start: t + 1, duration: 2 })
    marks.push({ name: 'upload', start: t + 3, duration: 1 })
    marks.push({ name: 'stabilize', start: t + 4, duration: 3 })
    marks.push({ name: 'readback', start: t + 11, duration: 1, frame: f })
    marks.push({ name: 'encode', start: t + 12, duration: 6 + f, frame: f })
  }
  return marks
}

test('percentile interpolates', () => {
  assert.equal(percentile([], 95), null)
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3)
  assert.equal(percentile([0, 10], 95), 9.5)
})

test('per-stage stats, derived composite and slowest stage', () => {
  const s = summariseMarks(fixture())
  assert.equal(s.frames, 3)
  assert.equal(s.stages.decode.meanPerFrameMs, 2)
  assert.equal(s.stages.stabilize.meanPerFrameMs, 3)
  // 10 ms render minus 2 + 1 + 3 = 4 ms of effects and composite
  assert.equal(s.stages['effects-composite'].meanPerFrameMs, 4)
  assert.equal(s.stages.encode.meanPerFrameMs, 7)
  assert.equal(s.stages.encode.p95PerFrameMs, 7.9)
  assert.equal(s.slowest, 'encode')
  assert.deepEqual(s.rows, [
    'decode',
    'upload',
    'stabilize',
    'effects-composite',
    'readback',
    'encode',
  ])
})

test('a mark without a frame goes to the render that began before it; frames without marks count as zero', () => {
  const marks = [
    { name: 'frame.render', start: 0, duration: 5, frame: 0 },
    { name: 'frame.render', start: 10, duration: 5, frame: 1 },
    { name: 'write', start: 12, duration: 4 },
  ]
  const s = summariseMarks(marks)
  assert.equal(s.stages.write.totalMs, 4)
  assert.equal(s.stages.write.meanPerFrameMs, 2)
  assert.equal(s.stages.write.p95PerFrameMs, 3.8)
  assert.equal(s.stages.write.meanPerMarkMs, 4)
})

test('warm-up frames can be skipped', () => {
  const s = summariseMarks(fixture(), { skipFrames: 1 })
  assert.equal(s.frames, 2)
  assert.equal(s.skippedFrames, 1)
})

test('no render marks: nothing to report', () => {
  const s = summariseMarks([{ name: 'decode', start: 0, duration: 1 }])
  assert.equal(s.frames, 0)
  assert.equal(s.slowest, null)
  assert.match(formatSummary('t', s), /no marks recorded/)
})

test('marksFromEntries keeps only dc.* and reads the frame from detail', () => {
  const m = marksFromEntries([
    { name: 'dc.encode', startTime: 5, duration: 2, detail: { frame: 4 } },
    { name: 'scrub.renderFrame.full', startTime: 1, duration: 9 },
    { name: 'dc.decode', startTime: 6, duration: 1, detail: null },
  ])
  assert.deepEqual(m, [
    { name: 'encode', start: 5, duration: 2, frame: 4 },
    { name: 'decode', start: 6, duration: 1 },
  ])
})

test('the table names the slowest stage', () => {
  const text = formatSummary('export', summariseMarks(fixture()), { wallMsPerFrame: 20 })
  assert.match(text, /encode \(encoder takes the sample\).*<- slowest/)
  assert.match(text, /real time 20\.00 ms per frame/)
})

test('the report prints each run next to the ceiling and names the slowest stage', async () => {
  const { buildReport } = await import('../report.mjs')
  const summary = summariseMarks(fixture())
  const stageRecord = {
    date: '2026-11-19T00:00:00Z',
    git: { commit: 'abcdef1234567' },
    machine: { model: 'Mac', chip: 'M4', memoryGiB: 16 },
    result: {
      runs: [
        {
          label: 'export, plain clip',
          kind: 'export',
          frames: 3,
          framesPerSecond: 40,
          wallMsPerFrame: 25,
          summary,
        },
        { label: 'preview, plain clip', kind: 'preview', ran: false, error: 'boom' },
      ],
    },
  }
  const ceiling = {
    result: {
      decode: { ran: true, framesPerSecond: 61 },
      encodes: [
        { label: 'HEVC Main 10', ran: true, framesPerSecond: 43 },
        { label: 'ProRes', ran: false, error: 'no encoder' },
      ],
    },
  }
  const text = buildReport(stageRecord, ceiling)
  assert.match(text, /FFmpeg decode alone.*61 fps = 16\.4 ms/)
  assert.match(text, /HEVC Main 10 .*43 fps = 23\.3 ms/)
  assert.match(text, /ProRes .*did not run: no encoder/)
  assert.match(text, /slowest stage: encode \(7\.00 ms per frame\)/)
  assert.match(text, /preview, plain clip: did not run: boom/)
  assert.match(buildReport(null, null), /No stage-timings record/)
})
