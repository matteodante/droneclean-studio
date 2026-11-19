// The subclip: a named range of one library file, kept as a record of the project.
//
// It is never a media record and never a file (design 1.6, D1): the parent's id is the only
// file it knows, so proxies, filmstrips, stabilization, colour and shadow removal keep keying
// on the parent exactly as before, and a clip dropped from a subclip is a clip of the parent.
//
// Frames are whole source frames of the parent at `sourceFps`, the convention of a timeline
// clip's `sourceStart`/`sourceEnd`: the range is `[startFrame, endFrame)`, end exclusive, so
// no conversion happens anywhere between a subclip, a mark and a clip.

export interface Subclip {
  id: string
  /** The library file this range was cut from. */
  mediaId: string
  name: string
  /** First frame of the range (inclusive), a whole frame of the parent at `sourceFps`. */
  startFrame: number
  /** End of the range (exclusive). */
  endFrame: number
  /** The parent's frame rate when the range was made; a different rate later makes it invalid. */
  sourceFps: number
  createdAt: number
}

/** Why a subclip can no longer be used. It is shown, never repaired (design 1.6, D6). */
export type SubclipInvalidReason = 'parent-missing' | 'range-past-end' | 'rate-changed'

export type SubclipValidity = { valid: true } | { valid: false; reason: SubclipInvalidReason }

/** The facts about a library file that a subclip is checked against. */
export interface SubclipParentInfo {
  /** Seconds, as the probe stored it. */
  duration: number
  /** Frames per second, as the probe stored it. */
  fps?: number
}
