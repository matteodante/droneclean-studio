// The judgements of the long-export measurement, on fixtures: no browser, no GPU, no footage.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  diskNeededBytes,
  downsample,
  judgeFlatMemory,
  judgeOutputGrowth,
  linearFit,
  memoryExceedsLimit,
  perMinute,
  planTimeline,
} from '../lib/memory-curve.mjs'
import { startMemoryWatch } from '../lib/memory-watch.mjs'

const MIB = 2 ** 20
const GIB = 2 ** 30

/** A curve of `seconds` seconds at 500 ms: `bytesAt(seconds)` plus a small deterministic wobble. */
function curve(seconds, bytesAt, wobbleMiB = 0) {
  return Array.from({ length: seconds * 2 + 1 }, (_, i) => {
    const t = i * 500
    const wobble = Math.sin(i * 1.7) * wobbleMiB * MIB
    return { t, browserBytes: Math.round(bytesAt(t / 1000) + wobble), gpuBytes: 400 * MIB }
  })
}

test('linear fit: exact line, flat line, one point', () => {
  const fit = linearFit([0, 1, 2, 3].map((x) => ({ x, y: 10 + 5 * x })))
  assert.ok(Math.abs(fit.slope - 5) < 1e-9)
  assert.ok(Math.abs(fit.intercept - 10) < 1e-9)
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9)
  assert.equal(linearFit([1, 2, 3].map((x) => ({ x, y: 7 }))).slope, 0)
  assert.equal(linearFit([{ x: 1, y: 3 }]).slope, 0)
})

test('a run that fills up and then holds is flat', () => {
  // 1.2 GiB warming up to 2.6 GiB in the first 40 s, then 2.6 GiB with a wobble of 20 MiB.
  const series = curve(120, (s) => (s < 40 ? 1.2 * GIB + (s / 40) * 1.4 * GIB : 2.6 * GIB), 20)
  const verdict = judgeFlatMemory(series)
  assert.equal(verdict.verdict, 'flat')
  assert.equal(verdict.flat, true)
  assert.ok(Math.abs(verdict.slopeMiBPerMinute) < 5, `slope ${verdict.slopeMiBPerMinute}`)
  assert.equal(verdict.startBytes, series[0].browserBytes)
  assert.equal(verdict.endBytes, series.at(-1).browserBytes)
  assert.ok(verdict.peakBytes >= 2.6 * GIB)
})

test('a slow leak is growing, and says what a 20 minute export would reach', () => {
  // +100 MiB a minute from 2 GiB.
  const series = curve(120, (s) => 2 * GIB + (s / 60) * 100 * MIB, 10)
  const verdict = judgeFlatMemory(series)
  assert.equal(verdict.verdict, 'growing')
  assert.equal(verdict.flat, false)
  assert.ok(Math.abs(verdict.slopeMiBPerMinute - 100) < 3, `slope ${verdict.slopeMiBPerMinute}`)
  // 2 GiB + 20 minutes at 100 MiB: about 4 GiB.
  assert.ok(Math.abs(verdict.projectedBytesAtTarget - (2 * GIB + 2000 * MIB)) < 150 * MIB)
})

test('growth only in the first half (warm-up) does not count', () => {
  const series = curve(120, (s) => 1 * GIB + Math.min(s, 55) * 40 * MIB)
  assert.equal(judgeFlatMemory(series).verdict, 'flat')
})

test('a flat run over the limit is over-limit, not flat', () => {
  const series = curve(120, () => 6.5 * GIB)
  const verdict = judgeFlatMemory(series, { limitBytes: 6 * GIB })
  assert.equal(verdict.verdict, 'over-limit')
  assert.equal(verdict.flat, false)
})

test('a run too short for a slope is not called flat; no samples is no data', () => {
  assert.equal(judgeFlatMemory(curve(30, () => GIB)).verdict, 'too-short')
  assert.equal(judgeFlatMemory(curve(30, () => GIB)).flat, false)
  assert.equal(judgeFlatMemory([]).verdict, 'no-data')
  assert.equal(judgeFlatMemory([{ t: 0, browserBytes: null }]).verdict, 'no-data')
  assert.equal(judgeFlatMemory(undefined).flat, false)
})

test('the limit check: strictly over, and a missing reading never trips it', () => {
  assert.equal(memoryExceedsLimit({ browserBytes: 6 * GIB + 1 }, 6 * GIB), true)
  assert.equal(memoryExceedsLimit({ browserBytes: 6 * GIB }, 6 * GIB), false)
  assert.equal(memoryExceedsLimit({ browserBytes: null }, 6 * GIB), false)
  assert.equal(memoryExceedsLimit(null, 6 * GIB), false)
})

test('per minute: buckets of the series with min, mean, max and the GPU peak', () => {
  const rows = perMinute(curve(120, (s) => GIB + s * MIB))
  assert.equal(rows.length, 3)
  assert.equal(rows[0].minute, 0)
  assert.equal(rows[0].samples, 120)
  assert.ok(rows[0].browserMiB.min < rows[0].browserMiB.mean)
  assert.ok(rows[0].browserMiB.mean < rows[0].browserMiB.max)
  assert.equal(rows[0].gpuMaxMiB, 400)
  assert.deepEqual(perMinute([]), [])
})

test('downsample keeps the ends and the highest point', () => {
  const series = curve(600, (s) => GIB + (s === 301 ? 3 * GIB : 0))
  const small = downsample(series, 100)
  assert.ok(small.length <= 101)
  assert.equal(small[0], series[0])
  assert.equal(small.at(-1), series.at(-1))
  assert.equal(Math.max(...small.map((s) => s.browserBytes)), 4 * GIB)
  assert.equal(downsample(series.slice(0, 10), 100).length, 10)
})

test('output growth: a streamed file has half its size at half-way', () => {
  const points = [10, 20, 30, 40, 50, 60].map((frame, i) => ({
    frame,
    growthBytes: (i + 1) * 15 * MIB,
  }))
  const verdict = judgeOutputGrowth(points, { totalFrames: 100, finalBytes: 180 * MIB })
  assert.equal(verdict.verdict, 'streamed')
  assert.equal(verdict.writtenAsItGoes, true)
  assert.equal(verdict.halfwayFrame, 50)
})

test('output growth: nothing on disk until the end is held-until-end', () => {
  const points = [10, 50, 90].map((frame) => ({ frame, growthBytes: 1 * MIB }))
  const verdict = judgeOutputGrowth(points, { totalFrames: 100, finalBytes: 500 * MIB })
  assert.equal(verdict.verdict, 'held-until-end')
  assert.equal(verdict.writtenAsItGoes, false)
})

test('output growth: in between is partial; missing facts are no data', () => {
  const partial = judgeOutputGrowth([{ frame: 50, growthBytes: 50 * MIB }], {
    totalFrames: 100,
    finalBytes: 500 * MIB,
  })
  assert.equal(partial.verdict, 'partial')
  assert.equal(judgeOutputGrowth([], { totalFrames: 100, finalBytes: 1 }).verdict, 'no-data')
  assert.equal(
    judgeOutputGrowth([{ frame: 10, growthBytes: 1 }], { totalFrames: 100, finalBytes: 1 }).verdict,
    'no-data',
  )
  assert.equal(
    judgeOutputGrowth([{ frame: 50, growthBytes: 1 }], { totalFrames: 100, finalBytes: 0 }).verdict,
    'no-data',
  )
})

const clips = [
  { fileName: 'a.MP4', bytes: 2_400_000_000, durationSeconds: 200 },
  { fileName: 'b.MP4', bytes: 3_700_000_000, durationSeconds: 300 },
  { fileName: 'c.MP4', bytes: 3_100_000_000, durationSeconds: 250 },
]

test('timeline plan: all clips by default, start times add up', () => {
  const plan = planTimeline(clips)
  assert.equal(plan.totalSeconds, 750)
  assert.equal(plan.exportSeconds, 750)
  assert.deepEqual(
    plan.clips.map((c) => [c.startSeconds, c.needed]),
    [
      [0, true],
      [200, true],
      [500, true],
    ],
  )
  assert.equal(plan.neededBytes, 9_200_000_000)
})

test('timeline plan: a limit copies only the clips it reaches', () => {
  const short = planTimeline(clips, { limitSeconds: 120 })
  assert.equal(short.exportSeconds, 120)
  assert.deepEqual(
    short.clips.map((c) => c.needed),
    [true, false, false],
  )
  assert.equal(short.neededBytes, 2_400_000_000)
  // A limit that ends exactly where a clip ends does not need the next clip.
  assert.deepEqual(
    planTimeline(clips, { limitSeconds: 200 }).clips.map((c) => c.needed),
    [true, false, false],
  )
  assert.equal(planTimeline(clips, { limitSeconds: 9999 }).exportSeconds, 750)
})

test('disk needed: clips, the output twice, and 4 GiB spare', () => {
  const needed = diskNeededBytes({
    neededBytes: 2 * GIB,
    exportSeconds: 120,
    bitsPerSecond: 80_000_000,
  })
  assert.equal(needed, 2 * GIB + 2 * 1_200_000_000 + 4 * GIB)
})

test('memory watch: samples the browser and the GPU, keeps gaps as null, windows the series', async () => {
  let now = 0
  let reading = 0
  const watch = startMemoryWatch('/unused', {
    intervalMs: 5,
    clock: () => (now += 5),
    readBrowser: () => (++reading === 2 ? null : { total: reading * 100 }),
    readGpu: async () => 7,
  })
  await new Promise((resolve) => setTimeout(resolve, 80))
  await watch.stop()
  const all = watch.series()
  assert.ok(all.length >= 3, `only ${all.length} samples`)
  assert.equal(all[0].browserBytes, 100)
  assert.equal(all[1].browserBytes, null)
  assert.equal(all[0].gpuBytes, 7)
  assert.deepEqual(watch.latest(), all.at(-1))
  assert.deepEqual(
    watch.series({ since: all[2].t }).map((s) => s.t),
    all.slice(2).map((s) => s.t),
  )
})

test('config: the whole timeline and a 6 GiB limit by default, both settable', async () => {
  const { loadConfig } = await import('../lib/config.mjs')
  const defaults = loadConfig({})
  assert.equal(defaults.longExportSeconds, null)
  assert.equal(defaults.memoryLimitGiB, 6)
  const set = loadConfig({ BENCH_MEMORY_LIMIT_GIB: '4' }, { longSeconds: '120' })
  assert.equal(set.longExportSeconds, 120)
  assert.equal(set.memoryLimitGiB, 4)
})
