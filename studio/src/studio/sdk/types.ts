/**
 * Public types of the DroneClean Studio SDK (task 2.1).
 *
 * Everything declared here is plain JSON: no store objects, no class
 * instances, no functions. The `Studio` interface and the seventeen namespace
 * interfaces use only these declarations, so the reference can be generated
 * from this file's declarations alone (design `docs/designs/2.1-sdk.md` §4.9).
 *
 * Units (design §4.3): a `Frame` is an integer timeline frame at the project
 * rate (`studio.project.rate()`), a `SourceFrame` is an integer frame inside
 * the source media, and `Seconds` is used only for values the stores already
 * keep in seconds (audio fades, subtitle cues).
 */

// ---------------------------------------------------------------------------
// Ids, units and rates
// ---------------------------------------------------------------------------

/** Opaque id of a timeline clip (a `TimelineItem`). Never parse it. */
export type ClipId = string

/** Opaque id of a timeline track (a `TimelineTrack`). Never parse it. */
export type TrackId = string

/** Opaque id of a media library item (`MediaMetadata`). Never parse it. */
export type MediaId = string

/** Opaque id of one effect instance applied to a clip (`ItemEffect`). Never parse it. */
export type EffectId = string

/** Opaque id of a timeline marker (`ProjectMarker`). Never parse it. */
export type MarkerId = string

/** Opaque id of a transition (`Transition`). Never parse it. */
export type TransitionId = string

/** Opaque id of a keyframe (`Keyframe.id`). Never parse it. */
export type KeyframeId = string

/** Integer frame on the timeline, counted at the project rate. */
export type Frame = number

/** Integer frame inside a source media file, counted at the source rate. */
export type SourceFrame = number

/** Seconds. Only for values the stores keep in seconds (audio fades, subtitle cues). */
export type Seconds = number

/**
 * A frame rate as an exact fraction of frames per second (design §4.3):
 * 59.94 is `{ num: 60000, den: 1001 }`, never `{ num: 59.94, den: 1 }`. Both
 * numbers are positive whole numbers; a rate is read back reduced, and
 * `@/studio/time`'s `toRate` and `rateValue` are the only conversions.
 */
export interface Rate {
  /** Numerator: a positive whole number. */
  num: number
  /** Denominator: a positive whole number, 1001 for the NTSC rates. */
  den: number
}

// ---------------------------------------------------------------------------
// Editing context
// ---------------------------------------------------------------------------

/**
 * The context the SDK reads and writes: the Main timeline, or the composition
 * that is open for editing in the app (design §4.3). Ids and the undo history
 * belong to one context; an id from another context is `NOT_FOUND`.
 */
export type TimelineContext = MainTimelineContext | CompositionTimelineContext

/** The Main timeline is the active context. */
export interface MainTimelineContext {
  kind: 'main'
}

/** An open sub-composition is the active context. */
export interface CompositionTimelineContext {
  kind: 'composition'
  /** Id of the open composition. */
  id: string
  /** Display name of the open composition. */
  name: string
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/** What `project.delete` answers: the project that is gone and that it cannot come back. */
export interface ProjectDeleteResult {
  /** The id of the deleted project. */
  id: string
  /** The project's name when it was deleted. */
  name: string
  /** Always false: the project's folder is removed from the workspace and nothing can restore it. */
  undoable: false
  /** The same, in words, for the agent to repeat to the user. */
  message: string
}

/** A project as the SDK reads it (`useProjectStore.currentProject`). */
export interface ProjectInfo {
  /** Stable id of the project. */
  id: string
  /** Display name. */
  name: string
  /** Free-text description; empty when unset. */
  description: string
  /** Canvas width in pixels. */
  width: number
  /** Canvas height in pixels. */
  height: number
  /** Project frame rate as an exact fraction. */
  fps: Rate
  /** Canvas background colour as six hex digits (`#RRGGBB`); absent means black. */
  backgroundColor?: string
  /** Creation time, epoch milliseconds. */
  createdAt: number
  /** Last modification time, epoch milliseconds. */
  updatedAt: number
}

/** Input of `project.create` (design §0.6). */
export interface ProjectCreateInput {
  /** Display name; must not be empty. */
  name: string
  /** Canvas width in pixels, a positive integer. */
  width: number
  /** Canvas height in pixels, a positive integer. */
  height: number
  /** Project rate, exact: `{ num: 60000, den: 1001 }` for 59.94. */
  fps: Rate
}

/** Fields `project.set` can change. */
export interface ProjectPatch {
  /** New canvas width in pixels. */
  width?: number
  /** New canvas height in pixels. */
  height?: number
  /** New project rate; today only `den: 1` is supported. */
  fps?: Rate
  /** New canvas background colour as six hex digits (`#RRGGBB`). */
  backgroundColor?: string
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Kind of a media library item, derived from its MIME type. */
export type MediaType = 'video' | 'audio' | 'image' | 'lottie' | 'unknown'

/** A media library item as the SDK reads it (`MediaMetadata`, `@/types/storage`). */
export interface MediaInfo {
  id: MediaId
  /** File name including its extension. */
  fileName: string
  /** MIME type as recorded at import. */
  mimeType: string
  /** Kind derived from `mimeType`. */
  type: MediaType
  /** Size in bytes. */
  fileSize: number
  /** Duration in seconds; 0 for images. */
  duration: Seconds
  /** Source width in pixels. */
  width: number
  /** Source height in pixels. */
  height: number
  /** Source frame rate in frames per second. */
  fps: number
  /** Codec identifier as probed at import. */
  codec: string
  /** Source bitrate in bits per second. */
  bitrate: number
  /** Import time, epoch milliseconds. */
  createdAt: number
  /** Last modification time, epoch milliseconds. */
  updatedAt: number
}

/** Options of `media.import` (design §2). */
export interface MediaImportOptions {
  /**
   * `link` references the user's original file through its handle (instant, no
   * copy); `copy` copies the bytes into the workspace folder. Default `link`.
   */
  storageMode?: 'copy' | 'link'
}

/** Filter of `media.list`. */
export interface MediaFilter {
  /** Only items of this kind. */
  type?: MediaType
}

// ---------------------------------------------------------------------------
// Subclips
// ---------------------------------------------------------------------------

/** Id of a subclip. */
export type SubclipId = string

/**
 * Why a subclip cannot be used any more: its file is gone from the library,
 * the file has fewer frames than the range needs, or the file's frame rate
 * changed after the range was cut.
 */
export type SubclipInvalidReason = 'parent-missing' | 'range-past-end' | 'rate-changed'

/**
 * A subclip as the SDK reads it: a named range of one library file
 * (`Subclip`, `@/studio/subclips`). The range is whole source frames of the
 * file, `[startFrame, endFrame)`, the convention of a clip's `sourceStart` and
 * `sourceEnd`, so it goes into `clips.add` unchanged.
 */
export interface SubclipInfo {
  id: SubclipId
  /** The library file the range was cut from. */
  mediaId: MediaId
  /** Display name. */
  name: string
  /** First source frame of the range (inclusive). */
  startFrame: SourceFrame
  /** End of the range (exclusive). */
  endFrame: SourceFrame
  /** The file's frame rate when the range was cut. */
  sourceFps: number
  /** Creation time, epoch milliseconds. */
  createdAt: number
  /** Whether the file still has every frame of the range at the same frame rate. */
  valid: boolean
  /** Why the subclip is not valid; absent when it is. */
  invalidReason?: SubclipInvalidReason
}

/** Input of `subclips.create`. */
export interface SubclipCreateInput {
  /** Library file to cut the range from; it must be a video or audio file. */
  mediaId: MediaId
  /** First source frame of the range (inclusive). */
  startFrame: SourceFrame
  /** End of the range (exclusive); at most the file's frame count. */
  endFrame: SourceFrame
  /** Display name; the file's name and a number when absent. */
  name?: string
}

/** Filter of `subclips.list`. */
export interface SubclipFilter {
  /** Only the subclips of this library file. */
  mediaId?: MediaId
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** A track is either a video or an audio track. */
export type TrackKind = 'video' | 'audio'

/** A track as the SDK reads it (`TimelineTrack` without its item list). */
export interface TrackInfo {
  id: TrackId
  /** Display name, e.g. "V1". */
  name: string
  /** Track kind; absent means video. */
  kind?: TrackKind
  /** Height of the track header in pixels; a view preference, read-only in the SDK. */
  height: number
  /** Locked tracks refuse edits. */
  locked: boolean
  /** Whether ripple edits propagate to this track; absent means true. */
  syncLock?: boolean
  /** Visual visibility (the eye toggle). */
  visible: boolean
  /** Audio muting (the speaker toggle). */
  muted: boolean
  /** Solo: silences every other audio track. */
  solo: boolean
  /** Track gain in dB; absent means 0 (unity). */
  volume?: number
  /** Track colour, e.g. `#RRGGBB`; any CSS colour string is stored as given. */
  color?: string
  /** Position in the track stack, 0 = top. */
  order: number
}

/** Input of `tracks.add`. */
export interface TrackAddInput {
  /** Kind of track to create. */
  kind: TrackKind
  /** Display name; a default name is chosen when absent. */
  name?: string
  /**
   * Insert position in the stack, 0 = top. Appended at the bottom when absent, under every other track: a video track
   * there is hidden by the footage above it, so a layer over the footage (a title, a picture in picture) takes 0.
   */
  position?: number
}

/** Fields `tracks.update` can change. */
export interface TrackPatch {
  /** Display name. */
  name?: string
  /** Locked tracks refuse edits. */
  locked?: boolean
  /** Whether ripple edits propagate to this track. */
  syncLock?: boolean
  /** Visual visibility. */
  visible?: boolean
  /** Audio muting. */
  muted?: boolean
  /** Solo. */
  solo?: boolean
  /** Track gain in dB, -60..12. */
  volume?: number
  /** Track colour, e.g. `#RRGGBB`; any CSS colour string is stored as given. */
  color?: string
}

// ---------------------------------------------------------------------------
// Clips and titles
// ---------------------------------------------------------------------------

/** Kind of a timeline clip (the discriminator of `TimelineItem`). */
export type ClipType =
  | 'video'
  | 'audio'
  | 'text'
  | 'image'
  | 'lottie'
  | 'shape'
  | 'adjustment'
  | 'controller'
  | 'composition'
  | 'subtitle'

/** Placement and scale of a clip on the canvas (`TransformProperties`). */
export interface ClipTransform {
  /** Horizontal offset from the canvas centre, pixels. */
  x?: number
  /** Vertical offset from the canvas centre, pixels. */
  y?: number
  /** Explicit width in pixels. */
  width?: number
  /** Explicit height in pixels. */
  height?: number
  /** Rotation anchor X in local pixels. */
  anchorX?: number
  /** Rotation anchor Y in local pixels. */
  anchorY?: number
  /** Rotation in degrees, clockwise. */
  rotation?: number
  /** Flip content horizontally. */
  flipHorizontal?: boolean
  /** Flip content vertically. */
  flipVertical?: boolean
  /** Opacity, 0 (transparent) to 1 (opaque). */
  opacity?: number
  /** Border radius in pixels, applied by clipping the rendered box. */
  cornerRadius?: number
}

/**
 * A clip as the SDK reads it. Positions and durations are timeline frames;
 * `source*` and `trim*` are source frames (design §4.3). Effects and keyframes
 * are read through `studio.effects` and `studio.keyframes`, not duplicated here.
 */
export interface ClipInfo {
  id: ClipId
  /** Track the clip sits on. */
  trackId: TrackId
  /** Discriminator of the clip. */
  type: ClipType
  /** Start frame on the timeline. */
  from: Frame
  /** Length in timeline frames (after speed changes). */
  durationInFrames: Frame
  /** Display label. */
  label: string
  /** Source media, for clips created from the media library. */
  mediaId?: MediaId
  /** Referenced sub-composition, for `composition` clips. */
  compositionId?: string
  /** Frames trimmed from the start of the source. */
  trimStart?: SourceFrame
  /** Frames trimmed from the end of the source. */
  trimEnd?: SourceFrame
  /** First source frame used (at the source rate). */
  sourceStart?: SourceFrame
  /** Last source frame used (exclusive, at the source rate). */
  sourceEnd?: SourceFrame
  /** Full length of the source in source frames. */
  sourceDuration?: SourceFrame
  /** Source frame rate used for `source*` conversions. */
  sourceFps?: number
  /** Playback speed multiplier, 0.1..10. */
  speed?: number
  /** Whether the source plays backwards. */
  isReversed?: boolean
  /** Volume in dB, -60..12; absent means 0. */
  volume?: number
  /** Audio fade-in length in seconds. */
  audioFadeIn?: Seconds
  /** Audio fade-out length in seconds. */
  audioFadeOut?: Seconds
  /** Video fade-in length in seconds. */
  fadeIn?: Seconds
  /** Video fade-out length in seconds. */
  fadeOut?: Seconds
  /** Canvas placement and scale, when the clip overrides them. */
  transform?: ClipTransform
  /** Text content, for `text` clips. */
  text?: string
  /** Text colour, for `text` clips. */
  color?: string
}

/** What `clips.add` answers when it was asked `onOverlap: 'move'`: the clip and the frame it was placed at. */
export interface ClipPlacement {
  /** The id of the new clip. */
  id: ClipId
  /** The frame the clip starts at: `requestedFrom`, or the first free frame after the clip it overlapped. */
  from: Frame
  /** The frame the input asked for. */
  requestedFrom: Frame
  /** Whether the clip was moved: `from` differs from `requestedFrom`. */
  moved: boolean
}

/** Input of `clips.add` and one entry of `clips.addMany`. */
export interface ClipAddInput {
  /** Media to place; it must exist in the media library. */
  mediaId: MediaId
  /** Track to place the clip on. */
  trackId: TrackId
  /** Requested start frame. `clips.add` places the clip exactly there or says why not (see `onOverlap`). */
  from: Frame
  /**
   * `clips.add` only: what to do when the clip would overlap one on its track.
   * `'fail'` (default) throws CONFLICT naming the clip in the way and the first free frame
   * where this one fits; `'move'` places it at that frame and answers a `ClipPlacement`.
   * `clips.addMany` applies it to each of its inputs.
   */
  onOverlap?: 'move' | 'fail'
  /** Length in timeline frames; the media's full length when absent. */
  durationInFrames?: Frame
  /** Display label; the media's file name when absent. */
  label?: string
  /**
   * First source frame to play (inclusive). Given together with `sourceEnd`; the
   * pair is whole frames of the media at its own rate, `0 <= sourceStart <
   * sourceEnd <= the file's frame count`. Absent: the whole file.
   */
  sourceStart?: SourceFrame
  /**
   * End of the source range (exclusive). With a range, the clip is as long as
   * the range plays at the project's rate, and `durationInFrames` must be left
   * out or equal to that length.
   */
  sourceEnd?: SourceFrame
}

/** Fields `clips.update` can change. */
export interface ClipPatch {
  /** Display label. */
  label?: string
  /** Volume in dB, -60..12. */
  volume?: number
  /** Audio fade-in length in seconds. */
  audioFadeIn?: Seconds
  /** Audio fade-out length in seconds. */
  audioFadeOut?: Seconds
  /** Video fade-in length in seconds. */
  fadeIn?: Seconds
  /** Video fade-out length in seconds. */
  fadeOut?: Seconds
  /**
   * Mute the clip's embedded audio without unlinking it (`embeddedAudioMuted`, a
   * video-only store field). `clips.update` accepts it on video clips and throws
   * `INVALID_ARGUMENT` for every other kind; mute an audio clip with `volume: -60`.
   */
  muted?: boolean
  /** Canvas placement and scale; merged into the clip's transform. */
  transform?: ClipTransform
}

/** Filter of `clips.list`. */
export interface ClipFilter {
  /** Only clips on this track. */
  trackId?: TrackId
  /** Only clips of this kind. */
  type?: ClipType
}

/** Options of `clips.remove`. */
export interface ClipRemoveOptions {
  /** Close the gap left by the removed clips and pull later clips left. */
  ripple?: boolean
}

/** Options of `clips.duplicate`. */
export interface ClipDuplicateOptions {
  /** Number of copies to make, default 1. */
  count?: number
  /** Frames to offset each copy by, default the clip's length. */
  offsetFrames?: Frame
}

/**
 * One point of a clip's speed curve: a clip-relative timeline frame and the speed there.
 * Frame 0 is the clip's first frame, the origin keyframes use; speeds are 0.1..10.
 */
export interface SpeedKey {
  /** Clip-relative timeline frame: an integer >= 0, the first key's exactly 0. */
  frame: Frame
  /** Playback speed at that frame, in x, `0.1..10`. */
  speed: number
  /**
   * How the speed moves from this key to the next one (the segment that starts here):
   * `linear` (the default: a straight line), `smooth` (smoothstep: leaves slowly, arrives
   * slowly, fastest change in the middle), `ease-in` (stays near this key's speed, then changes
   * fast) or `ease-out` (changes fast, then settles on the next key's speed). Ignored on the
   * last key. `getSpeedCurve` returns it only for a segment that is not linear.
   */
  ease?: 'linear' | 'smooth' | 'ease-in' | 'ease-out'
}

/** A clip's speed curve, as `clips.getSpeedCurve` reads it (design §4.9 of task 7.1). */
export interface ClipSpeedCurve {
  /** The keys, ordered by frame; the first at frame 0 and the last at the clip's length. */
  keys: SpeedKey[]
  /** The curve's average speed: the value the clip's `speed` holds and every length uses. */
  averageSpeed: number
}

/** A clip's motion blur, as `clips.getMotionBlur` reads it and `clips.setMotionBlur` takes it (design 7.2, section 4.7). */
export interface MotionBlurSettings {
  /**
   * The shutter in degrees of the interval between two output frames: a number from 0 to 360. 180 is
   * RSMB's Blur Amount 0.5 (the panel's slider shows degrees / 360), and the default of a new switch;
   * 360 blurs over the whole interval; 0 blurs nothing, for smooth slow motion alone. Each pixel is
   * blurred along its own motion over that share of the interval, centred on the frame's time, at
   * every speed.
   */
  shutterDegrees: number
  /**
   * Smooth slow motion: where an output frame covers less than one source frame (slower than 1x, or a 30 fps file
   * in a 60 fps project), make it from the two source frames around it instead of showing one frame twice.
   * `'blend'` mixes them by how near each is; `'optical-flow'` moves both along the motion measured between them
   * to where it is at that moment, and mixes them only where the motion cannot be trusted. Absent: off.
   */
  smoothSlowMotion?: 'blend' | 'optical-flow'
  /**
   * With `smoothSlowMotion: 'optical-flow'`, how finely the flow follows the motion (the panel's "Motion detail"):
   * `'high'` measures it at twice the size, which follows small and thin moving things a little more closely (on a
   * DJI 4K clip about +0.1 dB, better on 16 of 17 frames) for about three times the flow's time. Absent or `'normal'`:
   * the default, and `clips.getMotionBlur` leaves it out.
   */
  flowDetail?: 'normal' | 'high'
  /**
   * With `smoothSlowMotion: 'optical-flow'`, what is shown where neither source frame can be trusted (a branch near the
   * lens, something entering the frame; the panel's "Hard edges"): `'mix'` mixes the two frames there (a soft halo at
   * worst), `'nearest'` takes the frame more likely to show it (no halo, a small local jump). Absent or `'mix'`: the
   * default, and `clips.getMotionBlur` leaves it out.
   */
  flowEdges?: 'mix' | 'nearest'
  /**
   * @deprecated Use `smoothSlowMotion`. Still accepted by `clips.setMotionBlur` for scripts written before the
   * optical-flow mode: `true` is `smoothSlowMotion: 'blend'`, `false` is off. Never given together with
   * `smoothSlowMotion`, and never returned by `clips.getMotionBlur`.
   */
  blendSlowMotion?: boolean
}

/** The ramp shapes `clips.setSpeedPreset` builds (design §4.9 of task 7.1). */
export type SpeedPreset = 'ramp-in' | 'ramp-out' | 'ramp-in-out'

/** Options of `clips.setSpeedPreset`. */
export interface SpeedPresetOptions {
  /** The speed the ramp reaches, in x, `0.1..10`; default 4. */
  peak?: number
  /** The ramp's length in frames, an integer >= 1; default 15 (a quarter second at 60). */
  rampFrames?: number
}

/** Options of `clips.applySmoothEdit`; every field is optional. */
export interface SmoothEditOptions {
  /** The fast speed at both ends of the clip, in x, `1..10`; default 4. */
  peak?: number
  /** The slow speed in the middle, in x, `0.1..1`; default 0.45. */
  slow?: number
  /** The zoom-in over the clip as a fraction, `0..1`: 0.2 ends 20 % larger than it starts, 0 leaves the zoom alone; default 0.2. */
  zoom?: number
}

/** What `clips.applySmoothEdit` set on the clip. */
export interface SmoothEditResult {
  /** The speed curve's keys as stored, clip-relative; the ramps carry the `smooth` ease. */
  speedCurve: SpeedKey[]
  /** The curve's average speed: the value the clip's `speed` holds. */
  averageSpeed: number
  /** The clip's length after the curve, in frames: what keeps its source content at the new speeds. */
  durationInFrames: number
  /** The motion blur the clip now has: its own shutter angle (360 when it had none) with smooth slow motion by optical flow. */
  motionBlur: MotionBlurSettings
  /**
   * The zoom keyframes on the clip's width and height, centred: the clip-relative frames they sit on
   * (the first and last of the clip) and the size they reach as a multiple of the start. Null when `zoom` was 0.
   */
  zoom: { firstFrame: Frame; lastFrame: Frame; scale: number } | null
}

/** A clip's colour profile, as `clips.getColorProfile` reads it and `clips.setColorProfile` takes it: DJI D-Log M, DJI D-Log, or `none` (an answered "no transform"). */
export type ColorProfile = 'dlog-m' | 'dlog' | 'none'

/** A clip's creative look: a `.cube` file of the workspace's looks library and the blend it is applied with. */
export interface ClipLookInfo {
  /** The look's id, as `looks.list` names it. */
  id: string
  /** The blend with the untouched picture, `0..1`: 0 changes nothing, 1 applies the table fully. */
  intensity: number
}

/** What `clips.setLook` takes: the id of a look of the library and, optionally, the blend. */
export interface ClipLookRequest {
  /** The look's id, from `looks.list`. */
  id: string
  /** The blend, `0..1`; default 1. */
  intensity?: number
}

/** What `looks.add` takes: a `.cube` file's text and name. */
export interface LookAddInput {
  /** The `.cube` file's text. */
  text: string
  /** The file name the look keeps, ending in `.cube`. */
  fileName: string
  /** The name the clip panel's picker shows; default the file's TITLE, or its name. */
  name?: string
}

/** One look of the workspace's looks library, as `looks.list` reads it. */
export interface LookInfo {
  /** The id `clips.setLook` takes. */
  id: string
  /** The name the clip panel's picker shows. */
  name: string
  /** The `.cube` file's original name. */
  fileName: string
  /** Points per side of the look's 3D table. */
  size: number
}

/** A clip's stabilization as it is stored: what the pilot chose; the engine's matrices are not part of it. */
export interface ClipStabilization {
  /** Whether the clip is stabilized at all. */
  enabled: boolean
  /** The smoothing method's name, as the engine reports it (`Default`). */
  method: string
  /** The method's parameters by name; `smoothness` is the one the panel's slider sets. */
  params: Record<string, number>
  /** The output zoom: 1 is the frame the engine fits. */
  fov: number
  /** How much of the horizon is locked, in per cent, `0..100`. */
  horizonLockPercent: number
  /** The roll a locked horizon takes, in degrees, `-180..180`. */
  horizonLockRoll: number
  /** How far either way the adaptive zoom looks, in seconds; 0 turns it off. */
  adaptiveZoomSeconds: number
  /** Where the stabilized window sits sideways in the source picture, `-1..1` (0: the engine's framing). */
  framingX: number
  /** Where the stabilized window sits up and down in the source picture, `-1..1` (0: the engine's framing). */
  framingY: number
}

/** What `clips.setStabilization` changes: each field is optional, and the others keep their value (or the engine's default on a clip never stabilized). */
export interface StabilizationPatch {
  /** The smoothing amount, inside the range the engine reports for the clip's method (0.5 by default). */
  smoothness?: number
  /** The output zoom, greater than 0. */
  fov?: number
  /** The horizon lock in per cent, `0..100`. */
  horizonLockPercent?: number
  /** The roll a locked horizon takes in degrees, `-180..180`. */
  horizonLockRoll?: number
  /** The adaptive-zoom window in seconds, 0 or more. */
  adaptiveZoomSeconds?: number
  /**
   * Moves the stabilized window sideways in the source picture, `-1..1`: a fraction of the room the stabilization has
   * on that side, so the window never shows a black border (`-1` left, `1` right, 0 the engine's framing). For a 4:3
   * clip in a 9:16 project, it chooses which strip of the frame the reel shows. A clip with keyframes on `framingX` is
   * framed by them instead (`keyframes.add`); this value is then not read.
   */
  framingX?: number
  /** The same, up and down (`-1` up, `1` down). With keyframes on `framingX` or `framingY` (`keyframes.add`) this is the value only where the lane has none. */
  framingY?: number
}

/** The mark of a clip's shadow, in source pixels, as `shadow.mark` takes it. */
export interface ShadowMarkInput {
  /** Circle centre from the source picture's left edge, in source pixels. */
  x: number
  /** Circle centre from the source picture's top edge, in source pixels. */
  y: number
  /** The source frame the shadow is on; default: the frame the playhead shows on the clip. */
  sourceFrame?: number
  /** Circle radius in source pixels; default 3.5% of the source's shorter side. */
  radius?: number
}

/** A mark as `shadow.get` reads it. */
export interface ShadowMarkInfo {
  /** Circle centre from the left edge, in source pixels. */
  x: number
  /** Circle centre from the top edge, in source pixels. */
  y: number
  /** The source frame the mark was made on. */
  sourceFrame: number
  /** Circle radius in source pixels. */
  radius: number
}

/** The price of cleaning the ranges the tracking pass found, from the service's quote. */
export interface ShadowQuote {
  /** Seconds of shadow that would be removed. */
  seconds: number
  /** What the clean costs, in credits: the number `shadow.clean` must be given. */
  costCredits: number
  /** Credits for one second. */
  creditsPerSecond: number
  /** The account's credits available now. */
  availableCredits: number
  /** Whether the balance covers the clean. */
  enough: boolean
}

/** A stretch of source frames where the shadow was found. */
export interface ShadowRangeInfo {
  /** The first source frame. */
  startFrame: number
  /** One past the last source frame. */
  endFrame: number
}

/** A clip's shadow session as `shadow.get` reads it. */
export interface ShadowState {
  /** The mark, or null when the shadow was not marked. */
  mark: ShadowMarkInfo | null
  /** What the session is doing: `idle`, `signing-in`, `cutting`, `uploading`, `tracking`, `cleaning`, `downloading`, `saving` or `ready`. */
  stage: string
  /** Progress of the running step, `0..1`. */
  progress: number
  /** The stretches the tracking pass found, in source frames; empty before the pass. */
  ranges: ShadowRangeInfo[]
  /** The price of cleaning them, or null before the pass. */
  quote: ShadowQuote | null
  /** The last failure's message, or null. */
  error: string | null
  /** True when the user has to approve a new sign-in in the app. */
  needsSignIn: boolean
  /** How many cleaned pieces the clip records. */
  cleanedPieces: number
  /**
   * What following the shadow in this clip costs now, in credits, and the
   * number `shadow.follow` must be given: the follow button's price, or the
   * exact price of the piece once a follow stopped to ask for it (the piece
   * reaches the keyframes around the clip's part). Never charged above it.
   */
  followCredits: number
}

/** What `shadow.follow` found. */
export interface ShadowFollowResult {
  /** The stretches the tracker found, in source frames. */
  ranges: ShadowRangeInfo[]
  /** The price of cleaning them; null when nothing was found. */
  quote: ShadowQuote | null
  /**
   * Credits the tracking pass spent: what the service charged for the piece,
   * or 0 when it found no shadow where it was marked (it gives them back).
   */
  creditsSpent: number
}

/** What `shadow.clean` did. */
export interface ShadowCleanResult {
  /** Credits the clean was paid with: the price that was confirmed. */
  creditsSpent: number
  /** The stretches that were cleaned, in source frames. */
  ranges: ShadowRangeInfo[]
  /** How many cleaned pieces the clip records now. */
  cleanedPieces: number
}

/** Shadow of a title (`TextShadow`). */
export interface TitleShadow {
  /** Horizontal offset in pixels. */
  offsetX: number
  /** Vertical offset in pixels. */
  offsetY: number
  /** Blur radius in pixels. */
  blur: number
  /** Shadow colour: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, or `rgb()` / `rgba()` (stored as hex). */
  color: string
}

/** Outline of a title (`TextStroke`). */
export interface TitleStroke {
  /** Outline width in pixels. */
  width: number
  /** Outline colour: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, or `rgb()` / `rgba()` (stored as hex). */
  color: string
}

/**
 * Style fields of a title, the subset of `TextStyleFields` a caller sets
 * (`@/types/text`). Every field is optional; the defaults are
 * `createDefaultTextItem`'s (`generated-layer-items.ts:99`).
 */
export interface TitleStyle {
  /** Font size in pixels. */
  fontSize?: number
  /** Font family name. */
  fontFamily?: string
  /** Font weight. */
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold'
  /** Font style. */
  fontStyle?: 'normal' | 'italic'
  /** Underlined text. */
  underline?: boolean
  /** Text colour: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, or `rgb()` / `rgba()` (stored as hex). */
  color?: string
  /** Letter spacing in pixels. */
  letterSpacing?: number
  /** Background colour behind the text: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, or `rgb()` / `rgba()` (stored as hex); `null` clears it. */
  backgroundColor?: string | null
  /** Background corner radius in pixels. */
  backgroundRadius?: number
  /** Horizontal alignment inside the text box. */
  textAlign?: 'left' | 'center' | 'right'
  /** Vertical alignment inside the text box. */
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** Line height as a multiple of the font size. */
  lineHeight?: number
  /** Padding inside the text box in pixels. */
  textPadding?: number
  /** Drop shadow; `null` clears it. */
  textShadow?: TitleShadow | null
  /** Outline; `null` clears it. */
  stroke?: TitleStroke | null
}

/** Input of `titles.add`. */
export interface TitleAddInput {
  /** Track to place the title on. */
  trackId: TrackId
  /** Start frame on the timeline. */
  from: Frame
  /** Length in timeline frames. */
  durationInFrames: Frame
  /** Text to show. */
  text: string
  /** Style overrides; the editor's defaults when absent. */
  style?: TitleStyle
}

/** Fields `titles.update` can change. */
export interface TitlePatch {
  /** New text. */
  text?: string
  /** Style fields to merge into the title. */
  style?: TitleStyle
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** A value an effect parameter can hold (`GpuEffect.params`). */
export type EffectParamValue = number | boolean | string

/** One parameter of an effect type (`EffectParam` in `gpu-effects/types.ts`). */
export interface EffectParamInfo {
  /** Control to draw for it. */
  type: 'number' | 'boolean' | 'select' | 'color' | 'point' | 'json' | 'text'
  /** Display label. */
  label: string
  /** Value used when the effect is added without the parameter. */
  default: EffectParamValue
  /** Minimum for numeric parameters. */
  min?: number
  /** Maximum for numeric parameters. */
  max?: number
  /** Step for numeric parameters. */
  step?: number
  /** Choices of a `select` parameter. */
  options?: Array<{ value: string; label: string }>
  /** Whether the parameter can be animated with keyframes. */
  animatable?: boolean
}

/** An available effect type (a `GpuEffectDefinition` without its shader plumbing). */
export interface EffectTypeInfo {
  /** Registry id, e.g. `gpu-brightness`. */
  id: string
  /** Display name. */
  name: string
  /** Grouping category. */
  category: 'color' | 'blur' | 'distort' | 'stylize' | 'keying'
  /** Parameters keyed by name. */
  params: Record<string, EffectParamInfo>
}

/** One effect instance on a clip (`ItemEffect`). */
export interface EffectInfo {
  id: EffectId
  /** Registry id of the effect type. */
  type: string
  /** Current parameter values. */
  params: Record<string, EffectParamValue>
  /** Whether the effect is applied. */
  enabled: boolean
}

/** Fields `effects.update` can change. */
export interface EffectPatch {
  /** Parameter values to write; each named parameter is replaced. */
  params?: Record<string, EffectParamValue>
  /** Whether the effect is applied. */
  enabled?: boolean
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/** Easing between one keyframe and the next (`EasingType`). */
export type Easing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'hold'
  | 'cubic-bezier'
  | 'spring'

/** Component of a path-vertex keyframe property. */
export type PathVertexComponent = 'positionX' | 'positionY' | 'inX' | 'inY' | 'outX' | 'outY'

/**
 * A scalar property that can be animated (`AnimatableProperty` in
 * `@/types/keyframe`). `effect:<gpuEffectType>:<effectId>:<paramKey>` addresses
 * an effect parameter (`buildEffectAnimatableProperty`),
 * `pathVertex:<index>:<component>` one vertex of a path shape. `framingX` and `framingY` (each -1..1) animate the
 * stabilized window's framing of a video clip whose stabilization is on (`clips.setStabilization`'s `framingX` and
 * `framingY`, which are the value where the lane has no keyframe).
 */
export type KeyframeProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'anchorX'
  | 'anchorY'
  | 'rotation'
  | 'opacity'
  | 'cornerRadius'
  | 'cropLeft'
  | 'cropRight'
  | 'cropTop'
  | 'cropBottom'
  | 'cropSoftness'
  | 'volume'
  | 'textStyleScale'
  | 'fontSize'
  | 'lineHeight'
  | 'textPadding'
  | 'backgroundRadius'
  | 'textShadowOffsetX'
  | 'textShadowOffsetY'
  | 'textShadowBlur'
  | 'strokeWidth'
  | 'trimPathStart'
  | 'trimPathEnd'
  | 'trimPathOffset'
  | 'taperStartWidth'
  | 'taperEndWidth'
  | 'taperStartLength'
  | 'taperEndLength'
  | 'framingX'
  | 'framingY'
  | `effect:${string}:${string}:${string}`
  | `pathVertex:${number}:${PathVertexComponent}`

/** One keyframe (`Keyframe`). `frame` is relative to the start of the clip. */
export interface KeyframeInfo {
  id: KeyframeId
  /** Animated property, e.g. `opacity` or `effect:<gpuEffectType>:<effectId>:<paramKey>`. */
  property: KeyframeProperty
  /** Frame relative to the start of the clip (design §4.3). */
  frame: Frame
  /** Value at that frame. */
  value: number
  /** Easing from this keyframe to the next. */
  easing: Easing
  /** The curve of a `cubic-bezier` easing, as CSS writes it (x in 0..1, y may overshoot). */
  bezier?: KeyframeBezier
  /** The physics of a `spring` easing. */
  spring?: KeyframeSpring
}

/** Control points of a `cubic-bezier` easing, as CSS `cubic-bezier(x1, y1, x2, y2)` writes them. */
export interface KeyframeBezier {
  /** First control point X, 0..1. */
  x1: number
  /** First control point Y; outside 0..1 overshoots. */
  y1: number
  /** Second control point X, 0..1. */
  x2: number
  /** Second control point Y; outside 0..1 overshoots. */
  y2: number
}

/** A `spring` easing's physics. */
export interface KeyframeSpring {
  /** Stiffness, 1..500 (the editor's default 170). */
  tension: number
  /** Damping, 1..100 (default 26). */
  friction: number
  /** Mass, 0.1..10 (default 1). */
  mass: number
}

/** Fields `keyframes.update` can change. */
export interface KeyframePatch {
  /** New value. */
  value?: number
  /** New easing. */
  easing?: Easing
  /** A custom curve: sets the easing to `cubic-bezier` with these control points (the graph editor's handles). */
  bezier?: KeyframeBezier
  /** Spring physics: sets the easing to `spring` with these values. */
  spring?: KeyframeSpring
  /** New frame, still relative to the start of the clip. */
  frame?: Frame
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** Timing function of a transition (`TransitionTiming`). */
export type TransitionTiming = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier'

/** Direction of the directional presentations (`WipeDirection` and siblings). */
export type TransitionDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom'

/** Control points for `cubic-bezier` timing (`BezierPoints`). */
export interface TransitionBezierPoints {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A transition as the SDK reads it (`Transition`). */
export interface TransitionInfo {
  id: TransitionId
  /** Kind of transition; today always `crossfade`. */
  type: 'crossfade'
  /** Presentation id from `transitions.presentations()`, e.g. `fade`. */
  presentation: string
  /** Timing function. */
  timing: TransitionTiming
  /** Clip that ends at the cut. */
  leftClipId: ClipId
  /** Clip that starts at the cut. */
  rightClipId: ClipId
  /** Track both clips sit on. */
  trackId: TrackId
  /** Duration in timeline frames. */
  durationInFrames: Frame
  /** Direction, for directional presentations. */
  direction?: TransitionDirection
  /** Where the transition sits relative to the cut: 0 right, 0.5 centred, 1 left. */
  alignment?: number
  /** Control points when `timing` is `cubic-bezier`. */
  bezierPoints?: TransitionBezierPoints
  /** Referenced preset, when the transition came from one. */
  presetId?: string
  /** Free-form presentation properties. */
  properties?: Record<string, unknown>
}

/** Input of `transitions.add`. */
export interface TransitionAddInput {
  /** Clip that ends at the cut. */
  left: ClipId
  /** Clip that starts at the cut. */
  right: ClipId
  /** Presentation id; `'fade'` when absent. */
  presentation?: string
  /** Duration in timeline frames; the presentation's default when absent. */
  durationInFrames?: Frame
  /** Timing function applied after the transition is created. */
  timing?: TransitionTiming
  /** Direction, for directional presentations. */
  direction?: TransitionDirection
  /** Where the transition sits relative to the cut: 0 right, 0.5 centred, 1 left. */
  alignment?: number
}

/** Fields `transitions.update` can change. */
export interface TransitionPatch {
  /** Presentation id. */
  presentation?: string
  /** Duration in timeline frames. */
  durationInFrames?: Frame
  /** Timing function. */
  timing?: TransitionTiming
  /** Direction, for directional presentations. */
  direction?: TransitionDirection
  /** Where the transition sits relative to the cut. */
  alignment?: number
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** A timeline marker (`ProjectMarker`). */
export interface MarkerInfo {
  id: MarkerId
  /** Frame the marker sits on. */
  frame: Frame
  /** Optional label; surfaces fall back to an ordinal name when empty. */
  label?: string
  /** Marker colour: `#RGB`, `#RRGGBB`, or the `oklch(L C H)` the marker panel writes. */
  color: string
}

/** Input of `markers.addBeats`. */
export interface MarkerBeatsInput {
  /**
   * How strong a hit must be to get a marker, `0..1`: 0 marks every clear low
   * thump, 1 only the strongest hits of the song. Default 0.5.
   */
  strength?: number
}

/** Input of `markers.add`. */
export interface MarkerAddInput {
  /** Frame the marker sits on. */
  frame: Frame
  /** Optional label. */
  label?: string
  /** Marker colour: `#RGB`, `#RRGGBB`, or the `oklch(L C H)` the marker panel writes; the store's default when absent. */
  color?: string
}

/** Fields `markers.update` can change. */
export interface MarkerPatch {
  /** Frame the marker sits on. */
  frame?: Frame
  /** Label. */
  label?: string
  /** Marker colour: `#RGB`, `#RRGGBB`, or the `oklch(L C H)` the marker panel writes. */
  color?: string
}

/** The in/out playback range of the active context. */
export interface RangeInfo {
  /** In point, or null when unset. */
  in: Frame | null
  /** Out point, or null when unset. */
  out: Frame | null
}

// ---------------------------------------------------------------------------
// Selection and playback
// ---------------------------------------------------------------------------

/** What is selected in the editor. */
export interface SelectionInfo {
  /** Selected clips. */
  clips: ClipId[]
  /** Selected tracks. */
  tracks: TrackId[]
  /** Selected marker, when the selection is a marker. */
  marker: MarkerId | null
  /** Selected transition, when the selection is a transition. */
  transition: TransitionId | null
}

/** What `selection.set` changes; an absent field is left as it is. */
export interface SelectionPatch {
  /** Selected clips. */
  clips?: ClipId[]
  /** Selected tracks. */
  tracks?: TrackId[]
  /** Selected marker, or null to clear it. */
  marker?: MarkerId | null
  /** Selected transition, or null to clear it. */
  transition?: TransitionId | null
}

/** State of the transport (`PlaybackState`). */
export interface PlaybackInfo {
  /** Current playhead frame. */
  frame: Frame
  /** Whether playback is running. */
  playing: boolean
  /** Playback rate multiplier, 1 = real time. */
  rate: number
  /** Whether playback loops. */
  loop: boolean
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Video codec of an export (`ExportSettings['codec']`). */
export type ExportCodec = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1'

/** Encoder quality preset. */
export type ExportQuality = 'low' | 'medium' | 'high' | 'ultra'

/** Rate control of an export (`VideoRateControl`). */
export type ExportRateControl = 'auto' | 'variable' | 'constant'

/** Video container of an export (`VideoContainer`). */
export type ExportVideoContainer = 'mp4' | 'mov' | 'webm' | 'mkv'

/** Audio container of an audio export (`AudioContainer`). */
export type ExportAudioContainer = 'mp3' | 'aac' | 'wav'

/** What happens to transcript subtitles on export (`SubtitleExportMode`). */
export type ExportSubtitleMode = 'off' | 'burn' | 'sidecar' | 'embedded'

/** Whether an export renders the picture, the sound, or both. */
export type ExportMode = 'video' | 'audio'

/** Status of an export job (`RenderJobStatus`). */
export type ExportJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled'

/** Phase of a running export (`RenderProgress['phase']`). */
export type ExportPhase = 'preparing' | 'rendering' | 'encoding' | 'finalizing'

/**
 * The export settings the SDK owns (design §0.3, §4.7). The export dialog does
 * not read these yet; task 3.4 makes it use the same store.
 */
export interface ExportSettingsInfo {
  /** Video codec. */
  codec: ExportCodec
  /** Encoder quality preset. */
  quality: ExportQuality
  /** Output resolution in pixels. */
  resolution: { width: number; height: number }
  /** Rate control; `auto` when absent. */
  rateControl?: ExportRateControl
  /** Target video bitrate in bits per second for a custom rate control. */
  videoBitrate?: number
  /** Copy the original bytes when the timeline is provably passthrough-safe. */
  smartCopy?: boolean
  /** Video, audio, or both. */
  mode: ExportMode
  /** Video container; derived from the codec when absent. */
  videoContainer?: ExportVideoContainer
  /** Audio container of an audio export. */
  audioContainer?: ExportAudioContainer
  /** How transcript subtitles are exported; `burn` when absent. */
  subtitleMode?: ExportSubtitleMode
  /** Ignore the in/out range and export the whole timeline. */
  renderWholeProject?: boolean
}

/** Fields `export.setSettings` can change; an absent field is left as it is. */
export type ExportSettingsPatch = Partial<ExportSettingsInfo>

/** One export preset of the export dialog, resolved for the open project by `export.presets`. */
export interface ExportPresetInfo {
  /** The preset's id, as the export dialog names it (`instagram-reel`, `youtube-4k`, ...). */
  id: string
  /** Its English name in the export dialog. */
  label: string
  /** The settings it stands for: pass them to `export.setSettings` or as `export.start({ settings })`. */
  settings: ExportSettingsPatch
  /**
   * The AAC bitrate it states, when it states one (`'128k'` for the Instagram Reel). Read-only: `export.start` with
   * these settings applies it by itself, and `export.setSettings` refuses `audioBitrate`.
   */
  audioBitrate?: string
  /** The numbers it stands for; the frame rate is the project's, which the export always keeps. */
  numbers: { width: number; height: number; fps: number; codec: ExportCodec; bitrate: number }
}

/** Input of `export.start`. */
export interface ExportStartInput {
  /** Settings to overlay on the current ones for this job only. */
  settings?: ExportSettingsPatch
  /** First frame to render; the editor's in point when absent. */
  inPoint?: Frame | null
  /** Last frame to render (exclusive); the editor's out point when absent. */
  outPoint?: Frame | null
  /**
   * Display name of the job, and the name of its file (`<name>.mp4`; ` (2)` is added only when that file exists
   * already). Generated from the project when absent. `fileName` and `savedPath` of the job tell the real name.
   */
  name?: string
}

/** Options of `export.wait`. */
export interface ExportWaitOptions {
  /** Give up after this many milliseconds; waits indefinitely when absent. */
  timeoutMs?: number
}

/** One export job as the SDK reads it (`RenderJob` without its frozen snapshot). */
export interface ExportJobInfo {
  /** Job id, used by `status`, `wait` and `cancel`. */
  id: string
  /** Display name shown in the queue panel. */
  name: string
  /** Project the job renders, when it belongs to one. */
  projectId?: string
  /** Current status. */
  status: ExportJobStatus
  /** Progress, 0..100. */
  progress: number
  /** Phase of a running job. */
  phase?: ExportPhase
  /** Human-readable progress message. */
  progressMessage?: string
  /** Frames rendered so far. */
  renderedFrames?: number
  /** Frames the job will render in total. */
  totalFrames?: number
  /** First frame rendered, or null for the whole project. */
  inPoint: Frame | null
  /** Last frame rendered (exclusive), or null for the whole project. */
  outPoint: Frame | null
  /** Length of the rendered range in frames. */
  durationFrames: Frame
  /** Whether the job renders video or audio. */
  exportMode: ExportMode
  /** File name including its extension: the one asked for until the job completes, then the name the file really got. */
  fileName: string
  /** Workspace-relative path once the file is saved. */
  savedPath?: string
  /** Size of the written file in bytes. */
  fileSize?: number
  /** Error message of a failed job. */
  error?: string
  /** Enqueue time, epoch milliseconds. */
  createdAt: number
  /** Start time, epoch milliseconds. */
  startedAt?: number
  /** End time, epoch milliseconds. */
  finishedAt?: number
}

// ---------------------------------------------------------------------------
// What a call changed
// ---------------------------------------------------------------------------

/** Kind of an entity the SDK can name (design §4.5, §4.6). */
export type EntityKind =
  | 'clip'
  | 'track'
  | 'transition'
  | 'keyframe'
  | 'marker'
  | 'effect'
  | 'media'
  | 'subclip'
  | 'project'
  | 'range'

/** Reference to one entity. */
export interface EntityRef {
  /** Kind of the entity. */
  kind: EntityKind
  /**
   * Id of the entity. For `keyframe` it is the keyframe's own id; for
   * `project` it is the project id; for `range` it is `main` on the Main
   * timeline and the composition id inside a composition.
   */
  id: string
  /**
   * Clip that carries an `effect` entity, so a caller can address it as
   * `studio.effects.update(clip, effect, patch)` straight from `changes`. A
   * split gives both halves the same effect ids, so the clip and the id
   * together name one effect. Absent on every other kind.
   */
  clip?: ClipId
}

/** A changed entity and the top-level fields that changed. */
export interface UpdatedEntityRef extends EntityRef {
  /** Names of the fields whose value changed, e.g. `['volume']`. */
  fields: string[]
}

/**
 * A command that ran inside a transaction, as the undo stack records it (a
 * trim's amount in the SDK's sign).
 */
export interface CommandInfo {
  /** Command type, e.g. `UPDATE_ITEM`. */
  type: string
  /**
   * Details the action attached to it. A trim's `trimAmount` is in the SDK's
   * sign at either end: positive shortened the clip, as `clips.trimStart` and
   * `clips.trimEnd` take it.
   */
  payload?: Record<string, unknown>
}

/**
 * What a call or a transaction changed (design §4.6).
 *
 * One entry per entity, named by kind and id. Keyframes are named by their own
 * id, not by the clip that owns them. An effect is named by its own id and by
 * its `clip`: a split gives both halves the same effect ids, so the clip is
 * part of an effect's identity and the two halves' effects are two entries. A
 * change to an effect also reports the clip itself, with `effects` in its
 * `fields`; the effect's own `fields` name the field of the effect record that
 * moved, `effect` for its type or parameters and `enabled` for its switch. The
 * in/out points are one entity of kind `range`: its id is `main` on the Main
 * timeline and the composition id inside a composition; it is `added` when its
 * first point is set, `removed` when its last point is cleared, and `updated`
 * with `inPoint` or `outPoint` in `fields` when a point moves.
 */
export interface Changes {
  /** Commands that ran inside the call, in order; empty when it changed nothing. */
  commands: CommandInfo[]
  /** Entities that appeared. */
  added: EntityRef[]
  /** Entities that disappeared. */
  removed: EntityRef[]
  /** Entities that changed, with the fields that changed. */
  updated: UpdatedEntityRef[]
  /** Number of undo entries the call added to the history: 1 or 0. */
  undoSteps: number
}

/** Value and changes of `Studio.transaction`. */
export interface TransactionResult<T> {
  /** What the callback returned. */
  value: T
  /** What the callback changed; for a callback that returns a promise, only its synchronous part. */
  changes: Changes
  /**
   * Only when the callback returned a promise: resolves, once that promise
   * settles, with everything the call changed, including the edits made after
   * an `await`. Never rejects.
   */
  settled?: Promise<Changes>
}

// ---------------------------------------------------------------------------
// Reference and errors
// ---------------------------------------------------------------------------

/** One method of the generated reference (design §4.9). */
export interface SdkMethodReference {
  /** Method name inside its namespace. */
  name: string
  /** TypeScript signature as emitted by `tsc`. */
  signature: string
  /** One-line summary from the method's JSDoc. */
  summary: string
  /** The command type or store action the method maps to. */
  mapsTo: string
  /** `StudioError` codes the method can throw. */
  throws: string[]
  /** One example call from the method's JSDoc. */
  example: string
}

/** One namespace of the generated reference. */
export interface SdkNamespaceReference {
  /** Namespace name, e.g. `clips`. */
  name: string
  /** One-line summary of the namespace. */
  summary: string
  /** Its methods, in declaration order. */
  methods: SdkMethodReference[]
}

/** One public type of the generated reference. */
export interface SdkTypeReference {
  /** Type or interface name. */
  name: string
  /** Its declaration text as emitted by `tsc`. */
  declaration: string
  /** Leading JSDoc summary. */
  summary: string
}

/** One error code of the generated reference. */
export interface SdkErrorReference {
  /** The code. */
  code: StudioErrorCode
  /** When it is thrown. */
  summary: string
}

/** The whole generated reference, as `studio.reference()` returns it. */
export interface SdkReference {
  /** Format version, `1`. */
  version: 1
  /** The seventeen namespaces. */
  namespaces: SdkNamespaceReference[]
  /** The public types. */
  types: SdkTypeReference[]
  /** The error codes. */
  errors: SdkErrorReference[]
}

/** Code of a `StudioError` (design §4.5). */
export type StudioErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED'
  | 'MEDIA_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'INTERNAL'

/** JSON form of a `StudioError`, what the MCP passes to its caller (design §4.5). */
export interface StudioErrorJson {
  /** Always `StudioError`. */
  name: 'StudioError'
  /** The error code. */
  code: StudioErrorCode
  /** The full human-readable message. */
  message: string
  /** Name of the rejected argument, when one was named. */
  argument?: string
  /** Valid values for the rejected argument, when they are known. */
  valid?: readonly string[]
  /** The entity that was not found or conflicted, when there is one. */
  entity?: EntityRef
  /** What the caller can do to fix it. */
  hint?: string
}

// ---------------------------------------------------------------------------
// The namespaces
// ---------------------------------------------------------------------------

/**
 * `studio.project`: the open project and its metadata (design §4.2, §0.6).
 * Implemented by `createProjectApi(): ProjectApi` in `namespaces/project.ts`.
 */
export interface ProjectApi {
  /**
   * The open project, or null when no project is open. Not an undo step.
   * @mapsTo useProjectStore.currentProject
   * @throws Nothing
   * @example studio.project.current()
   */
  current(): ProjectInfo | null

  /**
   * Every project in the workspace storage. Not an undo step.
   * @mapsTo getAllProjects + useProjectStore.projects
   * @throws INTERNAL when the project list cannot be read
   * @example await studio.project.list()
   */
  list(): Promise<ProjectInfo[]>

  /**
   * Create a new empty project in workspace storage and open it: it becomes the
   * current project with its empty timeline and its own media library, so media
   * can be imported right away (no `project.open` needed). Not an undo step.
   * @mapsTo useProjectStore.createProject + createProjectObject
   * @throws INVALID_ARGUMENT when `name` is empty, a size is not a positive integer,
   *   or `fps` is not one of the rates the project form offers, as `{ num, den }`
   *   (23.976, 24, 25, 29.97, 30, 50, 59.94, 60, and the legacy 120 and 240)
   * @throws INTERNAL when the project cannot be written
   * @example const { id } = await studio.project.create({ name: 'Flight', width: 3840, height: 2160, fps: { num: 60000, den: 1001 } })
   */
  create(input: ProjectCreateInput): Promise<ProjectInfo>

  /**
   * The project frame rate as an exact fraction. Not an undo step.
   * @mapsTo useTimelineSettingsStore.fps
   * @throws Nothing
   * @example studio.project.rate()
   */
  rate(): Rate

  /**
   * The editing context the SDK is working in. Not an undo step.
   * @mapsTo useCompositionNavigationStore.activeCompositionId
   * @throws Nothing
   * @example studio.project.context()
   */
  context(): TimelineContext

  /**
   * Length of the active timeline in frames. Not an undo step.
   * @mapsTo computeCompositionDuration (actions/shared.ts:173)
   * @throws Nothing
   * @example studio.project.duration()
   */
  duration(): Frame

  /**
   * Change the project's canvas size, rate or background. One undo step.
   * @mapsTo UPDATE_PROJECT_METADATA via commitProjectMetadataChange
   *   (project-metadata-history.ts:39) + useTimelineSettingsStore.setFps
   * @throws NOT_FOUND when no project is open
   * @throws INVALID_ARGUMENT when `patch` is not an object, a size is not a positive
   *   integer, `fps` is not one of the rates the project form offers (see `create`), or
   *   `backgroundColor` is not a six-digit hex colour
   * @throws INTERNAL when the project metadata cannot be written
   * @example await studio.project.set({ backgroundColor: '#101014' })
   */
  set(patch: ProjectPatch): Promise<ProjectInfo>

  /**
   * Write the active timeline to workspace storage. Not an undo step.
   * @mapsTo saveTimeline
   * @throws NOT_FOUND when no project is open
   * @throws INTERNAL when the project cannot be written
   * @example await studio.project.save()
   */
  save(): Promise<void>

  /**
   * Open a stored project, replacing the editor's timeline, clearing its undo
   * history and loading the project's media library. Not an undo step.
   * @mapsTo loadTimeline
   * @throws NOT_FOUND when no project has that id
   * @throws UNSUPPORTED when the project was stored with an older schema and needs an
   *   upgrade: the user must open it once in the app, and the SDK has no way to force it
   * @throws INTERNAL when the project cannot be read
   * @example await studio.project.open('p-8f21')
   */
  open(id: string): Promise<void>

  /**
   * Delete a stored project for good: its folder and its entry leave the
   * workspace (the project JSON, its timeline, its media links, and the media
   * copies and caches that no other project uses). A media file the project only
   * linked from the user's own disk is never touched. It cannot be undone, and
   * the result says so. The open project is refused: open or create another one
   * first. Not an undo step.
   * @mapsTo useProjectStore.deleteProject, permanentlyDeleteProject
   * @throws NOT_FOUND when no project has that id
   * @throws CONFLICT when `id` is the open project
   * @throws INTERNAL when the project cannot be read or removed (it may then be left in the workspace trash)
   * @example await studio.project.delete('p-8f21')
   */
  delete(id: string): Promise<ProjectDeleteResult>
}

/**
 * `studio.media`: the media library (design §4.2).
 * Implemented by `createMediaApi(): MediaApi` in `namespaces/media.ts`.
 */
export interface MediaApi {
  /**
   * Media library items, optionally filtered by kind. Not an undo step.
   * @mapsTo useMediaLibraryStore.mediaItems
   * @throws Nothing
   * @example studio.media.list({ type: 'video' })
   */
  list(filter?: MediaFilter): MediaInfo[]

  /**
   * One media library item, or null when it does not exist. Not an undo step.
   * @mapsTo useMediaLibraryStore.mediaById
   * @throws Nothing
   * @example studio.media.get('m-1')
   */
  get(id: MediaId): MediaInfo | null

  /**
   * Import files through their handles. Library state. Not an undo step. In the
   * desktop app a media file can be named by absolute path instead: an array of
   * paths is accepted, and each file is served through the app's own
   * allow-listed media route; a browser has only handles.
   * @mapsTo importHandles (media-import-actions.ts:287)
   * @throws UNSUPPORTED when the browser cannot read file handles, or when no project is open
   * @throws INVALID_ARGUMENT when `handles` is not an array of `FileSystemFileHandle`
   * @throws INVALID_ARGUMENT when `storageMode` is not `'copy'` or `'link'`
   * @throws MEDIA_UNAVAILABLE when a file cannot be read
   * @throws INTERNAL when the import fails
   * @example await studio.media.import([handle], { storageMode: 'link' })
   */
  import(handles: FileSystemFileHandle[], options?: MediaImportOptions): Promise<MediaInfo[]>

  /**
   * Remove items from the library. Library state. Not an undo step.
   * @mapsTo deleteMediaBatch (media-delete-actions.ts)
   * @throws INVALID_ARGUMENT when `ids` is not an array of media ids
   * @throws NOT_FOUND when an id is not in the library
   * @throws INTERNAL when the removal fails
   * @example await studio.media.remove(['m-1'])
   */
  remove(ids: MediaId[]): Promise<void>

  /**
   * A URL the browser can play or decode the media from, or null when the
   * bytes are unavailable. Not an undo step.
   * @mapsTo resolveMediaUrl
   * @throws NOT_FOUND when the id is not in the library
   * @throws INTERNAL when the resolver fails
   * @example await studio.media.url('m-1')
   */
  url(id: MediaId): Promise<string | null>
}

/**
 * `studio.subclips`: named ranges of library files (design 1.6, D7).
 * Implemented by `createSubclipsApi(): SubclipsApi` in `namespaces/subclips.ts`.
 * Subclips are library state like media: no call here is an undo step, and a
 * clip placed from a subclip is a clip of the file (`clips.add` with the range).
 */
export interface SubclipsApi {
  /**
   * Subclips in the order they were made, optionally those of one file. Not an
   * undo step.
   * @mapsTo useSubclipsStore.subclips
   * @throws Nothing
   * @example studio.subclips.list({ mediaId: 'm-1' })
   */
  list(filter?: SubclipFilter): SubclipInfo[]

  /**
   * One subclip, or null when it does not exist. Not an undo step.
   * @mapsTo useSubclipsStore.subclips
   * @throws Nothing
   * @example studio.subclips.get('s-1')
   */
  get(id: SubclipId): SubclipInfo | null

  /**
   * Cut a named range out of a library file. Library state. Not an undo step.
   * Place it with `clips.add({ mediaId, trackId, from, sourceStart: startFrame,
   * sourceEnd: endFrame })`.
   * @mapsTo useSubclipsStore.create
   * @throws NOT_FOUND when `mediaId` is not in the library
   * @throws UNSUPPORTED when the media is not a video or audio file
   * @throws INVALID_ARGUMENT when the range is not whole frames with `0 <= startFrame <
   *   endFrame <= the file's frame count`, or `name` is given and empty
   * @example const s = studio.subclips.create({ mediaId: 'm-1', startFrame: 90, endFrame: 210, name: 'Gap' })
   */
  create(input: SubclipCreateInput): SubclipInfo

  /**
   * Change a subclip's name. Library state. Not an undo step.
   * @mapsTo useSubclipsStore.rename
   * @throws NOT_FOUND when `id` is not a subclip
   * @throws INVALID_ARGUMENT when `name` is not a non-empty string
   * @example studio.subclips.rename('s-1', 'Gap, second pass')
   */
  rename(id: SubclipId, name: string): void

  /**
   * Delete subclips. Clips already placed from them stay: they are clips of the
   * file. A call that names one missing id deletes nothing. Library state. Not an
   * undo step.
   * @mapsTo useSubclipsStore.remove
   * @throws INVALID_ARGUMENT when `ids` is not an array of subclip ids
   * @throws NOT_FOUND when an id is not a subclip
   * @example studio.subclips.remove(['s-1'])
   */
  remove(ids: SubclipId[]): void
}

/**
 * `studio.tracks`: the track stack of the active context (design §4.2).
 * Implemented by `createTracksApi(): TracksApi` in `namespaces/tracks.ts`.
 * Classic `V#`/`A#` names are re-derived from a track's position on every write,
 * exactly as in the app.
 */
export interface TracksApi {
  /**
   * Tracks from top to bottom. Not an undo step.
   * @mapsTo useItemsStore.tracks
   * @throws Nothing
   * @example studio.tracks.list()
   */
  list(): TrackInfo[]

  /**
   * Add a track at `position` (0 = top; the bottom when absent, where a video track is hidden by the ones above). One
   * undo step.
   * @mapsTo SET_TRACKS (track-actions.ts:10)
   * @throws INVALID_ARGUMENT when `position` is outside the stack, `kind` is not
   *   `video` or `audio`, `name` is not a string, or the input is not an object
   * @example studio.tracks.add({ kind: 'video', name: 'Titles', position: 0 })
   */
  add(input: TrackAddInput): TrackId

  /**
   * Change a track's name and controls. One undo step.
   * @mapsTo SET_TRACKS (track-actions.ts:10)
   * @throws NOT_FOUND when `id` is not a track in the active context
   * @throws INVALID_ARGUMENT when `volume` is outside -60..12, `height` is set (track
   *   height is a view preference the SDK does not change), or the patch is not an object
   * @example studio.tracks.update('a1', { muted: true })
   */
  update(id: TrackId, patch: TrackPatch): void

  /**
   * Delete a track and every clip on it. One undo step.
   * @mapsTo SET_TRACKS + REMOVE_ITEMS (design §0.2)
   * @throws NOT_FOUND when `id` is not a track in the active context
   * @example studio.tracks.remove('a1')
   */
  remove(id: TrackId): void

  /**
   * Set the stack order from an array of track ids, top first. One undo step.
   * @mapsTo SET_TRACKS (track-actions.ts:10)
   * @throws INVALID_ARGUMENT when the list is not a permutation of the current tracks
   * @example studio.tracks.reorder(['v2', 'v1', 'a2', 'a1'])
   */
  reorder(ids: TrackId[]): void
}

/**
 * `studio.clips`: the clips of the active context (design §4.2, §4.3).
 * Implemented by `createClipsApi(): ClipsApi` in `namespaces/clips.ts`.
 */
export interface ClipsApi {
  /**
   * Clips, optionally filtered by track or kind. Not an undo step.
   * @mapsTo useItemsStore.items
   * @throws Nothing
   * @example studio.clips.list({ trackId: 'v1' })
   */
  list(filter?: ClipFilter): ClipInfo[]

  /**
   * One clip, or null when it does not exist. Not an undo step.
   * @mapsTo useItemsStore.itemById
   * @throws Nothing
   * @example studio.clips.get('c1')
   */
  get(id: ClipId): ClipInfo | null

  /**
   * Place a media library item on a track at exactly `from`. One undo step.
   * A clip that would overlap one on its track is refused by default (the
   * error names that clip and the first free frame); pass `onOverlap: 'move'`
   * to have it placed at that frame instead. Then the answer is not the id but
   * a `ClipPlacement` `{ id, from, requestedFrom, moved }`, which says the frame
   * it chose. Without `onOverlap: 'move'` the answer is the id.
   * @mapsTo ADD_ITEM (item-actions.ts:610)
   * @throws NOT_FOUND when `mediaId` or `trackId` does not exist
   * @throws INVALID_ARGUMENT when `from` is not an integer frame >= 0, or `trackId`
   *   cannot hold a clip of the media's kind, or `sourceStart`/`sourceEnd` are not a
   *   whole-frame range inside the file given as a pair (and only for video or audio),
   *   or `durationInFrames` disagrees with the length of the range, or `onOverlap` is not `'move'` or `'fail'`
   * @throws UNSUPPORTED when the media kind cannot be placed on a timeline
   * @throws CONFLICT when the clip would overlap a clip of its track and `onOverlap` is not `'move'`
   * @example const id = studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 0, sourceStart: 90, sourceEnd: 210 })
   */
  add<T extends ClipAddInput>(input: T): T extends { onOverlap: 'move' } ? ClipPlacement : ClipId

  /**
   * Place several media items in one step. One undo step. Each input is
   * checked as `add` checks it, in order, against the clips already on the
   * track and the inputs before it: an input that would overlap one throws
   * CONFLICT (naming its index, the clip in the way and the first free frame)
   * and the call changes nothing. An input with `onOverlap: 'move'` is placed
   * at that frame instead, and its entry in the answer is a `ClipPlacement`
   * (`id`, `from`, `requestedFrom`, `moved`); every other entry is the id.
   * @mapsTo ADD_ITEM (item-actions.ts:610), once per input
   * @throws NOT_FOUND when a `mediaId` or `trackId` does not exist
   * @throws INVALID_ARGUMENT when a `from` is not an integer frame >= 0, or a
   *   `trackId` cannot hold a clip of its media's kind, or a source range is not valid
   *   (see `clips.add`), or an `onOverlap` is not `'move'` or `'fail'`
   * @throws UNSUPPORTED when a media kind cannot be placed on a timeline
   * @throws CONFLICT when an input would overlap a clip and its `onOverlap` is not `'move'`
   * @example studio.clips.addMany([{ mediaId: 'm-1', trackId: 'v1', from: 0 }])
   */
  addMany<T extends ClipAddInput>(
    inputs: T[],
  ): Array<T extends { onOverlap: 'move' } ? ClipPlacement : ClipId>

  /**
   * Change a clip's label, gain, fades or transform. One undo step.
   * @mapsTo UPDATE_ITEM (item-actions.ts:717)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `volume` is outside -60..12
   * @example studio.clips.update('c1', { volume: -6 })
   */
  update(id: ClipId, patch: ClipPatch): void

  /**
   * Move a clip to `to`, optionally onto another track. One undo step.
   * @mapsTo MOVE_ITEM (item-actions.ts:1205)
   * @throws NOT_FOUND when `id` or `trackId` does not exist
   * @throws INVALID_ARGUMENT when `to` is not an integer frame >= 0, or `trackId`
   *   cannot hold this clip's kind
   * @example studio.clips.move('c1', 120, 'v2')
   */
  move(id: ClipId, to: Frame, trackId?: TrackId): void

  /**
   * Delete clips, optionally closing the gap. One undo step.
   * @mapsTo REMOVE_ITEMS (item-actions.ts:915) / RIPPLE_DELETE_ITEMS (:945)
   * @throws NOT_FOUND when an id is not a clip in the active context
   * @throws INVALID_ARGUMENT when `ids` is not an array of clip ids
   * @example studio.clips.remove(['c1'], { ripple: true })
   */
  remove(ids: ClipId[], options?: ClipRemoveOptions): void

  /**
   * Copy clips after themselves. One undo step.
   * @mapsTo DUPLICATE_ITEMS (item-actions.ts:1297)
   * @throws NOT_FOUND when an id is not a clip in the active context
   * @throws INVALID_ARGUMENT when `count` is not a positive integer
   * @example studio.clips.duplicate(['c1'], { count: 2 })
   */
  duplicate(ids: ClipId[], options?: ClipDuplicateOptions): ClipId[]

  /**
   * Split a clip at a timeline frame. One undo step.
   * @mapsTo SPLIT_ITEM (edit/split-actions.ts:13)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `frame` is not an integer frame >= 0
   * @throws CONFLICT when the frame is outside the clip or inside a transition
   * @example const [left, right] = studio.clips.split('c1', 240)
   */
  split(id: ClipId, frame: Frame): [ClipId, ClipId]

  /**
   * Trim a clip's start by `frames`; positive shortens, negative extends.
   * One undo step.
   * @mapsTo TRIM_ITEM_START (edit/trim-actions.ts:253)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `frames` is not an integer
   * @example studio.clips.trimStart('c1', 30)
   */
  trimStart(id: ClipId, frames: number): void

  /**
   * Trim a clip's end by `frames`; positive shortens, negative extends.
   * One undo step.
   * @mapsTo TRIM_ITEM_END (edit/trim-actions.ts:267)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `frames` is not an integer
   * @example studio.clips.trimEnd('c1', 30)
   */
  trimEnd(id: ClipId, frames: number): void

  /**
   * Change a clip's playback speed, keeping its source range, and clear any
   * speed curve: a constant speed is the no-curve case. One undo step.
   * @mapsTo RATE_STRETCH_ITEM (edit/rate-stretch-actions.ts:425)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `speed` is outside 0.1..10
   * @throws UNSUPPORTED when the clip's kind has no playback speed: text, shape,
   *   plain image and lottie clips
   * @example studio.clips.setSpeed('c1', 0.5)
   */
  setSpeed(id: ClipId, speed: number): void

  /**
   * A clip's speed curve, or null when it plays at one speed. Not an undo
   * step. Keys are clip-relative frames, like keyframes: frame 0 is the clip's
   * first frame, and the last key sits at the clip's current length.
   * @mapsTo useItemsStore.itemById.speedCurve + averageSpeed (src/studio/speed/curve.ts:300)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that cannot carry a curve: a reversed clip, a
   *   composition wrapper, or a kind with no playback speed
   * @example studio.clips.getSpeedCurve('c1')?.keys
   */
  getSpeedCurve(id: ClipId): ClipSpeedCurve | null

  /**
   * Set a clip's speed curve, or remove it with null (the clip keeps playing at
   * the curve's average speed). The shape keeps the clip's source span and takes
   * the length it needs, moving the clips after it. One undo step.
   * @mapsTo SET_SPEED_CURVE (src/studio/speed/actions.ts:77)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that cannot carry a curve: a reversed clip, a
   *   composition wrapper, or a kind with no playback speed
   * @throws INVALID_ARGUMENT when `keys` is not a list of at least two keys, a
   *   speed is outside 0.1..10, a frame is not an integer, the keys are not in
   *   increasing frame order, the first and last frames are not 0 and the
   *   clip's length, or an `ease` is not linear, smooth, ease-in or ease-out
   * @example studio.clips.setSpeedCurve('c1', [{ frame: 0, speed: 1, ease: 'smooth' }, { frame: 120, speed: 4 }, { frame: 300, speed: 1 }])
   */
  setSpeedCurve(id: ClipId, keys: SpeedKey[] | null): void

  /**
   * A clip's motion blur settings, or null when it has none (blur off). Not an
   * undo step.
   * @mapsTo useItemsStore.itemById.motionBlur (src/types/timeline.ts)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that cannot carry blur: a reversed clip, a
   *   composition wrapper, or a kind that is not video
   * @example studio.clips.getMotionBlur('c1')?.shutterDegrees
   */
  getMotionBlur(id: ClipId): MotionBlurSettings | null

  /**
   * Switch a clip's motion blur on with a shutter, or off with null. Like
   * ReelSmart Motion Blur, every pixel is blurred along its own motion, which
   * optical flow measures between the stabilized source frames, over the
   * shutter's share of the frame interval (180 degrees is RSMB's 0.5), at every
   * speed; when the clip plays faster than 1x the source frames each output
   * frame covers are blurred and joined into one smear. With `smoothSlowMotion`
   * it also makes each slow-motion frame (below 1x, or a 30 fps file in a 60
   * fps project) from the two frames around it, by blending them or by optical
   * flow, so a slow-down plays smoothly instead of repeating frames; with
   * optical flow, `flowDetail` and `flowEdges` tune it. The
   * deprecated `blendSlowMotion` is still accepted in place of
   * `smoothSlowMotion`: `true` is `'blend'`, `false` is off. One undo step.
   * @mapsTo SET_MOTION_BLUR (src/studio/motion-blur/ui/actions.ts:20)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that cannot carry blur: a reversed clip, a
   *   composition wrapper, or a kind that is not video
   * @throws INVALID_ARGUMENT when `settings` is not null or an object whose
   *   `shutterDegrees` is a number from 0 to 360 (and `smoothSlowMotion`,
   *   when given, `'blend'` or `'optical-flow'`; the deprecated
   *   `blendSlowMotion`, when given, a boolean; `flowDetail`, when given,
   *   `'normal'` or `'high'`; `flowEdges`, when given, `'mix'` or `'nearest'`),
   *   when it gives both `smoothSlowMotion` and `blendSlowMotion`, or when it
   *   gives `flowDetail` or `flowEdges` without `smoothSlowMotion: 'optical-flow'`
   * @example studio.clips.setMotionBlur('c1', { shutterDegrees: 180, smoothSlowMotion: 'optical-flow' })
   * @example studio.clips.setMotionBlur('c1', { shutterDegrees: 0, smoothSlowMotion: 'optical-flow', flowDetail: 'high', flowEdges: 'nearest' })
   */
  setMotionBlur(id: ClipId, settings: MotionBlurSettings | null): void

  /**
   * Give a clip one of the three ramp presets: ramp in from 1x, ramp out to 1x,
   * or both with a hold at the peak. The shape keeps the clip's source span and
   * takes the length it needs, moving the clips after it. One undo step.
   * @mapsTo SET_SPEED_CURVE (src/studio/speed/actions.ts:77) with speedPresetCurve (src/studio/speed/presets.ts:86)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that cannot carry a curve: a reversed clip, a
   *   composition wrapper, or a kind with no playback speed
   * @throws INVALID_ARGUMENT when `preset` is not one of the three presets,
   *   `peak` is outside 0.1..10, or `rampFrames` is not an integer >= 1
   * @example studio.clips.setSpeedPreset('c1', 'ramp-in-out', { peak: 4, rampFrames: 15 })
   */
  setSpeedPreset(id: ClipId, preset: SpeedPreset, options?: SpeedPresetOptions): void

  /**
   * The reference look of the drone reels on one clip, in one call: a speed curve
   * fast-slow-fast (default 4x, 0.45x, 4x, the ramps eased `smooth`) that keeps the
   * clip's source content and takes the length it needs, smooth slow motion by
   * optical flow and motion blur on (the clip's own shutter angle, else 360; the
   * slow part is made by optical flow whatever mode the clip had), and an eased zoom-in
   * on the clip's width and height from its size to `1 + zoom` times it, over the
   * new length. Earlier width, height and scale keyframes of the clip are replaced.
   * The clips after it move by the speed slider's rule (only past the next clip's
   * start). Returns what it set. One undo step.
   * @mapsTo SMOOTH_EDIT (src/studio/smooth-edit/action.ts:142)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that is not a video clip that can carry a speed
   *   curve and blur: a reversed clip, a composition wrapper, or another kind
   * @throws INVALID_ARGUMENT when `options` is not an object, `peak` is outside 1..10,
   *   `slow` outside 0.1..1 or `zoom` outside 0..1
   * @throws CONFLICT when the clip is shorter than four frames, or its first or last
   *   frame is inside a transition and a zoom was asked for (pass `zoom: 0`)
   * @example studio.clips.applySmoothEdit('c1', { peak: 4, slow: 0.45, zoom: 0.2 })
   */
  applySmoothEdit(id: ClipId, options?: SmoothEditOptions): SmoothEditResult

  /**
   * The speed a clip holds at a timeline frame, in x: the curve's value there,
   * or the clip's constant speed when it has no curve. `frame` is an absolute
   * timeline frame, like `clips.split` and `playback.seek`; the keys a curve
   * carries stay clip-relative. Not an undo step.
   * @mapsTo speedAt (src/studio/speed/curve.ts:271)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED for a clip that cannot carry a curve: a reversed clip, a
   *   composition wrapper, or a kind with no playback speed
   * @throws INVALID_ARGUMENT when `frame` is not an integer, or is outside the
   *   clip's frames on the timeline
   * @example studio.clips.speedAt('c1', 90)
   */
  speedAt(id: ClipId, frame: Frame): number

  /**
   * A clip's colour profile, or null when it is unset (nothing was answered
   * for it). `none` is an answer: "this file needs no input transform". Not an
   * undo step.
   * @mapsTo useItemsStore.itemById.inputColor (src/types/timeline.ts)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip
   * @example studio.clips.getColorProfile('c1')
   */
  getColorProfile(id: ClipId): ColorProfile | null

  /**
   * Set a clip's colour profile: `dlog-m` (DJI D-Log M, the Avata 2's profile),
   * `dlog`, or `none`; null clears the answer. One undo step.
   * @mapsTo SET_COLOR_PROFILE (src/studio/presets/ColorPresetSection.tsx:134, updateClipsTogether)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip
   * @throws INVALID_ARGUMENT when `profile` is not `dlog-m`, `dlog`, `none` or null
   * @example studio.clips.setColorProfile('c1', 'dlog-m')
   */
  setColorProfile(id: ClipId, profile: ColorProfile | null): void

  /**
   * A clip's creative look, or null when it has none. Not an undo step.
   * @mapsTo useItemsStore.itemById.look (src/types/timeline.ts)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip
   * @example studio.clips.getLook('c1')?.intensity
   */
  getLook(id: ClipId): ClipLookInfo | null

  /**
   * Apply a look of the looks library to a clip, with a blend (default 1), or
   * remove it with null. Ids come from `looks.list()`. The call reads the
   * library from the workspace itself, so it works on a fresh session. One
   * undo step.
   * @mapsTo SET_LOOK (src/studio/looks/LooksSection.tsx:100, updateClipsTogether)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip
   * @throws INVALID_ARGUMENT when `look` is not null or an object with an id of the library and an `intensity` in 0..1
   * @throws INTERNAL when the looks library cannot be read from the workspace
   * @example await studio.clips.setLook('c1', { id: 'look-1', intensity: 0.8 })
   */
  setLook(id: ClipId, look: ClipLookRequest | null): Promise<void>

  /**
   * A clip's stored stabilization settings, or null when it was never
   * stabilized. A clip switched off keeps its settings with `enabled: false`.
   * Not an undo step.
   * @mapsTo useItemsStore.itemById.stabilization (src/types/timeline.ts)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip
   * @example studio.clips.getStabilization('c1')?.params.smoothness
   */
  getStabilization(id: ClipId): ClipStabilization | null

  /**
   * Switch a clip's stabilization on with the changes in `patch` (the others
   * keep the clip's value, or the engine's defaults), or off with null (the
   * settings are kept). Switching on opens the clip on the engine first, which
   * can take seconds, so the call is async and each awaited call is its own
   * undo step. A clip that is already on only stores the changes.
   * @mapsTo setEnabled / switchOn (src/studio/stabilization/ui/use-stabilization-controls.ts:131) with openStabilization and storeStabilization (src/studio/stabilization/ui/switch.ts)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip, its file carries no motion data, or it has no lens profile
   * @throws INVALID_ARGUMENT when `patch` is not null or an object, or a field is outside the range the panel accepts
   * @throws INTERNAL when the engine fails to open the clip; the message is the engine's
   * @example await studio.clips.setStabilization('c1', { smoothness: 0.6, horizonLockPercent: 100 })
   */
  setStabilization(id: ClipId, patch: StabilizationPatch | null): Promise<void>
}

/**
 * `studio.titles`: text clips of the active context (design §4.2).
 * Implemented by `createTitlesApi(): TitlesApi` in `namespaces/titles.ts`.
 */
export interface TitlesApi {
  /**
   * Text clips, top of the stack first. Not an undo step.
   * @mapsTo useItemsStore.items filtered by type 'text'
   * @throws Nothing
   * @example studio.titles.list()
   */
  list(): ClipInfo[]

  /**
   * Add a text clip with the editor's default style. One undo step.
   * @mapsTo createDefaultTextItem + ADD_ITEM (item-actions.ts:610)
   * @throws NOT_FOUND when `trackId` does not exist
   * @throws INVALID_ARGUMENT when `trackId` is not a video track, `from` or
   *   `durationInFrames` is not a positive frame count, or a style field is out of range
   * @throws CONFLICT when the title would overlap a clip on its track (it is never moved): a title over footage goes on
   *   a video track of its own above it, `studio.tracks.add({ kind: 'video', name: 'Titles', position: 0 })`
   * @example studio.titles.add({ trackId: 'v1', from: 0, durationInFrames: 90, text: 'Cinque Terre' })
   */
  add(input: TitleAddInput): ClipId

  /**
   * Change a title's text or style. One undo step.
   * @mapsTo UPDATE_ITEM (item-actions.ts:717)
   * @throws NOT_FOUND when `id` is not a text clip in the active context
   * @throws INVALID_ARGUMENT when `text` is not a string or a style field is out of range
   * @example studio.titles.update('t1', { text: 'Riomaggiore' })
   */
  update(id: ClipId, patch: TitlePatch): void
}

/**
 * `studio.effects`: GPU effects on clips (design §4.2).
 * Implemented by `createEffectsApi(): EffectsApi` in `namespaces/effects.ts`.
 */
export interface EffectsApi {
  /**
   * Every effect type the editor can apply. Not an undo step.
   * @mapsTo GPU_EFFECT_REGISTRY (registry.ts:10)
   * @throws Nothing
   * @example studio.effects.types()
   */
  types(): EffectTypeInfo[]

  /**
   * Effects on a clip, in application order. Not an undo step.
   * @mapsTo useItemsStore.itemById.items[].effects
   * @throws NOT_FOUND when `clip` is not a clip in the active context
   * @example studio.effects.list('c1')
   */
  list(clip: ClipId): EffectInfo[]

  /**
   * Add an effect with the type's defaults, plus any `params`. One undo step.
   * @mapsTo ADD_EFFECT (effect-actions.ts:11)
   * @throws NOT_FOUND when `clip` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `type` is not an effect type id
   * @example const id = studio.effects.add('c1', 'gpu-brightness', { amount: 0.1 })
   */
  add(clip: ClipId, type: string, params?: Record<string, EffectParamValue>): EffectId

  /**
   * Change an effect's parameters or enabled flag. One undo step.
   * @mapsTo UPDATE_EFFECT (effect-actions.ts:33)
   * @throws NOT_FOUND when `clip` or `effect` does not exist
   * @throws INVALID_ARGUMENT when the patch has a field other than `params` or
   *   `enabled`, a parameter is unknown to the effect type, has the wrong type or is
   *   out of range, or `enabled` is not a boolean
   * @example studio.effects.update('c1', 'e1', { enabled: false })
   */
  update(clip: ClipId, effect: EffectId, patch: EffectPatch): void

  /**
   * Remove an effect from a clip. One undo step.
   * @mapsTo REMOVE_EFFECT (effect-actions.ts:48)
   * @throws NOT_FOUND when `clip` or `effect` does not exist
   * @example studio.effects.remove('c1', 'e1')
   */
  remove(clip: ClipId, effect: EffectId): void
}

/**
 * `studio.keyframes`: scalar animation lanes of a clip (design §4.2).
 * Implemented by `createKeyframesApi(): KeyframesApi` in `namespaces/keyframes.ts`.
 * An update that writes nothing adds no undo entry, and `removeAll` clears the
 * clip's vector lanes too.
 */
export interface KeyframesApi {
  /**
   * Properties of a clip that can be animated. Not an undo step.
   * @mapsTo getAnimatablePropertiesForItem (animatable-properties.ts:41)
   * @throws NOT_FOUND when `clip` is not a clip in the active context
   * @example studio.keyframes.properties('c1')
   */
  properties(clip: ClipId): KeyframeProperty[]

  /**
   * Keyframes of a clip, optionally of one property, in frame order. Not an undo step.
   * @mapsTo useKeyframesStore.keyframesByItemId
   * @throws NOT_FOUND when `clip` is not a clip in the active context
   * @example studio.keyframes.list('c1', 'opacity')
   */
  list(clip: ClipId, property?: KeyframeProperty): KeyframeInfo[]

  /**
   * Add a keyframe at a clip-relative frame. One undo step. The property `framingX` or `framingY` (`-1..1`) animates the
   * stabilized window's framing of a clip whose stabilization is on: with a keyframe on it, the animated value replaces
   * the clip's stored `framingX` or `framingY` (each lane on its own), and the window is still held to the room the
   * stabilization has at every frame.
   * @mapsTo ADD_KEYFRAME (keyframe-actions.ts:36)
   * @throws NOT_FOUND when `clip` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `property` is not animatable for the clip, `frame` is not
   *   an integer frame >= 0, the value is not a number or is outside the property's range, or
   *   `easing` is not an easing type
   * @throws CONFLICT when the frame is outside the clip or inside a transition region
   * @example const id = studio.keyframes.add('c1', 'opacity', 0, 1, 'ease-in-out')
   */
  add(
    clip: ClipId,
    property: KeyframeProperty,
    frame: Frame,
    value: number,
    easing?: Easing,
  ): KeyframeId

  /**
   * Change a keyframe's value, easing or frame. One undo step.
   * @mapsTo UPDATE_KEYFRAME (keyframe-actions.ts)
   * @throws NOT_FOUND when `clip` or `keyframe` does not exist
   * @throws INVALID_ARGUMENT when `patch.value` is outside the property's range, `patch.frame`
   *   is not an integer frame >= 0, or `patch.easing` is not an easing type
   * @throws CONFLICT when `patch.frame` is outside the clip or inside a transition region
   * @example studio.keyframes.update('c1', 'k1', { value: 0.5 })
   */
  update(clip: ClipId, keyframe: KeyframeId, patch: KeyframePatch): void

  /**
   * Remove one keyframe. One undo step.
   * @mapsTo REMOVE_KEYFRAME (keyframe-actions.ts)
   * @throws NOT_FOUND when `clip` or `keyframe` does not exist
   * @example studio.keyframes.remove('c1', 'k1')
   */
  remove(clip: ClipId, keyframe: KeyframeId): void

  /**
   * Remove every keyframe of a clip, or of one property. One undo step.
   * @mapsTo REMOVE_KEYFRAMES (keyframe-actions.ts)
   * @throws NOT_FOUND when `clip` is not a clip in the active context
   * @example studio.keyframes.removeAll('c1', 'opacity')
   */
  removeAll(clip: ClipId, property?: KeyframeProperty): void
}

/**
 * `studio.transitions`: transitions at the cuts of the active context (design §4.2).
 * Implemented by `createTransitionsApi(): TransitionsApi` in `namespaces/transitions.ts`.
 */
export interface TransitionsApi {
  /**
   * Presentation ids a transition can use. Not an undo step.
   * @mapsTo transitionRegistry.getIds() (registry.ts:119)
   * @throws Nothing
   * @example studio.transitions.presentations()
   */
  presentations(): string[]

  /**
   * Transitions of the active context. Not an undo step.
   * @mapsTo useTransitionsStore.transitions
   * @throws Nothing
   * @example studio.transitions.list()
   */
  list(): TransitionInfo[]

  /**
   * Add a transition at the cut between two adjacent clips. One undo step.
   * @mapsTo canAddTransition + ADD_TRANSITION (transition-actions.ts:27)
   * @throws NOT_FOUND when `left` or `right` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `presentation` is not a known presentation id,
   *   `durationInFrames` is not an integer frame >= 1, `timing` is not linear, ease-in,
   *   ease-out, ease-in-out or cubic-bezier, `direction` is not from-left, from-right,
   *   from-top or from-bottom, or `alignment` is outside 0..1
   * @throws CONFLICT when the clips are not adjacent on one track or have no handle left
   * @example studio.transitions.add({ left: 'c1', right: 'c2', presentation: 'fade', durationInFrames: 30 })
   */
  add(input: TransitionAddInput): TransitionId

  /**
   * Change a transition's presentation, length or timing. One undo step. A patch
   * that names no field changes nothing and adds no undo entry.
   * @mapsTo UPDATE_TRANSITION (transition-actions.ts:160)
   * @throws NOT_FOUND when `id` is not a transition in the active context
   * @throws INVALID_ARGUMENT when `presentation` is not a known presentation id,
   *   `durationInFrames` is not an integer frame >= 1, `timing` is not linear, ease-in,
   *   ease-out, ease-in-out or cubic-bezier, `direction` is not from-left, from-right,
   *   from-top or from-bottom, or `alignment` is outside 0..1
   * @throws CONFLICT when the result would not fit the available handles
   * @example studio.transitions.update('x1', { durationInFrames: 45 })
   */
  update(id: TransitionId, patch: TransitionPatch): void

  /**
   * Remove a transition, leaving the cut. One undo step.
   * @mapsTo REMOVE_TRANSITION (transition-actions.ts:172)
   * @throws NOT_FOUND when `id` is not a transition in the active context
   * @example studio.transitions.remove('x1')
   */
  remove(id: TransitionId): void
}

/**
 * `studio.markers`: markers and the in/out range (design §4.2).
 * Implemented by `createMarkersApi(): MarkersApi` in `namespaces/markers.ts`.
 */
export interface MarkersApi {
  /**
   * Markers in frame order. Not an undo step.
   * @mapsTo useMarkersStore.markers
   * @throws Nothing
   * @example studio.markers.list()
   */
  list(): MarkerInfo[]

  /**
   * Add a marker at a frame. One undo step.
   * @mapsTo ADD_MARKER (marker-actions.ts:12)
   * @throws INVALID_ARGUMENT when `frame` is not an integer frame >= 0
   * @example const id = studio.markers.add({ frame: 120, label: 'take off' })
   */
  add(input: MarkerAddInput): MarkerId

  /**
   * Put a marker on each strong low-frequency hit (kick, bass pluck) of an
   * audio or video clip's sound, at the project frame where the hit plays: the
   * clip's trim, position, speed and reversal are respected. The clip's audio
   * is decoded and analysed off the main thread, which takes a few seconds for
   * a three-minute song, so the call is async. A frame that already has a
   * marker keeps it. Resolves with the frames that carry a beat, in order. One
   * undo step.
   * @mapsTo markBeats (src/studio/beats/mark.ts) with ADD_MARKER (marker-actions.ts:12)
   * @throws NOT_FOUND when `clipId` is not a clip in the active context
   * @throws INVALID_ARGUMENT when `input.strength` is not a number between 0 and 1
   * @throws UNSUPPORTED when the clip is not a video or audio clip
   * @throws MEDIA_UNAVAILABLE when the clip's audio cannot be loaded or decoded
   * @example const frames = await studio.markers.addBeats('a1', { strength: 0.6 })
   */
  addBeats(clipId: ClipId, input?: MarkerBeatsInput): Promise<Frame[]>

  /**
   * Change a marker's frame, label or colour. One undo step.
   * @mapsTo UPDATE_MARKER (marker-actions.ts:26)
   * @throws NOT_FOUND when `id` is not a marker in the active context
   * @throws INVALID_ARGUMENT when `frame` is not an integer frame >= 0
   * @example studio.markers.update('k1', { frame: 150 })
   */
  update(id: MarkerId, patch: MarkerPatch): void

  /**
   * Remove one marker. One undo step.
   * @mapsTo REMOVE_MARKER (marker-actions.ts:38)
   * @throws NOT_FOUND when `id` is not a marker in the active context
   * @example studio.markers.remove('k1')
   */
  remove(id: MarkerId): void

  /**
   * Remove every marker of the active context. One undo step.
   * @mapsTo CLEAR_MARKERS (marker-actions.ts:45)
   * @throws Nothing
   * @example studio.markers.clear()
   */
  clear(): void

  /**
   * The in/out playback range. Not an undo step.
   * @mapsTo useMarkersStore.inPoint + outPoint
   * @throws Nothing
   * @example studio.markers.range()
   */
  range(): RangeInfo

  /**
   * Set the in point, or clear it with null; a point past the end is clamped
   * and one past the out point resets the out point. One undo step.
   * @mapsTo SET_IN_POINT (marker-actions.ts:56)
   * @throws INVALID_ARGUMENT when `frame` is not an integer frame >= 0
   * @example studio.markers.setIn(0)
   */
  setIn(frame: Frame | null): void

  /**
   * Set the out point, or clear it with null; a point past the end is clamped
   * and one before the in point resets the in point. One undo step.
   * @mapsTo SET_OUT_POINT (marker-actions.ts:83)
   * @throws INVALID_ARGUMENT when `frame` is not an integer frame >= 0
   * @example studio.markers.setOut(600)
   */
  setOut(frame: Frame | null): void

  /**
   * Clear both in and out points. One undo step.
   * @mapsTo CLEAR_IN_OUT_POINTS (marker-actions.ts:110)
   * @throws Nothing
   * @example studio.markers.clearRange()
   */
  clearRange(): void
}

/**
 * `studio.selection`: what the editor has selected. Not an undo step.
 * Implemented by `createSelectionApi(): SelectionApi` in `namespaces/selection.ts`.
 */
export interface SelectionApi {
  /**
   * The current selection. Not an undo step.
   * @mapsTo useSelectionStore (selection/store.ts:30)
   * @throws Nothing
   * @example studio.selection.get()
   */
  get(): SelectionInfo

  /**
   * Select clips, tracks, a marker or a transition. Not an undo step.
   * @mapsTo selectItems / selectTracks / selectMarker / selectTransition
   * @throws NOT_FOUND when a selected id does not exist in the active context
   * @throws INVALID_ARGUMENT when the patch names two of clips, marker and transition
   * @example studio.selection.set({ clips: ['c1'] })
   */
  set(patch: SelectionPatch): void

  /**
   * Clear the selection. Not an undo step.
   * @mapsTo useSelectionStore.clearSelection
   * @throws Nothing
   * @example studio.selection.clear()
   */
  clear(): void
}

/**
 * `studio.playback`: the transport. Not an undo step.
 * Implemented by `createPlaybackApi(): PlaybackApi` in `namespaces/playback.ts`.
 */
export interface PlaybackApi {
  /**
   * Playhead, playing state, rate and loop. Not an undo step.
   * @mapsTo usePlaybackStore (playback/store.ts:104)
   * @throws Nothing
   * @example studio.playback.get()
   */
  get(): PlaybackInfo

  /**
   * Move the playhead to a frame. Not an undo step.
   * @mapsTo usePlaybackStore.setCurrentFrame
   * @throws INVALID_ARGUMENT when `frame` is not a frame of the active timeline
   * @example studio.playback.seek(120)
   */
  seek(frame: Frame): void

  /**
   * Start playback at the rate `setRate` chose. Not an undo step.
   * @mapsTo usePlaybackStore.play, then setPlaybackRate with the previous rate
   * @throws Nothing
   * @example studio.playback.play()
   */
  play(): void

  /**
   * Pause playback. Not an undo step.
   * @mapsTo usePlaybackStore.pause
   * @throws Nothing
   * @example studio.playback.pause()
   */
  pause(): void

  /**
   * Set the playback rate multiplier. Not an undo step.
   * @mapsTo usePlaybackStore.setPlaybackRate
   * @throws INVALID_ARGUMENT when `rate` is not a positive number
   * @example studio.playback.setRate(0.5)
   */
  setRate(rate: number): void

  /**
   * Turn looping on or off. Not an undo step.
   * @mapsTo usePlaybackStore.toggleLoop (set semantics: toggles only when the value differs)
   * @throws INVALID_ARGUMENT when `on` is not a boolean
   * @example studio.playback.setLoop(true)
   */
  setLoop(on: boolean): void
}

/**
 * `studio.export`: the render queue (design §4.2, §0.5, §4.7).
 * Implemented by `createExportApi(): ExportApi` in `namespaces/export.ts`; the
 * settings half lives in `namespaces/export-settings.ts`.
 */
export interface ExportApi {
  /**
   * The SDK's export settings. Not an undo step.
   * @mapsTo the SDK settings store (design §0.3); the export dialog does not read it yet
   * @throws Nothing
   * @example studio.export.settings()
   */
  settings(): ExportSettingsInfo

  /**
   * Change the SDK's export settings. Not an undo step.
   * @mapsTo the SDK settings store (design §0.3); the export dialog does not read it yet
   * @throws INVALID_ARGUMENT when a value is not one the exporter accepts
   * @throws UNSUPPORTED when the patch names proResProfile or audioBitrate, which the
   *   export pipeline does not read
   * @example studio.export.setSettings({ quality: 'high' })
   */
  setSettings(patch: ExportSettingsPatch): void

  /**
   * The export dialog's presets resolved for the open project (Instagram Reel, YouTube 4K, Small file, and Same as
   * source when a video clip is placed): each one's settings and numbers. The desktop's ProRes and 10-bit masters
   * need the native encoder and are not offered here. Not an undo step.
   * @mapsTo getPilotPresets / resolvePilotPreset (src/studio/export/presets.ts)
   * @throws UNSUPPORTED when no project is open
   * @example studio.export.presets().find((preset) => preset.id === 'instagram-reel')?.settings
   */
  presets(): ExportPresetInfo[]

  /**
   * Queue an export and return its job. Not an undo step.
   * @mapsTo buildRenderJob (build-render-job.ts:149) + enqueueJobs (render-queue-store.ts:104)
   * @throws UNSUPPORTED when no project is open, or when the settings name proResProfile
   *   or audioBitrate
   * @throws INVALID_ARGUMENT when the range or settings are not valid
   * @throws INTERNAL when the job cannot be built
   * @example const job = await studio.export.start({ name: 'Flight 01' })
   */
  start(options?: ExportStartInput): Promise<ExportJobInfo>

  /**
   * Every job in the queue, oldest first. Not an undo step.
   * @mapsTo useRenderQueueStore.jobs
   * @throws Nothing
   * @example studio.export.jobs()
   */
  jobs(): ExportJobInfo[]

  /**
   * One job, or null when it does not exist. Not an undo step.
   * @mapsTo useRenderQueueStore.jobs
   * @throws Nothing
   * @example studio.export.status('j1')
   */
  status(id: string): ExportJobInfo | null

  /**
   * Wait for a job to finish and return it; when `timeoutMs` passes first, the
   * job as it is then. Not an undo step.
   * @mapsTo useRenderQueueStore.jobs, polled every 250 ms
   * @throws NOT_FOUND when no job has that id
   * @throws INVALID_ARGUMENT when `timeoutMs` is not a non-negative number
   * @throws EXPORT_FAILED when the job fails or is cancelled
   * @example await studio.export.wait('j1', { timeoutMs: 60000 })
   */
  wait(id: string, options?: ExportWaitOptions): Promise<ExportJobInfo>

  /**
   * Cancel a queued or running job. Not an undo step.
   * @mapsTo useRenderQueueStore.cancelJob (render-queue-store.ts:121)
   * @throws NOT_FOUND when no job has that id
   * @example studio.export.cancel('j1')
   */
  cancel(id: string): void
}

/**
 * `studio.history`: the undo history of the active context (design §4.2, §4.4).
 * Implemented by `createHistoryApi(): HistoryApi` in `namespaces/history.ts`.
 */
export interface HistoryApi {
  /**
   * Undo up to `steps` entries and return how many were undone. Not an undo step.
   * @mapsTo useTimelineCommandStore.undo (timeline-command-store.ts:154)
   * @throws INVALID_ARGUMENT when `steps` is not a positive integer
   * @example studio.history.undo(2)
   */
  undo(steps?: number): number

  /**
   * Redo up to `steps` entries and return how many were redone. Not an undo step.
   * @mapsTo useTimelineCommandStore.redo (timeline-command-store.ts:178)
   * @throws INVALID_ARGUMENT when `steps` is not a positive integer
   * @example studio.history.redo()
   */
  redo(steps?: number): number

  /**
   * Whether an entry can be undone. Not an undo step.
   * @mapsTo useTimelineCommandStore.canUndo
   * @throws Nothing
   * @example studio.history.canUndo()
   */
  canUndo(): boolean

  /**
   * Whether an entry can be redone. Not an undo step.
   * @mapsTo useTimelineCommandStore.canRedo
   * @throws Nothing
   * @example studio.history.canRedo()
   */
  canRedo(): boolean

  /**
   * Label of the next entry `undo` would revert, or null. Not an undo step.
   * @mapsTo useTimelineCommandStore.getUndoLabel (timeline-command-store.ts:220)
   * @throws Nothing
   * @example studio.history.undoLabel()
   */
  undoLabel(): string | null

  /**
   * Label of the next entry `redo` would restore, or null. Not an undo step.
   * @mapsTo useTimelineCommandStore.getRedoLabel (timeline-command-store.ts:227)
   * @throws Nothing
   * @example studio.history.redoLabel()
   */
  redoLabel(): string | null

  /**
   * Drop the history of every editing context. Not an undo step.
   * @mapsTo useTimelineCommandStore.clearHistory (timeline-command-store.ts:202)
   * @throws Nothing
   * @example studio.history.clear()
   */
  clear(): void

  /**
   * Number of entries that can be undone. Not an undo step.
   * @mapsTo useTimelineCommandStore.undoStack
   * @throws Nothing
   * @example studio.history.depth()
   */
  depth(): number
}

/**
 * `studio.workspace`: whether the app has a workspace folder to work on.
 * Implemented by `createWorkspaceApi(): WorkspaceApi` in `namespaces/workspace.ts`.
 */
export interface WorkspaceApi {
  /**
   * Whether a workspace folder is open. False while the editor shows its workspace
   * gate, when every call that reads or writes the project would throw. Not an undo step.
   * @mapsTo getWorkspaceRoot (workspace-fs/root.ts)
   * @throws Nothing
   * @example studio.workspace.isOpen()
   */
  isOpen(): boolean
}

/**
 * `studio.looks`: the workspace's looks library, the `.cube` files a clip can
 * apply (`clips.setLook`). Implemented by `createLooksApi(): LooksApi` in `namespaces/looks.ts`.
 */
export interface LooksApi {
  /**
   * The looks of the library, newest last. Reads the library from the
   * workspace when it has not been read yet. Not an undo step.
   * @mapsTo useLooksStore.load (src/studio/looks/store.ts)
   * @throws INTERNAL when the library cannot be read from the workspace
   * @example await studio.looks.list()
   */
  list(): Promise<LookInfo[]>

  /**
   * Add a look to the library from the text of a `.cube` file (3D table, 65
   * points per side at most, input range 0…1) and answer it as `list` does.
   * An agent can write the text with code in the same `run` call (a function
   * over r, g, b) instead of sending a large file. The look is the workspace's,
   * not the project's: not an undo step. `name` is the picker's label (default:
   * the file's TITLE, or its name).
   * @mapsTo useLooksStore.add (src/studio/looks/store.ts)
   * @throws INVALID_ARGUMENT when the text is not a usable `.cube` look (the message names why)
   * @throws INTERNAL when the library cannot be read or written in the workspace
   * @example await studio.looks.add({ fileName: 'warm.cube', text: cubeText, name: 'Warm' })
   */
  add(input: LookAddInput): Promise<LookInfo>

  /**
   * Rename a look: `name` is the label the clip panel's picker shows; the id
   * and the file do not change, so clips keep the look. The library holds only
   * the user's own `.cube` files (there are no built-in looks), so every look
   * can be renamed. Answers the look as `list` does. The look is the
   * workspace's, not the project's: not an undo step.
   * @mapsTo useLooksStore.rename (src/studio/looks/store.ts)
   * @throws NOT_FOUND when `id` is not a look of the library
   * @throws INVALID_ARGUMENT when `name` is empty or not a string
   * @throws INTERNAL when the library cannot be read or written in the workspace
   * @example await studio.looks.rename('look-1', 'Warm')
   */
  rename(id: string, name: string): Promise<LookInfo>

  /**
   * Remove a look from the library and delete its `.cube` file from the
   * workspace. It cannot be undone. A look a clip still uses is refused (the
   * clips would lose their look): the error names those clips, and
   * `clips.setLook(clipId, null)` clears each. The library holds only the
   * user's own `.cube` files (there are no built-in looks), so every look can
   * be removed. Answers the look that was removed. Not an undo step.
   * @mapsTo useLooksStore.remove (src/studio/looks/store.ts)
   * @throws NOT_FOUND when `id` is not a look of the library
   * @throws CONFLICT when a clip of the project still uses the look (the message names the clips)
   * @throws INTERNAL when the library cannot be read or written in the workspace
   * @example await studio.looks.remove('look-1')
   */
  remove(id: string): Promise<LookInfo>
}

/**
 * `studio.shadow`: DroneClean shadow removal on a clip. Mark the shadow, follow
 * it (spends credits: `followCredits` of `shadow.get`), read the price of the
 * clean, clean at that price (spends credits). Both paying calls take the
 * credits the caller expects to spend and refuse unless they equal the current
 * price, so an agent never spends credits the user was not shown. Implemented
 * by `createShadowApi(): ShadowApi` in `namespaces/shadow.ts`. An agent cannot
 * sign in: when the service needs it the user approves it in the app.
 */
export interface ShadowApi {
  /**
   * A clip's shadow session: the mark, the stage, the ranges found, the
   * clean's price, the last failure and what following the shadow costs
   * (`followCredits`). Not an undo step.
   * @mapsTo useShadowSessionStore (src/studio/shadow/ui/use-shadow-session.ts)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip or is reversed
   * @example studio.shadow.get('c1').quote?.costCredits
   */
  get(id: ClipId): ShadowState

  /**
   * Mark the shadow on a clip: a point in source pixels on a source frame
   * (default: the frame the playhead shows on the clip). Forgets a pass made
   * for another mark. One undo step.
   * @mapsTo setMark (src/studio/shadow/ui/use-shadow-session.ts:1104)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip, is reversed, or the feature is switched off
   * @throws INVALID_ARGUMENT when the point is outside the source picture, the radius is not positive, or the source frame is not an integer inside the file; also when no source frame is given and the playhead is outside the clip
   * @example studio.shadow.mark('c1', { x: 1440, y: 1200 })
   */
  mark(id: ClipId, mark: ShadowMarkInput): void

  /**
   * Follow the marked shadow with a tracking pass and price cleaning what it
   * found. This SPENDS the user's credits: pass the credits you expect to
   * spend, and the call refuses unless that equals what following the shadow
   * in this clip costs now (`followCredits` of `shadow.get`, the number the
   * follow button shows: its part of the source, about a credit a second at
   * 30 fps, twice at 60, at least 5). Show the user that price first. Awaits
   * the whole pass (price check, balance check, cut, upload, track, quote); a
   * balance that cannot cover it stops it before anything is uploaded. The
   * piece sent reaches the keyframes around the clip's part: when that costs
   * more than `expectedCredits`, nothing is spent and the call throws CONFLICT
   * naming the exact price (`followCredits` then reads it, and a call with it
   * goes on with the piece already sent). The service never charges more than
   * `expectedCredits`, and gives the credits back when no shadow is found where
   * it was marked: `creditsSpent` says what it took. A second call for the same
   * mark reuses the finished pass and spends nothing.
   * @mapsTo track (src/studio/shadow/ui/use-shadow-session.ts:1123)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip, is reversed, or the feature is switched off
   * @throws INVALID_ARGUMENT when `expectedCredits` is not a whole number of credits, 0 or more
   * @throws CONFLICT when the shadow is not marked, `expectedCredits` differs from the current price or the piece costs more (the message names the exact price; nothing is spent), or the user must approve a sign-in in the app
   * @throws MEDIA_UNAVAILABLE when the clip's file cannot be read
   * @throws INTERNAL when the pass fails, or the balance does not cover it; the message is the service's
   * @example const { ranges, quote, creditsSpent } = await studio.shadow.follow('c1', 10)
   */
  follow(id: ClipId, expectedCredits: number): Promise<ShadowFollowResult>

  /**
   * Ask the price of the found ranges again, which also reads the balance
   * again (after credits were bought). Not an undo step and no credits are spent.
   * @mapsTo refreshQuote (src/studio/shadow/ui/use-shadow-session.ts:1230)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip or is reversed
   * @throws CONFLICT when the shadow has not been followed yet, or the user must approve a sign-in in the app
   * @throws INTERNAL when the quote fails; the message is the service's
   * @example await studio.shadow.quote('c1')
   */
  quote(id: ClipId): Promise<ShadowQuote>

  /**
   * Clean the followed ranges. This SPENDS the user's credits: pass the credits
   * you expect to spend, and the call refuses unless that equals the current
   * price (`costCredits` of `shadow.quote`), so a clean never costs more than
   * the price you were shown. The cleaned file is kept in the project and
   * recorded on the clip.
   * @mapsTo clean (src/studio/shadow/ui/use-shadow-session.ts:1155)
   * @throws NOT_FOUND when `id` is not a clip in the active context
   * @throws UNSUPPORTED when the clip is not a video clip, is reversed, or cleaning is switched off
   * @throws INVALID_ARGUMENT when `expectedCredits` is not a whole number of credits, 0 or more
   * @throws CONFLICT when the shadow was not followed, the price differs from `expectedCredits`, the balance does not cover it, or the user must approve a sign-in in the app
   * @throws INTERNAL when the clean fails; the message is the service's
   * @example await studio.shadow.clean('c1', 12)
   */
  clean(id: ClipId, expectedCredits: number): Promise<ShadowCleanResult>
}

/**
 * The DroneClean Studio SDK: one typed object over the editor's command store
 * and domain stores (design §4.2). Every call that changes the timeline is one
 * undo step; a failed call leaves the project exactly as it was.
 */
export interface Studio {
  /** Format version of the SDK, `1`. */
  readonly version: 1

  /** The open project and its metadata. */
  readonly project: ProjectApi
  /** The media library. */
  readonly media: MediaApi
  /** Named ranges of library files. */
  readonly subclips: SubclipsApi
  /** The track stack of the active context. */
  readonly tracks: TracksApi
  /** The clips of the active context. */
  readonly clips: ClipsApi
  /** The text clips of the active context. */
  readonly titles: TitlesApi
  /** GPU effects on clips. */
  readonly effects: EffectsApi
  /** Scalar keyframe lanes of a clip. */
  readonly keyframes: KeyframesApi
  /** Transitions at the cuts of the active context. */
  readonly transitions: TransitionsApi
  /** Markers and the in/out range. */
  readonly markers: MarkersApi
  /** What the editor has selected. */
  readonly selection: SelectionApi
  /** The transport. */
  readonly playback: PlaybackApi
  /** The render queue. */
  readonly export: ExportApi
  /** The undo history of the active context. */
  readonly history: HistoryApi
  /** Whether the app has a workspace folder. */
  readonly workspace: WorkspaceApi
  /** The looks library. */
  readonly looks: LooksApi
  /** DroneClean shadow removal. */
  readonly shadow: ShadowApi

  /**
   * Run `fn` as one undo step and report what it changed (design §4.4).
   * Nested calls commit once, at the outermost level; if `fn` throws, the
   * project is restored to its state before the call and nothing is added to
   * the history. A callback whose structural diff is empty adds no entry, so
   * writing the values that are already there is not an undo step. `fn` must be
   * synchronous: an edit made after an `await` is a step of its own. A
   * synchronous script wrapped here is one Ctrl+Z. `label` is the undo entry's
   * command type and follows `<NAMESPACE>_<METHOD>` in upper snake case, e.g.
   * `CLIPS_SPLIT` or `TRACKS_REMOVE`.
   * @mapsTo captureSnapshot / restoreSnapshot / addUndoEntry (design §4.4)
   * @throws INTERNAL when `fn` throws a non-`StudioError` (a `StudioError` is rethrown as it is)
   * @example const { value, changes } = studio.transaction('two cuts', s => s.clips.split('c1', 120))
   */
  transaction<T>(label: string, fn: (studio: Studio) => T): TransactionResult<T>

  /**
   * The generated reference: every namespace, method, type and error code with
   * its documentation. Not an undo step.
   * @mapsTo reference/sdk-reference.json (design §4.9)
   * @throws Nothing
   * @example studio.reference()
   */
  reference(): SdkReference
}
