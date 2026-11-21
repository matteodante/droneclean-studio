# DroneClean Studio SDK reference

Generated from the JSDoc of `src/studio/sdk/types.ts` by `npm run sdk:reference`;
format version 1. Every call that changes the timeline is one undo step, and a
failed call leaves the project exactly as it was. The same content is committed as
`sdk-reference.json` for `studio.reference()` and the MCP `search` tool.

## Namespaces

| Namespace | Methods |
|---|---|
| `studio.project` | 10 |
| `studio.media` | 5 |
| `studio.subclips` | 5 |
| `studio.tracks` | 5 |
| `studio.clips` | 26 |
| `studio.titles` | 3 |
| `studio.effects` | 5 |
| `studio.keyframes` | 6 |
| `studio.transitions` | 5 |
| `studio.markers` | 10 |
| `studio.selection` | 3 |
| `studio.playback` | 6 |
| `studio.export` | 8 |
| `studio.history` | 8 |
| `studio.workspace` | 1 |
| `studio.looks` | 4 |
| `studio.shadow` | 5 |
| `studio.preview` | 6 |

## studio.project

`studio.project`: the open project and its metadata (design §4.2, §0.6). Implemented by `createProjectApi(): ProjectApi` in `namespaces/project.ts`.

### `studio.project.current()`

```ts
current(): ProjectInfo | null
```

The open project, or null when no project is open. Not an undo step.

- Maps to: `useProjectStore.currentProject`
- Throws: nothing

Example:

```ts
studio.project.current()
```

### `studio.project.list()`

```ts
list(): Promise<ProjectInfo[]>
```

Every project in the workspace storage. Not an undo step.

- Maps to: `getAllProjects + useProjectStore.projects`
- Throws: INTERNAL

Example:

```ts
await studio.project.list()
```

### `studio.project.create()`

```ts
create(input: ProjectCreateInput): Promise<ProjectInfo>
```

Create a new empty project in workspace storage and open it: it becomes the current project with its empty timeline and its own media library, so media can be imported right away (no `project.open` needed). Not an undo step.

- Maps to: `useProjectStore.createProject + createProjectObject`
- Throws: INVALID_ARGUMENT, INTERNAL

Example:

```ts
const { id } = await studio.project.create({ name: 'Flight', width: 3840, height: 2160, fps: { num: 60000, den: 1001 } })
```

### `studio.project.rate()`

```ts
rate(): Rate
```

The project frame rate as an exact fraction. Not an undo step.

- Maps to: `useTimelineSettingsStore.fps`
- Throws: nothing

Example:

```ts
studio.project.rate()
```

### `studio.project.context()`

```ts
context(): TimelineContext
```

The editing context the SDK is working in. Not an undo step.

- Maps to: `useCompositionNavigationStore.activeCompositionId`
- Throws: nothing

Example:

```ts
studio.project.context()
```

### `studio.project.duration()`

```ts
duration(): Frame
```

Length of the active timeline in frames. Not an undo step.

- Maps to: `computeCompositionDuration (actions/shared.ts:173)`
- Throws: nothing

Example:

```ts
studio.project.duration()
```

### `studio.project.set()`

```ts
set(patch: ProjectPatch): Promise<ProjectInfo>
```

Change the project's canvas size, rate or background. One undo step.

- Maps to: `UPDATE_PROJECT_METADATA via commitProjectMetadataChange (project-metadata-history.ts:39) + useTimelineSettingsStore.setFps`
- Throws: NOT_FOUND, INVALID_ARGUMENT, INTERNAL

Example:

```ts
await studio.project.set({ backgroundColor: '#101014' })
```

### `studio.project.save()`

```ts
save(): Promise<void>
```

Write the active timeline to workspace storage. Not an undo step.

- Maps to: `saveTimeline`
- Throws: NOT_FOUND, INTERNAL

Example:

```ts
await studio.project.save()
```

### `studio.project.open()`

```ts
open(id: string): Promise<void>
```

Open a stored project, replacing the editor's timeline, clearing its undo history and loading the project's media library. Not an undo step.

- Maps to: `loadTimeline`
- Throws: NOT_FOUND, UNSUPPORTED, INTERNAL

Example:

```ts
await studio.project.open('p-8f21')
```

### `studio.project.delete()`

```ts
delete(id: string): Promise<ProjectDeleteResult>
```

Delete a stored project for good: its folder and its entry leave the workspace (the project JSON, its timeline, its media links, and the media copies and caches that no other project uses). A media file the project only linked from the user's own disk is never touched. It cannot be undone, and the result says so. The open project is refused: open or create another one first. Not an undo step.

- Maps to: `useProjectStore.deleteProject, permanentlyDeleteProject`
- Throws: NOT_FOUND, CONFLICT, INTERNAL

Example:

```ts
await studio.project.delete('p-8f21')
```

## studio.media

`studio.media`: the media library (design §4.2). Implemented by `createMediaApi(): MediaApi` in `namespaces/media.ts`.

### `studio.media.list()`

```ts
list(filter?: MediaFilter): MediaInfo[]
```

Media library items, optionally filtered by kind. Not an undo step.

- Maps to: `useMediaLibraryStore.mediaItems`
- Throws: nothing

Example:

```ts
studio.media.list({ type: 'video' })
```

### `studio.media.get()`

```ts
get(id: MediaId): MediaInfo | null
```

One media library item, or null when it does not exist. Not an undo step.

- Maps to: `useMediaLibraryStore.mediaById`
- Throws: nothing

Example:

```ts
studio.media.get('m-1')
```

### `studio.media.import()`

```ts
import(handles: FileSystemFileHandle[], options?: MediaImportOptions): Promise<MediaInfo[]>
```

Import files through their handles. Library state. Not an undo step. In the desktop app a media file can be named by absolute path instead: an array of paths is accepted, and each file is served through the app's own allow-listed media route; a browser has only handles.

- Maps to: `importHandles (media-import-actions.ts:287)`
- Throws: UNSUPPORTED, INVALID_ARGUMENT, MEDIA_UNAVAILABLE, INTERNAL

Example:

```ts
await studio.media.import([handle], { storageMode: 'link' })
```

### `studio.media.remove()`

```ts
remove(ids: MediaId[]): Promise<void>
```

Remove items from the library. Library state. Not an undo step.

- Maps to: `deleteMediaBatch (media-delete-actions.ts)`
- Throws: INVALID_ARGUMENT, NOT_FOUND, INTERNAL

Example:

```ts
await studio.media.remove(['m-1'])
```

### `studio.media.url()`

```ts
url(id: MediaId): Promise<string | null>
```

A URL the browser can play or decode the media from, or null when the bytes are unavailable. Not an undo step.

- Maps to: `resolveMediaUrl`
- Throws: NOT_FOUND, INTERNAL

Example:

```ts
await studio.media.url('m-1')
```

## studio.subclips

`studio.subclips`: named ranges of library files (design 1.6, D7). Implemented by `createSubclipsApi(): SubclipsApi` in `namespaces/subclips.ts`. Subclips are library state like media: no call here is an undo step, and a clip placed from a subclip is a clip of the file (`clips.add` with the range).

### `studio.subclips.list()`

```ts
list(filter?: SubclipFilter): SubclipInfo[]
```

Subclips in the order they were made, optionally those of one file. Not an undo step.

- Maps to: `useSubclipsStore.subclips`
- Throws: nothing

Example:

```ts
studio.subclips.list({ mediaId: 'm-1' })
```

### `studio.subclips.get()`

```ts
get(id: SubclipId): SubclipInfo | null
```

One subclip, or null when it does not exist. Not an undo step.

- Maps to: `useSubclipsStore.subclips`
- Throws: nothing

Example:

```ts
studio.subclips.get('s-1')
```

### `studio.subclips.create()`

```ts
create(input: SubclipCreateInput): SubclipInfo
```

Cut a named range out of a library file. Library state. Not an undo step. Place it with `clips.add({ mediaId, trackId, from, sourceStart: startFrame, sourceEnd: endFrame })`.

- Maps to: `useSubclipsStore.create`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
const s = studio.subclips.create({ mediaId: 'm-1', startFrame: 90, endFrame: 210, name: 'Gap' })
```

### `studio.subclips.rename()`

```ts
rename(id: SubclipId, name: string): void
```

Change a subclip's name. Library state. Not an undo step.

- Maps to: `useSubclipsStore.rename`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.subclips.rename('s-1', 'Gap, second pass')
```

### `studio.subclips.remove()`

```ts
remove(ids: SubclipId[]): void
```

Delete subclips. Clips already placed from them stay: they are clips of the file. A call that names one missing id deletes nothing. Library state. Not an undo step.

- Maps to: `useSubclipsStore.remove`
- Throws: INVALID_ARGUMENT, NOT_FOUND

Example:

```ts
studio.subclips.remove(['s-1'])
```

## studio.tracks

`studio.tracks`: the track stack of the active context (design §4.2). Implemented by `createTracksApi(): TracksApi` in `namespaces/tracks.ts`. Classic `V#`/`A#` names are re-derived from a track's position on every write, exactly as in the app.

### `studio.tracks.list()`

```ts
list(): TrackInfo[]
```

Tracks from top to bottom. Not an undo step.

- Maps to: `useItemsStore.tracks`
- Throws: nothing

Example:

```ts
studio.tracks.list()
```

### `studio.tracks.add()`

```ts
add(input: TrackAddInput): TrackId
```

Add a track at `position` (0 = top; the bottom when absent, where a video track is hidden by the ones above). One undo step.

- Maps to: `SET_TRACKS (track-actions.ts:10)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.tracks.add({ kind: 'video', name: 'Titles', position: 0 })
```

### `studio.tracks.update()`

```ts
update(id: TrackId, patch: TrackPatch): void
```

Change a track's name and controls. One undo step.

- Maps to: `SET_TRACKS (track-actions.ts:10)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.tracks.update('a1', { muted: true })
```

### `studio.tracks.remove()`

```ts
remove(id: TrackId): void
```

Delete a track and every clip on it. One undo step.

- Maps to: `SET_TRACKS + REMOVE_ITEMS (design §0.2)`
- Throws: NOT_FOUND

Example:

```ts
studio.tracks.remove('a1')
```

### `studio.tracks.reorder()`

```ts
reorder(ids: TrackId[]): void
```

Set the stack order from an array of track ids, top first. One undo step.

- Maps to: `SET_TRACKS (track-actions.ts:10)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.tracks.reorder(['v2', 'v1', 'a2', 'a1'])
```

## studio.clips

`studio.clips`: the clips of the active context (design §4.2, §4.3). Implemented by `createClipsApi(): ClipsApi` in `namespaces/clips.ts`.

### `studio.clips.list()`

```ts
list(filter?: ClipFilter): ClipInfo[]
```

Clips, optionally filtered by track or kind. Not an undo step.

- Maps to: `useItemsStore.items`
- Throws: nothing

Example:

```ts
studio.clips.list({ trackId: 'v1' })
```

### `studio.clips.get()`

```ts
get(id: ClipId): ClipInfo | null
```

One clip, or null when it does not exist. Not an undo step.

- Maps to: `useItemsStore.itemById`
- Throws: nothing

Example:

```ts
studio.clips.get('c1')
```

### `studio.clips.add()`

```ts
add<T extends ClipAddInput>(input: T): T extends { onOverlap: 'move'
```

Place a media library item on a track at exactly `from`. One undo step. A clip that would overlap one on its track is refused by default (the error names that clip and the first free frame); pass `onOverlap: 'move'` to have it placed at that frame instead. Then the answer is not the id but a `ClipPlacement` `{ id, from, requestedFrom, moved }`, which says the frame it chose. Without `onOverlap: 'move'` the answer is the id.

- Maps to: `ADD_ITEM (item-actions.ts:610)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, UNSUPPORTED, CONFLICT

Example:

```ts
const id = studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 0, sourceStart: 90, sourceEnd: 210 })
```

### `studio.clips.addMany()`

```ts
addMany<T extends ClipAddInput>(inputs: T[]): Array<T extends { onOverlap: 'move'
```

Place several media items in one step. One undo step. Each input is checked as `add` checks it, in order, against the clips already on the track and the inputs before it: an input that would overlap one throws CONFLICT (naming its index, the clip in the way and the first free frame) and the call changes nothing. An input with `onOverlap: 'move'` is placed at that frame instead, and its entry in the answer is a `ClipPlacement` (`id`, `from`, `requestedFrom`, `moved`); every other entry is the id.

- Maps to: `ADD_ITEM (item-actions.ts:610), once per input`
- Throws: NOT_FOUND, INVALID_ARGUMENT, UNSUPPORTED, CONFLICT

Example:

```ts
studio.clips.addMany([{ mediaId: 'm-1', trackId: 'v1', from: 0 }])
```

### `studio.clips.update()`

```ts
update(id: ClipId, patch: ClipPatch): void
```

Change a clip's label, gain, fades or transform. One undo step.

- Maps to: `UPDATE_ITEM (item-actions.ts:717)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.clips.update('c1', { volume: -6 })
```

### `studio.clips.move()`

```ts
move(id: ClipId, to: Frame, trackId?: TrackId): void
```

Move a clip to `to`, optionally onto another track. One undo step.

- Maps to: `MOVE_ITEM (item-actions.ts:1205)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.clips.move('c1', 120, 'v2')
```

### `studio.clips.remove()`

```ts
remove(ids: ClipId[], options?: ClipRemoveOptions): void
```

Delete clips, optionally closing the gap. One undo step.

- Maps to: `REMOVE_ITEMS (item-actions.ts:915) / RIPPLE_DELETE_ITEMS (:945)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.clips.remove(['c1'], { ripple: true })
```

### `studio.clips.duplicate()`

```ts
duplicate(ids: ClipId[], options?: ClipDuplicateOptions): ClipId[]
```

Copy clips after themselves. One undo step.

- Maps to: `DUPLICATE_ITEMS (item-actions.ts:1297)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.clips.duplicate(['c1'], { count: 2 })
```

### `studio.clips.split()`

```ts
split(id: ClipId, frame: Frame): [ClipId, ClipId]
```

Split a clip at a timeline frame. One undo step.

- Maps to: `SPLIT_ITEM (edit/split-actions.ts:13)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, CONFLICT

Example:

```ts
const [left, right] = studio.clips.split('c1', 240)
```

### `studio.clips.trimStart()`

```ts
trimStart(id: ClipId, frames: number): void
```

Trim a clip's start by `frames`; positive shortens, negative extends. One undo step.

- Maps to: `TRIM_ITEM_START (edit/trim-actions.ts:253)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.clips.trimStart('c1', 30)
```

### `studio.clips.trimEnd()`

```ts
trimEnd(id: ClipId, frames: number): void
```

Trim a clip's end by `frames`; positive shortens, negative extends. One undo step.

- Maps to: `TRIM_ITEM_END (edit/trim-actions.ts:267)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.clips.trimEnd('c1', 30)
```

### `studio.clips.setSpeed()`

```ts
setSpeed(id: ClipId, speed: number): void
```

Change a clip's playback speed, keeping its source range, and clear any speed curve: a constant speed is the no-curve case. One undo step.

- Maps to: `RATE_STRETCH_ITEM (edit/rate-stretch-actions.ts:425)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, UNSUPPORTED

Example:

```ts
studio.clips.setSpeed('c1', 0.5)
```

### `studio.clips.getSpeedCurve()`

```ts
getSpeedCurve(id: ClipId): ClipSpeedCurve | null
```

A clip's speed curve, or null when it plays at one speed. Not an undo step. Keys are clip-relative frames, like keyframes: frame 0 is the clip's first frame, and the last key sits at the clip's current length.

- Maps to: `useItemsStore.itemById.speedCurve + averageSpeed (src/studio/speed/curve.ts:300)`
- Throws: NOT_FOUND, UNSUPPORTED

Example:

```ts
studio.clips.getSpeedCurve('c1')?.keys
```

### `studio.clips.setSpeedCurve()`

```ts
setSpeedCurve(id: ClipId, keys: SpeedKey[] | null): void
```

Set a clip's speed curve, or remove it with null (the clip keeps playing at the curve's average speed). The shape keeps the clip's source span and takes the length it needs, moving the clips after it. One undo step.

- Maps to: `SET_SPEED_CURVE (src/studio/speed/actions.ts:77)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
studio.clips.setSpeedCurve('c1', [{ frame: 0, speed: 1, ease: 'smooth' }, { frame: 120, speed: 4 }, { frame: 300, speed: 1 }])
```

### `studio.clips.getMotionBlur()`

```ts
getMotionBlur(id: ClipId): MotionBlurSettings | null
```

A clip's motion blur settings, or null when it has none (blur off). Not an undo step.

- Maps to: `useItemsStore.itemById.motionBlur (src/types/timeline.ts)`
- Throws: NOT_FOUND, UNSUPPORTED

Example:

```ts
studio.clips.getMotionBlur('c1')?.shutterDegrees
```

### `studio.clips.setMotionBlur()`

```ts
setMotionBlur(id: ClipId, settings: MotionBlurSettings | null): void
```

Switch a clip's motion blur on with a shutter, or off with null. Like ReelSmart Motion Blur, every pixel is blurred along its own motion, which optical flow measures between the stabilized source frames, over the shutter's share of the frame interval (180 degrees is RSMB's 0.5), at every speed; when the clip plays faster than 1x the source frames each output frame covers are blurred and joined into one smear. With `smoothSlowMotion` it also makes each slow-motion frame (below 1x, or a 30 fps file in a 60 fps project) from the two frames around it, by blending them or by optical flow, so a slow-down plays smoothly instead of repeating frames; with optical flow, `flowDetail` and `flowEdges` tune it. The deprecated `blendSlowMotion` is still accepted in place of `smoothSlowMotion`: `true` is `'blend'`, `false` is off. One undo step.

- Maps to: `SET_MOTION_BLUR (src/studio/motion-blur/ui/actions.ts:20)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
studio.clips.setMotionBlur('c1', { shutterDegrees: 180, smoothSlowMotion: 'optical-flow' })
```

### `studio.clips.setSpeedPreset()`

```ts
setSpeedPreset(id: ClipId, preset: SpeedPreset, options?: SpeedPresetOptions): void
```

Give a clip one of the three ramp presets: ramp in from 1x, ramp out to 1x, or both with a hold at the peak. The shape keeps the clip's source span and takes the length it needs, moving the clips after it. One undo step.

- Maps to: `SET_SPEED_CURVE (src/studio/speed/actions.ts:77) with speedPresetCurve (src/studio/speed/presets.ts:86)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
studio.clips.setSpeedPreset('c1', 'ramp-in-out', { peak: 4, rampFrames: 15 })
```

### `studio.clips.applySmoothEdit()`

```ts
applySmoothEdit(id: ClipId, options?: SmoothEditOptions): SmoothEditResult
```

The reference look of the drone reels on one clip, in one call: a speed curve fast-slow-fast (default 4x, 0.45x, 4x, the ramps eased `smooth`) that keeps the clip's source content and takes the length it needs, smooth slow motion by optical flow and motion blur on (the clip's own shutter angle, else 360; the slow part is made by optical flow whatever mode the clip had), and an eased zoom-in on the clip's width and height from its size to `1 + zoom` times it, over the new length. Earlier width, height and scale keyframes of the clip are replaced. The clips after it move by the speed slider's rule (only past the next clip's start). Returns what it set. One undo step.

- Maps to: `SMOOTH_EDIT (src/studio/smooth-edit/action.ts:142)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT, CONFLICT

Example:

```ts
studio.clips.applySmoothEdit('c1', { peak: 4, slow: 0.45, zoom: 0.2 })
```

### `studio.clips.smoothEditTimeline()`

```ts
smoothEditTimeline(options?: SmoothEditTimelineOptions): Promise<SmoothEditTimelineResult>
```

The smooth edit of the whole timeline, cut to a song, in one call: the song's beats are marked (a marker each, if it has none yet); the video clips are laid end to end from the song's first beat in the order they play, each cut to `bars` bars (four beats a bar, each clip keeping the in-point it has, at normal speed before the look); each gets the `applySmoothEdit` look with its default numbers (fast-slow-fast speed ramp with optical-flow slow motion, motion blur, eased zoom); and a quarter-second crossfade is added at each cut when `crossfade` is true. A clip's stabilization stays. Clips with too little footage, clips that cannot take the look and clips that would end after the song are left as they are, after the last shot. Nothing is deleted. Finding the beats takes a few seconds for a three-minute song, so the call is async. One undo step.

- Maps to: `smoothEditTimeline (src/studio/smooth-edit/timeline.ts) with MARKERS_ADD_BEATS and SMOOTH_EDIT`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT, CONFLICT, MEDIA_UNAVAILABLE

Example:

```ts
const result = await studio.clips.smoothEditTimeline({ bars: 1, crossfade: true })
```

### `studio.clips.speedAt()`

```ts
speedAt(id: ClipId, frame: Frame): number
```

The speed a clip holds at a timeline frame, in x: the curve's value there, or the clip's constant speed when it has no curve. `frame` is an absolute timeline frame, like `clips.split` and `playback.seek`; the keys a curve carries stay clip-relative. Not an undo step.

- Maps to: `speedAt (src/studio/speed/curve.ts:271)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
studio.clips.speedAt('c1', 90)
```

### `studio.clips.getColorProfile()`

```ts
getColorProfile(id: ClipId): ColorProfile | null
```

A clip's colour profile, or null when it is unset (nothing was answered for it). `none` is an answer: "this file needs no input transform". Not an undo step.

- Maps to: `useItemsStore.itemById.inputColor (src/types/timeline.ts)`
- Throws: NOT_FOUND, UNSUPPORTED

Example:

```ts
studio.clips.getColorProfile('c1')
```

### `studio.clips.setColorProfile()`

```ts
setColorProfile(id: ClipId, profile: ColorProfile | null): void
```

Set a clip's colour profile: `dlog-m` (DJI D-Log M, the Avata 2's profile), `dlog`, or `none`; null clears the answer. One undo step.

- Maps to: `SET_COLOR_PROFILE (src/studio/presets/ColorPresetSection.tsx:134, updateClipsTogether)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
studio.clips.setColorProfile('c1', 'dlog-m')
```

### `studio.clips.getLook()`

```ts
getLook(id: ClipId): ClipLookInfo | null
```

A clip's creative look, or null when it has none. Not an undo step.

- Maps to: `useItemsStore.itemById.look (src/types/timeline.ts)`
- Throws: NOT_FOUND, UNSUPPORTED

Example:

```ts
studio.clips.getLook('c1')?.intensity
```

### `studio.clips.setLook()`

```ts
setLook(id: ClipId, look: ClipLookRequest | null): Promise<void>
```

Apply a look of the looks library to a clip, with a blend (default 1), or remove it with null. Ids come from `looks.list()`. The call reads the library from the workspace itself, so it works on a fresh session. One undo step.

- Maps to: `SET_LOOK (src/studio/looks/LooksSection.tsx:100, updateClipsTogether)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT, INTERNAL

Example:

```ts
await studio.clips.setLook('c1', { id: 'look-1', intensity: 0.8 })
```

### `studio.clips.getStabilization()`

```ts
getStabilization(id: ClipId): ClipStabilization | null
```

A clip's stored stabilization settings, or null when it was never stabilized. A clip switched off keeps its settings with `enabled: false`. Not an undo step.

- Maps to: `useItemsStore.itemById.stabilization (src/types/timeline.ts)`
- Throws: NOT_FOUND, UNSUPPORTED

Example:

```ts
studio.clips.getStabilization('c1')?.params.smoothness
```

### `studio.clips.setStabilization()`

```ts
setStabilization(id: ClipId, patch: StabilizationPatch | null): Promise<void>
```

Switch a clip's stabilization on with the changes in `patch` (the others keep the clip's value, or the engine's defaults), or off with null (the settings are kept). Switching on opens the clip on the engine first, which can take seconds, so the call is async and each awaited call is its own undo step. A clip that is already on only stores the changes.

- Maps to: `setEnabled / switchOn (src/studio/stabilization/ui/use-stabilization-controls.ts:131) with openStabilization and storeStabilization (src/studio/stabilization/ui/switch.ts)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT, INTERNAL

Example:

```ts
await studio.clips.setStabilization('c1', { smoothness: 0.6, horizonLockPercent: 100 })
```

## studio.titles

`studio.titles`: text clips of the active context (design §4.2). Implemented by `createTitlesApi(): TitlesApi` in `namespaces/titles.ts`.

### `studio.titles.list()`

```ts
list(): ClipInfo[]
```

Text clips, top of the stack first. Not an undo step.

- Maps to: `useItemsStore.items filtered by type 'text'`
- Throws: nothing

Example:

```ts
studio.titles.list()
```

### `studio.titles.add()`

```ts
add(input: TitleAddInput): ClipId
```

Add a text clip with the editor's default style. One undo step.

- Maps to: `createDefaultTextItem + ADD_ITEM (item-actions.ts:610)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, CONFLICT

Example:

```ts
studio.titles.add({ trackId: 'v1', from: 0, durationInFrames: 90, text: 'Cinque Terre' })
```

### `studio.titles.update()`

```ts
update(id: ClipId, patch: TitlePatch): void
```

Change a title's text or style. One undo step.

- Maps to: `UPDATE_ITEM (item-actions.ts:717)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.titles.update('t1', { text: 'Riomaggiore' })
```

## studio.effects

`studio.effects`: GPU effects on clips (design §4.2). Implemented by `createEffectsApi(): EffectsApi` in `namespaces/effects.ts`.

### `studio.effects.types()`

```ts
types(): EffectTypeInfo[]
```

Every effect type the editor can apply. Not an undo step.

- Maps to: `GPU_EFFECT_REGISTRY (registry.ts:10)`
- Throws: nothing

Example:

```ts
studio.effects.types()
```

### `studio.effects.list()`

```ts
list(clip: ClipId): EffectInfo[]
```

Effects on a clip, in application order. Not an undo step.

- Maps to: `useItemsStore.itemById.items[].effects`
- Throws: NOT_FOUND

Example:

```ts
studio.effects.list('c1')
```

### `studio.effects.add()`

```ts
add(clip: ClipId, type: string, params?: Record<string, EffectParamValue>): EffectId
```

Add an effect with the type's defaults, plus any `params`. One undo step.

- Maps to: `ADD_EFFECT (effect-actions.ts:11)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
const id = studio.effects.add('c1', 'gpu-brightness', { amount: 0.1 })
```

### `studio.effects.update()`

```ts
update(clip: ClipId, effect: EffectId, patch: EffectPatch): void
```

Change an effect's parameters or enabled flag. One undo step.

- Maps to: `UPDATE_EFFECT (effect-actions.ts:33)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.effects.update('c1', 'e1', { enabled: false })
```

### `studio.effects.remove()`

```ts
remove(clip: ClipId, effect: EffectId): void
```

Remove an effect from a clip. One undo step.

- Maps to: `REMOVE_EFFECT (effect-actions.ts:48)`
- Throws: NOT_FOUND

Example:

```ts
studio.effects.remove('c1', 'e1')
```

## studio.keyframes

`studio.keyframes`: scalar animation lanes of a clip (design §4.2). Implemented by `createKeyframesApi(): KeyframesApi` in `namespaces/keyframes.ts`. An update that writes nothing adds no undo entry, and `removeAll` clears the clip's vector lanes too.

### `studio.keyframes.properties()`

```ts
properties(clip: ClipId): KeyframeProperty[]
```

Properties of a clip that can be animated. Not an undo step.

- Maps to: `getAnimatablePropertiesForItem (animatable-properties.ts:41)`
- Throws: NOT_FOUND

Example:

```ts
studio.keyframes.properties('c1')
```

### `studio.keyframes.list()`

```ts
list(clip: ClipId, property?: KeyframeProperty): KeyframeInfo[]
```

Keyframes of a clip, optionally of one property, in frame order. Not an undo step.

- Maps to: `useKeyframesStore.keyframesByItemId`
- Throws: NOT_FOUND

Example:

```ts
studio.keyframes.list('c1', 'opacity')
```

### `studio.keyframes.add()`

```ts
add(clip: ClipId, property: KeyframeProperty, frame: Frame, value: number, easing?: Easing): KeyframeId
```

Add a keyframe at a clip-relative frame. One undo step. The property `framingX` or `framingY` (`-1..1`) animates the stabilized window's framing of a clip whose stabilization is on: with a keyframe on it, the animated value replaces the clip's stored `framingX` or `framingY` (each lane on its own), and the window is still held to the room the stabilization has at every frame.

- Maps to: `ADD_KEYFRAME (keyframe-actions.ts:36)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, CONFLICT

Example:

```ts
const id = studio.keyframes.add('c1', 'opacity', 0, 1, 'ease-in-out')
```

### `studio.keyframes.update()`

```ts
update(clip: ClipId, keyframe: KeyframeId, patch: KeyframePatch): void
```

Change a keyframe's value, easing or frame. One undo step.

- Maps to: `UPDATE_KEYFRAME (keyframe-actions.ts)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, CONFLICT

Example:

```ts
studio.keyframes.update('c1', 'k1', { value: 0.5 })
```

### `studio.keyframes.remove()`

```ts
remove(clip: ClipId, keyframe: KeyframeId): void
```

Remove one keyframe. One undo step.

- Maps to: `REMOVE_KEYFRAME (keyframe-actions.ts)`
- Throws: NOT_FOUND

Example:

```ts
studio.keyframes.remove('c1', 'k1')
```

### `studio.keyframes.removeAll()`

```ts
removeAll(clip: ClipId, property?: KeyframeProperty): void
```

Remove every keyframe of a clip, or of one property. One undo step.

- Maps to: `REMOVE_KEYFRAMES (keyframe-actions.ts)`
- Throws: NOT_FOUND

Example:

```ts
studio.keyframes.removeAll('c1', 'opacity')
```

## studio.transitions

`studio.transitions`: transitions at the cuts of the active context (design §4.2). Implemented by `createTransitionsApi(): TransitionsApi` in `namespaces/transitions.ts`.

### `studio.transitions.presentations()`

```ts
presentations(): string[]
```

Presentation ids a transition can use. Not an undo step.

- Maps to: `transitionRegistry.getIds() (registry.ts:119)`
- Throws: nothing

Example:

```ts
studio.transitions.presentations()
```

### `studio.transitions.list()`

```ts
list(): TransitionInfo[]
```

Transitions of the active context. Not an undo step.

- Maps to: `useTransitionsStore.transitions`
- Throws: nothing

Example:

```ts
studio.transitions.list()
```

### `studio.transitions.add()`

```ts
add(input: TransitionAddInput): TransitionId
```

Add a transition at the cut between two adjacent clips. One undo step.

- Maps to: `canAddTransition + ADD_TRANSITION (transition-actions.ts:27)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, CONFLICT

Example:

```ts
studio.transitions.add({ left: 'c1', right: 'c2', presentation: 'fade', durationInFrames: 30 })
```

### `studio.transitions.update()`

```ts
update(id: TransitionId, patch: TransitionPatch): void
```

Change a transition's presentation, length or timing. One undo step. A patch that names no field changes nothing and adds no undo entry.

- Maps to: `UPDATE_TRANSITION (transition-actions.ts:160)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, CONFLICT

Example:

```ts
studio.transitions.update('x1', { durationInFrames: 45 })
```

### `studio.transitions.remove()`

```ts
remove(id: TransitionId): void
```

Remove a transition, leaving the cut. One undo step.

- Maps to: `REMOVE_TRANSITION (transition-actions.ts:172)`
- Throws: NOT_FOUND

Example:

```ts
studio.transitions.remove('x1')
```

## studio.markers

`studio.markers`: markers and the in/out range (design §4.2). Implemented by `createMarkersApi(): MarkersApi` in `namespaces/markers.ts`.

### `studio.markers.list()`

```ts
list(): MarkerInfo[]
```

Markers in frame order. Not an undo step.

- Maps to: `useMarkersStore.markers`
- Throws: nothing

Example:

```ts
studio.markers.list()
```

### `studio.markers.add()`

```ts
add(input: MarkerAddInput): MarkerId
```

Add a marker at a frame. One undo step.

- Maps to: `ADD_MARKER (marker-actions.ts:12)`
- Throws: INVALID_ARGUMENT

Example:

```ts
const id = studio.markers.add({ frame: 120, label: 'take off' })
```

### `studio.markers.addBeats()`

```ts
addBeats(clipId: ClipId, input?: MarkerBeatsInput): Promise<Frame[]>
```

Put a marker on each strong low-frequency hit (kick, bass pluck) of an audio or video clip's sound, at the project frame where the hit plays: the clip's trim, position, speed and reversal are respected. The clip's audio is decoded and analysed off the main thread, which takes a few seconds for a three-minute song, so the call is async. A frame that already has a marker keeps it. Resolves with the frames that carry a beat, in order. One undo step.

- Maps to: `markBeats (src/studio/beats/mark.ts) with ADD_MARKER (marker-actions.ts:12)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, UNSUPPORTED, MEDIA_UNAVAILABLE

Example:

```ts
const frames = await studio.markers.addBeats('a1', { strength: 0.6 })
```

### `studio.markers.update()`

```ts
update(id: MarkerId, patch: MarkerPatch): void
```

Change a marker's frame, label or colour. One undo step.

- Maps to: `UPDATE_MARKER (marker-actions.ts:26)`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.markers.update('k1', { frame: 150 })
```

### `studio.markers.remove()`

```ts
remove(id: MarkerId): void
```

Remove one marker. One undo step.

- Maps to: `REMOVE_MARKER (marker-actions.ts:38)`
- Throws: NOT_FOUND

Example:

```ts
studio.markers.remove('k1')
```

### `studio.markers.clear()`

```ts
clear(): void
```

Remove every marker of the active context. One undo step.

- Maps to: `CLEAR_MARKERS (marker-actions.ts:45)`
- Throws: nothing

Example:

```ts
studio.markers.clear()
```

### `studio.markers.range()`

```ts
range(): RangeInfo
```

The in/out playback range. Not an undo step.

- Maps to: `useMarkersStore.inPoint + outPoint`
- Throws: nothing

Example:

```ts
studio.markers.range()
```

### `studio.markers.setIn()`

```ts
setIn(frame: Frame | null): void
```

Set the in point, or clear it with null; a point past the end is clamped and one past the out point resets the out point. One undo step.

- Maps to: `SET_IN_POINT (marker-actions.ts:56)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.markers.setIn(0)
```

### `studio.markers.setOut()`

```ts
setOut(frame: Frame | null): void
```

Set the out point, or clear it with null; a point past the end is clamped and one before the in point resets the in point. One undo step.

- Maps to: `SET_OUT_POINT (marker-actions.ts:83)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.markers.setOut(600)
```

### `studio.markers.clearRange()`

```ts
clearRange(): void
```

Clear both in and out points. One undo step.

- Maps to: `CLEAR_IN_OUT_POINTS (marker-actions.ts:110)`
- Throws: nothing

Example:

```ts
studio.markers.clearRange()
```

## studio.selection

`studio.selection`: what the editor has selected. Not an undo step. Implemented by `createSelectionApi(): SelectionApi` in `namespaces/selection.ts`.

### `studio.selection.get()`

```ts
get(): SelectionInfo
```

The current selection. Not an undo step.

- Maps to: `useSelectionStore (selection/store.ts:30)`
- Throws: nothing

Example:

```ts
studio.selection.get()
```

### `studio.selection.set()`

```ts
set(patch: SelectionPatch): void
```

Select clips, tracks, a marker or a transition. Not an undo step.

- Maps to: `selectItems / selectTracks / selectMarker / selectTransition`
- Throws: NOT_FOUND, INVALID_ARGUMENT

Example:

```ts
studio.selection.set({ clips: ['c1'] })
```

### `studio.selection.clear()`

```ts
clear(): void
```

Clear the selection. Not an undo step.

- Maps to: `useSelectionStore.clearSelection`
- Throws: nothing

Example:

```ts
studio.selection.clear()
```

## studio.playback

`studio.playback`: the transport. Not an undo step. Implemented by `createPlaybackApi(): PlaybackApi` in `namespaces/playback.ts`.

### `studio.playback.get()`

```ts
get(): PlaybackInfo
```

Playhead, playing state, rate and loop. Not an undo step.

- Maps to: `usePlaybackStore (playback/store.ts:104)`
- Throws: nothing

Example:

```ts
studio.playback.get()
```

### `studio.playback.seek()`

```ts
seek(frame: Frame): void
```

Move the playhead to a frame. Not an undo step.

- Maps to: `usePlaybackStore.setCurrentFrame`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.playback.seek(120)
```

### `studio.playback.play()`

```ts
play(): void
```

Start playback at the rate `setRate` chose. Not an undo step.

- Maps to: `usePlaybackStore.play, then setPlaybackRate with the previous rate`
- Throws: nothing

Example:

```ts
studio.playback.play()
```

### `studio.playback.pause()`

```ts
pause(): void
```

Pause playback. Not an undo step.

- Maps to: `usePlaybackStore.pause`
- Throws: nothing

Example:

```ts
studio.playback.pause()
```

### `studio.playback.setRate()`

```ts
setRate(rate: number): void
```

Set the playback rate multiplier. Not an undo step.

- Maps to: `usePlaybackStore.setPlaybackRate`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.playback.setRate(0.5)
```

### `studio.playback.setLoop()`

```ts
setLoop(on: boolean): void
```

Turn looping on or off. Not an undo step.

- Maps to: `usePlaybackStore.toggleLoop (set semantics: toggles only when the value differs)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.playback.setLoop(true)
```

## studio.export

`studio.export`: the render queue (design §4.2, §0.5, §4.7). Implemented by `createExportApi(): ExportApi` in `namespaces/export.ts`; the settings half lives in `namespaces/export-settings.ts`.

### `studio.export.settings()`

```ts
settings(): ExportSettingsInfo
```

The SDK's export settings. Not an undo step.

- Maps to: `the SDK settings store (design §0.3); the export dialog does not read it yet`
- Throws: nothing

Example:

```ts
studio.export.settings()
```

### `studio.export.setSettings()`

```ts
setSettings(patch: ExportSettingsPatch): void
```

Change the SDK's export settings. Not an undo step.

- Maps to: `the SDK settings store (design §0.3); the export dialog does not read it yet`
- Throws: INVALID_ARGUMENT, UNSUPPORTED

Example:

```ts
studio.export.setSettings({ quality: 'high' })
```

### `studio.export.presets()`

```ts
presets(): ExportPresetInfo[]
```

The export dialog's presets resolved for the open project (Instagram Reel, TikTok, YouTube Shorts, YouTube 4K, Small file, and Same as source when a video clip is placed): each one's settings and numbers. The desktop's ProRes and 10-bit masters need the native encoder and are not offered here. Not an undo step.

- Maps to: `getPilotPresets / resolvePilotPreset (src/studio/export/presets.ts)`
- Throws: UNSUPPORTED

Example:

```ts
studio.export.presets().find((preset) => preset.id === 'instagram-reel')?.settings
```

### `studio.export.start()`

```ts
start(options?: ExportStartInput): Promise<ExportJobInfo>
```

Queue an export and return its job. Not an undo step.

- Maps to: `buildRenderJob (build-render-job.ts:149) + enqueueJobs (render-queue-store.ts:104)`
- Throws: UNSUPPORTED, INVALID_ARGUMENT, INTERNAL

Example:

```ts
const job = await studio.export.start({ name: 'Flight 01' })
```

### `studio.export.jobs()`

```ts
jobs(): ExportJobInfo[]
```

Every job in the queue, oldest first. Not an undo step.

- Maps to: `useRenderQueueStore.jobs`
- Throws: nothing

Example:

```ts
studio.export.jobs()
```

### `studio.export.status()`

```ts
status(id: string): ExportJobInfo | null
```

One job, or null when it does not exist. Not an undo step.

- Maps to: `useRenderQueueStore.jobs`
- Throws: nothing

Example:

```ts
studio.export.status('j1')
```

### `studio.export.wait()`

```ts
wait(id: string, options?: ExportWaitOptions): Promise<ExportJobInfo>
```

Wait for a job to finish and return it; when `timeoutMs` passes first, the job as it is then. Not an undo step.

- Maps to: `useRenderQueueStore.jobs, polled every 250 ms`
- Throws: NOT_FOUND, INVALID_ARGUMENT, EXPORT_FAILED

Example:

```ts
await studio.export.wait('j1', { timeoutMs: 60000 })
```

### `studio.export.cancel()`

```ts
cancel(id: string): void
```

Cancel a queued or running job. Not an undo step.

- Maps to: `useRenderQueueStore.cancelJob (render-queue-store.ts:121)`
- Throws: NOT_FOUND

Example:

```ts
studio.export.cancel('j1')
```

## studio.history

`studio.history`: the undo history of the active context (design §4.2, §4.4). Implemented by `createHistoryApi(): HistoryApi` in `namespaces/history.ts`.

### `studio.history.undo()`

```ts
undo(steps?: number): number
```

Undo up to `steps` entries and return how many were undone. Not an undo step.

- Maps to: `useTimelineCommandStore.undo (timeline-command-store.ts:154)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.history.undo(2)
```

### `studio.history.redo()`

```ts
redo(steps?: number): number
```

Redo up to `steps` entries and return how many were redone. Not an undo step.

- Maps to: `useTimelineCommandStore.redo (timeline-command-store.ts:178)`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.history.redo()
```

### `studio.history.canUndo()`

```ts
canUndo(): boolean
```

Whether an entry can be undone. Not an undo step.

- Maps to: `useTimelineCommandStore.canUndo`
- Throws: nothing

Example:

```ts
studio.history.canUndo()
```

### `studio.history.canRedo()`

```ts
canRedo(): boolean
```

Whether an entry can be redone. Not an undo step.

- Maps to: `useTimelineCommandStore.canRedo`
- Throws: nothing

Example:

```ts
studio.history.canRedo()
```

### `studio.history.undoLabel()`

```ts
undoLabel(): string | null
```

Label of the next entry `undo` would revert, or null. Not an undo step.

- Maps to: `useTimelineCommandStore.getUndoLabel (timeline-command-store.ts:220)`
- Throws: nothing

Example:

```ts
studio.history.undoLabel()
```

### `studio.history.redoLabel()`

```ts
redoLabel(): string | null
```

Label of the next entry `redo` would restore, or null. Not an undo step.

- Maps to: `useTimelineCommandStore.getRedoLabel (timeline-command-store.ts:227)`
- Throws: nothing

Example:

```ts
studio.history.redoLabel()
```

### `studio.history.clear()`

```ts
clear(): void
```

Drop the history of every editing context. Not an undo step.

- Maps to: `useTimelineCommandStore.clearHistory (timeline-command-store.ts:202)`
- Throws: nothing

Example:

```ts
studio.history.clear()
```

### `studio.history.depth()`

```ts
depth(): number
```

Number of entries that can be undone. Not an undo step.

- Maps to: `useTimelineCommandStore.undoStack`
- Throws: nothing

Example:

```ts
studio.history.depth()
```

## studio.workspace

`studio.workspace`: whether the app has a workspace folder to work on. Implemented by `createWorkspaceApi(): WorkspaceApi` in `namespaces/workspace.ts`.

### `studio.workspace.isOpen()`

```ts
isOpen(): boolean
```

Whether a workspace folder is open. False while the editor shows its workspace gate, when every call that reads or writes the project would throw. Not an undo step.

- Maps to: `getWorkspaceRoot (workspace-fs/root.ts)`
- Throws: nothing

Example:

```ts
studio.workspace.isOpen()
```

## studio.looks

`studio.looks`: the workspace's looks library, the `.cube` files a clip can apply (`clips.setLook`). Implemented by `createLooksApi(): LooksApi` in `namespaces/looks.ts`.

### `studio.looks.list()`

```ts
list(): Promise<LookInfo[]>
```

The looks of the library, newest last. Reads the library from the workspace when it has not been read yet. Not an undo step.

- Maps to: `useLooksStore.load (src/studio/looks/store.ts)`
- Throws: INTERNAL

Example:

```ts
await studio.looks.list()
```

### `studio.looks.add()`

```ts
add(input: LookAddInput): Promise<LookInfo>
```

Add a look to the library from the text of a `.cube` file (3D table, 65 points per side at most, input range 0…1) and answer it as `list` does. An agent can write the text with code in the same `run` call (a function over r, g, b) instead of sending a large file. The look is the workspace's, not the project's: not an undo step. `name` is the picker's label (default: the file's TITLE, or its name).

- Maps to: `useLooksStore.add (src/studio/looks/store.ts)`
- Throws: INVALID_ARGUMENT, INTERNAL

Example:

```ts
await studio.looks.add({ fileName: 'warm.cube', text: cubeText, name: 'Warm' })
```

### `studio.looks.rename()`

```ts
rename(id: string, name: string): Promise<LookInfo>
```

Rename a look: `name` is the label the clip panel's picker shows; the id and the file do not change, so clips keep the look. The library holds only the user's own `.cube` files (there are no built-in looks), so every look can be renamed. Answers the look as `list` does. The look is the workspace's, not the project's: not an undo step.

- Maps to: `useLooksStore.rename (src/studio/looks/store.ts)`
- Throws: NOT_FOUND, INVALID_ARGUMENT, INTERNAL

Example:

```ts
await studio.looks.rename('look-1', 'Warm')
```

### `studio.looks.remove()`

```ts
remove(id: string): Promise<LookInfo>
```

Remove a look from the library and delete its `.cube` file from the workspace. It cannot be undone. A look a clip still uses is refused (the clips would lose their look): the error names those clips, and `clips.setLook(clipId, null)` clears each. The library holds only the user's own `.cube` files (there are no built-in looks), so every look can be removed. Answers the look that was removed. Not an undo step.

- Maps to: `useLooksStore.remove (src/studio/looks/store.ts)`
- Throws: NOT_FOUND, CONFLICT, INTERNAL

Example:

```ts
await studio.looks.remove('look-1')
```

## studio.shadow

`studio.shadow`: DroneClean shadow removal on a clip. Mark the shadow, follow it (spends credits: `followCredits` of `shadow.get`), read the price of the clean, clean at that price (spends credits). Both paying calls take the credits the caller expects to spend and refuse unless they equal the current price, so an agent never spends credits the user was not shown. Implemented by `createShadowApi(): ShadowApi` in `namespaces/shadow.ts`. An agent cannot sign in: when the service needs it the user approves it in the app.

### `studio.shadow.get()`

```ts
get(id: ClipId): ShadowState
```

A clip's shadow session: the mark, the stage, the ranges found, the clean's price, the last failure and what following the shadow costs (`followCredits`). Not an undo step.

- Maps to: `useShadowSessionStore (src/studio/shadow/ui/use-shadow-session.ts)`
- Throws: NOT_FOUND, UNSUPPORTED

Example:

```ts
studio.shadow.get('c1').quote?.costCredits
```

### `studio.shadow.mark()`

```ts
mark(id: ClipId, mark: ShadowMarkInput): void
```

Mark the shadow on a clip: a point in source pixels on a source frame (default: the frame the playhead shows on the clip). Forgets a pass made for another mark. One undo step.

- Maps to: `setMark (src/studio/shadow/ui/use-shadow-session.ts:1104)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT

Example:

```ts
studio.shadow.mark('c1', { x: 1440, y: 1200 })
```

### `studio.shadow.follow()`

```ts
follow(id: ClipId, expectedCredits: number): Promise<ShadowFollowResult>
```

Follow the marked shadow with a tracking pass and price cleaning what it found. This SPENDS the user's credits: pass the credits you expect to spend, and the call refuses unless that equals what following the shadow in this clip costs now (`followCredits` of `shadow.get`, the number the follow button shows: its part of the source, about a credit a second at 30 fps, twice at 60, at least 5). Show the user that price first. Awaits the whole pass (price check, balance check, cut, upload, track, quote); a balance that cannot cover it stops it before anything is uploaded. The piece sent reaches the keyframes around the clip's part: when that costs more than `expectedCredits`, nothing is spent and the call throws CONFLICT naming the exact price (`followCredits` then reads it, and a call with it goes on with the piece already sent). The service never charges more than `expectedCredits`, and gives the credits back when no shadow is found where it was marked: `creditsSpent` says what it took. A second call for the same mark reuses the finished pass and spends nothing.

- Maps to: `track (src/studio/shadow/ui/use-shadow-session.ts:1123)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT, CONFLICT, MEDIA_UNAVAILABLE, INTERNAL

Example:

```ts
const { ranges, quote, creditsSpent } = await studio.shadow.follow('c1', 10)
```

### `studio.shadow.quote()`

```ts
quote(id: ClipId): Promise<ShadowQuote>
```

Ask the price of the found ranges again, which also reads the balance again (after credits were bought). Not an undo step and no credits are spent.

- Maps to: `refreshQuote (src/studio/shadow/ui/use-shadow-session.ts:1230)`
- Throws: NOT_FOUND, UNSUPPORTED, CONFLICT, INTERNAL

Example:

```ts
await studio.shadow.quote('c1')
```

### `studio.shadow.clean()`

```ts
clean(id: ClipId, expectedCredits: number): Promise<ShadowCleanResult>
```

Clean the followed ranges. This SPENDS the user's credits: pass the credits you expect to spend, and the call refuses unless that equals the current price (`costCredits` of `shadow.quote`), so a clean never costs more than the price you were shown. The cleaned file is kept in the project and recorded on the clip.

- Maps to: `clean (src/studio/shadow/ui/use-shadow-session.ts:1155)`
- Throws: NOT_FOUND, UNSUPPORTED, INVALID_ARGUMENT, CONFLICT, INTERNAL

Example:

```ts
await studio.shadow.clean('c1', 12)
```

## studio.preview

`studio.preview`: the program monitor's playback resolution and the pre-render, as After Effects renders a work area: the frames of a range are rendered ahead through the preview's own pipeline at the current quality, encoded into memory, and played back from there at full frame rate. Any edit that changes a frame makes it stale at once and the preview renders it live again; an export never reads the cache. Implemented by `createPreviewApi(): PreviewApi` in `namespaces/preview.ts`. None of it is an undo step.

### `studio.preview.quality()`

```ts
quality(): PreviewQualityLevel
```

The playback resolution: 1 (Full), 0.5 (1/2) or 0.25 (1/4) of the size the preview renders at. Not an undo step.

- Maps to: `usePlaybackStore.previewQuality (shared/state/playback/store.ts)`
- Throws: nothing

Example:

```ts
studio.preview.quality()
```

### `studio.preview.setQuality()`

```ts
setQuality(quality: PreviewQualityLevel): void
```

Set the playback resolution (kept for the app, as the menu does). A lower one renders fewer pixels: the composite, the effects and a pre-render get cheaper; frames pre-rendered at another resolution become stale. Not an undo step.

- Maps to: `usePlaybackStore.setPreviewQuality`
- Throws: INVALID_ARGUMENT

Example:

```ts
studio.preview.setQuality(0.5)
```

### `studio.preview.prerender()`

```ts
prerender(range?: PrerenderRangeInput): Promise<PrerenderResult>
```

Render a range of the timeline ahead so it plays back smoothly: the timeline's In/Out by default, else the whole timeline. Pauses playback, renders only the frames the cache does not hold yet, and resolves when it ends with how it ended (a cancelled or stopped render keeps the frames it finished). The ruler shows the rendered frames in green. Not an undo step.

- Maps to: `runPrerender (src/studio/prerender/job.ts)`
- Throws: INVALID_ARGUMENT, CONFLICT, UNSUPPORTED

Example:

```ts
await studio.preview.prerender({ startFrame: 0, endFrame: 300 })
```

### `studio.preview.prerendered()`

```ts
prerendered(): PrerenderStatus
```

What the pre-render cache holds now: the ranges that play from it, its size, the render running and how the last one ended. Not an undo step.

- Maps to: `usePrerenderStore (src/studio/prerender/store.ts)`
- Throws: nothing

Example:

```ts
studio.preview.prerendered().ranges
```

### `studio.preview.cancelPrerender()`

```ts
cancelPrerender(): void
```

Stop the running pre-render after the frame it is drawing; the frames it finished stay. Does nothing when none runs. Not an undo step.

- Maps to: `cancelPrerender (src/studio/prerender/job.ts)`
- Throws: nothing

Example:

```ts
studio.preview.cancelPrerender()
```

### `studio.preview.clearPrerender()`

```ts
clearPrerender(): void
```

Delete every pre-rendered frame; the preview renders live again. Not an undo step.

- Maps to: `prerenderCache.clear (src/studio/prerender/cache.ts)`
- Throws: nothing

Example:

```ts
studio.preview.clearPrerender()
```

## Types

### `ClipId`

Opaque id of a timeline clip (a `TimelineItem`). Never parse it.

```ts
export type ClipId = string;
```

### `TrackId`

Opaque id of a timeline track (a `TimelineTrack`). Never parse it.

```ts
export type TrackId = string;
```

### `MediaId`

Opaque id of a media library item (`MediaMetadata`). Never parse it.

```ts
export type MediaId = string;
```

### `EffectId`

Opaque id of one effect instance applied to a clip (`ItemEffect`). Never parse it.

```ts
export type EffectId = string;
```

### `MarkerId`

Opaque id of a timeline marker (`ProjectMarker`). Never parse it.

```ts
export type MarkerId = string;
```

### `TransitionId`

Opaque id of a transition (`Transition`). Never parse it.

```ts
export type TransitionId = string;
```

### `KeyframeId`

Opaque id of a keyframe (`Keyframe.id`). Never parse it.

```ts
export type KeyframeId = string;
```

### `Frame`

Integer frame on the timeline, counted at the project rate.

```ts
export type Frame = number;
```

### `SourceFrame`

Integer frame inside a source media file, counted at the source rate.

```ts
export type SourceFrame = number;
```

### `Seconds`

Seconds. Only for values the stores keep in seconds (audio fades, subtitle cues).

```ts
export type Seconds = number;
```

### `Rate`

A frame rate as an exact fraction of frames per second (design §4.3): 59.94 is `{ num: 60000, den: 1001 }`, never `{ num: 59.94, den: 1 }`. Both numbers are positive whole numbers; a rate is read back reduced, and `@/studio/time`'s `toRate` and `rateValue` are the only conversions.

```ts
export interface Rate {
    num: number;
    den: number;
}
```

### `TimelineContext`

The context the SDK reads and writes: the Main timeline, or the composition that is open for editing in the app (design §4.3). Ids and the undo history belong to one context; an id from another context is `NOT_FOUND`.

```ts
export type TimelineContext = MainTimelineContext | CompositionTimelineContext;
```

### `MainTimelineContext`

The Main timeline is the active context.

```ts
export interface MainTimelineContext {
    kind: 'main';
}
```

### `CompositionTimelineContext`

An open sub-composition is the active context.

```ts
export interface CompositionTimelineContext {
    kind: 'composition';
    id: string;
    name: string;
}
```

### `ProjectDeleteResult`

What `project.delete` answers: the project that is gone and that it cannot come back.

```ts
export interface ProjectDeleteResult {
    id: string;
    name: string;
    undoable: false;
    message: string;
}
```

### `ProjectInfo`

A project as the SDK reads it (`useProjectStore.currentProject`).

```ts
export interface ProjectInfo {
    id: string;
    name: string;
    description: string;
    width: number;
    height: number;
    fps: Rate;
    backgroundColor?: string;
    createdAt: number;
    updatedAt: number;
}
```

### `ProjectCreateInput`

Input of `project.create` (design §0.6).

```ts
export interface ProjectCreateInput {
    name: string;
    width: number;
    height: number;
    fps: Rate;
}
```

### `ProjectPatch`

Fields `project.set` can change.

```ts
export interface ProjectPatch {
    width?: number;
    height?: number;
    fps?: Rate;
    backgroundColor?: string;
}
```

### `MediaType`

Kind of a media library item, derived from its MIME type.

```ts
export type MediaType = 'video' | 'audio' | 'image' | 'lottie' | 'unknown';
```

### `MediaInfo`

A media library item as the SDK reads it (`MediaMetadata`, `@/types/storage`).

```ts
export interface MediaInfo {
    id: MediaId;
    fileName: string;
    mimeType: string;
    type: MediaType;
    fileSize: number;
    duration: Seconds;
    width: number;
    height: number;
    fps: number;
    codec: string;
    bitrate: number;
    createdAt: number;
    updatedAt: number;
}
```

### `MediaImportOptions`

Options of `media.import` (design §2).

```ts
export interface MediaImportOptions {
    storageMode?: 'copy' | 'link';
}
```

### `MediaFilter`

Filter of `media.list`.

```ts
export interface MediaFilter {
    type?: MediaType;
}
```

### `SubclipId`

Id of a subclip.

```ts
export type SubclipId = string;
```

### `SubclipInvalidReason`

Why a subclip cannot be used any more: its file is gone from the library, the file has fewer frames than the range needs, or the file's frame rate changed after the range was cut.

```ts
export type SubclipInvalidReason = 'parent-missing' | 'range-past-end' | 'rate-changed';
```

### `SubclipInfo`

A subclip as the SDK reads it: a named range of one library file (`Subclip`, `@/studio/subclips`). The range is whole source frames of the file, `[startFrame, endFrame)`, the convention of a clip's `sourceStart` and `sourceEnd`, so it goes into `clips.add` unchanged.

```ts
export interface SubclipInfo {
    id: SubclipId;
    mediaId: MediaId;
    name: string;
    startFrame: SourceFrame;
    endFrame: SourceFrame;
    sourceFps: number;
    createdAt: number;
    valid: boolean;
    invalidReason?: SubclipInvalidReason;
}
```

### `SubclipCreateInput`

Input of `subclips.create`.

```ts
export interface SubclipCreateInput {
    mediaId: MediaId;
    startFrame: SourceFrame;
    endFrame: SourceFrame;
    name?: string;
}
```

### `SubclipFilter`

Filter of `subclips.list`.

```ts
export interface SubclipFilter {
    mediaId?: MediaId;
}
```

### `TrackKind`

A track is either a video or an audio track.

```ts
export type TrackKind = 'video' | 'audio';
```

### `TrackInfo`

A track as the SDK reads it (`TimelineTrack` without its item list).

```ts
export interface TrackInfo {
    id: TrackId;
    name: string;
    kind?: TrackKind;
    height: number;
    locked: boolean;
    syncLock?: boolean;
    visible: boolean;
    muted: boolean;
    solo: boolean;
    volume?: number;
    color?: string;
    order: number;
}
```

### `TrackAddInput`

Input of `tracks.add`.

```ts
export interface TrackAddInput {
    kind: TrackKind;
    name?: string;
    position?: number;
}
```

### `TrackPatch`

Fields `tracks.update` can change.

```ts
export interface TrackPatch {
    name?: string;
    locked?: boolean;
    syncLock?: boolean;
    visible?: boolean;
    muted?: boolean;
    solo?: boolean;
    volume?: number;
    color?: string;
}
```

### `ClipType`

Kind of a timeline clip (the discriminator of `TimelineItem`).

```ts
export type ClipType = 'video' | 'audio' | 'text' | 'image' | 'lottie' | 'shape' | 'adjustment' | 'controller' | 'composition' | 'subtitle';
```

### `ClipTransform`

Placement and scale of a clip on the canvas (`TransformProperties`).

```ts
export interface ClipTransform {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    anchorX?: number;
    anchorY?: number;
    rotation?: number;
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    opacity?: number;
    cornerRadius?: number;
}
```

### `ClipInfo`

A clip as the SDK reads it. Positions and durations are timeline frames; `source*` and `trim*` are source frames (design §4.3). Effects and keyframes are read through `studio.effects` and `studio.keyframes`, not duplicated here.

```ts
export interface ClipInfo {
    id: ClipId;
    trackId: TrackId;
    type: ClipType;
    from: Frame;
    durationInFrames: Frame;
    label: string;
    mediaId?: MediaId;
    compositionId?: string;
    trimStart?: SourceFrame;
    trimEnd?: SourceFrame;
    sourceStart?: SourceFrame;
    sourceEnd?: SourceFrame;
    sourceDuration?: SourceFrame;
    sourceFps?: number;
    speed?: number;
    isReversed?: boolean;
    volume?: number;
    audioFadeIn?: Seconds;
    audioFadeOut?: Seconds;
    fadeIn?: Seconds;
    fadeOut?: Seconds;
    transform?: ClipTransform;
    text?: string;
    color?: string;
}
```

### `ClipPlacement`

What `clips.add` answers when it was asked `onOverlap: 'move'`: the clip and the frame it was placed at.

```ts
export interface ClipPlacement {
    id: ClipId;
    from: Frame;
    requestedFrom: Frame;
    moved: boolean;
}
```

### `ClipAddInput`

Input of `clips.add` and one entry of `clips.addMany`.

```ts
export interface ClipAddInput {
    mediaId: MediaId;
    trackId: TrackId;
    from: Frame;
    onOverlap?: 'move' | 'fail';
    durationInFrames?: Frame;
    label?: string;
    sourceStart?: SourceFrame;
    sourceEnd?: SourceFrame;
}
```

### `ClipPatch`

Fields `clips.update` can change.

```ts
export interface ClipPatch {
    label?: string;
    volume?: number;
    audioFadeIn?: Seconds;
    audioFadeOut?: Seconds;
    fadeIn?: Seconds;
    fadeOut?: Seconds;
    muted?: boolean;
    transform?: ClipTransform;
}
```

### `ClipFilter`

Filter of `clips.list`.

```ts
export interface ClipFilter {
    trackId?: TrackId;
    type?: ClipType;
}
```

### `ClipRemoveOptions`

Options of `clips.remove`.

```ts
export interface ClipRemoveOptions {
    ripple?: boolean;
}
```

### `ClipDuplicateOptions`

Options of `clips.duplicate`.

```ts
export interface ClipDuplicateOptions {
    count?: number;
    offsetFrames?: Frame;
}
```

### `SpeedKey`

One point of a clip's speed curve: a clip-relative timeline frame and the speed there. Frame 0 is the clip's first frame, the origin keyframes use; speeds are 0.1..10.

```ts
export interface SpeedKey {
    frame: Frame;
    speed: number;
    ease?: 'linear' | 'smooth' | 'ease-in' | 'ease-out';
}
```

### `ClipSpeedCurve`

A clip's speed curve, as `clips.getSpeedCurve` reads it (design §4.9 of task 7.1).

```ts
export interface ClipSpeedCurve {
    keys: SpeedKey[];
    averageSpeed: number;
}
```

### `MotionBlurSettings`

A clip's motion blur, as `clips.getMotionBlur` reads it and `clips.setMotionBlur` takes it (design 7.2, section 4.7).

```ts
export interface MotionBlurSettings {
    shutterDegrees: number;
    smoothSlowMotion?: 'blend' | 'optical-flow';
    flowDetail?: 'normal' | 'high';
    flowEdges?: 'mix' | 'nearest';
    blendSlowMotion?: boolean;
}
```

### `SpeedPreset`

The ramp shapes `clips.setSpeedPreset` builds (design §4.9 of task 7.1).

```ts
export type SpeedPreset = 'ramp-in' | 'ramp-out' | 'ramp-in-out';
```

### `SpeedPresetOptions`

Options of `clips.setSpeedPreset`.

```ts
export interface SpeedPresetOptions {
    peak?: number;
    rampFrames?: number;
}
```

### `SmoothEditOptions`

Options of `clips.applySmoothEdit`; every field is optional.

```ts
export interface SmoothEditOptions {
    peak?: number;
    slow?: number;
    zoom?: number;
}
```

### `SmoothEditResult`

What `clips.applySmoothEdit` set on the clip.

```ts
export interface SmoothEditResult {
    speedCurve: SpeedKey[];
    averageSpeed: number;
    durationInFrames: number;
    motionBlur: MotionBlurSettings;
    zoom: {
        firstFrame: Frame;
        lastFrame: Frame;
        scale: number;
    } | null;
}
```

### `SmoothEditTimelineOptions`

Options of `clips.smoothEditTimeline`; every field is optional.

```ts
export interface SmoothEditTimelineOptions {
    songId?: ClipId;
    bars?: 1 | 2 | 4;
    crossfade?: boolean;
}
```

### `SmoothEditTimelineResult`

What `clips.smoothEditTimeline` laid out.

```ts
export interface SmoothEditTimelineResult {
    songId: ClipId;
    bars: number;
    beats: number;
    firstDownbeat: Frame;
    shots: Array<{
        clipId: ClipId;
        from: Frame;
        durationInFrames: Frame;
    }>;
    crossfades: number;
    tooShort: ClipId[];
    unsupported: ClipId[];
    afterSong: ClipId[];
}
```

### `ColorProfile`

A clip's colour profile, as `clips.getColorProfile` reads it and `clips.setColorProfile` takes it: DJI D-Log M, DJI D-Log, or `none` (an answered "no transform").

```ts
export type ColorProfile = 'dlog-m' | 'dlog' | 'none';
```

### `ClipLookInfo`

A clip's creative look: a `.cube` file of the workspace's looks library and the blend it is applied with.

```ts
export interface ClipLookInfo {
    id: string;
    intensity: number;
}
```

### `ClipLookRequest`

What `clips.setLook` takes: the id of a look of the library and, optionally, the blend.

```ts
export interface ClipLookRequest {
    id: string;
    intensity?: number;
}
```

### `LookAddInput`

What `looks.add` takes: a `.cube` file's text and name.

```ts
export interface LookAddInput {
    text: string;
    fileName: string;
    name?: string;
}
```

### `LookInfo`

One look of the workspace's looks library, as `looks.list` reads it.

```ts
export interface LookInfo {
    id: string;
    name: string;
    fileName: string;
    size: number;
}
```

### `ClipStabilization`

A clip's stabilization as it is stored: what the pilot chose; the engine's matrices are not part of it.

```ts
export interface ClipStabilization {
    enabled: boolean;
    method: string;
    params: Record<string, number>;
    fov: number;
    horizonLockPercent: number;
    horizonLockRoll: number;
    adaptiveZoomSeconds: number;
    framingX: number;
    framingY: number;
}
```

### `StabilizationPatch`

What `clips.setStabilization` changes: each field is optional, and the others keep their value (or the engine's default on a clip never stabilized).

```ts
export interface StabilizationPatch {
    smoothness?: number;
    fov?: number;
    horizonLockPercent?: number;
    horizonLockRoll?: number;
    adaptiveZoomSeconds?: number;
    framingX?: number;
    framingY?: number;
}
```

### `ShadowMarkInput`

The mark of a clip's shadow, in source pixels, as `shadow.mark` takes it.

```ts
export interface ShadowMarkInput {
    x: number;
    y: number;
    sourceFrame?: number;
    radius?: number;
}
```

### `ShadowMarkInfo`

A mark as `shadow.get` reads it.

```ts
export interface ShadowMarkInfo {
    x: number;
    y: number;
    sourceFrame: number;
    radius: number;
}
```

### `ShadowQuote`

The price of cleaning the ranges the tracking pass found, from the service's quote.

```ts
export interface ShadowQuote {
    seconds: number;
    costCredits: number;
    creditsPerSecond: number;
    availableCredits: number;
    enough: boolean;
}
```

### `ShadowRangeInfo`

A stretch of source frames where the shadow was found.

```ts
export interface ShadowRangeInfo {
    startFrame: number;
    endFrame: number;
}
```

### `ShadowState`

A clip's shadow session as `shadow.get` reads it.

```ts
export interface ShadowState {
    mark: ShadowMarkInfo | null;
    stage: string;
    progress: number;
    ranges: ShadowRangeInfo[];
    quote: ShadowQuote | null;
    error: string | null;
    needsSignIn: boolean;
    cleanedPieces: number;
    followCredits: number;
}
```

### `ShadowFollowResult`

What `shadow.follow` found.

```ts
export interface ShadowFollowResult {
    ranges: ShadowRangeInfo[];
    quote: ShadowQuote | null;
    creditsSpent: number;
}
```

### `ShadowCleanResult`

What `shadow.clean` did.

```ts
export interface ShadowCleanResult {
    creditsSpent: number;
    ranges: ShadowRangeInfo[];
    cleanedPieces: number;
}
```

### `TitleShadow`

Shadow of a title (`TextShadow`).

```ts
export interface TitleShadow {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
}
```

### `TitleStroke`

Outline of a title (`TextStroke`).

```ts
export interface TitleStroke {
    width: number;
    color: string;
}
```

### `TitleStyle`

Style fields of a title, the subset of `TextStyleFields` a caller sets (`@/types/text`). Every field is optional; the defaults are `createDefaultTextItem`'s (`generated-layer-items.ts:99`).

```ts
export interface TitleStyle {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
    fontStyle?: 'normal' | 'italic';
    underline?: boolean;
    color?: string;
    letterSpacing?: number;
    backgroundColor?: string | null;
    backgroundRadius?: number;
    textAlign?: 'left' | 'center' | 'right';
    verticalAlign?: 'top' | 'middle' | 'bottom';
    lineHeight?: number;
    textPadding?: number;
    textShadow?: TitleShadow | null;
    stroke?: TitleStroke | null;
}
```

### `TitleAddInput`

Input of `titles.add`.

```ts
export interface TitleAddInput {
    trackId: TrackId;
    from: Frame;
    durationInFrames: Frame;
    text: string;
    style?: TitleStyle;
}
```

### `TitlePatch`

Fields `titles.update` can change.

```ts
export interface TitlePatch {
    text?: string;
    style?: TitleStyle;
}
```

### `EffectParamValue`

A value an effect parameter can hold (`GpuEffect.params`).

```ts
export type EffectParamValue = number | boolean | string;
```

### `EffectParamInfo`

One parameter of an effect type (`EffectParam` in `gpu-effects/types.ts`).

```ts
export interface EffectParamInfo {
    type: 'number' | 'boolean' | 'select' | 'color' | 'point' | 'json' | 'text';
    label: string;
    default: EffectParamValue;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{
        value: string;
        label: string;
    }>;
    animatable?: boolean;
}
```

### `EffectTypeInfo`

An available effect type (a `GpuEffectDefinition` without its shader plumbing).

```ts
export interface EffectTypeInfo {
    id: string;
    name: string;
    category: 'color' | 'blur' | 'distort' | 'stylize' | 'keying';
    params: Record<string, EffectParamInfo>;
}
```

### `EffectInfo`

One effect instance on a clip (`ItemEffect`).

```ts
export interface EffectInfo {
    id: EffectId;
    type: string;
    params: Record<string, EffectParamValue>;
    enabled: boolean;
}
```

### `EffectPatch`

Fields `effects.update` can change.

```ts
export interface EffectPatch {
    params?: Record<string, EffectParamValue>;
    enabled?: boolean;
}
```

### `Easing`

Easing between one keyframe and the next (`EasingType`).

```ts
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | 'cubic-bezier' | 'spring';
```

### `PathVertexComponent`

Component of a path-vertex keyframe property.

```ts
export type PathVertexComponent = 'positionX' | 'positionY' | 'inX' | 'inY' | 'outX' | 'outY';
```

### `KeyframeProperty`

A scalar property that can be animated (`AnimatableProperty` in `@/types/keyframe`). `effect:<gpuEffectType>:<effectId>:<paramKey>` addresses an effect parameter (`buildEffectAnimatableProperty`), `pathVertex:<index>:<component>` one vertex of a path shape. `framingX` and `framingY` (each -1..1) animate the stabilized window's framing of a video clip whose stabilization is on (`clips.setStabilization`'s `framingX` and `framingY`, which are the value where the lane has no keyframe).

```ts
export type KeyframeProperty = 'x' | 'y' | 'width' | 'height' | 'anchorX' | 'anchorY' | 'rotation' | 'opacity' | 'cornerRadius' | 'cropLeft' | 'cropRight' | 'cropTop' | 'cropBottom' | 'cropSoftness' | 'volume' | 'textStyleScale' | 'fontSize' | 'lineHeight' | 'textPadding' | 'backgroundRadius' | 'textShadowOffsetX' | 'textShadowOffsetY' | 'textShadowBlur' | 'strokeWidth' | 'trimPathStart' | 'trimPathEnd' | 'trimPathOffset' | 'taperStartWidth' | 'taperEndWidth' | 'taperStartLength' | 'taperEndLength' | 'framingX' | 'framingY' | `effect:${string}:${string}:${string}` | `pathVertex:${number}:${PathVertexComponent}`;
```

### `KeyframeInfo`

One keyframe (`Keyframe`). `frame` is relative to the start of the clip.

```ts
export interface KeyframeInfo {
    id: KeyframeId;
    property: KeyframeProperty;
    frame: Frame;
    value: number;
    easing: Easing;
    bezier?: KeyframeBezier;
    spring?: KeyframeSpring;
}
```

### `KeyframeBezier`

Control points of a `cubic-bezier` easing, as CSS `cubic-bezier(x1, y1, x2, y2)` writes them.

```ts
export interface KeyframeBezier {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
```

### `KeyframeSpring`

A `spring` easing's physics.

```ts
export interface KeyframeSpring {
    tension: number;
    friction: number;
    mass: number;
}
```

### `KeyframePatch`

Fields `keyframes.update` can change.

```ts
export interface KeyframePatch {
    value?: number;
    easing?: Easing;
    bezier?: KeyframeBezier;
    spring?: KeyframeSpring;
    frame?: Frame;
}
```

### `TransitionTiming`

Timing function of a transition (`TransitionTiming`).

```ts
export type TransitionTiming = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier';
```

### `TransitionDirection`

Direction of the directional presentations (`WipeDirection` and siblings).

```ts
export type TransitionDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';
```

### `TransitionBezierPoints`

Control points for `cubic-bezier` timing (`BezierPoints`).

```ts
export interface TransitionBezierPoints {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
```

### `TransitionInfo`

A transition as the SDK reads it (`Transition`).

```ts
export interface TransitionInfo {
    id: TransitionId;
    type: 'crossfade';
    presentation: string;
    timing: TransitionTiming;
    leftClipId: ClipId;
    rightClipId: ClipId;
    trackId: TrackId;
    durationInFrames: Frame;
    direction?: TransitionDirection;
    alignment?: number;
    bezierPoints?: TransitionBezierPoints;
    presetId?: string;
    properties?: Record<string, unknown>;
}
```

### `TransitionAddInput`

Input of `transitions.add`.

```ts
export interface TransitionAddInput {
    left: ClipId;
    right: ClipId;
    presentation?: string;
    durationInFrames?: Frame;
    timing?: TransitionTiming;
    direction?: TransitionDirection;
    alignment?: number;
}
```

### `TransitionPatch`

Fields `transitions.update` can change.

```ts
export interface TransitionPatch {
    presentation?: string;
    durationInFrames?: Frame;
    timing?: TransitionTiming;
    direction?: TransitionDirection;
    alignment?: number;
}
```

### `MarkerInfo`

A timeline marker (`ProjectMarker`).

```ts
export interface MarkerInfo {
    id: MarkerId;
    frame: Frame;
    label?: string;
    color: string;
}
```

### `MarkerBeatsInput`

Input of `markers.addBeats`.

```ts
export interface MarkerBeatsInput {
    strength?: number;
}
```

### `MarkerAddInput`

Input of `markers.add`.

```ts
export interface MarkerAddInput {
    frame: Frame;
    label?: string;
    color?: string;
}
```

### `MarkerPatch`

Fields `markers.update` can change.

```ts
export interface MarkerPatch {
    frame?: Frame;
    label?: string;
    color?: string;
}
```

### `RangeInfo`

The in/out playback range of the active context.

```ts
export interface RangeInfo {
    in: Frame | null;
    out: Frame | null;
}
```

### `SelectionInfo`

What is selected in the editor.

```ts
export interface SelectionInfo {
    clips: ClipId[];
    tracks: TrackId[];
    marker: MarkerId | null;
    transition: TransitionId | null;
}
```

### `SelectionPatch`

What `selection.set` changes; an absent field is left as it is.

```ts
export interface SelectionPatch {
    clips?: ClipId[];
    tracks?: TrackId[];
    marker?: MarkerId | null;
    transition?: TransitionId | null;
}
```

### `PlaybackInfo`

State of the transport (`PlaybackState`).

```ts
export interface PlaybackInfo {
    frame: Frame;
    playing: boolean;
    rate: number;
    loop: boolean;
}
```

### `PreviewQualityLevel`

The preview's playback resolution: 1 full, 0.5 half, 0.25 quarter of its render size.

```ts
export type PreviewQualityLevel = 1 | 0.5 | 0.25;
```

### `PrerenderRangeInput`

The bounds of a pre-render; each defaults to the timeline's In/Out, else to the whole timeline.

```ts
export interface PrerenderRangeInput {
    startFrame?: Frame;
    endFrame?: Frame;
}
```

### `FrameRangeInfo`

A range of timeline frames, `endFrame` exclusive.

```ts
export interface FrameRangeInfo {
    startFrame: Frame;
    endFrame: Frame;
}
```

### `PrerenderResult`

How a pre-render ended.

```ts
export interface PrerenderResult {
    status: 'done' | 'cancelled' | 'stopped';
    reason?: 'changed' | 'full' | 'unsupported' | 'error';
    detail?: string;
    startFrame: Frame;
    endFrame: Frame;
    renderedFrames: number;
    seconds: number;
}
```

### `PrerenderStatus`

What the pre-render cache holds and does now.

```ts
export interface PrerenderStatus {
    ranges: FrameRangeInfo[];
    bytes: number;
    running: {
        startFrame: Frame;
        endFrame: Frame;
        done: number;
        total: number;
    } | null;
    last: PrerenderResult | null;
}
```

### `ExportCodec`

Video codec of an export (`ExportSettings['codec']`).

```ts
export type ExportCodec = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1';
```

### `ExportQuality`

Encoder quality preset.

```ts
export type ExportQuality = 'low' | 'medium' | 'high' | 'ultra';
```

### `ExportRateControl`

Rate control of an export (`VideoRateControl`).

```ts
export type ExportRateControl = 'auto' | 'variable' | 'constant';
```

### `ExportVideoContainer`

Video container of an export (`VideoContainer`).

```ts
export type ExportVideoContainer = 'mp4' | 'mov' | 'webm' | 'mkv';
```

### `ExportAudioContainer`

Audio container of an audio export (`AudioContainer`).

```ts
export type ExportAudioContainer = 'mp3' | 'aac' | 'wav';
```

### `ExportSubtitleMode`

What happens to transcript subtitles on export (`SubtitleExportMode`).

```ts
export type ExportSubtitleMode = 'off' | 'burn' | 'sidecar' | 'embedded';
```

### `ExportMode`

Whether an export renders the picture, the sound, or both.

```ts
export type ExportMode = 'video' | 'audio';
```

### `ExportJobStatus`

Status of an export job (`RenderJobStatus`).

```ts
export type ExportJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
```

### `ExportPhase`

Phase of a running export (`RenderProgress['phase']`).

```ts
export type ExportPhase = 'preparing' | 'rendering' | 'encoding' | 'finalizing';
```

### `ExportSettingsInfo`

The export settings the SDK owns (design §0.3, §4.7). The export dialog does not read these yet; task 3.4 makes it use the same store.

```ts
export interface ExportSettingsInfo {
    codec: ExportCodec;
    quality: ExportQuality;
    resolution: {
        width: number;
        height: number;
    };
    rateControl?: ExportRateControl;
    videoBitrate?: number;
    smartCopy?: boolean;
    mode: ExportMode;
    videoContainer?: ExportVideoContainer;
    audioContainer?: ExportAudioContainer;
    subtitleMode?: ExportSubtitleMode;
    renderWholeProject?: boolean;
}
```

### `ExportSettingsPatch`

Fields `export.setSettings` can change; an absent field is left as it is.

```ts
export type ExportSettingsPatch = Partial<ExportSettingsInfo>;
```

### `ExportPresetInfo`

One export preset of the export dialog, resolved for the open project by `export.presets`.

```ts
export interface ExportPresetInfo {
    id: string;
    label: string;
    settings: ExportSettingsPatch;
    audioBitrate?: string;
    numbers: {
        width: number;
        height: number;
        fps: number;
        codec: ExportCodec;
        bitrate: number;
    };
}
```

### `ExportStartInput`

Input of `export.start`.

```ts
export interface ExportStartInput {
    settings?: ExportSettingsPatch;
    inPoint?: Frame | null;
    outPoint?: Frame | null;
    name?: string;
}
```

### `ExportWaitOptions`

Options of `export.wait`.

```ts
export interface ExportWaitOptions {
    timeoutMs?: number;
}
```

### `ExportJobInfo`

One export job as the SDK reads it (`RenderJob` without its frozen snapshot).

```ts
export interface ExportJobInfo {
    id: string;
    name: string;
    projectId?: string;
    status: ExportJobStatus;
    progress: number;
    phase?: ExportPhase;
    progressMessage?: string;
    renderedFrames?: number;
    totalFrames?: number;
    inPoint: Frame | null;
    outPoint: Frame | null;
    durationFrames: Frame;
    exportMode: ExportMode;
    fileName: string;
    savedPath?: string;
    fileSize?: number;
    error?: string;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
}
```

### `EntityKind`

Kind of an entity the SDK can name (design §4.5, §4.6).

```ts
export type EntityKind = 'clip' | 'track' | 'transition' | 'keyframe' | 'marker' | 'effect' | 'media' | 'subclip' | 'project' | 'range';
```

### `EntityRef`

Reference to one entity.

```ts
export interface EntityRef {
    kind: EntityKind;
    id: string;
    clip?: ClipId;
}
```

### `UpdatedEntityRef`

A changed entity and the top-level fields that changed.

```ts
export interface UpdatedEntityRef extends EntityRef {
    fields: string[];
}
```

### `CommandInfo`

A command that ran inside a transaction, as the undo stack records it (a trim's amount in the SDK's sign).

```ts
export interface CommandInfo {
    type: string;
    payload?: Record<string, unknown>;
}
```

### `Changes`

What a call or a transaction changed (design §4.6).

```ts
export interface Changes {
    commands: CommandInfo[];
    added: EntityRef[];
    removed: EntityRef[];
    updated: UpdatedEntityRef[];
    undoSteps: number;
}
```

### `TransactionResult`

Value and changes of `Studio.transaction`.

```ts
export interface TransactionResult<T> {
    value: T;
    changes: Changes;
    settled?: Promise<Changes>;
}
```

### `SdkMethodReference`

One method of the generated reference (design §4.9).

```ts
export interface SdkMethodReference {
    name: string;
    signature: string;
    summary: string;
    mapsTo: string;
    throws: string[];
    example: string;
}
```

### `SdkNamespaceReference`

One namespace of the generated reference.

```ts
export interface SdkNamespaceReference {
    name: string;
    summary: string;
    methods: SdkMethodReference[];
}
```

### `SdkTypeReference`

One public type of the generated reference.

```ts
export interface SdkTypeReference {
    name: string;
    declaration: string;
    summary: string;
}
```

### `SdkErrorReference`

One error code of the generated reference.

```ts
export interface SdkErrorReference {
    code: StudioErrorCode;
    summary: string;
}
```

### `SdkReference`

The whole generated reference, as `studio.reference()` returns it.

```ts
export interface SdkReference {
    version: 1;
    namespaces: SdkNamespaceReference[];
    types: SdkTypeReference[];
    errors: SdkErrorReference[];
}
```

### `StudioErrorCode`

Code of a `StudioError` (design §4.5).

```ts
export type StudioErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'CONFLICT' | 'UNSUPPORTED' | 'MEDIA_UNAVAILABLE' | 'EXPORT_FAILED' | 'INTERNAL';
```

### `StudioErrorJson`

JSON form of a `StudioError`, what the MCP passes to its caller (design §4.5).

```ts
export interface StudioErrorJson {
    name: 'StudioError';
    code: StudioErrorCode;
    message: string;
    argument?: string;
    valid?: readonly string[];
    entity?: EntityRef;
    hint?: string;
}
```

### `Studio`

The DroneClean Studio SDK: one typed object over the editor's command store and domain stores (design §4.2). Every call that changes the timeline is one undo step; a failed call leaves the project exactly as it was.

```ts
export interface Studio {
    readonly version: 1;
    readonly project: ProjectApi;
    readonly media: MediaApi;
    readonly subclips: SubclipsApi;
    readonly tracks: TracksApi;
    readonly clips: ClipsApi;
    readonly titles: TitlesApi;
    readonly effects: EffectsApi;
    readonly keyframes: KeyframesApi;
    readonly transitions: TransitionsApi;
    readonly markers: MarkersApi;
    readonly selection: SelectionApi;
    readonly playback: PlaybackApi;
    readonly export: ExportApi;
    readonly history: HistoryApi;
    readonly workspace: WorkspaceApi;
    readonly looks: LooksApi;
    readonly shadow: ShadowApi;
    readonly preview: PreviewApi;
    transaction<T>(label: string, fn: (studio: Studio) => T): TransactionResult<T>;
    reference(): SdkReference;
}
```

## Errors

| Code | When it is thrown |
|---|---|
| `INVALID_ARGUMENT` | An argument has the wrong type, the wrong shape or a value outside its range; the message names the argument and lists the valid values when they are known. |
| `NOT_FOUND` | An id does not exist in the active editing context or in the media library; the message names the argument, the ids that do exist and `studio.project.context()`. |
| `CONFLICT` | The call is valid on its own but contradicts the project's state: a cut that cannot take a transition, a keyframe inside a transition, a split outside the clip. |
| `UNSUPPORTED` | The editor cannot do this yet or in this browser: import without file handles, export settings the pipeline does not read, a project stored with an older schema. |
| `MEDIA_UNAVAILABLE` | A media file's bytes cannot be read: permission denied, the file is gone, or nothing of an import could be read. |
| `EXPORT_FAILED` | An export job failed or was cancelled before it wrote its file. |
| `INTERNAL` | A store or storage operation failed unexpectedly; the message carries the underlying reason. |
