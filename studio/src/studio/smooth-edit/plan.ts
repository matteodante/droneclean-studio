/**
 * Where the shots of a beat-synced smooth edit go (the "Smooth edit" of the whole timeline).
 *
 * A pure function: the song's beat frames, the song's end and the clips with the footage each one
 * has left after its in-point, in; the cuts out. Nothing here reads a store, so the unit tests can
 * run it on a few numbers.
 *
 * The beats are what the beat finder marks: one strong bass hit each. A bar is four of them. The
 * tempo is the beats' median spacing, refined by a fit through every beat that sits on the grid, so
 * a missed or an extra hit moves nothing and a long song does not drift. The first beat is the first
 * downbeat. Shot `k` starts at `first + k * bars * 4 * beatLength`, snapped to a detected beat when
 * one is close, and ends where shot `k + 1` starts, so the shots meet exactly.
 */

/** Beats in a bar: the smooth edit assumes 4/4, as the drone reels it copies do. */
const BEATS_PER_BAR = 4

/** How many bars a shot may last. */
export const SMOOTH_SHOT_BARS = [1, 2, 4] as const
export type SmoothShotBars = (typeof SMOOTH_SHOT_BARS)[number]

/** A grid frame is moved onto a detected beat when one lies within this share of a beat. */
const SNAP_SHARE = 0.15

/** A beat is on the grid, for the tempo fit, when it is this close to a whole number of beats. */
const GRID_SHARE = 0.2

/** One video clip of the timeline, in timeline order. */
export interface PlanClip {
  id: string
  /** The frames the clip's footage plays at normal speed from its in-point to the end of the file. */
  availableFrames: number
}

export interface PlanInput {
  /** The song's beat frames, ascending (a project frame each). */
  beats: readonly number[]
  /** The first frame after the song on the timeline. */
  songEnd: number
  /** Bars per shot. */
  bars: number
  /** The video clips, in the order they play. */
  clips: readonly PlanClip[]
  /**
   * The footage, in frames at normal speed, a shot of `shotFrames` frames takes: the smooth edit's
   * fast parts spend the footage faster than it plays, so this is more than the shot's length.
   */
  footageFor: (shotFrames: number, clipId: string) => number
}

export interface PlannedShot {
  clipId: string
  /** The timeline frame the shot starts at. */
  from: number
  /** The shot's length in frames, as it plays after the speed ramp. */
  durationInFrames: number
}

export interface SmoothPlan {
  /** The clips that become shots, in order. */
  shots: PlannedShot[]
  /** The clips whose footage is too short for a shot of the chosen length, left as they are. */
  tooShort: string[]
  /** The clips that would start after the song's end, left as they are. */
  afterSong: string[]
  /** The first beat: the first downbeat, where the first shot starts. */
  firstDownbeat: number
  /** One beat in frames, as the fit found it; 0 when there were fewer than two beats. */
  beatFrames: number
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * One beat in frames: the median spacing, then the slope of a line through the first beat and every beat
 * within {@link GRID_SHARE} of a whole number of beats from it. 0 for fewer than two beats.
 */
export function beatLength(beats: readonly number[]): number {
  if (beats.length < 2) return 0
  const gaps = beats.slice(1).map((beat, index) => beat - beats[index]!)
  let length = median(gaps)
  if (length <= 0) return 0
  const first = beats[0]!
  // The median is only a whole-frame guess: a few rounds of fitting the beats that sit on the grid
  // it makes pull it onto the true tempo, so a long song's last beats stay on the grid too.
  for (let round = 0; round < 4; round += 1) {
    let along = 0
    let squares = 0
    for (const beat of beats) {
      const count = Math.round((beat - first) / length)
      if (count === 0) continue
      if (Math.abs(beat - first - count * length) > GRID_SHARE * length) continue
      along += count * (beat - first)
      squares += count * count
    }
    if (squares === 0) break
    length = along / squares
  }
  return length
}

/** The frame shot `index` starts at: on the grid, then on a detected beat when one is near. */
function cutFrame(beats: readonly number[], first: number, beat: number, beatsPerShot: number, index: number): number {
  const grid = first + index * beatsPerShot * beat
  let nearest = grid
  let distance = Number.POSITIVE_INFINITY
  for (const candidate of beats) {
    const gap = Math.abs(candidate - grid)
    if (gap < distance) {
      distance = gap
      nearest = candidate
    }
  }
  return Math.round(distance <= SNAP_SHARE * beat ? nearest : grid)
}

/**
 * Plan the shots. A clip whose footage is too short for its shot is skipped and does not take a slot,
 * the next clip takes it. The first clip that would end after the song, and every clip after it, are left
 * after the song. With fewer than two beats there is no tempo and no shot.
 */
export function planSmoothEdit(input: PlanInput): SmoothPlan {
  const beats = [...new Set(input.beats)].toSorted((a, b) => a - b)
  const beat = beatLength(beats)
  const firstDownbeat = beats[0] ?? 0
  const plan: SmoothPlan = { shots: [], tooShort: [], afterSong: [], firstDownbeat, beatFrames: beat }
  if (beat <= 0) {
    plan.afterSong = input.clips.map((clip) => clip.id)
    return plan
  }
  const beatsPerShot = input.bars * BEATS_PER_BAR
  let slot = 0
  let songFull = false
  for (const clip of input.clips) {
    if (songFull) {
      plan.afterSong.push(clip.id)
      continue
    }
    const from = cutFrame(beats, firstDownbeat, beat, beatsPerShot, slot)
    const end = cutFrame(beats, firstDownbeat, beat, beatsPerShot, slot + 1)
    if (end > input.songEnd || end <= from) {
      songFull = true
      plan.afterSong.push(clip.id)
      continue
    }
    if (clip.availableFrames < input.footageFor(end - from, clip.id)) {
      plan.tooShort.push(clip.id)
      continue
    }
    plan.shots.push({ clipId: clip.id, from, durationInFrames: end - from })
    slot += 1
  }
  return plan
}
