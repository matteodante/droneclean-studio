/**
 * The speed-ramp proof's page side (task 7.1): what the stabilization host was asked for while a ramped clip exported.
 *
 * The export asks the page's stabilization host for the gyro data of one source frame per output frame (through the
 * worker's relay, or directly on the main thread; both end in `host.frame`). This module watches those lookups on the
 * installed host, so the measurement can say which source frames the stabilization used and hash the engine's data for
 * the frames it names. Nothing here changes what the host answers.
 *
 * `main.ts` loads this module; it sets `window.benchRamp`, called by `bench/measurements/speed-ramp-stabilized.mjs`.
 */
import { stabilizationSeat } from '@/studio/stabilization/seat'
import type { StabilizationFrameData } from '@/studio/stabilization/client'

/** Source frames the host answered, in the order of the answers (repeats kept: the stage and the relay both ask). */
let lookups: number[] = []
/** The data of the watched frames, as first answered. */
let watched = new Map<number, StabilizationFrameData>()
let watching: Set<number> = new Set()

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Start recording the lookups of the installed host; `watch` names the source frames whose data are kept for hashing. */
function startSeatLog(watch: number[]): void {
  const seat = stabilizationSeat()
  lookups = []
  watched = new Map()
  watching = new Set(watch)
  const original = seat.frame.bind(seat)
  seat.frame = (key, sourceFrame) => {
    const data = original(key, sourceFrame)
    if (data !== undefined) {
      lookups.push(sourceFrame)
      if (watching.has(sourceFrame) && !watched.has(sourceFrame)) watched.set(sourceFrame, data)
    }
    return data
  }
}

/** The distinct source frames looked up, the number of lookups, and the hashes of the watched frames' data. */
async function takeSeatLog() {
  const distinct = [...new Set(lookups)].sort((a, b) => a - b)
  const hashes = []
  for (const [frame, data] of [...watched].sort((a, b) => a[0] - b[0])) {
    hashes.push({
      frame,
      matricesSha256: await sha256Hex(
        new Uint8Array(data.matrices.buffer, data.matrices.byteOffset, data.matrices.byteLength),
      ),
      kernelParamsBytes: data.params.byteLength,
      kernelParamsSha256: await sha256Hex(data.params),
    })
  }
  return { lookups: lookups.length, distinct, hashes }
}

const api = { startSeatLog, takeSeatLog }
type BenchRampApi = typeof api
;(window as unknown as { benchRamp: BenchRampApi }).benchRamp = api
