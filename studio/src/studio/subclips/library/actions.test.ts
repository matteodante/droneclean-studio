// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { useSubclipsStore } from '@/studio/subclips'

const markDirty = vi.hoisted(() => vi.fn())
vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  useTimelineSettingsStore: { getState: () => ({ markDirty }) },
}))

import { buildSubclipDragData, getMarkedRange, createSubclipFromMarks, deleteSubclips } from './actions'

const media = {
  id: 'm1',
  fileName: 'DJI_0020.MP4',
  duration: 10,
  fps: 59.94,
} as Parameters<typeof createSubclipFromMarks>[0]

describe('subclip actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubclipsStore.getState().reset()
    useSourcePlayerStore.setState({ marksByKey: {} })
  })

  it('has no range without a mark, and none for marks outside the file or reversed', () => {
    expect(getMarkedRange(media)).toBeNull()
    for (const marks of [
      { in: null, out: null },
      { in: 50, out: 50 },
      { in: 80, out: 20 },
      { in: 0, out: 5000 },
      { in: 5000, out: null },
    ]) {
      useSourcePlayerStore.setState({ marksByKey: { m1: marks } })
      expect(getMarkedRange(media)).toBeNull()
    }
  })

  it('reads the file edge for a missing side (10 s at 59.94 is 599 frames)', () => {
    useSourcePlayerStore.setState({ marksByKey: { m1: { in: null, out: 120 } } })
    expect(getMarkedRange(media)).toEqual({ startFrame: 0, endFrame: 120 })
    useSourcePlayerStore.setState({ marksByKey: { m1: { in: 120, out: null } } })
    expect(getMarkedRange(media)).toEqual({ startFrame: 120, endFrame: 599 })
  })

  it('creates the subclip at the file rate and leaves the marks as they were', () => {
    useSourcePlayerStore.setState({ marksByKey: { m1: { in: 60, out: 180 } } })
    const subclip = createSubclipFromMarks(media)
    expect(subclip).toMatchObject({ mediaId: 'm1', startFrame: 60, endFrame: 180, sourceFps: 59.94 })
    expect(subclip?.name).toBe('DJI_0020 00:00:01:00')
    expect(useSourcePlayerStore.getState().marksByKey.m1).toEqual({ in: 60, out: 180 })
    expect(markDirty).toHaveBeenCalledTimes(1)
  })

  it('returns null and changes nothing without a range', () => {
    expect(createSubclipFromMarks(media)).toBeNull()
    expect(useSubclipsStore.getState().subclips).toEqual([])
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('does not mark the project changed when deleting an id that is not there', () => {
    expect(deleteSubclips(['nope'])).toBe(0)
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('describes a drag of a subclip as the parent with its range, the label and the range seconds', () => {
    const subclip = useSubclipsStore
      .getState()
      .create({ mediaId: 'm1', name: 'Hoop', startFrame: 0, endFrame: 60, sourceFps: 59.94 })
    expect(buildSubclipDragData(subclip)).toEqual({
      type: 'media-item',
      mediaId: 'm1',
      mediaType: 'video',
      fileName: 'Hoop',
      duration: expect.closeTo(1.001, 9),
      sourceStart: 0,
      sourceEnd: 60,
      subclipId: subclip.id,
    })
  })
})
