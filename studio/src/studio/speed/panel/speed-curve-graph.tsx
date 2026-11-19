/**
 * The speed graph: the clip's curve over its own timeline frames, with a handle per key, a row of
 * source-frame labels and a row of timeline-frame ticks (design 7.1, section 4.8).
 *
 * The horizontal axis is the timeline's own: `frameToPlotX` is the expression the timeline ruler
 * uses, so the graph sits under the frames it describes while the dock is scrolled with the timeline.
 * The vertical axis is speed, 0.1 at the bottom and 10 at the top, with 1x marked. A handle is a key;
 * its pointer down is handed to the panel, which owns the drag and its single undo entry.
 *
 * Kept presentational: it draws what the store holds and reports a pointer down, so the panel's
 * numbers and the drag are testable without measuring the SVG beyond its top-left corner.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { SpeedCurve } from '@/studio/speed'
import {
  SPEED_GRAPH_SOURCE_ROW_HEIGHT,
  clipFrameToPlotX,
  firstTickFrame,
  frameToPlotX,
  speedGraphHeight,
  speedToPlotY,
  tickStep,
} from './graph-geometry'
import type { SpeedKeyDragStart } from './use-speed-curve-key-drag'

interface SpeedCurveGraphProps {
  /** The clip's curve; the last key sits at the clip's length. */
  curve: SpeedCurve
  /** The clip's timeline length, in frames. */
  duration: number
  /** The clip's first timeline frame. */
  clipFrom: number
  /** The playhead's timeline frame. */
  playhead: number
  /** The project's frame rate. */
  fps: number
  /** The timeline's settled zoom. */
  pixelsPerSecond: number
  /** The timeline content's scroll left. */
  scrollLeft: number
  /** The visible width of the timeline content, for the tick row. */
  viewportWidth: number
  /** The source frame at each key, in key order. */
  sourceFramesByKey: readonly number[]
  /** The source frame at the playhead, when the playhead is inside the clip. */
  sourceFrameAtPlayhead: number | null
  /** Height of the plot, so a short dock still draws a curve (the panel measures it). */
  plotHeight: number
  /** The key being dragged, for its highlighted handle. */
  draggingIndex: number | null
  /** A key's pointer down, with the pointer and the plot's top edge in client pixels. */
  onKeyPointerDown: (start: SpeedKeyDragStart) => void
  /** Accessible name of the graph. */
  label: string
}

export function SpeedCurveGraph({
  curve,
  duration,
  clipFrom,
  playhead,
  fps,
  pixelsPerSecond,
  scrollLeft,
  viewportWidth,
  sourceFramesByKey,
  sourceFrameAtPlayhead,
  plotHeight,
  draggingIndex,
  onKeyPointerDown,
  label,
}: SpeedCurveGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const totalHeight = speedGraphHeight(plotHeight)
  const sourceLabelY = plotHeight + 12
  const tickLabelY = plotHeight + SPEED_GRAPH_SOURCE_ROW_HEIGHT + 11
  const xOfClipFrame = (frame: number) =>
    clipFrameToPlotX(frame, clipFrom, fps, pixelsPerSecond, scrollLeft)
  const yOfSpeed = (speed: number) => speedToPlotY(speed, plotHeight)
  const durationX = xOfClipFrame(duration)
  const playheadFrame = playhead - clipFrom
  const playheadVisible = playheadFrame >= 0 && playheadFrame <= duration
  const playheadX = xOfClipFrame(playheadFrame)

  const step = tickStep(pixelsPerSecond, fps)
  const firstFrame = firstTickFrame(
    (scrollLeft / Math.max(1, pixelsPerSecond)) * fps,
    step,
  )
  const ticks: number[] = []
  if (viewportWidth > 0) {
    for (
      let frame = firstFrame;
      frameToPlotX(frame, fps, pixelsPerSecond, scrollLeft) <= viewportWidth;
      frame += step
    ) {
      ticks.push(frame)
    }
  }

  const handlePointerDown = (index: number) => (event: ReactPointerEvent<SVGGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    onKeyPointerDown({
      index,
      clientX: event.clientX,
      clientY: event.clientY,
      plotTop: rect.top,
      plotHeight,
    })
  }

  const curvePoints = curve.keys
    .map((key) => `${xOfClipFrame(key.frame)},${yOfSpeed(key.speed)}`)
    .join(' ')
  const areaPoints = `${xOfClipFrame(0)},${plotHeight} ${curvePoints} ${durationX},${plotHeight}`

  return (
    <svg
      ref={svgRef}
      data-testid="speed-curve-graph"
      data-plot-height={plotHeight}
      width="100%"
      height={totalHeight}
      className="block select-none"
      style={{ touchAction: 'none' }}
      role="img"
      aria-label={label}
    >
      {/* The clip's own span is the lit area; the timeline past its end is dimmed. */}
      <rect
        x={durationX}
        y={0}
        width={1_000_000}
        height={totalHeight}
        fill="var(--background)"
        opacity={0.6}
      />
      <polygon points={areaPoints} fill="var(--primary)" opacity={0.12} />

      {/* The speed axis: its floor and its ceiling. */}
      {[10, 0.1].map((speed) => (
        <line
          key={speed}
          x1={-1_000_000}
          x2={1_000_000}
          y1={yOfSpeed(speed)}
          y2={yOfSpeed(speed)}
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      <line
        x1={-1_000_000}
        x2={1_000_000}
        y1={yOfSpeed(1)}
        y2={yOfSpeed(1)}
        stroke="var(--muted-foreground)"
        strokeOpacity={0.5}
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <text x={4} y={yOfSpeed(1) - 2} fill="var(--muted-foreground)" fontSize={9}>
        1×
      </text>
      <text x={4} y={yOfSpeed(10) + 9} fill="var(--muted-foreground)" fontSize={9}>
        10×
      </text>
      <text x={4} y={plotHeight - 2} fill="var(--muted-foreground)" fontSize={9}>
        0.1×
      </text>

      {/* The clip's own end, so the right edge that moves during a drag has a line. */}
      <line
        x1={durationX}
        x2={durationX}
        y1={0}
        y2={plotHeight}
        stroke="var(--border)"
        strokeWidth={1}
      />

      {/* The curve itself: linear between keys, so a polyline through them is exact. */}
      <polyline
        points={curvePoints}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinejoin="round"
        data-testid="speed-curve-line"
      />

      {/* The playhead and its source frame. */}
      {playheadVisible && (
        <>
          <line
            x1={playheadX}
            x2={playheadX}
            y1={0}
            y2={totalHeight}
            stroke="var(--foreground)"
            strokeOpacity={0.7}
            strokeWidth={1}
          />
          <polygon
            points={`${playheadX - 4},0 ${playheadX + 4},0 ${playheadX},5`}
            fill="var(--foreground)"
            opacity={0.7}
          />
        </>
      )}

      {/* One handle per key; the endpoints are squares because they stay on the clip's ends. */}
      {curve.keys.map((key, index) => {
        const x = xOfClipFrame(key.frame)
        const y = yOfSpeed(key.speed)
        const pinned = index === 0 || index === curve.keys.length - 1
        const active = draggingIndex === index
        return (
          <g
            key={`${key.frame}-${index}`}
            data-testid={`speed-key-handle-${index}`}
            data-pinned={pinned ? 'true' : 'false'}
            className={pinned ? 'cursor-ns-resize' : 'cursor-move'}
            onPointerDown={handlePointerDown(index)}
          >
            <circle cx={x} cy={y} r={10} fill="transparent" />
            {pinned ? (
              <rect
                x={x - 4.5}
                y={y - 4.5}
                width={9}
                height={9}
                fill="var(--background)"
                stroke="var(--primary)"
                strokeWidth={2}
              />
            ) : (
              <circle
                cx={x}
                cy={y}
                r={active ? 6 : 5}
                fill="var(--background)"
                stroke="var(--primary)"
                strokeWidth={2}
              />
            )}
          </g>
        )
      })}

      {/* The source-frame row: the source frame at each key, and at the playhead. */}
      <line
        x1={-1_000_000}
        x2={1_000_000}
        y1={plotHeight + 1}
        y2={plotHeight + 1}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {curve.keys.map((key, index) => (
        <text
          key={`source-${key.frame}-${index}`}
          data-testid={`speed-key-source-${index}`}
          x={xOfClipFrame(key.frame)}
          y={sourceLabelY}
          fill="var(--muted-foreground)"
          fontSize={9}
          textAnchor="middle"
        >
          {sourceFramesByKey[index] ?? ''}
        </text>
      ))}
      {playheadVisible && sourceFrameAtPlayhead !== null && (
        <text
          data-testid="speed-playhead-source"
          x={playheadX}
          y={sourceLabelY}
          fill="var(--foreground)"
          fontSize={9}
          textAnchor="middle"
        >
          {sourceFrameAtPlayhead}
        </text>
      )}

      {/* The timeline-frame ticks, numbered like the timeline's ruler. */}
      {ticks.map((frame) => {
        const x = frameToPlotX(frame, fps, pixelsPerSecond, scrollLeft)
        return (
          <g key={`tick-${frame}`} data-testid="speed-tick">
            <line
              x1={x}
              x2={x}
              y1={plotHeight + SPEED_GRAPH_SOURCE_ROW_HEIGHT}
              y2={plotHeight + SPEED_GRAPH_SOURCE_ROW_HEIGHT + 3}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={x} y={tickLabelY} fill="var(--muted-foreground)" fontSize={9} textAnchor="middle">
              {frame}
            </text>
          </g>
        )
      })}
      <line
        x1={-1_000_000}
        x2={1_000_000}
        y1={plotHeight + SPEED_GRAPH_SOURCE_ROW_HEIGHT}
        y2={plotHeight + SPEED_GRAPH_SOURCE_ROW_HEIGHT}
        stroke="var(--border)"
        strokeWidth={1}
      />
      <line
        x1={-1_000_000}
        x2={1_000_000}
        y1={totalHeight - 0.5}
        y2={totalHeight - 0.5}
        stroke="var(--border)"
        strokeWidth={1}
      />
    </svg>
  )
}
