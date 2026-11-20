/**
 * Beat detection: the strong low-frequency hits of a song (kicks, bass
 * plucks), as seconds from the start of the analysed audio.
 *
 * Pure maths with no store, no DOM and no worker API, so the worker, the main
 * thread fallback and the tests all run the same code. The steps are the ones
 * After Effects' "convert audio to keyframes" leaves to the user, done once:
 *
 * 1. Low band. Two one-pole low-pass filters in series (about 12 dB per
 *    octave below `LOW_PASS_HZ`) keep the thump and drop hats, voices and
 *    snares' noise.
 * 2. Energy envelope. The mean square of the low band per hop of
 *    `HOP_SECONDS`, in square root, so a hit is a rise of loudness.
 * 3. Onset strength. The positive rise of the envelope over the mean of the
 *    hops just before it (the half-wave rectified flux of the low band).
 * 4. Peak picking. A hop is a hit when it is the strongest in its
 *    neighbourhood, the low band carries a good part of the loudness there
 *    (a hi-hat's burst does not), above an adaptive threshold (a multiple of the mean
 *    onset strength around it, raised by `strength`) and above a share of the
 *    strongest hit of the whole audio; then the strongest hits win inside
 *    `MIN_GAP_SECONDS`.
 */

/** Cut-off of the low band, in hertz. */
const LOW_PASS_HZ = 150

/** Time between two envelope values, in seconds. */
const HOP_SECONDS = 0.005

/** The closest two hits can be, in seconds. */
const MIN_GAP_SECONDS = 0.2

/** Hops before a hop whose mean the rise is measured against. */
const REFERENCE_HOPS = 6

/** Half-width of the window the adaptive threshold averages, in seconds. */
const ADAPTIVE_WINDOW_SECONDS = 1

/** The default `strength`. */
const DEFAULT_BEAT_STRENGTH = 0.5

export interface BeatDetectionOptions {
  /**
   * How strong a hit must be to be kept, `0..1`: 0 keeps every clear low
   * thump, 1 keeps only the strongest hits of the audio. Default 0.5.
   */
  strength?: number
}

/** `strength` clamped to `0..1`; a missing or non-finite value is the default. */
export function normalizeBeatStrength(strength: number | undefined): number {
  if (strength === undefined || !Number.isFinite(strength)) return DEFAULT_BEAT_STRENGTH
  return Math.min(1, Math.max(0, strength))
}

/**
 * The share of a hit's loudness the low band must carry. A kick is nearly all
 * low band; a hi-hat's noise leaks about a tenth of its level into it.
 */
const MIN_LOW_BAND_SHARE = 0.4

/** Hops after the rise that the low band's share is read over. */
const SHARE_HOPS = 3

interface Envelopes {
  /** Square root of the low band's mean square per hop. */
  low: Float32Array
  /** The same for the whole signal. */
  full: Float32Array
  /** Seconds between two values. */
  hopSeconds: number
}

/** The low band's and the whole signal's loudness per hop. */
function envelopes(samples: Float32Array, sampleRate: number): Envelopes {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS))
  const hops = Math.floor(samples.length / hop)
  const low = new Float32Array(hops)
  const full = new Float32Array(hops)
  const alpha = 1 - Math.exp((-2 * Math.PI * LOW_PASS_HZ) / sampleRate)
  let first = 0
  let second = 0
  let index = 0
  for (let h = 0; h < hops; h += 1) {
    let lowSum = 0
    let fullSum = 0
    for (let i = 0; i < hop; i += 1, index += 1) {
      const sample = samples[index] as number
      first += alpha * (sample - first)
      second += alpha * (first - second)
      lowSum += second * second
      fullSum += sample * sample
    }
    low[h] = Math.sqrt(lowSum / hop)
    full[h] = Math.sqrt(fullSum / hop)
  }
  return { low, full, hopSeconds: hop / sampleRate }
}

/** Whether the low band carries enough of the loudness at and after hop `h`. */
function isLowBandHit({ low, full }: Envelopes, h: number): boolean {
  let lowPeak = 0
  let fullPeak = 0
  for (let k = h; k < Math.min(low.length, h + SHARE_HOPS); k += 1) {
    lowPeak = Math.max(lowPeak, low[k] as number)
    fullPeak = Math.max(fullPeak, full[k] as number)
  }
  return lowPeak >= MIN_LOW_BAND_SHARE * fullPeak
}

/** The positive rise of each envelope value over the mean of the hops before it. */
function onsetStrength(envelope: Float32Array): Float32Array {
  const onset = new Float32Array(envelope.length)
  let window = 0
  for (let h = 0; h < envelope.length; h += 1) {
    const count = Math.min(h, REFERENCE_HOPS)
    const reference = count > 0 ? window / count : (envelope[h] as number)
    onset[h] = Math.max(0, (envelope[h] as number) - reference)
    window += envelope[h] as number
    if (h >= REFERENCE_HOPS) window -= envelope[h - REFERENCE_HOPS] as number
  }
  return onset
}

/** Prefix sums, so the mean of any range is two reads. */
function prefixSums(values: Float32Array): Float64Array {
  const sums = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i += 1) {
    sums[i + 1] = (sums[i] as number) + (values[i] as number)
  }
  return sums
}

/** Whether `h` is the strongest hop of its neighbourhood; of equal ones, the earliest. */
function isLocalMaximum(onset: Float32Array, h: number, neighbourhood: number): boolean {
  const value = onset[h] as number
  const lo = Math.max(0, h - neighbourhood)
  const hi = Math.min(onset.length - 1, h + neighbourhood)
  for (let k = lo; k <= hi; k += 1) {
    const other = onset[k] as number
    if (other > value || (other === value && k < h)) return false
  }
  return true
}

/** The hops that pass the thresholds and are local maxima, before the minimum gap is applied. */
function pickCandidates(bands: Envelopes, onset: Float32Array, strength: number): number[] {
  let peak = 0
  for (let h = 0; h < onset.length; h += 1) peak = Math.max(peak, onset[h] as number)
  // A silent or constant signal has no hits; the floor also keeps the
  // rounding noise of a near-silent file from being "the strongest hit".
  if (peak < 1e-4) return []

  const sums = prefixSums(onset)
  const around = Math.max(1, Math.round(ADAPTIVE_WINDOW_SECONDS / bands.hopSeconds))
  const neighbourhood = Math.max(1, Math.round(MIN_GAP_SECONDS / 2 / bands.hopSeconds))
  const adaptiveFactor = 1.5 + 3 * strength
  const shareOfPeak = 0.05 + 0.55 * strength

  const candidates: number[] = []
  for (let h = 0; h < onset.length; h += 1) {
    const value = onset[h] as number
    if (value < shareOfPeak * peak) continue
    const from = Math.max(0, h - around)
    const to = Math.min(onset.length, h + around + 1)
    const mean = ((sums[to] as number) - (sums[from] as number)) / (to - from)
    if (value < adaptiveFactor * mean) continue
    if (isLocalMaximum(onset, h, neighbourhood) && isLowBandHit(bands, h)) candidates.push(h)
  }
  return candidates
}

/** The strongest candidates first, each dropped when a stronger one is closer than `gapHops`. */
function applyMinimumGap(candidates: number[], onset: Float32Array, gapHops: number): number[] {
  const byStrength = candidates.toSorted(
    (a, b) => (onset[b] as number) - (onset[a] as number) || a - b,
  )
  const kept: number[] = []
  for (const h of byStrength) {
    if (kept.every((other) => Math.abs(other - h) >= gapHops)) kept.push(h)
  }
  return kept.toSorted((a, b) => a - b)
}

/**
 * Times of the strong low-frequency hits of `samples` (mono), in seconds from
 * its first sample, in order.
 * @example detectBeats(mono, 44100, { strength: 0.5 }) // [0.5, 1, 1.5]
 */
export function detectBeats(
  samples: Float32Array,
  sampleRate: number,
  options: BeatDetectionOptions = {},
): number[] {
  if (!(sampleRate > 0) || samples.length === 0) return []
  const bands = envelopes(samples, sampleRate)
  const onset = onsetStrength(bands.low)
  const candidates = pickCandidates(bands, onset, normalizeBeatStrength(options.strength))
  const gapHops = Math.max(1, Math.round(MIN_GAP_SECONDS / bands.hopSeconds))
  return applyMinimumGap(candidates, onset, gapHops).map((h) => h * bands.hopSeconds)
}
