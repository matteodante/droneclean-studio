import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cpuPercentPerCore,
  meanAndPeak,
  parseIoregStatistics,
  parseNvidiaSmiLine,
  startSampler,
  summariseSamples,
} from '../lib/sampler.mjs'

const IOREG = `+-o AGXAcceleratorG16X  <class AGXAcceleratorG16X>
    {
      "IOClass" = "AGXAcceleratorG16X"
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=4999675904,"Tiler Utilization %"=42,"recoveryCount"=0,"Renderer Utilization %"=41,"Device Utilization %"=42,"In use system memory"=409272320}
    }`

test('ioreg: device utilisation and memory', () => {
  const s = parseIoregStatistics(IOREG)
  assert.equal(s.busyPercent, 42)
  assert.equal(s.rendererPercent, 41)
  assert.equal(s.memoryBytes, 409272320)
  assert.equal(s.memoryAllocatedBytes, 4999675904)
})

test('ioreg: no statistics is null, not zeros', () => {
  assert.equal(parseIoregStatistics(''), null)
  assert.equal(parseIoregStatistics('"PerformanceStatistics" = {"x"=1}'), null)
  assert.equal(parseIoregStatistics(undefined), null)
})

test('nvidia-smi: a normal line', () => {
  assert.deepEqual(parseNvidiaSmiLine('87, 45, 12, 3210\r'), {
    busyPercent: 87,
    encoderPercent: 45,
    decoderPercent: 12,
    memoryBytes: 3210 * 2 ** 20,
  })
})

test('nvidia-smi: [N/A] fields are null, junk lines are null', () => {
  const s = parseNvidiaSmiLine('5, [N/A], [N/A], 800')
  assert.equal(s.encoderPercent, null)
  assert.equal(s.decoderPercent, null)
  assert.equal(s.busyPercent, 5)
  assert.equal(parseNvidiaSmiLine('[N/A], [N/A], [N/A], [N/A]'), null)
  assert.equal(parseNvidiaSmiLine('NVIDIA-SMI has failed'), null)
  assert.equal(parseNvidiaSmiLine(''), null)
})

test('cpu use per core from two readings', () => {
  const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, irq: 0, idle } })
  const pct = cpuPercentPerCore([cpu(0, 0), cpu(0, 0)], [cpu(50, 50), cpu(0, 100)])
  assert.deepEqual(pct, [50, 0])
})

test('mean and peak ignore nulls; all null is null', () => {
  assert.deepEqual(meanAndPeak([10, null, 30]), { mean: 20, peak: 30 })
  assert.equal(meanAndPeak([null, null]), null)
})

const ALL = { available: true }
const MISSING = { available: false, reason: 'no counter' }

test('summary shape, and a missing source says so instead of zeros', () => {
  const samples = [
    { t: 0, cpuPerCore: [10, 20], gpu: { busyPercent: 40, memoryBytes: 2 ** 30 }, browser: null },
    { t: 500, cpuPerCore: [30, 40], gpu: { busyPercent: 60, memoryBytes: 2 ** 30 }, browser: null },
  ]
  const s = summariseSamples(samples, {
    gpuBusy: ALL,
    gpuMemory: ALL,
    gpuEncoder: MISSING,
    gpuDecoder: MISSING,
    browserMemory: ALL,
  })
  assert.equal(s.samples, 2)
  assert.equal(s.cpu.coreCount, 2)
  assert.deepEqual(s.cpu.perCorePercent, [
    { mean: 20, peak: 30 },
    { mean: 30, peak: 40 },
  ])
  assert.deepEqual(s.cpu.overallPercent, { mean: 25, peak: 35 })
  assert.deepEqual(s.gpu.busyPercent, { mean: 50, peak: 60 })
  assert.deepEqual(s.gpu.memoryMiB, { mean: 1024, peak: 1024 })
  assert.deepEqual(s.gpu.encoderEnginePercent, { available: false, reason: 'no counter' })
  assert.equal(s.browserMemory.available, false)
})

test('a window summarises only its samples', () => {
  const samples = [0, 500, 1000].map((t, i) => ({
    t,
    cpuPerCore: [i * 10],
    gpu: null,
    browser: null,
  }))
  const s = summariseSamples(
    samples,
    {
      gpuBusy: MISSING,
      gpuMemory: MISSING,
      gpuEncoder: MISSING,
      gpuDecoder: MISSING,
      browserMemory: ALL,
    },
    { since: 400, until: 600 },
  )
  assert.equal(s.samples, 1)
  assert.deepEqual(s.cpu.overallPercent, { mean: 10, peak: 10 })
})

test('a sampler runs, samples and stops, with injected sources', async () => {
  let n = 0
  const cpus = () => [{ times: { user: (n += 10), nice: 0, sys: 0, irq: 0, idle: n } }]
  const gpuSource = {
    start: async () => ({ gpuBusy: ALL, gpuMemory: ALL, gpuEncoder: MISSING, gpuDecoder: MISSING }),
    read: async () => ({ busyPercent: 5, memoryBytes: 2 ** 20 }),
    stop() {},
  }
  const sampler = await startSampler({
    gpuSource,
    readCpus: cpus,
    readBrowser: () => ({ total: 7, byType: { gpu: 7 } }),
    intervalMs: 5,
  })
  await new Promise((r) => setTimeout(r, 60))
  const s = await sampler.stop()
  assert.ok(s.samples >= 3)
  assert.equal(s.browserMemory.peakBytes, 7)
  assert.equal(s.gpu.busyPercent.peak, 5)
})
