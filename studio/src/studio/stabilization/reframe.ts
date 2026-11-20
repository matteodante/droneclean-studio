// Reframing (task 11.13): where the stabilized window sits inside the source picture. A 4:3 drone shot stabilized into
// a 9:16 project shows the centre strip of the frame; the pilot wants the lake that filled the left of it. The engine
// fits the window (its zoom and its own centre, `translation2d`, are the adaptive zoom's); the pilot's framing moves it
// further, and never past the room the stabilization has.
//
// One place, the warp's kernel parameters: `translation2d` is added to every output pixel's position before the ray is
// made (`wgpu_undistort.wgsl`, `undistort_coord`), which pans the window in the stabilized frame. The preview and the
// export both record the warp through `stage.ts`, so both read it here and agree. Nothing is stored in the engine's
// frames: the offset is applied to the copy `prepareFrame` makes, so a clip's engine is shared by clips of different
// framings and a slider drag asks the engine for nothing.
//
// Units: the setting is -1..1, the fraction of the room on that side (`-1` the window's edge at the left of the picture,
// `1` at the right, 0 where the engine put it). The room is measured per frame from the frame's own data: the window's
// four corners go through the frame's row matrices to the source picture as a pinhole camera of the lens's focal
// length sees them, and what is left between their extent and the picture's edges is the room. A wide lens images the
// same ray closer to its centre than a pinhole does, so the pinhole window is the larger one and the room measured
// is the smaller (conservative); `SAFE_FRACTION` keeps a tenth of it besides. It is not measured on real footage:
// `reframe.test.ts` holds the arithmetic, a clip's real border-free-ness is a thing to look at.
//
// What is not modelled: the sensor shift of in-body stabilization (flag 256), the mesh (512) and the digital lens (2)
// move the window by a few pixels at most; the output projections other than rectilinear (`output_projection` is not 0)
// get no room (framing off) because their rays are not the pinhole's.

/** Where the fields this reads are in Gyroflow's `KernelParams` (little-endian; `stage.ts` has the others) */
const WIDTH = 0
const HEIGHT = 4
const OUTPUT_WIDTH = 12
const OUTPUT_HEIGHT = 16
const MATRIX_COUNT = 24
const FLAGS = 36
/** The focal length in pixels, two floats */
const FOCAL = 64
/** The lens centre, two floats */
const CENTRE = 72
const FOV = 176
const VERTICAL_STRETCH = 188
const HORIZONTAL_STRETCH = 192
/** The pan of the output window the engine already applies (the adaptive zoom's centre), two floats, output pixels */
const TRANSLATION_2D = 216
const OUTPUT_PROJECTION = 376
/** `KernelParamsFlags::FRAMEBUFFER_INVERTED`: the engine flips the pan's sign on `y` */
const FRAMEBUFFER_INVERTED = 128
/** Floats per row matrix */
const MATRIX_STRIDE = 16

/** The share of the measured room the setting's ±1 reaches: a tenth stays as the margin of the lens and the rounding */
export const SAFE_FRACTION = 0.9

/** The framing the pilot chose: both from -1 to 1, 0 is the engine's own */
export interface Framing {
  x: number
  y: number
}

/** What a clip's settings say about its framing: `undefined` when it is the engine's own (nothing to apply) */
export function framingOf(
  settings: { framingX?: number; framingY?: number } | undefined,
): Framing | undefined {
  const x = settings?.framingX ?? 0
  const y = settings?.framingY ?? 0
  return x === 0 && y === 0 ? undefined : { x, y }
}

/** The window's extent in the source picture, in source pixels, as the pinhole model gives it */
export interface WindowExtent {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** The room the window has on each side, in source pixels (0 where it has none) */
export interface FramingRoom {
  left: number
  right: number
  up: number
  down: number
}

/** How far a unit of the translation moves the window in the source picture, per axis (`fov`, and the stretches) */
function sourcePerOutputPixel(view: DataView): { x: number; y: number } {
  const fov = view.getFloat32(FOV, true)
  const horizontal = view.getFloat32(HORIZONTAL_STRETCH, true)
  const vertical = view.getFloat32(VERTICAL_STRETCH, true)
  // The kernel: `out_f = f * stretch / fov` with `stretch = 1 / horizontal` (or 1), and the source position is divided
  // by the stretches (`rotate_and_distort`'s caller): a unit of output pixels is `fov * (1 / stretch_axis) / stretch`
  const stretch = horizontal > 0.01 ? 1 / horizontal : 1
  const x = (fov * (horizontal > 0.001 ? 1 / horizontal : 1)) / stretch
  const y = (fov * (vertical > 0.001 ? 1 / vertical : 1)) / stretch
  return { x, y }
}

/**
 * Where the output window's four corners land in the source picture, over every row matrix: the extent of the
 * window as the pinhole model sees it, or `null` when a corner's ray is behind the camera (no room is claimed then).
 * A projective map keeps a rectangle's extent at its corners, so the corners are all there is to ask.
 */
export function windowExtent(params: Uint8Array, matrices: Float32Array): WindowExtent | null {
  const view = new DataView(params.buffer, params.byteOffset, params.byteLength)
  const outputWidth = view.getInt32(OUTPUT_WIDTH, true)
  const outputHeight = view.getInt32(OUTPUT_HEIGHT, true)
  const count = Math.min(view.getInt32(MATRIX_COUNT, true), Math.floor(matrices.length / MATRIX_STRIDE))
  const fov = view.getFloat32(FOV, true)
  const horizontal = view.getFloat32(HORIZONTAL_STRETCH, true)
  const vertical = view.getFloat32(VERTICAL_STRETCH, true)
  const stretch = horizontal > 0.01 ? 1 / horizontal : 1
  const focalX = view.getFloat32(FOCAL, true)
  const focalY = view.getFloat32(FOCAL + 4, true)
  const centreX = view.getFloat32(CENTRE, true)
  const centreY = view.getFloat32(CENTRE + 4, true)
  const panX = view.getFloat32(TRANSLATION_2D, true)
  const panY = view.getFloat32(TRANSLATION_2D + 4, true)
  if (
    count < 1 ||
    !(outputWidth > 0) ||
    !(outputHeight > 0) ||
    !(fov > 0) ||
    !(focalX > 0) ||
    !(focalY > 0)
  ) {
    return null
  }
  const outputFocalX = (focalX * stretch) / fov
  const outputFocalY = (focalY * stretch) / fov
  const scaleX = horizontal > 0.001 ? 1 / horizontal : 1
  const scaleY = vertical > 0.001 ? 1 / vertical : 1
  const extent: WindowExtent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const corners: [number, number][] = [
    [0, 0],
    [outputWidth, 0],
    [0, outputHeight],
    [outputWidth, outputHeight],
  ]
  for (let row = 0; row < count; row++) {
    const m = row * MATRIX_STRIDE
    for (const [cornerX, cornerY] of corners) {
      const dx = (cornerX + panX - outputWidth / 2) / outputFocalX
      const dy = (cornerY + panY - outputHeight / 2) / outputFocalY
      const x = dx * matrices[m]! + dy * matrices[m + 1]! + matrices[m + 2]!
      const y = dx * matrices[m + 3]! + dy * matrices[m + 4]! + matrices[m + 5]!
      const w = dx * matrices[m + 6]! + dy * matrices[m + 7]! + matrices[m + 8]!
      if (!(w > 1e-6)) return null
      const sourceX = ((x / w) * focalX + centreX) * scaleX
      const sourceY = ((y / w) * focalY + centreY) * scaleY
      extent.minX = Math.min(extent.minX, sourceX)
      extent.maxX = Math.max(extent.maxX, sourceX)
      extent.minY = Math.min(extent.minY, sourceY)
      extent.maxY = Math.max(extent.maxY, sourceY)
    }
  }
  return extent
}

/**
 * The room the window has between its extent and the source picture's edges, per side, in source pixels; all 0 when
 * the extent cannot be measured (a ray behind the camera, an output projection other than rectilinear).
 */
export function framingRoom(params: Uint8Array, matrices: Float32Array): FramingRoom {
  const none = { left: 0, right: 0, up: 0, down: 0 }
  const view = new DataView(params.buffer, params.byteOffset, params.byteLength)
  if (view.getInt32(OUTPUT_PROJECTION, true) !== 0) return none
  const extent = windowExtent(params, matrices)
  if (!extent) return none
  const width = view.getInt32(WIDTH, true)
  const height = view.getInt32(HEIGHT, true)
  return {
    left: Math.max(0, extent.minX),
    right: Math.max(0, width - extent.maxX),
    up: Math.max(0, extent.minY),
    down: Math.max(0, height - extent.maxY),
  }
}

/** A setting held to its range: a stored value outside -1..1 is clamped, never trusted */
function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0
}

/**
 * How far the framing moves the window in source pixels on each axis, from the room: positive is right and down, the
 * room on the side it moves toward limits it (and `SAFE_FRACTION` of it is all ±1 reaches).
 */
export function framingShift(room: FramingRoom, framing: Framing): { x: number; y: number } {
  const x = unit(framing.x)
  const y = unit(framing.y)
  return {
    x: (x >= 0 ? x * room.right : x * room.left) * SAFE_FRACTION,
    y: (y >= 0 ? y * room.down : y * room.up) * SAFE_FRACTION,
  }
}

/**
 * Moves the window of a frame's kernel parameters by `framing`: adds the shift to `translation2d`, in place, on the
 * copy the caller owns. `framing` of `undefined` (or 0 and 0) leaves the bytes alone.
 */
export function applyFraming(
  params: Uint8Array,
  matrices: Float32Array,
  framing: Framing | undefined,
): void {
  if (!framing || (unit(framing.x) === 0 && unit(framing.y) === 0)) return
  const view = new DataView(params.buffer, params.byteOffset, params.byteLength)
  const shift = framingShift(framingRoom(params, matrices), framing)
  const per = sourcePerOutputPixel(view)
  const inverted = (view.getInt32(FLAGS, true) & FRAMEBUFFER_INVERTED) !== 0
  const dx = per.x > 0 ? shift.x / per.x : 0
  const dy = per.y > 0 ? (inverted ? -shift.y : shift.y) / per.y : 0
  view.setFloat32(TRANSLATION_2D, view.getFloat32(TRANSLATION_2D, true) + dx, true)
  view.setFloat32(TRANSLATION_2D + 4, view.getFloat32(TRANSLATION_2D + 4, true) + dy, true)
}
