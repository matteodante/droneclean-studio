// The clip panel's motion blur rows: hidden while their switch is off and for a clip that cannot
// carry blur; with the switch on, the clip's switch and each shutter choice are one undo step.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
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
  return item ? <MotionBlurRows items={[item]} /> : null
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
    expect(screen.queryByTestId('motion-blur-shutter')).toBeNull()
    expect(screen.getByTestId('motion-blur-hint').textContent).toContain('4')
  })

  it('switches blur on at 360 degrees: one undo step, undone in one press', () => {
    renderStored(clip({ speed: 4 }))

    fireEvent.click(screen.getByTestId('motion-blur-enabled'))

    expect(stored()).toEqual({ shutterDegrees: 360 })
    expect(undoDepth()).toBe(1)
    expect(screen.getByTestId('motion-blur-shutter')).toBeTruthy()

    act(() => useTimelineCommandStore.getState().undo())
    expect(stored()).toBeUndefined()
  })

  it('switches blur off: one undo step, and the field is removed', () => {
    renderStored(clip({ speed: 4, motionBlur: { shutterDegrees: 180 } }))

    fireEvent.click(screen.getByTestId('motion-blur-enabled'))

    expect(stored()).toBeUndefined()
    expect(undoDepth()).toBe(1)
    expect(screen.queryByTestId('motion-blur-shutter')).toBeNull()
  })

  it('says it changes nothing at 1x while blur is on', () => {
    renderStored(clip({ motionBlur: { shutterDegrees: 360 } }))
    expect(screen.getByTestId('motion-blur-identity')).toBeTruthy()
  })

  it('switches the smooth slow motion on at 0.5x, and the 1x note gives way to it', () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 180 } }))
    expect(screen.getByTestId('motion-blur-identity')).toBeTruthy()

    fireEvent.click(screen.getByTestId('motion-blur-blend-slow'))

    expect(stored()).toEqual({ shutterDegrees: 180, blendSlowMotion: true })
    expect(undoDepth()).toBe(1)
    expect(screen.queryByTestId('motion-blur-identity')).toBeNull()
  })

  it('keeps the smooth slow motion when the shutter angle changes', async () => {
    renderStored(clip({ speed: 0.5, motionBlur: { shutterDegrees: 360, blendSlowMotion: true } }))

    const trigger = screen.getByTestId('motion-blur-shutter')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: '90°' }))

    expect(stored()).toEqual({ shutterDegrees: 90, blendSlowMotion: true })
  })

  it('changes the shutter angle with the select: one undo step per choice', async () => {
    renderStored(clip({ speed: 4, motionBlur: { shutterDegrees: 360 } }))

    const trigger = screen.getByTestId('motion-blur-shutter')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const option = await screen.findByRole('option', { name: '180°' })
    fireEvent.click(option)

    expect(stored()).toEqual({ shutterDegrees: 180 })
    expect(undoDepth()).toBe(1)
  })
})
