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
 * How finely the flow follows the motion, a clip's "Motion detail" (design 11.24): `'normal'` measures it at half the
 * frame's size up to twice a 1080p frame and at a quarter above; `'high'` at twice that (the frame's own size up to twice
 * a 1080p frame, half above), which follows small and thin moving things more closely and costs about three times the
 * flow per source gap.
 */
export type FlowDetail = 'normal' | 'high'

/**
 * How many frame pixels one flow pixel spans, along each side: at `'normal'` detail 2 for frames up to twice a 1080p
 * frame and 4 above, at `'high'` half that. The flow runs on the source frames, so this is the source's size, whatever
 * the project's output size.
 *
 * @throws RangeError when the size is not a positive whole number of pixels.
 */
export function flowScaleFor(frame: FlowFrameSize, detail: FlowDetail = 'normal'): 1 | 2 | 4 {
  assertSize(frame)
  const large = frame.width * frame.height > QUARTER_ABOVE_PIXELS
  if (detail === 'high') return large ? 2 : 1
  return large ? 4 : 2
}

/** The flow's size for a frame: the frame divided by `flowScaleFor`, at least one pixel each way. */
export function flowSizeFor(frame: FlowFrameSize, detail: FlowDetail = 'normal'): FlowFrameSize {
  const scale = flowScaleFor(frame, detail)
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

/**
 * Where neither frame is trusted (a thin thing against the sky, a branch near the lens, something entering at the
 * border), a clip's "Hard edges" (design 11.24): `'mix'` mixes the two moved samples by the phase (a soft local halo at
 * worst), `'nearest'` takes the one of the frame more likely to see that content (no halo, a small local jump).
 */
export type FlowEdges = 'mix' | 'nearest'

/**
 * The interpolation's tolerance in the frame's pixels: a frame whose own flow at its sample point differs from the
 * motion at the phase by this much weighs e^-1 (the frame does not see that content).
 */
export const CONSISTENCY_SIGMA = 2

/**
 * How many times the forward warp's holes (flow pixels nothing landed on) take their found neighbours' mean: each pass
 * reaches one flow pixel further, so 8 fill holes 16 frame pixels wide at half-size flow and 32 at quarter-size
 * (design 11.24, the probe's setting).
 */
export const FILL_PASSES = 8

function assertSize(size: FlowFrameSize): void {
  const { width, height } = size
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`optical flow: a size must be whole pixels, got ${width}x${height}`)
  }
}
