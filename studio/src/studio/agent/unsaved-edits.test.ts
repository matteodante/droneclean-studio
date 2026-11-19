/**
 * What Take over of a lost workspace would discard (task 2.3): the timeline's
 * edits that no save has written, read from the timeline's own dirty flag.
 */
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { hasUnsavedProjectEdits } from './unsaved-edits'

afterEach(() => {
  useTimelineSettingsStore.getState().markClean()
})

describe('unsaved project edits', () => {
  it('follows the timeline: an edit sets it, a save that went through clears it', () => {
    useTimelineSettingsStore.getState().markClean()
    expect(hasUnsavedProjectEdits()).toBe(false)
    useTimelineSettingsStore.getState().markDirty()
    expect(hasUnsavedProjectEdits()).toBe(true)
    useTimelineSettingsStore.getState().markClean()
    expect(hasUnsavedProjectEdits()).toBe(false)
  })
})
