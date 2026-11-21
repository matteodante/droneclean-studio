// The preview's line about a staged clip it holds (design 3.6 section 2.10): "opening" while a stage is not ready, the
// failure with Retry when one failed, nothing once the clip is drawn with all its stages, nothing for a clip that is
// gone or no longer staged.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { setClipStageState, subscribeStagedFrameReady } from '@/studio/render/stages/failure'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { StagedClipStatus } from './StagedClipStatus'

const { retryMock } = vi.hoisted(() => ({ retryMock: vi.fn(async () => undefined) }))
vi.mock('@/studio/render/stages/session', () => ({ pagePreparer: () => ({ retry: retryMock }) }))

const clip = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-1',
  label: 'Run 2',
  from: 0,
  durationInFrames: 30,
  src: 'blob:clip',
  mediaId: 'media-1',
  inputColor: 'dlog-m',
} as unknown as VideoItem

beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      editor: {
        stagedClip: {
          stage: { stabilize: 'stabilization', 'input-colour': 'input colour', look: 'look' },
          opening: '{{clip}}: preparing {{stage}}',
          failed: '{{clip}}: {{stage}} failed: {{message}}',
          retry: 'Retry',
        },
      },
    },
    true,
    true,
  )
})

afterEach(() => {
  act(() => setClipStageState('clip-1', null))
  useItemsStore.setState({ items: [] })
  usePlaybackStore.setState({ currentFrame: 0 })
})

describe('the staged clip status on the preview', () => {
  it('says a clip is opening while a stage is not ready, and goes when the clip is drawn again', () => {
    useItemsStore.setState({ items: [clip as TimelineItem] })
    render(<StagedClipStatus />)
    expect(screen.queryByRole('status')).toBeNull()

    act(() => setClipStageState('clip-1', { kind: 'opening', stage: 'input-colour' }))
    expect(screen.getByTestId('staged-clip-opening').textContent).toBe(
      'Run 2: preparing input colour',
    )

    act(() => setClipStageState('clip-1', null))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing about a clip the playhead is not on, and speaks again when the playhead comes back to it', () => {
    useItemsStore.setState({ items: [clip as TimelineItem] })
    render(<StagedClipStatus />)
    act(() => setClipStageState('clip-1', { kind: 'opening', stage: 'stabilize' }))
    expect(screen.getByTestId('staged-clip-opening')).toBeTruthy()

    act(() => usePlaybackStore.setState({ currentFrame: 30 }))
    expect(screen.queryByRole('status')).toBeNull()

    act(() => usePlaybackStore.setState({ currentFrame: 29 }))
    expect(screen.getByTestId('staged-clip-opening').textContent).toBe(
      'Run 2: preparing stabilization',
    )
  })

  it('shows a failure with Retry, which prepares the clip again and draws the frame again', async () => {
    useItemsStore.setState({ items: [clip as TimelineItem] })
    const redraw = vi.fn()
    const stop = subscribeStagedFrameReady(redraw)
    render(<StagedClipStatus />)
    act(() =>
      setClipStageState('clip-1', {
        kind: 'failed',
        stage: 'input-colour',
        message: 'the pass broke',
      }),
    )
    expect(screen.getByTestId('staged-clip-failed').textContent).toContain(
      'Run 2: input colour failed: the pass broke',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(redraw).toHaveBeenCalledTimes(1))
    expect(retryMock).toHaveBeenCalledWith(clip)
    stop()
  })

  it('lists no clip that is gone, or that no stage changes any more', () => {
    useItemsStore.setState({ items: [{ ...clip, inputColor: 'none' } as TimelineItem] })
    render(<StagedClipStatus />)
    act(() => setClipStageState('clip-1', { kind: 'opening', stage: 'input-colour' }))
    expect(screen.queryByRole('status')).toBeNull()
    act(() => useItemsStore.setState({ items: [] }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
