// Measures the machine while a measurement runs: CPU use per core, GPU busy time and memory, the media engines
// where the platform shows them, and the resident memory of the benchmark's browser. One sample every 500 ms.
//
// A source the platform does not offer is recorded as missing, with the reason; its numbers are `null`, never 0.
//   macOS:   `ioreg -r -d 1 -c IOAccelerator` (no sudo): "Device Utilization %" and the driver's memory in use.
//            No counter for the media engine: encoder and decoder are missing.
//   Windows: `nvidia-smi --query-gpu=utilization.gpu,utilization.encoder,utilization.decoder,memory.used
//            --format=csv,noheader,nounits -lms 500` (NVIDIA only; the first GPU it prints).
import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { sampleBrowserMemory } from './browser.mjs'

const SAMPLE_INTERVAL_MS = 500

/** The browser's profile folders are `<tmp>/droneclean-bench-profile-XXXX` (browser.mjs); this prefix finds any. */
const BROWSER_PROFILE_PREFIX = path.join(os.tmpdir(), 'droneclean-bench-profile-')

/** `ioreg` output -> the first accelerator's statistics, or null when there are none. */
export function parseIoregStatistics(text) {
  const block = /"PerformanceStatistics"\s*=\s*\{([^}]*)\}/.exec(text ?? '')
  if (!block) return null
  const stats = {}
  for (const m of block[1].matchAll(/"([^"]+)"\s*=\s*(-?\d+)/g)) stats[m[1]] = Number(m[2])
  if (stats['Device Utilization %'] === undefined) return null
  return {
    busyPercent: stats['Device Utilization %'],
    rendererPercent: stats['Renderer Utilization %'] ?? null,
    tilerPercent: stats['Tiler Utilization %'] ?? null,
    memoryBytes: stats['In use system memory'] ?? null,
    memoryAllocatedBytes: stats['Alloc system memory'] ?? null,
  }
}

/** One line of `nvidia-smi --format=csv,noheader,nounits` -> numbers, `null` for a field it prints as [N/A]. */
export function parseNvidiaSmiLine(line) {
  const fields = String(line ?? '')
    .trim()
    .split(',')
    .map((f) => f.trim())
  if (fields.length < 4 || fields.some((f) => f === '')) return null
  const number = (f) => (/^\d+(\.\d+)?$/.test(f) ? Number(f) : null)
  const [busy, encoder, decoder, memoryMiB] = fields.map(number)
  if (busy === null && encoder === null && decoder === null && memoryMiB === null) return null
  return {
    busyPercent: busy,
    encoderPercent: encoder,
    decoderPercent: decoder,
    memoryBytes: memoryMiB === null ? null : memoryMiB * 2 ** 20,
  }
}

/** Percent busy of each core between two `os.cpus()` readings. */
export function cpuPercentPerCore(previous, current) {
  const busyAndTotal = (c) => {
    const { user, nice, sys, idle, irq } = c.times
    return { busy: user + nice + sys + irq, total: user + nice + sys + irq + idle }
  }
  return current.map((cpu, i) => {
    const a = busyAndTotal(previous[i] ?? cpu)
    const b = busyAndTotal(cpu)
    const total = b.total - a.total
    return total > 0 ? Math.min(100, Math.max(0, ((b.busy - a.busy) / total) * 100)) : 0
  })
}

const round = (n, digits = 1) => Number(n.toFixed(digits))

/** Mean and peak of the numbers that are not null; null when none is a number (the source is missing). */
export function meanAndPeak(values, digits = 1) {
  const numbers = values.filter((v) => typeof v === 'number')
  if (numbers.length === 0) return null
  return {
    mean: round(numbers.reduce((s, v) => s + v, 0) / numbers.length, digits),
    peak: round(Math.max(...numbers), digits),
  }
}

/**
 * The summary written into a record. `samples` are `{ t, cpuPerCore, gpu, browser }`; `sources` says what each
 * source could do (`{ available, reason? }`). Only samples in [since, until] count.
 */
export function summariseSamples(samples, sources, { since = -Infinity, until = Infinity } = {}) {
  const inside = samples.filter((s) => s.t >= since && s.t <= until && s.cpuPerCore)
  const cores = inside[0]?.cpuPerCore.length ?? 0
  const perCore = Array.from({ length: cores }, (_, i) =>
    meanAndPeak(inside.map((s) => s.cpuPerCore[i])),
  )
  const overall = meanAndPeak(
    inside.map((s) => s.cpuPerCore.reduce((sum, v) => sum + v, 0) / s.cpuPerCore.length),
  )
  const gpu = (field) => meanAndPeak(inside.map((s) => s.gpu?.[field] ?? null))
  const gpuMemory = meanAndPeak(
    inside.map((s) => (s.gpu?.memoryBytes ?? null) / 2 ** 20 || null),
    0,
  )
  const browserPeak = inside.reduce(
    (best, s) => (s.browser && s.browser.total > (best?.total ?? 0) ? s.browser : best),
    null,
  )
  const missing = (source) =>
    source.available ? undefined : { available: false, reason: source.reason ?? 'unavailable' }
  return {
    intervalMs: SAMPLE_INTERVAL_MS,
    samples: inside.length,
    durationSeconds: inside.length > 1 ? round(inside.at(-1).t / 1000 - inside[0].t / 1000, 1) : 0,
    cpu: {
      coreCount: cores,
      overallPercent: overall,
      perCorePercent: perCore,
    },
    gpu: {
      busyPercent: missing(sources.gpuBusy) ?? gpu('busyPercent'),
      memoryMiB: missing(sources.gpuMemory) ?? gpuMemory,
      encoderEnginePercent: missing(sources.gpuEncoder) ?? gpu('encoderPercent'),
      decoderEnginePercent: missing(sources.gpuDecoder) ?? gpu('decoderPercent'),
    },
    browserMemory:
      missing(sources.browserMemory) ??
      (browserPeak
        ? { peakBytes: browserPeak.total, peakByProcessType: browserPeak.byType }
        : { available: false, reason: 'no benchmark browser was running in the window' }),
  }
}

function execText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 8 << 20 }, (error, out) =>
      resolve(error ? null : out),
    )
  })
}

/** The GPU source of this platform: `{ start, read, stop, sources }`; `read()` is the latest numbers or null. */
function createGpuSource(platform = process.platform) {
  if (platform === 'darwin') {
    return {
      async start() {
        const ok = parseIoregStatistics(
          await execText('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']),
        )
        const reason = 'ioreg shows no GPU statistics on this Mac'
        return {
          gpuBusy: ok ? { available: true } : { available: false, reason },
          gpuMemory: ok ? { available: true } : { available: false, reason },
          gpuEncoder: {
            available: false,
            reason: 'macOS shows no media-engine counter without sudo',
          },
          gpuDecoder: {
            available: false,
            reason: 'macOS shows no media-engine counter without sudo',
          },
        }
      },
      async read() {
        const stats = parseIoregStatistics(
          await execText('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']),
        )
        return stats && { busyPercent: stats.busyPercent, memoryBytes: stats.memoryBytes }
      },
      stop() {},
    }
  }
  if (platform === 'win32') {
    let child = null
    let latest = null
    let failure = null
    return {
      start() {
        return new Promise((resolve) => {
          const done = (available, reason) => {
            const source = available ? { available: true } : { available: false, reason }
            resolve({
              gpuBusy: source,
              gpuMemory: source,
              gpuEncoder: source,
              gpuDecoder: source,
            })
          }
          child = spawn(
            'nvidia-smi',
            [
              '--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder,memory.used',
              '--format=csv,noheader,nounits',
              `-lms`,
              String(SAMPLE_INTERVAL_MS),
            ],
            { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
          )
          let buffer = ''
          let first = true
          child.on('error', (e) => {
            failure = `nvidia-smi could not start (${e.code ?? e.message}): no NVIDIA GPU or driver`
            if (first) {
              first = false
              done(false, failure)
            }
          })
          child.on('exit', () => {
            if (first) {
              first = false
              done(false, 'nvidia-smi exited without a reading: no NVIDIA GPU')
            }
          })
          child.stdout.on('data', (chunk) => {
            buffer += chunk
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const parsed = parseNvidiaSmiLine(line)
              if (!parsed) continue
              latest = parsed
              if (first) {
                first = false
                done(true)
              }
            }
          })
          // A machine whose nvidia-smi prints nothing readable is a missing source, not a hang.
          setTimeout(() => {
            if (first) {
              first = false
              done(false, 'nvidia-smi printed no readable line within 5 s')
            }
          }, 5000).unref()
        })
      },
      read: async () => latest,
      stop() {
        child?.kill()
      },
    }
  }
  return {
    start: async () => {
      const source = { available: false, reason: `no GPU counter implemented for ${platform}` }
      return { gpuBusy: source, gpuMemory: source, gpuEncoder: source, gpuDecoder: source }
    },
    read: async () => null,
    stop() {},
  }
}

function readBrowserMemory() {
  try {
    return sampleBrowserMemory(BROWSER_PROFILE_PREFIX)
  } catch {
    return null
  }
}

/**
 * Start sampling. `stop()` ends it and returns the summary of the whole run; `summarise({ since, until })` (times
 * from `sampler.now()`) summarises a window while it runs, so one sampler can serve several runs inside a measurement.
 */
export async function startSampler({
  gpuSource = createGpuSource(),
  readCpus = os.cpus,
  readBrowser = readBrowserMemory,
  intervalMs = SAMPLE_INTERVAL_MS,
  clock = () => performance.now(),
} = {}) {
  const gpuSources = await gpuSource.start()
  const sources = {
    ...gpuSources,
    browserMemory: { available: true },
  }
  const samples = []
  const origin = clock()
  const now = () => Math.round(clock() - origin)
  let previous = readCpus()
  let stopped = false
  let timer = null
  let inFlight = Promise.resolve()

  const tick = async () => {
    const started = clock()
    const cpus = readCpus()
    const [gpu] = await Promise.all([gpuSource.read().catch(() => null)])
    samples.push({
      t: now(),
      cpuPerCore: cpuPercentPerCore(previous, cpus),
      gpu: gpu ?? null,
      browser: readBrowser(),
    })
    previous = cpus
    if (!stopped) {
      timer = setTimeout(
        () => {
          inFlight = tick()
        },
        Math.max(0, intervalMs - (clock() - started)),
      )
    }
  }
  timer = setTimeout(() => {
    inFlight = tick()
  }, intervalMs)

  return {
    now,
    sources,
    summarise: (window) => summariseSamples(samples, sources, window),
    async stop() {
      stopped = true
      clearTimeout(timer)
      await inFlight
      gpuSource.stop()
      return summariseSamples(samples, sources)
    },
  }
}
