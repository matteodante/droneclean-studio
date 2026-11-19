import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompositionItem, VideoItem } from '@/types/timeline'
import { makeTimelineTrack, makeTimelineVideoItem, setTimelineState } from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineViewportStore } from '@/features/timeline/stores/timeline-viewport-store'
import { useZoomStore } from '@/features/timeline/stores/zoom-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { areaAt, averageSpeed, type SpeedCurve } from '@/studio/speed'
import { SpeedCurvePanel } from './speed-curve-panel'
import { useSpeedCurvePanelStore } from './panel-store'
import { plotYToSpeed } from './graph-geometry'
import { roundCurveSpeed } from './curve-on-item'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

/** The design's 10-second ramp: 1x, up to 4x by frame 30, held, down to 1x at 600. */
const RAMP: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

/** The source frames the ramp spends at equal rates (design 7.1, section 5.2). */
const RAMP_SOURCE_FRAMES = 2_310

/** The clip that carries the ramp; the downstream clip sits after it on the same track. */
function rampItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return makeTimelineVideoItem({
    id: 'clip',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 600,
    sourceStart: 0,
    sourceEnd: RAMP_SOURCE_FRAMES,
    sourceDuration: 4_000,
    sourceFps: 30,
    speed: averageSpeed(RAMP),
    speedCurve: RAMP,
    ...overrides,
  })
}

function downstreamItem(): VideoItem {
  return makeTimelineVideoItem({
    id: 'after',
    trackId: 'track-v1',
    from: 620,
    durationInFrames: 80,
    sourceStart: 0,
    sourceEnd: 80,
    sourceDuration: 4_000,
    sourceFps: 30,
  })
}

/** Seed the stores with the ramp clip (and optionally the downstream one) and the panel's geometry. */
function seed(items: VideoItem[], options: { scrollLeft?: number } = {}): void {
  setTimelineState({
    items,
    tracks: [makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })],
    fps: 30,
  })
  useTimelineViewportStore.setState({ scrollLeft: options.scrollLeft ?? 0, viewportWidth: 800 })
  useZoomStore.setState({ pixelsPerSecond: 100, contentPixelsPerSecond: 100 })
  usePlaybackStore.setState({ currentFrame: 0, isPlaying: false })
  useSelectionStore.setState({ editKeyframePanelOpen: false })
  useTimelineCommandStore.getState().clearHistory()
}

/** Give the SVG a real box, as the browser does and jsdom does not. */
function mockPlotBox(): SVGSVGElement {
  const svg = screen.getByTestId('speed-curve-graph') as unknown as SVGSVGElement
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 184,
      width: 800,
      height: 184,
      toJSON: () => ({}),
    }),
  })
  return svg
}

function curveOf(id = 'clip'): SpeedCurve {
  const curve = useItemsStore.getState().itemById[id]?.speedCurve
  if (!curve) throw new Error(`${id} has no curve`)
  return curve
}

function renderPanel(onClose = vi.fn()) {
  return render(
    <SpeedCurvePanel
      itemId="clip"
      onClose={onClose}
      propertyColumnWidth={200}
      timelineScrollContainerRef={undefined}
    />,
  )
}

describe('SpeedCurvePanel', () => {
  beforeEach(() => {
    useSpeedCurvePanelStore.setState({ itemId: null })
    vi.restoreAllMocks()
  })

  it('draws one handle per key, at the frame the timeline shows it under', () => {
    seed([rampItem()])
    renderPanel()

    expect(screen.getAllByTestId(/^speed-key-handle-/)).toHaveLength(4)
    // Frame 30 at 100 px/s and 30 fps is 100 px to the right of the timeline content's edge.
    const circle = screen.getByTestId('speed-key-handle-1').querySelector('circle')!
    expect(circle.getAttribute('cx')).toBe('100')
    expect(screen.getAllByTestId(/^speed-key-row-/)).toHaveLength(4)
  })

  it('follows the timeline scroll, the container the keyframe editor takes', () => {
    seed([rampItem()], { scrollLeft: 50 })
    const container = document.createElement('div')
    container.scrollLeft = 50
    render(
      <SpeedCurvePanel
        itemId="clip"
        propertyColumnWidth={200}
        timelineScrollContainerRef={{ current: container }}
        onClose={vi.fn()}
      />,
    )

    const circle = screen.getByTestId('speed-key-handle-1').querySelector('circle')!
    expect(circle.getAttribute('cx')).toBe('50')
  })

  it('reads the speed at the playhead, the clip duration and the source frames from the curve', () => {
    seed([rampItem({ from: 100 })])
    usePlaybackStore.setState({ currentFrame: 115 })
    renderPanel()

    // The ramp is linear from (0, 1x) to (30, 4x): at frame 15 it holds 2.5x.
    expect(screen.getByTestId('speed-readout-speed')).toHaveTextContent('2.50×')
    expect(screen.getByTestId('speed-readout-duration')).toHaveTextContent('600')
    expect(areaAt(RAMP, 600)).toBe(RAMP_SOURCE_FRAMES)
    expect(screen.getByTestId('speed-readout-source')).toHaveTextContent(String(RAMP_SOURCE_FRAMES))
  })

  it('labels each key with its source frame, and the playhead with the source frame it shows', () => {
    seed([rampItem()])
    usePlaybackStore.setState({ currentFrame: 15 })
    renderPanel()

    expect(screen.getByTestId('speed-key-source-frame-1')).toHaveTextContent(
      String(Math.floor(areaAt(RAMP, 30))),
    )
    // The playhead at frame 15 reads the integral's source frame, floored like the renderer.
    expect(screen.getByTestId('speed-playhead-source')).toHaveTextContent(
      String(Math.floor(areaAt(RAMP, 15))),
    )
  })

  it('pins the first and last keys to the clip ends', () => {
    seed([rampItem()])
    renderPanel()

    const firstRow = screen.getByTestId('speed-key-row-0')
    const lastRow = screen.getByTestId('speed-key-row-3')
    for (const row of [firstRow, lastRow]) {
      const inputs = within(row).getAllByRole('spinbutton')
      expect(inputs[0]).toBeDisabled()
    }
    // A horizontal drag on the last key leaves its frame at the clip's end.
    mockPlotBox()
    const handle = screen.getByTestId('speed-key-handle-3')
    fireEvent.pointerDown(handle, { clientX: 2_000, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 2_200, clientY: 70, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    const keys = curveOf().keys
    expect(keys[keys.length - 1]?.frame).toBe(
      useItemsStore.getState().itemById['clip']!.durationInFrames,
    )
    expect(keys[0]?.frame).toBe(0)
  })

  it('moves the clip and the clips after it while a key is dragged, and adds one undo step on release', () => {
    seed([rampItem(), downstreamItem()])
    renderPanel()
    mockPlotBox()

    const startDuration = useItemsStore.getState().itemById['clip']!.durationInFrames
    const startDownstream = useItemsStore.getState().itemById['after']!.from

    // Drag the 4x key down the graph: a slower shape averages less, so the clip takes more frames.
    fireEvent.pointerDown(screen.getByTestId('speed-key-handle-1'), {
      button: 0,
      clientX: 100,
      clientY: 90,
      pointerId: 1,
    })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 130, pointerId: 1 })

    // The live feedback: the store already follows the pointer, with no undo entry yet.
    const liveDuration = useItemsStore.getState().itemById['clip']!.durationInFrames
    expect(liveDuration).toBeGreaterThan(startDuration)
    expect(useItemsStore.getState().itemById['after']!.from).toBe(
      startDownstream + (liveDuration - startDuration),
    )
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)

    fireEvent.pointerUp(window, { pointerId: 1 })

    // One release, one entry: the drag's whole preview.
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(useTimelineCommandStore.getState().undoStack[0]?.command.type).toBe('SET_SPEED_CURVE')

    const edited = useItemsStore.getState().itemById['clip']!
    // The pointer's y is the key's speed on the graph's own axis.
    const plotHeight = Number(
      screen.getByTestId('speed-curve-graph').getAttribute('data-plot-height'),
    )
    expect(edited.speedCurve?.keys[1]?.speed).toBeCloseTo(
      roundCurveSpeed(plotYToSpeed(130, plotHeight)),
      6,
    )

    useTimelineCommandStore.getState().undo()

    const restored = useItemsStore.getState().itemById['clip']!
    expect(restored.durationInFrames).toBe(startDuration)
    expect(restored.speedCurve?.keys).toEqual(RAMP.keys)
    expect(useItemsStore.getState().itemById['after']!.from).toBe(startDownstream)
  })

  it('applies a preset in one undo step, with the design keys scaled to the length it needs', () => {
    seed([
      rampItem({
        durationInFrames: 600,
        speed: 1,
        speedCurve: undefined,
        sourceEnd: 600,
      }),
    ])
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'editor.speedCurve.rampIn' }))

    const edited = useItemsStore.getState().itemById['clip']!
    const curve = curveOf()
    // The ramp-in shape: 1x at 0, 4x from r to the end; the action keeps the source span and
    // takes the length the average needs, so the keys scale with it.
    expect(curve.keys.map((key) => key.speed)).toEqual([1, 4, 4])
    const duration = edited.durationInFrames
    expect(curve.keys[0]?.frame).toBe(0)
    expect(curve.keys[1]?.frame).toBe(Math.round((15 / 600) * duration))
    expect(curve.keys[2]?.frame).toBe(duration)
    expect(edited.speed).toBeCloseTo(averageSpeed(curve), 9)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().itemById['clip']!.durationInFrames).toBe(600)
    expect(useItemsStore.getState().itemById['clip']!.speedCurve).toBeUndefined()
  })

  it('removes the curve with Flat, in one undo step', () => {
    seed([rampItem()])
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'editor.speedCurve.flat' }))

    expect(useItemsStore.getState().itemById['clip']!.speedCurve).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().itemById['clip']!.speedCurve?.keys).toEqual(RAMP.keys)
  })

  it('types a key speed: the curve keeps the edit, one undo step', () => {
    seed([rampItem()])
    renderPanel()

    const row = screen.getByTestId('speed-key-row-1')
    const speedInput = within(row).getAllByRole('spinbutton')[1]!
    fireEvent.change(speedInput, { target: { value: '2' } })
    fireEvent.blur(speedInput)

    expect(curveOf().keys.map((key) => key.speed)).toEqual([1, 2, 4, 1])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('closes when the keyframe editor opens: the two docks share the bottom', () => {
    seed([rampItem()])
    const onClose = vi.fn()
    useSelectionStore.setState({ editKeyframePanelOpen: true })

    renderPanel(onClose)

    expect(onClose).toHaveBeenCalled()
  })

  it('says why a reversed clip has no curve, and offers no controls', () => {
    seed([rampItem({ id: 'clip', speedCurve: undefined, isReversed: true })])
    renderPanel()

    expect(screen.getByTestId('speed-curve-blocked')).toHaveTextContent(
      'editor.speedCurve.unsupportedReversed',
    )
    expect(screen.queryByTestId('speed-curve-graph')).not.toBeInTheDocument()
  })

  it('says why a composition wrapper has no curve', () => {
    const composition: CompositionItem = {
      id: 'comp',
      type: 'composition',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 120,
      label: 'Compound',
      compositionId: 'nested-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
    }
    setTimelineState({
      items: [composition],
      tracks: [makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })],
      fps: 30,
    })
    render(
      <SpeedCurvePanel itemId="comp" onClose={vi.fn()} propertyColumnWidth={200} />,
    )

    expect(screen.getByTestId('speed-curve-blocked')).toHaveTextContent(
      'editor.speedCurve.unsupportedComposition',
    )
    expect(screen.queryByTestId('speed-curve-graph')).not.toBeInTheDocument()
  })
})
