// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { analyzeMediaBeats } from '@/studio/beats/analyze'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { SmoothEditControl } from './dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))
vi.mock('@/studio/beats/analyze', () => ({ analyzeMediaBeats: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('the smooth edit dialog', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useItemsStore.getState().setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([makeTimelineVideoItem({ id: 'v1', trackId: 'track-v1' })])
  })

  it('without a song says to add one first, and offers no Apply', () => {
    render(<SmoothEditControl />)

    fireEvent.click(screen.getByRole('button', { name: 'timeline.smoothEdit.title' }))

    expect(screen.getByText('timeline.smoothEdit.noSong')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'timeline.smoothEdit.apply' })).toBeNull()
    expect(screen.getByRole('button', { name: 'timeline.smoothEdit.close' })).toBeTruthy()
  })

  it('with a song says how many clips will change, and Apply cuts them in one undo step', async () => {
    useTimelineSettingsStore.getState().setFps(30)
    vi.mocked(analyzeMediaBeats).mockResolvedValue(Array.from({ length: 30 }, (_, index) => 1 + index * 0.5))
    useItemsStore.getState().setTracks([
      makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 0 }),
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 1 }),
    ])
    useItemsStore.getState().setItems([
      makeTimelineAudioItem({
        id: 'song',
        mediaId: 'song-media',
        from: 0,
        durationInFrames: 450,
        sourceEnd: 450,
        sourceDuration: 450,
      }),
      ...['a', 'b'].map((id, index) =>
        makeTimelineVideoItem({
          id,
          trackId: 'track-v1',
          from: index * 200,
          durationInFrames: 200,
          sourceStart: 100,
          sourceEnd: 300,
          sourceDuration: 800,
          sourceFps: 30,
          speed: 1,
          sourceWidth: 1920,
          sourceHeight: 1080,
        }),
      ),
    ])
    const depth = useTimelineCommandStore.getState().undoStack.length
    render(<SmoothEditControl />)

    fireEvent.click(screen.getByRole('button', { name: 'timeline.smoothEdit.title' }))
    await waitFor(() => expect(screen.getByText('timeline.smoothEdit.willChange')).toBeTruthy())
    // The bars buttons (1, 2, 4): the first is the default; pick it again to prove a pick re-plans.
    fireEvent.click(screen.getAllByRole('button', { name: 'timeline.smoothEdit.bars' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'timeline.smoothEdit.apply' }))

    await waitFor(() => expect(useTimelineCommandStore.getState().undoStack.length).toBe(depth + 1))
    expect(useItemsStore.getState().itemById['a']!.speedCurve).toBeDefined()
    expect(useItemsStore.getState().itemById['b']!.from).toBe(90)
  })
})
