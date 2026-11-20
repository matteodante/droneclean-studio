// The clip panel's motion blur rows: hidden while their switch is off and for a clip that cannot
// carry blur; with the switch on, the clip's switch, each amount and each smooth slow motion choice are one undo step.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MotionBlurRows } from './MotionBlurRows'

const switchState = vi.hoisted(() => ({ shown: true }))
vi.mock('@/studio/feature-switches', () => ({
  isFeatureShown: () => switchState.shown,
}))

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

/** The panel's wiring: the item comes from the store, so a change comes back as a new selection */
function StoreHarness({ itemId }: { itemId: string }) {
  const item = useItemsStore((state) => state.itemById[itemId])
  // the app's root gives every tooltip its provider (`app.tsx`); the optical-flow rows' labels have tooltips
  return item ? (
    <TooltipProvider>
      <MotionBlurRows items={[item]} />
    </TooltipProvider>
  ) : null
}

function renderStored(item: TimelineItem) {
  useItemsStore.getState().setItems([item])
  return render(<StoreHarness itemId={item.id} />)
}

function stored(): VideoItem['motionBlur'] {
  return (useItemsStore.getState().itemById['clip-1'] as VideoItem | undefined)?.motionBlur
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

describe('MotionBlurRows', () => {
  beforeAll(() => {
    // jsdom has no pointer capture or scrolling, which the Radix select asks for when it opens
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.hasPointerCapture ??= () => false
    proto.setPointerCapture ??= () => undefined
    proto.releasePointerCapture ??= () => undefined
    proto.scrollIntoView ??= () => undefined
  })

  beforeEach(() => {
    switchState.shown = true
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
  })

  it('renders nothing while the feature switch is off', () => {
    switchState.shown = false
    const off = renderStored(clip({ motionBlur: { shutterDegrees: 180 } }))
    expect(off.container.textContent).toBe('')
  })

  it('renders nothing for a text clip, a reversed clip and a composition wrapper', () => {
    const text = renderStored(TEXT)
    expect(text.container.textContent).toBe('')
    text.unmount()
    const reversed = renderStored(clip({ isReversed: true }))
    expect(reversed.container.textContent).toBe('')
    reversed.unmount()
    const wrapper = renderStored(clip({ compositionId: 'comp-1' }))
    expect(wrapper.container.textContent).toBe('')
  })

  it('shows the switch alone while blur is off, and the hint at 4x', () => {
    renderStored(clip({ speed: 4 }))
    expect(screen.getByTestId('motion-blur-enabled')).toBeTruthy()
    expect(screen.queryByTestId('motion-blur-amount')).toBeNull()
    expect(screen.getByTestId('motion-blur-hint').textContent).toContain('4')
  })

  it('switches blur on at 180 degrees, RSMB 0.5: one undo step, undone in one press', () => {
    renderStored(clip({ speed: 4 }))

    fireEvent.click(screen.getByTestId('motion-blur-enabled'))

    expect(stored()).toEqual({ shutterDegrees: 180 })
    expect(undoDepth()).toBe(1)
    expect(screen.getByTestId('motion-blur-amount').textContent).toContain('0.50 · 180°')

    act(() => useTimelineCommandStore.getState().undo())
    expect(stored()).toBeUndefined()
  })

  it('switches blur off: one undo step, and the field is removed', () => {
    renderStored(clip({ speed: 4, motionBlur: { shutterDegrees: 180 } }))

    fireEvent.click(screen.getByTestId('motion-blur-enabled'))

    expect(stored()).toBeUndefined()
    expect(undoDepth()).toBe(1)
    expect(screen.queryByTestId('motion-blur-amount')).toBeNull()
  })

  it('shows the amount at 1x too, with no note that it does nothing (the blur acts at every speed)', () => {
    renderStored(clip({ motionBlur: { shutterDegrees: 90 } }))
    expect(screen.getByTestId('motion-blur-amount').textContent).toContain('0.25 · 90°')
    expect(screen.queryByTestId('motion-blur-identity')).toBeNull()
  })

  /** Drags the amount slider's thumb from its left edge to `percent` of its width and lets go */
  function dragAmount(percent: number) {
    const track = screen.getByTestId('motion-blur-amount').querySelector('.touch-none') as HTMLElement
    track.getBoundingClientRect = () =>
      ({ left: 0, right: 100, width: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON() {} }) as DOMRect
    track.setPointerCapture = () => {}
    fireEvent.pointerDown(track, { clientX: percent, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: percent, clientY: 0, pointerId: 1 })
  }

  /** Opens a select by its test id and picks the option of that name */
  async function choose(testId: string, option: string) {
    const trigger = screen.getByTestId(testId)
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: option }))
  }

  it('offers smooth slow motion off, by frame blending or by optical flow, and starts off', async () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 180 } }))
    expect(screen.getByTestId('motion-blur-smooth-slow').textContent).toBe('Off')
    const trigger = screen.getByTestId('motion-blur-smooth-slow')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Off', 'Frame blending', 'Optical flow'])
  })

  it('sets frame blending at 0.5x in one undo step', async () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 180 } }))

    await choose('motion-blur-smooth-slow', 'Frame blending')

    expect(stored()).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'blend' })
    expect(undoDepth()).toBe(1)
  })

  it('moves from frame blending to optical flow and back off, one undo step each', async () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 180, smoothSlowMotion: 'blend' } }))
    expect(screen.getByTestId('motion-blur-smooth-slow').textContent).toBe('Frame blending')

    await choose('motion-blur-smooth-slow', 'Optical flow')
    expect(stored()).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'optical-flow' })
    expect(screen.getByTestId('motion-blur-smooth-slow').textContent).toBe('Optical flow')

    await choose('motion-blur-smooth-slow', 'Off')
    expect(stored()).toEqual({ shutterDegrees: 180 })
    expect(undoDepth()).toBe(2)
  })

  it('keeps the smooth slow motion when the amount changes', async () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 360, smoothSlowMotion: 'optical-flow' } }))

    // the track runs from 0 to 1: a quarter of the way in is 0.25
    dragAmount(25)

    await waitFor(() => expect(stored()).toEqual({ shutterDegrees: 90, smoothSlowMotion: 'optical-flow' }))
  })

  it('forgets the mode with the blur: switched on again, it starts at 180 degrees with smooth slow motion off', () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 270, smoothSlowMotion: 'blend' } }))
    fireEvent.click(screen.getByTestId('motion-blur-enabled'))
    expect(stored()).toBeUndefined()
    fireEvent.click(screen.getByTestId('motion-blur-enabled'))
    expect(stored()).toEqual({ shutterDegrees: 180 })
  })

  it('stores the amount once, on release, snapped to its step: one undo step', async () => {
    renderStored(clip({ speed: 4, motionBlur: { shutterDegrees: 360 } }))

    dragAmount(35)

    await waitFor(() => expect(stored()).toEqual({ shutterDegrees: 126 }))
    expect(undoDepth()).toBe(1)
  })

  it('goes down to 0: no blur, the smooth slow motion kept (Twixtor without a smear)', async () => {
    renderStored(clip({ speed: 0.25, motionBlur: { shutterDegrees: 180, smoothSlowMotion: 'optical-flow' } }))

    dragAmount(0)

    await waitFor(() => expect(stored()).toEqual({ shutterDegrees: 0, smoothSlowMotion: 'optical-flow' }))
    expect(undoDepth()).toBe(1)
  })

  it('shows motion detail and hard edges only with optical flow, at their defaults (design 11.24)', () => {
    const blend = renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 180, smoothSlowMotion: 'blend' } }))
    expect(screen.queryByTestId('motion-blur-flow-detail')).toBeNull()
    expect(screen.queryByTestId('motion-blur-flow-edges')).toBeNull()
    blend.unmount()

    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 180, smoothSlowMotion: 'optical-flow' } }))
    expect(screen.getByTestId('motion-blur-flow-detail').textContent).toBe('Normal')
    expect(screen.getByTestId('motion-blur-flow-edges').textContent).toBe('Mix frames')
  })

  it('sets high detail and nearest-frame edges in one undo step each, and keeps them when the amount changes', async () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 360, smoothSlowMotion: 'optical-flow' } }))

    await choose('motion-blur-flow-detail', 'High')
    expect(stored()).toEqual({ shutterDegrees: 360, smoothSlowMotion: 'optical-flow', flowDetail: 'high' })
    await choose('motion-blur-flow-edges', 'Nearest frame')
    expect(stored()).toEqual({
      shutterDegrees: 360,
      smoothSlowMotion: 'optical-flow',
      flowDetail: 'high',
      flowEdges: 'nearest',
    })
    expect(undoDepth()).toBe(2)

    dragAmount(25)
    await waitFor(() =>
      expect(stored()).toEqual({
        shutterDegrees: 90,
        smoothSlowMotion: 'optical-flow',
        flowDetail: 'high',
        flowEdges: 'nearest',
      }),
    )
  })

  it('stores a default chosen again as nothing, and drops both when the mode leaves optical flow', async () => {
    renderStored(
      clip({
        speed: 0.5,
        motionBlur: { shutterDegrees: 180, smoothSlowMotion: 'optical-flow', flowDetail: 'high', flowEdges: 'nearest' },
      }),
    )
    await choose('motion-blur-flow-detail', 'Normal')
    expect(stored()).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'optical-flow', flowEdges: 'nearest' })

    await choose('motion-blur-smooth-slow', 'Frame blending')
    expect(stored()).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'blend' })
    expect(screen.queryByTestId('motion-blur-flow-edges')).toBeNull()
  })
})
