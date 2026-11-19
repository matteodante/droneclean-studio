// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from 'sonner'

import { i18n } from '@/i18n'
import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useReverseConformDialogStore } from '../reverse-conform-dialog-store'
import { commitPreparedReverseItems, reverseItems } from './item-actions'

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

// Cleaned shadow pieces are frames of the source, a reverse conform is another file: reversing a
// cleaned clip is refused in the store action, so the UI and the SDK both get the refusal
// (review finding C5).

function video(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  }
}

const CLEANED = {
  mark: { x: 10, y: 10, sourceFrame: 100, radius: 5 },
  ranges: [],
  pieces: [{ jobId: 'job-1', path: 'media/m/shadow/100_30.mp4', startFrame: 100, frames: 30 }],
}

describe('reversing a clip with cleaned shadow pieces', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setItems([video({ shadowRemoval: CLEANED }), video({ id: 'clip-2' })])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useReverseConformDialogStore.setState({ request: null })
    vi.mocked(toast.warning).mockReset()
  })

  it('is refused: nothing changes, no history, no dialog, and the toast says why', () => {
    const before = useItemsStore.getState().items

    reverseItems(['clip-1'])

    expect(useItemsStore.getState().items).toBe(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(useReverseConformDialogStore.getState().request).toBeNull()
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith(i18n.t('editor.shadowSection.reverseRefused'))
  })

  it('is refused when the prepared conform is committed too', () => {
    const before = useItemsStore.getState().items

    commitPreparedReverseItems([before[0]!], [])

    expect(useItemsStore.getState().items).toBe(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(toast.warning).toHaveBeenCalledWith(i18n.t('editor.shadowSection.reverseRefused'))
  })

  it('still reverses a clip without pieces', () => {
    reverseItems(['clip-2'])

    expect(useReverseConformDialogStore.getState().request).not.toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
