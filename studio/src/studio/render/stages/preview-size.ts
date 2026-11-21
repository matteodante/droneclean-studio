// The preview's staged pictures at the size it shows (design 8.10). A 4K stabilized clip in a preview a thousand pixels
// wide was warped, interpolated and blurred at 3840x2880 and then shrunk by the composite: about 23 times the pixels
// the screen shows, which is where a preview frame's time went (15 ms of a 16.7 ms frame for the warp alone, 63 ms for
// a smooth ramp's gather, on the M4). Here the preview reduces each picture of a clip's chain to the pixel scale its
// staged picture is shown at, never below one staged pixel per preview pixel: the decoded frame, each stage's output,
// the optical flow and the gather. An export reduces nothing; the golden frames are an export's.
//
// The reduction is a level of `PREVIEW_REDUCTIONS`, not any number: a clip whose box grows a little each frame (an
// eased zoom) keeps its sizes, and with them its textures, flows and gathers, until it crosses a level.
//
// Pure arithmetic: no GPU, no store. The pipeline (`pipeline.ts`) applies it, the draw (`draw.ts`) says the box.

import type { Size } from './types'

/** The reductions a preview picks from, by how many staged pixels one preview pixel shows */
export const PREVIEW_REDUCTIONS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8]

/** Below this a picture is left at its size: a pass to shrink it would cost more than it saves */
const SMALLEST_REDUCTION = 1.25

/**
 * Where the preview draws a clip's staged picture: the box (the clip's transform) the picture is contained in on the
 * preview canvas, in the canvas's pixels.
 */
export interface PreviewBox {
  readonly width: number
  readonly height: number
}

/** A size of a reduced picture, with the size it stands for (its natural size, the layout's) */
export interface ReducedSize extends Size {
  readonly natural?: Size
}

/** The size a picture stands for: its natural size when it was reduced, else its own */
export function naturalOf(size: ReducedSize): Size {
  return size.natural ?? size
}

/**
 * The level a staged picture of natural size `staged`, contained in `box`, is reduced by: the largest that still
 * leaves at least one staged pixel for each preview pixel it is shown on (1 when the box is as large as the picture or
 * larger, or is not a box).
 */
export function previewReduction(staged: Size, box: PreviewBox): number {
  if (!(box.width > 0) || !(box.height > 0) || !(staged.width > 0) || !(staged.height > 0)) return 1
  // Contained: the picture is shown at min(box / staged) of its size, so one preview pixel shows this many of its own
  const perPreviewPixel = Math.max(staged.width / box.width, staged.height / box.height)
  let level = 1
  for (const candidate of PREVIEW_REDUCTIONS) if (candidate <= perPreviewPixel + 1e-9) level = candidate
  return level
}

/** `size` divided by `factor` on both axes, in whole pixels (one at least), with the size it stands for */
function reduceBy(size: Size, factor: number): ReducedSize {
  return {
    width: Math.max(1, Math.round(size.width / factor)),
    height: Math.max(1, Math.round(size.height / factor)),
    natural: { width: size.width, height: size.height },
  }
}

/**
 * How a preview reduces every picture of a clip whose staged picture has natural size `staged` and is shown in `box`:
 * each to the staged picture's pixel scale at its level. A picture of the staged picture's size (a stage that keeps
 * its input's size, after the stabilization or without one) is divided by the level; the decoded frame of a
 * stabilized clip, whose pixels are the stabilized picture's (the engine's output is the largest window of its shape
 * inside the frame), is divided by the level too; a picture of finer pixels (a source larger than the engine's output)
 * by more, and a coarser one (a proxy) by less, or not at all when that is below `SMALLEST_REDUCTION`.
 *
 * A picture of the same natural size is always given the same reduced size, so a stage that keeps its input's size
 * keeps it reduced as well.
 */
export function previewReducer(staged: Size, box: PreviewBox): (size: Size) => ReducedSize {
  const level = previewReduction(staged, box)
  return (size) => {
    const factor = level * Math.min(size.width / staged.width, size.height / staged.height)
    return factor < SMALLEST_REDUCTION
      ? { width: size.width, height: size.height, natural: { width: size.width, height: size.height } }
      : reduceBy(size, factor)
  }
}
