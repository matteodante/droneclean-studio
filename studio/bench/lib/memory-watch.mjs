// The memory curve of one run: every 500 ms the resident memory of the benchmark browser's processes and, where the
// platform shows it, the GPU driver's memory in use (macOS: `ioreg`, the same reading as the machine sampler's;
// elsewhere `gpuBytes` is null and `gpuSource` says why). Unlike the machine sampler's summary it keeps every
// sample, so the curve can be judged (lib/memory-curve.mjs) and so the measurement can look at the newest reading
// and stop the export.
import { execFile } from 'node:child_process'
import { sampleBrowserMemory } from './browser.mjs'
import { parseIoregStatistics } from './sampler.mjs'

const WATCH_INTERVAL_MS = 500

/** Run a command and give its output, or null when it fails (the way the machine sampler's `execText` does). */
function execText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 8 << 20 }, (error, out) =>
      resolve(error ? null : out),
    )
  })
}

async function ioregGpuBytes() {
  const out = await execText('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'])
  return parseIoregStatistics(out)?.memoryBytes ?? null
}

/** Samples of one browser, found by its profile folder. `stop()` ends it; times are ms from the start. */
export function startMemoryWatch(
  profileDir,
  {
    intervalMs = WATCH_INTERVAL_MS,
    readBrowser = () => sampleBrowserMemory(profileDir),
    readGpu = process.platform === 'darwin' ? ioregGpuBytes : async () => null,
    clock = () => performance.now(),
  } = {},
) {
  const origin = clock()
  const samples = []
  let stopped = false
  let timer = null
  let inFlight = Promise.resolve()

  const tick = async () => {
    const started = clock()
    let browser = null
    try {
      browser = readBrowser()
    } catch {
      // A browser that is starting or closing has no readable process table row: a gap, not a zero.
    }
    const gpuBytes = await readGpu().catch(() => null)
    samples.push({
      t: Math.round(clock() - origin),
      browserBytes: browser?.total ?? null,
      gpuBytes,
    })
    if (!stopped) {
      timer = setTimeout(
        () => {
          inFlight = tick()
        },
        Math.max(0, intervalMs - (clock() - started)),
      )
    }
  }
  inFlight = tick()

  return {
    now: () => Math.round(clock() - origin),
    /** The newest sample, or null before the first. */
    latest: () => samples.at(-1) ?? null,
    /** The samples in [since, until] (ms from the start). */
    series: ({ since = -Infinity, until = Infinity } = {}) =>
      samples.filter((s) => s.t >= since && s.t <= until),
    gpuSource:
      process.platform === 'darwin'
        ? 'ioreg "In use system memory" of the GPU driver (system-wide, not only the browser)'
        : `not read on ${process.platform} (the machine sampler has nvidia-smi for Windows)`,
    async stop() {
      stopped = true
      clearTimeout(timer)
      await inFlight
    },
  }
}
