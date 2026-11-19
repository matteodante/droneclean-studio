/**
 * The speed graph's axes, as plain numbers (design 7.1, section 4.8).
 *
 * x is the timeline: a global frame's pixel is the same expression the timeline's own ruler uses,
 * `(frame / fps) · pixelsPerSecond - scrollLeft`, so a key sits under the frame it belongs to when
 * the dock is scrolled with the timeline. y is the speed, `0.1` at the plot's bottom and `10` at its
 * top, linear, with `1x` marked: the panel's one scale, so a speed read from the pointer is the speed
 * a key gets. The plot's height is a parameter: the dock shrinks when the timeline pane is short
 * (see the panel), and the pointer maths follows the same height the graph was drawn with.
 *
 * Nothing here touches the DOM, so the pointer maths is tested without measuring anything.
 */

import { MAX_CURVE_SPEED, MIN_CURVE_SPEED } from '@/studio/speed'

/** The plot's height when the dock has room for it, in pixels. */
export const SPEED_GRAPH_PLOT_HEIGHT = 150

/** The plot's smallest height, so a short timeline pane still shows a curve. */
export const SPEED_GRAPH_MIN_PLOT_HEIGHT = 56

/** Vertical padding of the plot, so a handle at 0.1x or 10x is not cut in half. */
const SPEED_GRAPH_PAD_Y = 8

/** Height of the row of source-frame labels under the plot. */
export const SPEED_GRAPH_SOURCE_ROW_HEIGHT = 18

/** Height of the row of timeline-frame ticks under the source row. */
const SPEED_GRAPH_TICK_ROW_HEIGHT = 16

/** The graph's rows under the plot: the source-frame ruler and the frame ticks. */
export const SPEED_GRAPH_ROWS_HEIGHT =
  SPEED_GRAPH_SOURCE_ROW_HEIGHT + SPEED_GRAPH_TICK_ROW_HEIGHT

/** The height of the whole graph for a plot height. */
export function speedGraphHeight(plotHeight: number): number {
  return plotHeight + SPEED_GRAPH_ROWS_HEIGHT
}

/** The speed range the axis covers, in x. */
const SPEED_GRAPH_RANGE = MAX_CURVE_SPEED - MIN_CURVE_SPEED

/** The x pixel of a global timeline frame, the timeline ruler's expression. */
export function frameToPlotX(
  frame: number,
  fps: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  return (frame / fps) * pixelsPerSecond - scrollLeft
}

/** The x pixel of a clip-relative frame; the clip's first frame is `clipFrom`. */
export function clipFrameToPlotX(
  frame: number,
  clipFrom: number,
  fps: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  return frameToPlotX(clipFrom + frame, fps, pixelsPerSecond, scrollLeft)
}

/** The speed at a plot y pixel, clamped into the axis. */
export function plotYToSpeed(y: number, plotHeight: number = SPEED_GRAPH_PLOT_HEIGHT): number {
  const usable = plotHeight - 2 * SPEED_GRAPH_PAD_Y
  if (usable <= 0) return MIN_CURVE_SPEED
  const aboveBottom = plotHeight - SPEED_GRAPH_PAD_Y - y
  const ratio = aboveBottom / usable
  const speed = MIN_CURVE_SPEED + Math.min(1, Math.max(0, ratio)) * SPEED_GRAPH_RANGE
  return Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, speed))
}

/** The plot y pixel of a speed, clamped into the axis. */
export function speedToPlotY(speed: number, plotHeight: number = SPEED_GRAPH_PLOT_HEIGHT): number {
  const usable = plotHeight - 2 * SPEED_GRAPH_PAD_Y
  const clamped = Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, speed))
  const ratio = (clamped - MIN_CURVE_SPEED) / SPEED_GRAPH_RANGE
  return plotHeight - SPEED_GRAPH_PAD_Y - ratio * usable
}

/**
 * The frame step of the tick row for a zoom, at least `minPixels` apart: 1, 2, 5, 10, 15, 30, 60,
 * 120, 300 or 600 frames. The timeline ruler uses its own step; this row only has to be readable.
 */
export function tickStep(pixelsPerSecond: number, fps: number, minPixels = 64): number {
  const pixelsPerFrame = pixelsPerSecond / fps
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
  for (const step of steps) {
    if (step * pixelsPerFrame >= minPixels) return step
  }
  return steps[steps.length - 1]!
}

/**
 * The first tick at or before the visible left edge: ticks are whole multiples of `step` global
 * frames, like the timeline ruler's own numbering.
 */
export function firstTickFrame(startFrame: number, step: number): number {
  return Math.floor(startFrame / step) * step
}
