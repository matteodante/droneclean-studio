// The stabilization section: hidden while its switch is off; with it on, the switch and each control are one undo
// step with the right settings, a clip with no motion data gets the message instead of the controls, and a value
// outside the allowed range is not stored.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { i18n } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { NoLensProfileError, NoMotionDataError } from '../client'
import type { SmoothingMethod, StabilizationSettings } from '../settings'
import type { StabilizationEngine } from './engine'
import { StabilizationSection } from './StabilizationSection'

const switchState = vi.hoisted(() => ({ shown: true }))
vi.mock('@/studio/feature-switches', () => ({
  isFeatureShown: () => switchState.shown,
}))

beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      editor: {
        stabilization: {
          title: 'Stabilization',
          enable: 'Stabilize',
          smoothness: 'Smoothness',
          horizonLock: 'Horizon lock',
          horizonRoll: 'Horizon roll',
          zoom: 'Zoom',
          adaptiveZoom: 'Adaptive zoom',
          lens: 'Lens',
          noMotionData: 'This clip has no motion data',
          noLensProfile: 'This clip has no lens profile',
          failed: 'Could not stabilize: {{reason}}',
          progress: { starting: 'Opening', reading: '{{read}} of {{total}} MB', smoothing: 'Computing' },
        },
      },
    },
    true,
    true,
  )
})

const METHODS: SmoothingMethod[] = [
  {
    name: 'Default',
    params: [{ name: 'smoothness', description: 'Smoothness', default: 0.5, min: 0.001, max: 1, unit: '' }],
  },
]

const ON: StabilizationSettings = {
  enabled: true,
  method: 'Default',
  params: { smoothness: 0.5 },
  fov: 1,
  horizonLockPercent: 0,
  horizonLockRoll: 0,
  adaptiveZoomSeconds: 4,
}

function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    label: 'DJI_0020.MP4',
    mediaId: 'media-1',
    src: 'blob:clip-1',
    from: 0,
    durationInFrames: 600,
    sourceFps: 59.94,
    ...extra,
  }
}

const TEXT: TextItem = {
  id: 'text-1',
  trackId: 'track-1',
  type: 'text',
  label: 'Title',
  text: 'Hello',
  color: '#ffffff',
  from: 0,
  durationInFrames: 60,
}

function makeEngine(overrides: Partial<StabilizationEngine> = {}) {
  return {
    smoothingMethods: vi.fn(async () => METHODS),
    probe: vi.fn(async () => ({ name: 'Avata 2 4K', model: 'opencv_fisheye' })),
    applySettings: vi.fn(async () => {}),
    ...overrides,
  } satisfies StabilizationEngine
}

/** The panel's wiring: the item comes from the store, so a change comes back as a new selection */
function StoreHarness({ itemId, engine }: { itemId: string; engine: StabilizationEngine }) {
  const item = useItemsStore((state) => state.itemById[itemId])
  return item ? (
    <TooltipProvider>
      <StabilizationSection items={[item]} engine={engine} />
    </TooltipProvider>
  ) : null
}

function renderStored(item: TimelineItem, engine: StabilizationEngine) {
  useItemsStore.getState().setItems([item])
  return render(<StoreHarness itemId={item.id} engine={engine} />)
}

function stored(): StabilizationSettings | undefined {
  return (useItemsStore.getState().itemById['clip-1'] as VideoItem | undefined)?.stabilization
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

/** Commits a number box the way a user does: type, then Enter */
function typeInto(testId: string, value: string) {
  const input = screen.getByTestId(testId).querySelector('input') as HTMLInputElement
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('StabilizationSection', () => {
  beforeEach(() => {
    switchState.shown = true
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
  })

  it('renders nothing while the switch is off, and for a selection with no video clip', () => {
    switchState.shown = false
    const off = renderStored(clip({ stabilization: ON }), makeEngine())
    expect(off.container.textContent).toBe('')
    off.unmount()

    switchState.shown = true
    const text = renderStored(TEXT, makeEngine())
    expect(text.container.textContent).toBe('')
  })

  it('switches a clip on after the engine says it can be stabilized: one undo step, with the defaults', async () => {
    const engine = makeEngine()
    renderStored(clip(), engine)
    expect(screen.queryByTestId('stabilization-controls')).toBeNull()

    fireEvent.click(screen.getByTestId('stabilization-enabled'))

    await waitFor(() => expect(stored()?.enabled).toBe(true))
    expect(stored()).toMatchObject({ method: 'Default', params: { smoothness: 0.5 }, fov: 1, adaptiveZoomSeconds: 4 })
    expect(undoDepth()).toBe(1)
    expect(engine.probe).toHaveBeenCalledTimes(1)
    expect(engine.applySettings).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('stabilization-controls')).toBeTruthy()
    expect(screen.getByTestId('stabilization-lens').textContent).toBe('Avata 2 4K')

    act(() => useTimelineCommandStore.getState().undo())
    expect(stored()).toBeUndefined()
  })

  it('switches a clip off: one undo step, the settings kept', async () => {
    renderStored(clip({ stabilization: { ...ON, fov: 1.3 } }), makeEngine())

    fireEvent.click(screen.getByTestId('stabilization-enabled'))

    await waitFor(() => expect(stored()?.enabled).toBe(false))
    expect(stored()?.fov).toBe(1.3)
    expect(undoDepth()).toBe(1)
    expect(screen.queryByTestId('stabilization-controls')).toBeNull()
  })

  it('shows the message instead of the controls for a clip with no motion data, and stores nothing', async () => {
    const engine = makeEngine({
      probe: vi.fn(async () => {
        throw new NoMotionDataError()
      }),
    })
    renderStored(clip(), engine)

    fireEvent.click(screen.getByTestId('stabilization-enabled'))

    expect((await screen.findByTestId('stabilization-no-motion-data')).textContent).toBe(
      'This clip has no motion data',
    )
    expect(screen.queryByTestId('stabilization-controls')).toBeNull()
    expect(stored()).toBeUndefined()
    expect(undoDepth()).toBe(0)
    expect(engine.applySettings).not.toHaveBeenCalled()
  })

  it('shows the lens message for a clip with no lens profile', async () => {
    renderStored(
      clip(),
      makeEngine({
        probe: vi.fn(async () => {
          throw new NoLensProfileError()
        }),
      }),
    )

    fireEvent.click(screen.getByTestId('stabilization-enabled'))

    expect(await screen.findByTestId('stabilization-no-lens-profile')).toBeTruthy()
    expect(stored()).toBeUndefined()
  })

  it('shows the engine’s own words for any other failure', async () => {
    renderStored(
      clip(),
      makeEngine({
        probe: vi.fn(async () => {
          throw new Error('boom')
        }),
      }),
    )

    fireEvent.click(screen.getByTestId('stabilization-enabled'))

    expect((await screen.findByTestId('stabilization-failed')).textContent).toBe('Could not stabilize: boom')
  })

  it('stores the zoom and the adaptive window as one undo step each', async () => {
    const engine = makeEngine()
    renderStored(clip({ stabilization: ON }), engine)
    await screen.findByTestId('stabilization-controls')

    typeInto('stabilization-fov', '1.25')
    await waitFor(() => expect(stored()?.fov).toBe(1.25))
    expect(undoDepth()).toBe(1)

    typeInto('stabilization-adaptive-zoom', '2')
    await waitFor(() => expect(stored()?.adaptiveZoomSeconds).toBe(2))
    expect(undoDepth()).toBe(2)
    expect(stored()).toMatchObject({ fov: 1.25, adaptiveZoomSeconds: 2, horizonLockPercent: 0 })
    expect(engine.applySettings).toHaveBeenCalledTimes(2)
  })

  it('does not store a zoom of 0 or less, and a negative adaptive window is held at its minimum of 0', async () => {
    renderStored(clip({ stabilization: ON }), makeEngine())
    await screen.findByTestId('stabilization-controls')

    typeInto('stabilization-fov', '0')
    typeInto('stabilization-fov', '-2')
    expect(stored()).toMatchObject({ fov: 1, adaptiveZoomSeconds: 4 })
    expect(undoDepth()).toBe(0)

    typeInto('stabilization-adaptive-zoom', '-3')
    await waitFor(() => expect(stored()?.adaptiveZoomSeconds).toBe(0))
    expect(undoDepth()).toBe(1)
  })

  it('stores a slider once, on release, with the value it ended on', async () => {
    renderStored(clip({ stabilization: ON }), makeEngine())
    await screen.findByTestId('stabilization-controls')
    const track = screen.getByTestId('stabilization-horizon-percent').querySelector('.touch-none') as HTMLElement
    track.getBoundingClientRect = () =>
      ({ left: 0, right: 100, width: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON() {} }) as DOMRect
    track.setPointerCapture = () => {}

    fireEvent.pointerDown(track, { clientX: 10, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: 40, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: 70, clientY: 0, pointerId: 1 })
    expect(undoDepth()).toBe(0)
    fireEvent.pointerUp(track, { clientX: 70, clientY: 0, pointerId: 1 })

    await waitFor(() => expect(stored()?.horizonLockPercent).toBe(70))
    expect(undoDepth()).toBe(1)
  })

  /** Drags a slider's thumb from its left edge to `percent` of its width and lets go */
  function dragSlider(testId: string, percent: number) {
    const track = screen.getByTestId(testId).querySelector('.touch-none') as HTMLElement
    track.getBoundingClientRect = () =>
      ({ left: 0, right: 100, width: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON() {} }) as DOMRect
    track.setPointerCapture = () => {}
    fireEvent.pointerDown(track, { clientX: percent, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: percent, clientY: 0, pointerId: 1 })
  }

  it('changes smoothness, horizon lock, roll and zoom one undo step each, and undoes each in turn', async () => {
    const engine = makeEngine()
    renderStored(clip({ stabilization: ON }), engine)
    await screen.findByTestId('stabilization-controls')

    dragSlider('stabilization-smoothness', 80)
    await waitFor(() => expect(stored()?.params.smoothness).not.toBe(0.5))
    const smoothness = stored()!.params.smoothness
    expect(smoothness).toBeGreaterThan(0.5)
    dragSlider('stabilization-horizon-percent', 60)
    await waitFor(() => expect(stored()?.horizonLockPercent).toBe(60))
    dragSlider('stabilization-horizon-roll', 75)
    await waitFor(() => expect(stored()?.horizonLockRoll).not.toBe(0))
    const roll = stored()!.horizonLockRoll
    typeInto('stabilization-fov', '1.4')
    await waitFor(() => expect(stored()?.fov).toBe(1.4))
    expect(undoDepth()).toBe(4)
    // every change reached the engine the renderer draws with, with the whole settings
    expect(engine.applySettings).toHaveBeenCalledTimes(4)
    expect(vi.mocked(engine.applySettings).mock.calls.at(-1)?.[1]).toMatchObject({
      params: { smoothness },
      horizonLockPercent: 60,
      horizonLockRoll: roll,
      fov: 1.4,
    })

    const undo = () => act(() => useTimelineCommandStore.getState().undo())
    undo()
    expect(stored()?.fov).toBe(1)
    undo()
    expect(stored()?.horizonLockRoll).toBe(0)
    undo()
    expect(stored()?.horizonLockPercent).toBe(0)
    undo()
    expect(stored()?.params.smoothness).toBe(0.5)
    expect(undoDepth()).toBe(0)
  })

  it('does not add an undo step when a control commits the value it already holds (Enter, then blur)', async () => {
    const engine = makeEngine()
    renderStored(clip({ stabilization: ON }), engine)
    await screen.findByTestId('stabilization-controls')

    // Enter and the blur it causes arrive in one event, before React has drawn the first commit
    const input = screen.getByTestId('stabilization-fov').querySelector('input') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1.25' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })
    await waitFor(() => expect(stored()?.fov).toBe(1.25))
    expect(undoDepth()).toBe(1)
    expect(engine.applySettings).toHaveBeenCalledTimes(1)
  })

  describe('the framing keyframes (task 11.23)', () => {
    const lane = (property: string) =>
      useKeyframesStore.getState().keyframesByItemId['clip-1']?.properties.find((entry) => entry.property === property)
        ?.keyframes ?? []

    beforeEach(() => {
      useKeyframesStore.getState().setKeyframes([])
      usePlaybackStore.getState().setCurrentFrame(0)
    })

    it('stores a drag on a framing slider as the clip setting while the lane has no keyframe', async () => {
      renderStored(clip({ stabilization: ON }), makeEngine())
      await screen.findByTestId('stabilization-controls')
      dragSlider('stabilization-framing-x', 75)
      await waitFor(() => expect(stored()?.framingX).toBeCloseTo(0.5, 5))
      expect(lane('framingX')).toEqual([])
    })

    it('has a diamond that adds a keyframe at the playhead with the value shown, and removes it', async () => {
      renderStored(clip({ stabilization: { ...ON, framingX: 0.3 } }), makeEngine())
      await screen.findByTestId('stabilization-controls')
      usePlaybackStore.getState().setCurrentFrame(20)
      const diamond = () =>
        screen.getByTestId('stabilization-framing-x').querySelector('button') as HTMLButtonElement
      await waitFor(() => expect(diamond().disabled).toBe(false))
      fireEvent.click(diamond())
      await waitFor(() => expect(lane('framingX')).toHaveLength(1))
      expect(lane('framingX')[0]).toMatchObject({ frame: 20, value: 0.3 })
      expect(lane('framingY')).toEqual([])
      fireEvent.click(diamond())
      await waitFor(() => expect(lane('framingX')).toEqual([]))
    })

    it('shows the animated value at the playhead and stores a drag there as a keyframe, not as the setting', async () => {
      renderStored(clip({ stabilization: { ...ON, framingX: 0.3 } }), makeEngine())
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'clip-1',
          properties: [
            {
              property: 'framingX',
              keyframes: [
                { id: 'a', frame: 0, value: -1, easing: 'linear' },
                { id: 'b', frame: 100, value: 1, easing: 'linear' },
              ],
            },
          ],
        },
      ])
      await screen.findByTestId('stabilization-controls')
      usePlaybackStore.getState().setCurrentFrame(50)
      // Half way between -1 and 1 is 0, not the stored 0.3 (the slider's number reads it)
      await waitFor(() =>
        expect(Number(screen.getByTestId('stabilization-framing-x').textContent)).toBe(0),
      )
      dragSlider('stabilization-framing-x', 90)
      await waitFor(() => expect(lane('framingX')).toHaveLength(3))
      expect(lane('framingX').find((keyframe) => keyframe.frame === 50)?.value).toBeCloseTo(0.8, 5)
      // The setting is what the lane has where it has no keyframe: untouched
      expect(stored()?.framingX).toBe(0.3)
    })
  })
})
