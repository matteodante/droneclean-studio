/**
 * Filmstrip tiles from keyframes.
 *
 * A filmstrip tile is a small picture of "the clip near time t". Decoding the exact frame at t means decoding every
 * frame from the previous keyframe up to t (a 4K HEVC clip with a keyframe every 0.5 to 1 s costs up to 30 frames
 * for one tile). When the tiles are further apart than the clip's keyframes, the keyframe nearest to t shows the
 * same content to the eye and costs one decode. This file decides which time to ask the decoder for; the worker
 * looks the keyframe times up in the container's sample table (no decode).
 */

/** Snapping is worth it only when a GOP is at least this many frames; a clip of all keyframes is decoded exactly. */
const MIN_GOP_FRAMES_FOR_SNAP = 4
/** A snapped frame is never further than this fraction of the tile spacing from the tile's time. */
const MAX_SNAP_SPACING_FRACTION = 0.5

export interface KeyframeNeighbours {
  /** Timestamp of the last keyframe at or before the time, or null when there is none. */
  prev: number | null
  /** Timestamp of the first keyframe after the time, or null when there is none. */
  next: number | null
}

export interface KeyframeProfile {
  /** Typical gap between keyframes in seconds (median of the first ones). */
  interval: number
  /** Duration of one frame in seconds. */
  frameDuration: number
}

/**
 * The time the decoder is asked for to draw the tile of `time`.
 * Returns `time` itself (exact frame) unless a keyframe within half a tile spacing exists and the clip's keyframes
 * are sparser than the tiles.
 */
export function chooseFilmstripFrameTime(
  time: number,
  spacing: number,
  neighbours: KeyframeNeighbours,
  profile: KeyframeProfile,
): number {
  if (!(spacing > 0) || !(profile.interval > 0)) return time
  // Tiles at least as dense as the keyframes: today's exact frames.
  if (spacing <= profile.interval) return time
  // All-keyframe (intra) or near-intra clips: one frame is already one decode.
  if (profile.interval < MIN_GOP_FRAMES_FOR_SNAP * profile.frameDuration) return time

  const { prev, next } = neighbours
  const dPrev = prev === null ? Infinity : time - prev
  const dNext = next === null ? Infinity : next - time
  const best = dPrev <= dNext ? prev : next
  const dist = Math.min(dPrev, dNext)
  if (best === null || dist > spacing * MAX_SNAP_SPACING_FRACTION) return time
  return best
}

/** Median of the gaps between consecutive timestamps; 0 when there are fewer than two. */
export function medianGap(timestamps: number[]): number {
  const gaps: number[] = []
  for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i]! - timestamps[i - 1]!)
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

/**
 * Spacing in seconds of each tile index: the smaller gap to the nearest other tile (extracted or already cached),
 * at least one tile period. `indices` need not be sorted.
 */
export function tileSpacings(indices: Iterable<number>, frameRate: number): Map<number, number> {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const out = new Map<number, number>()
  const period = 1 / frameRate
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!
    const gapPrev = i > 0 ? cur - sorted[i - 1]! : Infinity
    const gapNext = i < sorted.length - 1 ? sorted[i + 1]! - cur : Infinity
    const gap = Math.min(gapPrev, gapNext)
    out.set(cur, Number.isFinite(gap) ? gap / frameRate : period)
  }
  return out
}

interface PacketLike {
  timestamp: number
}

/** The part of mediabunny's `EncodedPacketSink` the snapper needs. */
export interface KeyPacketSource {
  getFirstPacket(options?: { metadataOnly?: boolean }): Promise<PacketLike | null>
  getKeyPacket(timestamp: number, options?: { metadataOnly?: boolean }): Promise<PacketLike | null>
  getNextKeyPacket(packet: never, options?: { metadataOnly?: boolean }): Promise<PacketLike | null>
}

export interface KeyframeLookup {
  profile: KeyframeProfile
  neighbours(time: number): Promise<KeyframeNeighbours>
}

const PROFILE_SAMPLE_KEYFRAMES = 9
const META = { metadataOnly: true } as const

/**
 * Reads keyframe times from the container's sample table. Returns null when the clip has no keyframe list to read
 * (the caller then decodes exactly).
 */
export async function createKeyframeLookup(
  source: KeyPacketSource,
  frameDuration: number,
): Promise<KeyframeLookup | null> {
  const first = await source.getKeyPacket(0, META)
  const start = first ?? (await source.getFirstPacket(META))
  if (!start) return null

  const sample: number[] = [start.timestamp]
  let cursor: PacketLike | null = start
  while (cursor && sample.length < PROFILE_SAMPLE_KEYFRAMES) {
    cursor = await source.getNextKeyPacket(cursor as never, META)
    if (cursor) sample.push(cursor.timestamp)
  }
  const interval = medianGap(sample)
  if (!(interval > 0)) return null

  return {
    profile: { interval, frameDuration },
    async neighbours(time: number): Promise<KeyframeNeighbours> {
      const prev = await source.getKeyPacket(time, META)
      const next = prev
        ? await source.getNextKeyPacket(prev as never, META)
        : await source.getFirstPacket(META)
      return { prev: prev ? prev.timestamp : null, next: next ? next.timestamp : null }
    },
  }
}
