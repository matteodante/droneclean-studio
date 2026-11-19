/**
 * How many parallel lanes the machine's media engine sustains (task 8.7, design section 4.1).
 *
 * The hardware that decodes and encodes video (VideoToolbox, NVDEC/NVENC, Quick Sync) is a fixed resource: past some
 * number of simultaneous streams a new one only takes a share of what the others had. The probe finds that number
 * by running 1, 2, 3 ... synthetic streams at once for a fraction of a second each and keeping the widest count
 * whose total throughput still grows by at least {@link MIN_LANE_GAIN} over the count below it.
 *
 * The load measured is a transcode: a hardware encode of every frame followed by a hardware decode, which is what a
 * proxy does and what saturates the engine first (measured on the M4 with FFmpeg: 195 frames/s with one process,
 * 221 with four). Decode alone is not probed: at a probe-sized picture it is limited by the JavaScript that feeds
 * it, not by the engine (2400 frames/s on the M4), so it would say nothing about 4K clips.
 *
 * The probe uses WebCodecs only, no file and no network, and takes under 2 s. The width is cached per machine in the
 * app's local storage; a different machine (cores, memory, GPU, browser) has another key and probes again. When the
 * browser has no WebCodecs or no hardware codec the width is 1: nothing is promised that was not measured.
 *
 * This module imports nothing from the app: the bench measurement `engine-lanes` loads it into a bare page.
 */

export interface EngineProbeResult {
  /** Lanes of work that keeps the encoder and the decoder busy (proxies) */
  transcode: number
  /** Total frames per second at 1, 2, 3 ... lanes: the evidence for the width */
  framesPerSecond: number[]
  /** Where the answer came from */
  source: 'measured' | 'cached' | 'fallback'
  /** Why a fallback was used */
  reason?: string
  codec?: string
  /** Wall time of the measurement itself, 0 for a cached or fallback answer */
  probeMs: number
}

/** A count of lanes is kept only if it delivers at least this much more than the count below it. */
const MIN_LANE_GAIN = 1.25
/** Most lanes the probe will try. */
const MAX_PROBED_LANES = 4

const WIDTH = 1920
const HEIGHT = 1080
const FRAME_RATE = 30
const KEY_INTERVAL = 30
const POOL_FRAMES = 6
/** Per trial: the first part is left out (codec start-up), the rest is counted. */
const TRIAL_WARMUP_MS = 80
const TRIAL_WINDOW_MS = 170
const MAX_QUEUE = 6
const WARMUP_TRIAL_MS = 120
const CACHE_PREFIX = 'droneclean.side-work.engine-lanes.v2:'
const HEVC = 'hvc1.1.6.L123.B0'
const AVC = 'avc1.640028'

/**
 * Widest lane count whose throughput grew by `minGain` at every step. `rates[i]` is the total throughput of i + 1
 * lanes. Pure: this is the rule, the browser part only feeds it.
 */
export function chooseWidth(rates: number[], minGain = MIN_LANE_GAIN): number {
  let width = 1
  for (let n = 2; n <= rates.length; n++) {
    const below = rates[n - 2]
    const here = rates[n - 1]
    if (below === undefined || here === undefined || below <= 0 || here < below * minGain) break
    width = n
  }
  return width
}

/** Whether to try one lane more: the last count still gained enough. */
export function shouldTryMore(rates: number[], limit: number, minGain = MIN_LANE_GAIN): boolean {
  if (rates.length >= limit) return false
  if (rates.length < 2) return true
  const below = rates[rates.length - 2]
  const last = rates[rates.length - 1]
  return below !== undefined && last !== undefined && last >= below * minGain
}

export interface MachineKeyInput {
  platform?: string
  cores?: number
  memoryGb?: number
  gpu?: string
  browser?: string
}

/** Cache key of one machine and browser build. */
export function machineKey(input: MachineKeyInput): string {
  return [
    input.platform ?? '?',
    `c${input.cores ?? 0}`,
    `m${input.memoryGb ?? 0}`,
    input.gpu ?? '?',
    input.browser ?? '?',
  ]
    .join('|')
    .replace(/\s+/g, '_')
}

function readMachineKey(): string {
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator
  let gpu = '?'
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const gl = canvas.getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
  } catch {
    // no GPU name: the key is a little less specific, which is safe (it only means a re-probe more often)
  }
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory
  return machineKey({
    platform: nav?.platform,
    cores: nav?.hardwareConcurrency,
    memoryGb: memory,
    gpu,
    browser: nav?.userAgent.match(/(Chrome|Edg|Electron)\/[\d.]+/)?.[0],
  })
}

function readCache(key: string): EngineProbeResult | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<EngineProbeResult>
    if (typeof value.transcode !== 'number' || value.transcode < 1) return null
    return { ...(value as EngineProbeResult), source: 'cached', probeMs: 0 }
  } catch {
    return null
  }
}

function writeCache(key: string, result: EngineProbeResult): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result))
  } catch {
    // no storage (private window): the probe runs again next time
  }
}

interface LaneContext {
  /** Counts a frame that came out of the decoder */
  count: () => void
  stopAt: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function pickCodec(): Promise<string | null> {
  for (const codec of [HEVC, AVC]) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: WIDTH,
        height: HEIGHT,
        bitrate: 4_000_000,
        framerate: FRAME_RATE,
        hardwareAcceleration: 'prefer-hardware',
      })
      if (support.supported) return codec
    } catch {
      // try the next codec
    }
  }
  return null
}

function makeFramePool(): VideoFrame[] {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas')
  const frames: VideoFrame[] = []
  for (let i = 0; i < POOL_FRAMES; i++) {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    gradient.addColorStop(0, `hsl(${i * 47}, 70%, 40%)`)
    gradient.addColorStop(1, `hsl(${i * 47 + 120}, 70%, 60%)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    for (let r = 0; r < 40; r++) {
      ctx.fillStyle = `hsl(${(r * 37 + i * 13) % 360}, 80%, ${30 + ((r * 7) % 50)}%)`
      ctx.fillRect(((r * 211 + i * 97) % WIDTH) | 0, ((r * 131 + i * 53) % HEIGHT) | 0, 160, 90)
    }
    frames.push(new VideoFrame(canvas, { timestamp: i }))
  }
  return frames
}

/** One transcode lane: encode synthetic frames, decode what comes out, until `stopAt`. */
async function transcodeLane(codec: string, pool: VideoFrame[], lane: LaneContext): Promise<void> {
  const state: { decoder: VideoDecoder | null; failed: Error | null } = {
    decoder: null,
    failed: null,
  }
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      if (!state.decoder) {
        const decoder = new VideoDecoder({
          output: (frame) => {
            frame.close()
            lane.count()
          },
          error: (e) => {
            state.failed = e instanceof Error ? e : new Error(String(e))
          },
        })
        state.decoder = decoder
        decoder.configure({
          codec,
          codedWidth: WIDTH,
          codedHeight: HEIGHT,
          hardwareAcceleration: 'prefer-hardware',
          ...(meta?.decoderConfig?.description
            ? { description: meta.decoderConfig.description }
            : {}),
        })
      }
      if (state.decoder.decodeQueueSize <= MAX_QUEUE * 2) {
        state.decoder.decode(
          new EncodedVideoChunk({ type: chunk.type, timestamp: chunk.timestamp, data }),
        )
      }
    },
    error: (e) => {
      state.failed = e instanceof Error ? e : new Error(String(e))
    },
  })
  encoder.configure({
    codec,
    width: WIDTH,
    height: HEIGHT,
    bitrate: 4_000_000,
    framerate: FRAME_RATE,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime',
    ...(codec === HEVC ? {} : { avc: { format: 'avc' as const } }),
  })
  let i = 0
  try {
    while (performance.now() < lane.stopAt && !state.failed) {
      if (encoder.encodeQueueSize > MAX_QUEUE) {
        await sleep(1)
        continue
      }
      const frame = new VideoFrame(pool[i % pool.length]!, { timestamp: i * 33_333 })
      encoder.encode(frame, { keyFrame: i % KEY_INTERVAL === 0 })
      frame.close()
      i++
    }
  } finally {
    if (state.failed) throw state.failed
    try {
      encoder.close()
    } catch {
      // already closed
    }
    try {
      state.decoder?.close()
    } catch {
      // already closed
    }
  }
}

async function runLanes(
  lanes: number,
  ms: number,
  pool: VideoFrame[],
  codec: string,
): Promise<void> {
  const lane: LaneContext = { stopAt: performance.now() + ms, count: () => {} }
  await Promise.all(Array.from({ length: lanes }, () => transcodeLane(codec, pool, lane)))
}

/** Total frames per second of `lanes` lanes started together, counted after the warm-up. */
async function trial(
  lanes: number,
  startLane: (lane: LaneContext) => Promise<void>,
): Promise<number> {
  const start = performance.now()
  const warmupAt = start + TRIAL_WARMUP_MS
  const stopAt = warmupAt + TRIAL_WINDOW_MS
  let counted = 0
  const lane: LaneContext = {
    stopAt,
    count: () => {
      const now = performance.now()
      if (now >= warmupAt && now <= stopAt) counted++
    },
  }
  await Promise.all(Array.from({ length: lanes }, () => startLane(lane)))
  return (counted * 1000) / TRIAL_WINDOW_MS
}

async function measureLoad(
  limit: number,
  startLane: (lane: LaneContext) => Promise<void>,
): Promise<number[]> {
  const rates: number[] = []
  while (shouldTryMore(rates, limit)) {
    rates.push(await trial(rates.length + 1, startLane))
  }
  return rates
}

export interface ProbeOptions {
  /** Most lanes to try, default {@link MAX_PROBED_LANES} capped by half the cores */
  maxLanes?: number
  /** Ignore the cache and measure again */
  force?: boolean
}

/** Measure (or read from the cache) the lanes this machine's media engine sustains. */
export async function probeEngineLanes(options: ProbeOptions = {}): Promise<EngineProbeResult> {
  const fallback = (reason: string): EngineProbeResult => ({
    transcode: 1,
    framesPerSecond: [],
    source: 'fallback',
    reason,
    probeMs: 0,
  })
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return fallback('this browser has no WebCodecs')
  }
  const key = readMachineKey()
  if (!options.force) {
    const cached = readCache(key)
    if (cached) return cached
  }
  const started = performance.now()
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
  const limit = Math.max(1, Math.min(options.maxLanes ?? MAX_PROBED_LANES, Math.floor(cores / 2)))
  let pool: VideoFrame[] = []
  try {
    const codec = await pickCodec()
    if (!codec) return fallback('no hardware video encoder')
    pool = makeFramePool()
    // The first stream of a cold codec starts slowly: one short run that is not counted.
    await runLanes(1, WARMUP_TRIAL_MS, pool, codec)
    const rates = await measureLoad(limit, (lane) => transcodeLane(codec, pool, lane))
    const result: EngineProbeResult = {
      transcode: chooseWidth(rates),
      framesPerSecond: rates,
      source: 'measured',
      codec,
      probeMs: Math.round(performance.now() - started),
    }
    writeCache(key, result)
    return result
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error))
  } finally {
    for (const frame of pool) frame.close()
  }
}
