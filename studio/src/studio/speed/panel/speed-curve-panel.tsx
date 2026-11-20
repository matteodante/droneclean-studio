/**
 * The speed curve dock (design 7.1, section 4.8): the clip's speed over its timeline frames, with a
 * handle per key, a source-frame ruler, a readout, a numeric entry per key and the three presets.
 *
 * It is opened from the clip panel's Playback row ("Curve…") and mounted beside the keyframe editor
 * in the timeline dock, with its own open flag (`panel-store.ts`). Every edit calls the speed
 * module's one action: `setSpeedCurve` for the presets, the flat button and a typed number (one undo
 * step each), and its history-free `applySpeedCurve` while a key is dragged, with one undo entry when
 * the pointer is released. So a mouse and `clips.setSpeedCurve` take the same code path, the clip's
 * source span stays what it was and its length and the clips after it follow the shape's average.
 *
 * A clip without a curve opens as a flat line at its speed: giving it a curve is the first edit.
 * A reversed clip and a composition wrapper cannot hold one (the design's `UNSUPPORTED` cases), so
 * the panel says why and offers no controls.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, X } from 'lucide-react'
import type { TimelineItem } from '@/types/timeline'
import { Button } from '@/components/ui/button'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTimelineViewportStore } from '@/features/timeline/stores/timeline-viewport-store'
import { useZoomStore } from '@/features/timeline/stores/zoom-store'
import { useSettledTimelineGeometry } from '@/features/timeline/components/use-settled-timeline-scroll-left'
import { useThrottledFrame } from '@/features/preview/hooks/use-throttled-frame'
import { useSelectionStore } from '@/shared/state/selection'
import { isFeatureShown } from '@/studio/feature-switches'
import type { SmoothSlowMotion } from '@/studio/motion-blur'
import {
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  SPEED_EASES,
  SPEED_PRESET_NAMES,
  speedPresetCurve,
  type SpeedCurve,
  type SpeedEase,
  type SpeedPresetName,
} from '@/studio/speed'
import { canHoldSmoothEdit, smoothEditClip } from '@/studio/smooth-edit/action'
import { canHoldSpeedCurve, setSpeedCurve } from '../actions'
import {
  clampCurveSpeed,
  curveKeyRows,
  curveOnItem,
  isBelowProjectRate,
  keySourceFrame,
  roundCurveSpeed,
  slowestFrameRate,
  sourceFramesUsed,
  speedAtPlayhead,
  withKeyEase,
  withKeyFrame,
  withKeySpeed,
} from './curve-on-item'
import {
  SPEED_GRAPH_MIN_PLOT_HEIGHT,
  SPEED_GRAPH_PLOT_HEIGHT,
  SPEED_GRAPH_ROWS_HEIGHT,
} from './graph-geometry'
import { SpeedCurveGraph } from './speed-curve-graph'
import { useSpeedCurveKeyDrag } from './use-speed-curve-key-drag'

/** Height of the panel's header row, in pixels. */
const HEADER_HEIGHT = 36

/** The dock's height when the timeline pane has room for it, in pixels. */
const DEFAULT_PANEL_HEIGHT = 200

/** The dock's smallest height: a short timeline pane still gets a usable plot. */
const MIN_PANEL_HEIGHT = 130

/** At most this share of the timeline pane, so the tracks stay in view above the dock. */
const MAX_PANEL_RATIO = 0.45

/** Room under the graph, so its last row is not on the panel's edge. */
const PANEL_FOOTER_SPACE = 12

/** The plot height that fills a panel of `panelHeight` pixels, within the graph's own limits. */
function plotHeightFor(panelHeight: number): number {
  const available =
    panelHeight - HEADER_HEIGHT - SPEED_GRAPH_ROWS_HEIGHT - PANEL_FOOTER_SPACE
  return Math.min(SPEED_GRAPH_PLOT_HEIGHT, Math.max(SPEED_GRAPH_MIN_PLOT_HEIGHT, available))
}

/** The preset's label key, in the design's order. */
const PRESET_LABEL_KEYS: Record<SpeedPresetName, SpeedCurveLabelKey> = {
  'ramp-in': 'editor.speedCurve.rampIn',
  'ramp-out': 'editor.speedCurve.rampOut',
  'ramp-in-out': 'editor.speedCurve.rampInOut',
}

/** The default preset fields, the design's 4x peak and 15-frame ramp (section 4.8). */
const DEFAULT_PEAK = 4
const DEFAULT_RAMP_FRAMES = 15

/**
 * The panel's English text, as the fallback of every `t` call: the strings the nine language
 * files receive, and what the panel shows until that wave lands them (the same pattern the
 * keyframe editor's easing labels use).
 */
const LABELS = {
  'editor.speedCurve.title': 'Speed curve',
  'editor.speedCurve.rampIn': 'Ramp in',
  'editor.speedCurve.rampOut': 'Ramp out',
  'editor.speedCurve.rampInOut': 'Ramp in and out',
  'editor.speedCurve.flat': 'Flat',
  'editor.speedCurve.smoothEdit': 'Smooth ramp + zoom',
  'editor.speedCurve.smoothEditTitle':
    'Fast, slow, fast with smooth slow motion and motion blur, and an eased zoom-in over the clip',
  'editor.speedCurve.peakSpeed': 'Peak speed',
  'editor.speedCurve.rampLength': 'Ramp length',
  'editor.speedCurve.close': 'Close',
  'editor.speedCurve.atPlayhead': 'Speed at playhead',
  'editor.speedCurve.duration': 'Length',
  'editor.speedCurve.sourceFrames': 'Source frames',
  'editor.speedCurve.keyFrame': 'Frame',
  'editor.speedCurve.keySpeed': 'Speed',
  'editor.speedCurve.sourceFrame': 'Source frame',
  'editor.speedCurve.unsupportedReversed': 'A reversed clip cannot have a speed curve.',
  'editor.speedCurve.unsupportedComposition': 'A compound clip cannot have a speed curve.',
  'editor.speedCurve.unsupportedKind': 'This clip cannot have a speed curve.',
  'editor.speedCurve.selectOneClip': 'Select one clip to edit its speed curve.',
  'editor.speedCurve.ease': 'Ease',
  'editor.speedCurve.easeTitle': 'How the speed changes from this key to the next',
  'editor.speedCurve.easeLinear': 'Linear',
  'editor.speedCurve.easeSmooth': 'Smooth',
  'editor.speedCurve.easeIn': 'Ease in',
  'editor.speedCurve.easeOut': 'Ease out',
  'editor.speedCurve.deliveredFps': 'Frames per second',
  'editor.speedCurve.deliveredFpsTitle':
    "The frames a second the clip really has at its slowest point: its own frame rate times that speed",
  'editor.speedCurve.lowFps':
    'Too few frames: {{fps}} a second at the slowest point, the project plays {{projectFps}}. Frames repeat.',
  'editor.speedCurve.lowFpsBlended':
    'Too few frames: {{fps}} a second at the slowest point, the project plays {{projectFps}}. Smooth slow motion blends the frames in between.',
  'editor.speedCurve.lowFpsFlow':
    'Too few frames: {{fps}} a second at the slowest point, the project plays {{projectFps}}. Optical flow makes the frames in between from the motion.',
} as const

/** The warning's key for a clip's smooth slow motion: frames repeat, are blended, or are made by optical flow. */
const LOW_FPS_KEYS: Record<SmoothSlowMotion | 'off', SpeedCurveLabelKey> = {
  off: 'editor.speedCurve.lowFps',
  blend: 'editor.speedCurve.lowFpsBlended',
  'optical-flow': 'editor.speedCurve.lowFpsFlow',
}

/** The label key of each ease's name in the key row's menu. */
const EASE_LABEL_KEYS: Record<SpeedEase, SpeedCurveLabelKey> = {
  linear: 'editor.speedCurve.easeLinear',
  smooth: 'editor.speedCurve.easeSmooth',
  'ease-in': 'editor.speedCurve.easeIn',
  'ease-out': 'editor.speedCurve.easeOut',
}

type SpeedCurveLabelKey = keyof typeof LABELS

/** The panel's translated text, with the English default until the language files carry the key. */
function useSpeedCurveLabels(): (
  key: SpeedCurveLabelKey,
  values?: Record<string, string | number>,
) => string {
  const { t } = useTranslation()
  return (key, values) => t(key, { defaultValue: LABELS[key], ...values })
}

/** A frame rate for the readout: up to two decimals, no trailing zeros (14.99, 30, 59.94). */
function formatFps(fps: number): string {
  return String(Number(fps.toFixed(2)))
}

/** Why a clip cannot hold a curve, or null when it can: the design's two hidden cases. */
function blockedReason(item: TimelineItem): 'reversed' | 'composition' | 'kind' | null {
  if (item.type === 'composition') return 'composition'
  if (canHoldSpeedCurve(item)) return null
  return 'reversed'
}

/** A small labelled numeric field, committed on blur or Enter. */
function PanelNumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(() => String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])
  const commit = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)))
    else setDraft(String(value))
  }
  return (
    <label className="flex h-6 shrink-0 items-center rounded border border-border/60 bg-background/80 px-1 text-[9px] text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <input
        aria-label={label}
        className="ml-1 w-9 min-w-0 bg-transparent text-right font-mono text-[10px] tabular-nums text-foreground outline-none disabled:opacity-40"
        disabled={disabled}
        inputMode="decimal"
        step={step}
        type="number"
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(String(value))
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

/** The frames a second the clip really has at its slowest point, and the warning below the project's rate. */
function FrameRateReadout({
  curve,
  item,
  fps,
  label,
}: {
  curve: SpeedCurve
  item: TimelineItem
  fps: number
  label: ReturnType<typeof useSpeedCurveLabels>
}) {
  if (item.type !== 'video') return null
  const delivered = slowestFrameRate(curve, item, fps)
  const tooFew = isBelowProjectRate(delivered, fps)
  const smooth = (isFeatureShown('motionBlur') ? item.motionBlur?.smoothSlowMotion : undefined) ?? 'off'
  return (
    <>
      <div
        className="flex items-center justify-between gap-2"
        title={label('editor.speedCurve.deliveredFpsTitle')}
      >
        <span>{label('editor.speedCurve.deliveredFps')}</span>
        <output
          className={`font-mono tabular-nums ${tooFew ? 'text-amber-500' : 'text-foreground'}`}
          data-testid="speed-readout-fps"
        >
          {formatFps(delivered)}
        </output>
      </div>
      {tooFew && (
        <p
          className="mt-0.5 text-[10px] leading-3 text-amber-500"
          data-testid="speed-low-fps-warning"
          role="status"
        >
          {label(LOW_FPS_KEYS[smooth], {
            fps: formatFps(delivered),
            projectFps: formatFps(fps),
          })}
        </p>
      )}
    </>
  )
}

/** One key's row: its clip-relative frame, its speed and the source frame it shows. */
function CurveKeyRow({
  index,
  frame,
  speed,
  sourceFrame,
  pinned,
  ease,
  last,
  onFrameCommit,
  onSpeedCommit,
  onEaseCommit,
}: {
  index: number
  frame: number
  speed: number
  sourceFrame: number
  pinned: boolean
  ease: SpeedEase
  last: boolean
  onFrameCommit: (frame: number) => void
  onSpeedCommit: (speed: number) => void
  onEaseCommit: (ease: SpeedEase) => void
}) {
  const label = useSpeedCurveLabels()
  const frameLabel = `${label('editor.speedCurve.keyFrame')} ${index + 1}`
  const speedLabel = `${label('editor.speedCurve.keySpeed')} ${index + 1}`
  return (
    <div
      data-testid={`speed-key-row-${index}`}
      className="flex items-center gap-1 border-b border-border/40 px-2 py-0.5 text-[10px] text-muted-foreground"
    >
      <span className="w-3 shrink-0 tabular-nums">{index + 1}</span>
      <PanelNumberField
        label={frameLabel}
        value={frame}
        min={0}
        max={1_000_000}
        step={1}
        disabled={pinned}
        onCommit={onFrameCommit}
      />
      <PanelNumberField
        label={speedLabel}
        value={speed}
        min={MIN_CURVE_SPEED}
        max={MAX_CURVE_SPEED}
        step={0.01}
        onCommit={onSpeedCommit}
      />
      <select
        aria-label={`${label('editor.speedCurve.ease')} ${index + 1}`}
        className="h-6 w-[4.5rem] min-w-0 shrink rounded border border-border/60 bg-background/80 px-0.5 text-[10px] text-foreground outline-none disabled:opacity-40"
        data-testid={`speed-key-ease-${index}`}
        disabled={last}
        title={label('editor.speedCurve.easeTitle')}
        value={ease}
        onChange={(event) => onEaseCommit(event.target.value as SpeedEase)}
      >
        {SPEED_EASES.map((name) => (
          <option key={name} value={name}>
            {label(EASE_LABEL_KEYS[name])}
          </option>
        ))}
      </select>
      <span
        className="ml-auto shrink-0 tabular-nums"
        title={label('editor.speedCurve.sourceFrame')}
        data-testid={`speed-key-source-frame-${index}`}
      >
        {sourceFrame}
      </span>
    </div>
  )
}

/** The reason body: the panel's header and why this clip has no curve. */
function SpeedCurveBlockedBody({
  reason,
  onClose,
}: {
  reason: 'reversed' | 'composition' | 'kind'
  onClose: () => void
}) {
  const label = useSpeedCurveLabels()
  const message =
    reason === 'composition'
      ? label('editor.speedCurve.unsupportedComposition')
      : reason === 'reversed'
        ? label('editor.speedCurve.unsupportedReversed')
        : label('editor.speedCurve.unsupportedKind')
  return (
    <div
      data-testid="speed-curve-panel"
      className="flex-shrink-0 border-t border-border bg-background"
      style={{ height: MIN_PANEL_HEIGHT }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-border px-2">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{label('editor.speedCurve.title')}</span>
        <div className="flex-1" />
        <Button
          aria-label={label('editor.speedCurve.close')}
          className="h-6 w-6"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        data-testid="speed-curve-blocked"
        className="flex h-[calc(100%-2.25rem)] items-center justify-center px-4 text-xs text-muted-foreground"
      >
        {message}
      </div>
    </div>
  )
}

/** The dock's body: the panel for one clip, mounted only while the dock is open. */
function SpeedCurvePanelBody({
  itemId,
  onClose,
  propertyColumnWidth,
  timelineScrollContainerRef,
}: {
  itemId: string
  onClose: () => void
  propertyColumnWidth: number
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
}) {
  const label = useSpeedCurveLabels()
  const item = useItemsStore((state) => state.itemById[itemId])
  const fps = useTimelineSettingsStore((state) => state.fps)
  const playhead = useThrottledFrame({ updateDuringPlayback: true, throttleMs: 100 })
  const pixelsPerSecond = useZoomStore((state) => state.contentPixelsPerSecond)
  const viewportWidth = useTimelineViewportStore((state) => state.viewportWidth)
  const { scrollLeft } = useSettledTimelineGeometry(
    timelineScrollContainerRef,
    true,
    pixelsPerSecond,
  )
  const [peak, setPeak] = useState(DEFAULT_PEAK)
  const [rampFrames, setRampFrames] = useState(DEFAULT_RAMP_FRAMES)
  const panelRef = useRef<HTMLDivElement>(null)
  const [timelinePaneHeight, setTimelinePaneHeight] = useState(0)

  useEffect(() => {
    // The dock may not eat the timeline: it takes at most a share of the pane it is docked in,
    // and the graph follows that height (design 7.1, section 4.8). A taller pane keeps the default.
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const update = () => setTimelinePaneHeight(parent.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  const curve = useMemo<SpeedCurve | null>(
    () => (item ? curveOnItem(item) : null),
    [item],
  )
  const rows = useMemo(() => (item ? curveKeyRows(curve ?? { keys: [] }, item, fps) : []), [
    curve,
    fps,
    item,
  ])
  const { draggingIndex, beginDrag } = useSpeedCurveKeyDrag({ itemId, fps, pixelsPerSecond })
  const keyframePanelOpen = useSelectionStore((state) => state.editKeyframePanelOpen)

  useEffect(() => {
    // The clip went away (deleted, or the tab switched): the dock has nothing to show.
    if (!item) onClose()
  }, [item, onClose])

  useEffect(() => {
    // One dock at a time: the keyframe editor and this panel share the timeline's bottom, and two
    // of them would take more room than the pane has. "Curve…" closes the keyframe dock first, so
    // this only closes the curve dock when the user opens the keyframe editor.
    if (keyframePanelOpen) onClose()
  }, [keyframePanelOpen, onClose])

  if (!item || !curve) return null
  const blocked = blockedReason(item)
  if (blocked !== null) return <SpeedCurveBlockedBody reason={blocked} onClose={onClose} />

  const cappedHeight =
    timelinePaneHeight > 0
      ? Math.max(
          MIN_PANEL_HEIGHT,
          Math.min(DEFAULT_PANEL_HEIGHT, Math.floor(timelinePaneHeight * MAX_PANEL_RATIO)),
        )
      : DEFAULT_PANEL_HEIGHT
  const plotHeight = plotHeightFor(cappedHeight)
  const panelHeight =
    HEADER_HEIGHT + plotHeight + SPEED_GRAPH_ROWS_HEIGHT + PANEL_FOOTER_SPACE
  const duration = Math.max(1, Math.round(item.durationInFrames))
  const readout = speedAtPlayhead(curve, playhead, item)
  const sourceFrames = sourceFramesUsed(curve, item, fps)
  const playheadRelative = playhead - item.from
  const playheadInClip = playheadRelative >= 0 && playheadRelative < duration
  const playheadSourceFrame = playheadInClip
    ? keySourceFrame(curve, Math.round(playheadRelative), item, fps)
    : null

  const commitCurve = (next: SpeedCurve) => {
    setSpeedCurve(item.id, next)
  }

  const commitSpeed = (index: number, speed: number) => {
    const current = useItemsStore.getState().itemById[item.id]
    if (!current) return
    commitCurve(withKeySpeed(curveOnItem(current), index, roundCurveSpeed(speed)))
  }

  const commitFrame = (index: number, frame: number) => {
    const current = useItemsStore.getState().itemById[item.id]
    if (!current) return
    commitCurve(withKeyFrame(curveOnItem(current), index, frame))
  }

  const commitEase = (index: number, ease: SpeedEase) => {
    const current = useItemsStore.getState().itemById[item.id]
    if (!current) return
    commitCurve(withKeyEase(curveOnItem(current), index, ease))
  }

  const applyPreset = (preset: SpeedPresetName) => {
    commitCurve(speedPresetCurve(preset, duration, peak, rampFrames))
  }

  // `setSpeedCurve` with null is the action's "no curve, one speed at the average" (design 4.9).
  const flat = () => setSpeedCurve(item.id, null)

  return (
    <div
      ref={panelRef}
      data-testid="speed-curve-panel"
      className="flex-shrink-0 border-t border-border bg-background"
      style={{ height: panelHeight }}
    >
      <div className="flex h-9 items-center gap-2 overflow-hidden border-b border-border px-2">
        <Gauge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium">{label('editor.speedCurve.title')}</span>
        <PanelNumberField
          label={label('editor.speedCurve.peakSpeed')}
          value={peak}
          min={MIN_CURVE_SPEED}
          max={MAX_CURVE_SPEED}
          step={0.1}
          onCommit={(value) => setPeak(clampCurveSpeed(value))}
        />
        <PanelNumberField
          label={label('editor.speedCurve.rampLength')}
          value={rampFrames}
          min={1}
          max={duration}
          step={1}
          onCommit={(value) => setRampFrames(Math.round(value))}
        />
        {SPEED_PRESET_NAMES.map((preset) => (
          <Button
            key={preset}
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => applyPreset(preset)}
            size="sm"
            variant="secondary"
          >
            {label(PRESET_LABEL_KEYS[preset])}
          </Button>
        ))}
        <Button
          className="h-6 shrink-0 px-2 text-[11px]"
          disabled={!canHoldSmoothEdit(item)}
          onClick={() => smoothEditClip(item.id, { peak: Math.max(1, peak) })}
          size="sm"
          title={label('editor.speedCurve.smoothEditTitle')}
          variant="secondary"
        >
          {label('editor.speedCurve.smoothEdit')}
        </Button>
        <Button className="h-6 shrink-0 px-2 text-[11px]" onClick={flat} size="sm" variant="ghost">
          {label('editor.speedCurve.flat')}
        </Button>
        <div className="flex-1" />
        <Button
          aria-label={label('editor.speedCurve.close')}
          className="h-6 w-6 shrink-0"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex" style={{ height: panelHeight - HEADER_HEIGHT }}>
        <div
          className="flex min-h-0 flex-col border-r border-border"
          style={{ width: propertyColumnWidth }}
        >
          <div className="border-b border-border/60 px-2 py-1 text-[10px] leading-4 text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>{label('editor.speedCurve.atPlayhead')}</span>
              <output
                className="font-mono tabular-nums text-foreground"
                data-testid="speed-readout-speed"
              >
                {`${readout.speed.toFixed(2)}×`}
              </output>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{label('editor.speedCurve.duration')}</span>
              <output
                className="font-mono tabular-nums text-foreground"
                data-testid="speed-readout-duration"
              >
                {duration}
              </output>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{label('editor.speedCurve.sourceFrames')}</span>
              <output
                className="font-mono tabular-nums text-foreground"
                data-testid="speed-readout-source"
              >
                {sourceFrames}
              </output>
            </div>
            <FrameRateReadout curve={curve} item={item} fps={fps} label={label} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="speed-curve-keys">
            {rows.map((row, index) => (
              <CurveKeyRow
                key={`${row.frame}-${index}`}
                frame={row.frame}
                index={index}
                pinned={row.pinned}
                sourceFrame={row.sourceFrame}
                speed={row.speed}
                ease={row.ease}
                last={index === rows.length - 1}
                onFrameCommit={(frame) => commitFrame(index, frame)}
                onSpeedCommit={(speed) => commitSpeed(index, speed)}
                onEaseCommit={(ease) => commitEase(index, ease)}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden pt-1">
          <SpeedCurveGraph
            clipFrom={item.from}
            curve={curve}
            draggingIndex={draggingIndex}
            duration={duration}
            fps={fps}
            label={label('editor.speedCurve.title')}
            pixelsPerSecond={pixelsPerSecond}
            plotHeight={plotHeight}
            playhead={playhead}
            scrollLeft={scrollLeft}
            sourceFrameAtPlayhead={playheadSourceFrame}
            sourceFramesByKey={rows.map((row) => row.sourceFrame)}
            viewportWidth={viewportWidth}
            onKeyPointerDown={beginDrag}
          />
        </div>
      </div>
    </div>
  )
}

interface SpeedCurvePanelProps {
  /** The clip whose curve the dock shows, or null when the dock is closed. */
  itemId: string | null
  /** Close the dock. */
  onClose: () => void
  /** Width of the timeline's track-header column, so the graph lines up with the timeline content. */
  propertyColumnWidth: number
  /** The timeline's scroll container, which the graph's x axis follows. */
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
}

/**
 * The speed curve dock. It has no hooks before the open check, so a closed dock mounts nothing and
 * the timeline keeps its room.
 */
export function SpeedCurvePanel({
  itemId,
  onClose,
  propertyColumnWidth,
  timelineScrollContainerRef,
}: SpeedCurvePanelProps) {
  if (itemId === null) return null
  return (
    <SpeedCurvePanelBody
      itemId={itemId}
      onClose={onClose}
      propertyColumnWidth={propertyColumnWidth}
      timelineScrollContainerRef={timelineScrollContainerRef}
    />
  )
}
