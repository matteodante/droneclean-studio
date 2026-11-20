// The stabilization's look-ahead: the frames each stabilized clip reads first, asked of its engine before the playhead
// reaches the clip, so a cut never waits for them.
//
// The engine computes a clip's stabilization for its whole file once, whatever part of it the clip shows; what the
// preview needs at a cut is that engine's data for the source frames the next clip's first output frames read. Those
// depend on everything an edit changes: the clip's source range, its speed curve (at the 4x end of a smooth edit eight
// timeline frames read 32 source frames), its motion blur (each sample's neighbours, design 9.2), an incoming
// transition (its pre-roll, before the clip's first frame). They used to be asked for by the stabilization stage while
// it drew the clip before the cut, within its last 30 source frames, which is 7 timeline frames at 4x: a 4K preview
// with motion blur drew no frame there, so the next clip's data was asked for only when its first frame was due, and
// the preview drew it unstabilized meanwhile (20 Nov 2026, an agent's six-clip edit: a wait at every cut).
//
// So the page asks from the playhead, by timeline time: whenever the playhead moves or the timeline changes, every
// stabilized clip whose first drawn frame is within `LOOK_AHEAD_SECONDS` ahead gets the source positions of its first
// `FIRST_FRAMES` output frames warmed on its engine (`StabilizationSeat.warm`), from the renderer's own plan
// (`timelineFramePlan`), with the neighbours either side. Once the clip is drawn its engine's window takes over.

import {
  resolveAATransitionRamps,
  resolveTransitionRenderTimelineSpan,
  type RenderTimelineSpan,
} from '@/runtime/renderer/render-span'
import { resolveTransitionWindows } from '@/shared/timeline/transitions/transition-planner'
import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import type { StabilizationSeat } from '@/studio/stabilization/seat'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { timelineFramePlan } from './plan'
import { isStabilized } from './predicates'

/**
 * How far ahead of the playhead, in seconds of the timeline (more at a faster playback rate), a clip's first frames are
 * asked for: far longer than the engine takes to answer them (3 ms median, 99 ms at most while a reel played).
 */
const LOOK_AHEAD_SECONDS = 1

/**
 * How many of a clip's first output frames are warmed: 133 ms at 59.94 fps, longer than the engine takes to fill the
 * window that takes over once the clip's first frame is drawn. A clip stays in the look-ahead for as long after its
 * first frame, so the frames it is drawing are not let go.
 */
const FIRST_FRAMES = 8

/** The most positions one clip's first frames are: a 10x start reads 82 */
const MAX_POSITIONS = 128

/** What the look-ahead reads: the timeline, the playhead and the rates */
export interface StabilizationLookAhead {
  readonly items: readonly TimelineItem[]
  readonly transitions: readonly Transition[]
  /** The playhead's timeline frame */
  readonly frame: number
  /** The project's frame rate */
  readonly fps: number
  /** The playback rate: a faster one looks further ahead */
  readonly playbackRate: number
}

/** Where a clip is first drawn: its own first frame, or an incoming transition's first, drawn through its span */
interface ClipStart {
  readonly item: VideoItem
  readonly first: number
  readonly transition?: { readonly span: RenderTimelineSpan; readonly end: number }
}

/** The stabilized clips of the timeline and where each is first drawn */
function clipStarts(lookAhead: StabilizationLookAhead): ClipStart[] {
  const { items, transitions, fps } = lookAhead
  const byId = new Map(items.map((item) => [item.id, item]))
  const incoming = new Map(
    resolveTransitionWindows([...transitions], byId).map((window) => [window.rightClip.id, window]),
  )
  const starts: ClipStart[] = []
  for (const item of items) {
    if (item.type !== 'video' || !isStabilized(item)) continue
    const window = incoming.get(item.id)
    if (window === undefined || window.startFrame >= item.from) {
      starts.push({ item, first: item.from })
      continue
    }
    const range = { transitionStart: window.startFrame, transitionEnd: window.endFrame }
    const ramp = resolveAATransitionRamps(window.leftClip, item, range, fps)?.right
    const span = resolveTransitionRenderTimelineSpan(item, range, fps, ramp)
    starts.push({ item, first: window.startFrame, transition: { span, end: window.endFrame } })
  }
  return starts
}

/**
 * The source positions a clip's first `FIRST_FRAMES` drawn frames read: every whole frame from the lowest sample less
 * one to the highest plus one (the vector blur's neighbours, design 9.2), inside the file, and the positions between two
 * frames of an optical-flow slow motion.
 */
function firstPositions(start: ClipStart, fps: number): number[] {
  const { item } = start
  const end = Math.min(item.from + item.durationInFrames, start.first + FIRST_FRAMES)
  const wholes: number[] = []
  const between: number[] = []
  for (let frame = start.first; frame < end; frame += 1) {
    const span = start.transition !== undefined && frame < start.transition.end ? start.transition.span : undefined
    const plan = timelineFramePlan(item, frame, fps, span, 0)
    for (const sample of plan.samples) wholes.push(sample.index)
    if (plan.flow !== undefined) between.push(plan.samples[0]!.index + plan.flow.phase)
  }
  if (wholes.length === 0) return []
  const lowest = Math.max(0, Math.min(...wholes) - 1)
  const fileEnd = item.sourceDuration === undefined ? Infinity : item.sourceDuration - 1
  const highest = Math.min(Math.max(...wholes) + 1, fileEnd, lowest + MAX_POSITIONS - 1)
  const positions: number[] = []
  for (let position = lowest; position <= highest; position += 1) positions.push(position)
  return [...positions, ...between]
}

/** Per engine key, the positions the stabilized clips the playhead reaches next read first */
function positionsAhead(lookAhead: StabilizationLookAhead): Map<string, Set<number>> {
  const { frame, fps, playbackRate } = lookAhead
  const horizon = Math.ceil(fps * LOOK_AHEAD_SECONDS * Math.max(1, Math.abs(playbackRate)))
  const wanted = new Map<string, Set<number>>()
  for (const start of clipStarts(lookAhead)) {
    if (start.first <= frame - FIRST_FRAMES || start.first > frame + horizon) continue
    const key = stabilizationEngineKey(start.item)
    if (key === null) continue
    let positions: number[]
    try {
      positions = firstPositions(start, fps)
    } catch {
      // A clip the plan cannot map (a source frame below 0) is reported by the renderer when it draws it
      continue
    }
    const set = wanted.get(key) ?? new Set<number>()
    for (const position of positions) set.add(position)
    wanted.set(key, set)
  }
  return wanted
}

/**
 * Asks the engines of the stabilized clips the playhead reaches within the look-ahead for the frames those clips read
 * first. The host is only asked for when some clip is due (a project with no stabilized clip opens nothing).
 */
export function warmStabilizationAhead(host: () => StabilizationSeat, lookAhead: StabilizationLookAhead): void {
  const wanted = positionsAhead(lookAhead)
  if (wanted.size === 0) return
  const seat = host()
  for (const [key, positions] of wanted) seat.warm(key, [...positions])
}
