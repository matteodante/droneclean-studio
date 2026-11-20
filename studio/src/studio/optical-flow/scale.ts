// The sizes the optical flow works at (task 11.12, design 11.12): the flow's own size from the frame's, its pyramid,
// and the work done at each level. The GPU path (`flow.ts`) and its CPU twin (`cpu-reference.fixture.ts`) both read
// them from here, so the two always build the same pyramid.

/** A picture's size in pixels. */
export interface FlowFrameSize {
  readonly width: number
  readonly height: number
}

/**
 * The frames, in pixels, above which the flow is measured at a quarter of the frame's size instead of half: twice a
 * 1080p frame. 1080p (2.1 MP) and 2.7K (4.1 MP) get half-size flow; 4K UHD (8.3 MP) and the Avata 2's 3840x2880
 * (11.1 MP) a quarter. The design measured half-size flow at 1080p (8.9 ms a frame pair) and quarter-size at 4K
 * (12.3 ms), both within 0.3 dB of full-size flow; full-size 4K flow costs 117 ms.
 */
const QUARTER_ABOVE_PIXELS = 2 * 1920 * 1080

/** The coarsest pyramid level is the last whose short side is still at least this many pixels (as the probe). */
const COARSEST_SIDE = 32

/**
 * How many frame pixels one flow pixel spans, along each side: 2 for frames up to twice a 1080p frame, 4 above. The
 * flow runs on the source frames, so this is the source's size, whatever the project's output size.
 *
 * @throws RangeError when the size is not a positive whole number of pixels.
 */
export function flowScaleFor(frame: FlowFrameSize): 2 | 4 {
  assertSize(frame)
  return frame.width * frame.height > QUARTER_ABOVE_PIXELS ? 4 : 2
}

/** The flow's size for a frame: the frame divided by `flowScaleFor`, at least one pixel each way. */
export function flowSizeFor(frame: FlowFrameSize): FlowFrameSize {
  const scale = flowScaleFor(frame)
  return {
    width: Math.max(1, Math.floor(frame.width / scale)),
    height: Math.max(1, Math.floor(frame.height / scale)),
  }
}

/** The pyramid's levels, finest first: each half the one before (rounded down), down to a short side of about 32. */
export function flowLevels(finest: FlowFrameSize): FlowFrameSize[] {
  assertSize(finest)
  const levels: FlowFrameSize[] = [{ width: finest.width, height: finest.height }]
  for (;;) {
    const { width, height } = levels[levels.length - 1]!
    if (Math.min(width, height) >> 1 < COARSEST_SIDE) break
    levels.push({ width: width >> 1, height: height >> 1 })
  }
  return levels
}

/**
 * The work at level `level` (0 is the finest) of a pyramid of `count` levels: Lucas-Kanade rounds and the window's
 * radius. The three coarsest levels get 6 rounds (they are cheap), the others 4 from level 2 and 3 at levels 0 and 1;
 * the window is 5x5 at levels 0 and 1 and 7x7 above.
 */
export function levelWork(level: number, count: number): { readonly rounds: number; readonly radius: number } {
  const fromTop = count - 1 - level
  return { rounds: fromTop < 3 ? 6 : level >= 2 ? 4 : 3, radius: level <= 1 ? 2 : 3 }
}

/** The largest change of the flow one Lucas-Kanade round may make, in pixels of its level. */
export const LK_MAX_STEP = 1.5

/** The round trip's tolerance in the frame's pixels: a point whose flow there and back misses by this much weighs e^-1. */
export const CONSISTENCY_SIGMA = 2

function assertSize(size: FlowFrameSize): void {
  const { width, height } = size
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`optical flow: a size must be whole pixels, got ${width}x${height}`)
  }
}
