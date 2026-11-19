// Project builders for the golden cases: small, explicit, deterministic.
//
// A case describes one project through these helpers. Nothing here is random and
// nothing reads the clock; ids are derived from the case id, so a project built
// twice is the same JSON.
import { HEIGHT, WIDTH } from './images.mjs'

const FPS = 24
/** Source frames in the committed videos (see golden/media/make-videos.sh). */
const VIDEO_FRAMES = 12

/** Media the cases can reference. Images are generated; videos are committed files. */
export const imageMediaId = (name) => `golden-image-${name}`
export const videoMediaId = (name) => `golden-video-${name}`

export function effect(type, params = {}, id = `fx-${type}`) {
  return { id, enabled: true, effect: { type: 'gpu-effect', gpuEffectType: type, params } }
}

/** Placement fields shared by every layer. `track` 0 is the TOP layer (lowest order is drawn last). */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function layer({ id, track, from = 0, frames, transform, crop, effects, blendMode }) {
  return {
    id,
    trackId: `track-${track}`,
    from,
    durationInFrames: frames,
    label: id,
    ...(transform ? { transform } : {}),
    ...(crop ? { crop } : {}),
    ...(effects?.length ? { effects } : {}),
    ...(blendMode ? { blendMode } : {}),
  }
}

export function imageItem({ id, image, frames = 48, ...rest }) {
  return {
    ...layer({ id, frames, ...rest }),
    type: 'image',
    mediaId: imageMediaId(image),
    sourceWidth: WIDTH,
    sourceHeight: HEIGHT,
  }
}

// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function videoItem({
  id,
  video,
  frames = VIDEO_FRAMES,
  sourceFrames = VIDEO_FRAMES,
  shadowRemoval,
  inputColor,
  look,
  speed = 1,
  motionBlur,
  width = WIDTH,
  height = HEIGHT,
  ...rest
}) {
  return {
    ...layer({ id, frames, ...rest }),
    type: 'video',
    mediaId: videoMediaId(video),
    sourceWidth: width,
    sourceHeight: height,
    sourceFps: FPS,
    sourceStart: 0,
    sourceEnd: frames * speed,
    sourceDuration: sourceFrames,
    trimStart: 0,
    trimEnd: sourceFrames - frames * speed,
    speed,
    volume: 0,
    ...(shadowRemoval ? { shadowRemoval } : {}),
    ...(inputColor ? { inputColor } : {}),
    ...(look ? { look } : {}),
    ...(motionBlur ? { motionBlur } : {}),
  }
}

export function textItem({ id, text, frames = 48, color = '#ffffff', fontSize = 40, ...rest }) {
  return {
    ...layer({ id, frames, ...rest }),
    type: 'text',
    text,
    color,
    // A family installed with macOS and Windows: the render must not depend on a network font.
    fontFamily: 'Arial',
    fontSize,
    fontWeight: 'bold',
    textAlign: 'center',
    verticalAlign: 'middle',
  }
}

export function transition({
  id = 'transition',
  presentation,
  left,
  right,
  frames,
  direction,
  track = 0,
}) {
  return {
    id,
    type: 'crossfade',
    presentation,
    ...(direction ? { direction } : {}),
    timing: 'linear',
    leftClipId: left,
    rightClipId: right,
    trackId: `track-${track}`,
    durationInFrames: frames,
    alignment: 0.5,
  }
}

/**
 * Build a project. `items` carry a `track` index (0 = top); every track that is
 * used gets a record. `background` is the project background colour.
 */
export function buildProject({
  id,
  items,
  transitions = [],
  background = '#202020',
  width = WIDTH,
  height = HEIGHT,
}) {
  const trackIds = [...new Set(items.map((item) => item.trackId))].sort()
  const tracks = trackIds.map((trackId) => ({
    id: trackId,
    name: trackId.toUpperCase(),
    kind: 'video',
    height: 60,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order: Number(trackId.split('-')[1]),
    items: [],
  }))
  const duration = Math.max(...items.map((item) => item.from + item.durationInFrames))
  return {
    id,
    name: id,
    description: 'DroneClean golden frame',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    duration,
    schemaVersion: 10,
    metadata: { width, height, fps: FPS, backgroundColor: background },
    timeline: { masterBusDb: 0, tracks, items, transitions, keyframes: [], compositions: [] },
  }
}

/** Every media id a project uses, split by kind, so the runner can serve exactly those. */
export function mediaUsedBy(project) {
  const images = new Set()
  const videos = new Set()
  for (const item of project.timeline.items) {
    if (item.type === 'image') images.add(item.mediaId.replace('golden-image-', ''))
    if (item.type === 'video') videos.add(item.mediaId.replace('golden-video-', ''))
  }
  return { images: [...images], videos: [...videos] }
}
