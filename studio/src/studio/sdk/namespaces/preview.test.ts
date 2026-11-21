// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { prerenderCache } from '@/studio/prerender/cache'
import { setPrerenderHost } from '@/studio/prerender/host'
import { usePrerenderStore } from '@/studio/prerender/store'
import { StudioError } from '../errors'
import type { PreviewQualityLevel } from '../types'
import { createPreviewApi } from './preview'

const preview = createPreviewApi()

/** One 240-frame clip on V1. */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: 'v1',
      from: 0,
      durationInFrames: 240,
      sourceEnd: 240,
      sourceDuration: 240,
    }),
  ])
}

async function catchAsync(call: () => Promise<unknown>): Promise<StudioError> {
  try {
    await call()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

function catchError(call: () => unknown): StudioError {
  try {
    call()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

beforeEach(() => {
  resetTimelineCompositionTestState()
  usePlaybackStore.setState({ previewQuality: 1, isPlaying: false })
  prerenderCache.clear()
  usePrerenderStore.setState({ job: null, lastOutcome: null })
  setPrerenderHost(null)
})

afterEach(() => {
  setPrerenderHost(null)
  vi.unstubAllGlobals()
})

describe('preview.quality and preview.setQuality', () => {
  it('reads and writes the playback store, outside the undo history', () => {
    seedTimeline()
    const undoBefore = useTimelineCommandStore.getState().undoStack

    expect(preview.quality()).toBe(1)
    preview.setQuality(0.5)
    expect(usePlaybackStore.getState().previewQuality).toBe(0.5)
    expect(preview.quality()).toBe(0.5)
    preview.setQuality(0.25)
    expect(preview.quality()).toBe(0.25)

    expect(useTimelineCommandStore.getState().undoStack).toBe(undoBefore)
  })

  it('reads an older 1/3 as the quarter level the menu offers', () => {
    usePlaybackStore.setState({ previewQuality: 0.33 })
    expect(preview.quality()).toBe(0.25)
  })

  it('rejects a quality the menu does not offer', () => {
    for (const quality of [0.33, 2, 0, Number.NaN]) {
      const error = catchError(() => preview.setQuality(quality as PreviewQualityLevel))
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('quality')
      expect(error.message).toContain('preview.setQuality: ')
      expect(error.message).toContain('one of 1, 0.5, 0.25')
    }
    expect(usePlaybackStore.getState().previewQuality).toBe(1)
  })
})

describe('preview.prerender', () => {
  it('rejects bounds outside the timeline or out of order', async () => {
    seedTimeline()

    const late = await catchAsync(() => preview.prerender({ startFrame: 240 }))
    expect(late.code).toBe('INVALID_ARGUMENT')
    expect(late.argument).toBe('startFrame')
    expect(late.message).toContain('preview.prerender: ')

    const fractional = await catchAsync(() => preview.prerender({ endFrame: 10.5 }))
    expect(fractional.code).toBe('INVALID_ARGUMENT')
    expect(fractional.argument).toBe('endFrame')

    const reversed = await catchAsync(() => preview.prerender({ startFrame: 100, endFrame: 50 }))
    expect(reversed.code).toBe('INVALID_ARGUMENT')
    expect(reversed.argument).toBe('range')
  })

  it('rejects an empty timeline', async () => {
    const error = await catchAsync(() => preview.prerender())
    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.message).toContain('preview.prerender: ')
  })

  it('needs the editor preview to be open', async () => {
    seedTimeline()
    const error = await catchAsync(() => preview.prerender())
    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toBe("preview.prerender: the editor's preview is not open")
  })

  it('refuses a second render while one runs', async () => {
    seedTimeline()
    useMarkersStore.setState({ inPoint: 0, outPoint: 60 })
    setPrerenderHost({
      resolvedUrls: new Map([['media-1', 'blob:media-1']]),
      renderSize: { width: 640, height: 360 },
      renderText: true,
      project: { width: 1920, height: 1080 },
    })
    // WebCodecs that answers later, then says it cannot encode: the first render is running when the second
    // call comes, and stops as unsupported once the answer arrives
    let answer: (value: { supported: boolean }) => void = () => {}
    const pending = new Promise<{ supported: boolean }>((resolve) => {
      answer = resolve
    })
    vi.stubGlobal('VideoEncoder', { isConfigSupported: () => pending })
    vi.stubGlobal('VideoDecoder', { isConfigSupported: () => pending })
    const first = preview.prerender()
    const second = await catchAsync(() => preview.prerender())
    expect(second.code).toBe('CONFLICT')
    expect(second.message).toContain('preview.prerender: ')

    answer({ supported: false })
    const result = await first
    expect(result).toMatchObject({
      status: 'stopped',
      reason: 'unsupported',
      startFrame: 0,
      endFrame: 60,
      renderedFrames: 0,
    })
    expect(preview.prerendered().last).toMatchObject({ status: 'stopped', reason: 'unsupported' })
    expect(preview.prerendered().running).toBeNull()
  })
})

describe('a pre-render whose media is not loaded', () => {
  it('stops before rendering anything and says why', async () => {
    seedTimeline()
    setPrerenderHost({
      resolvedUrls: new Map(),
      renderSize: { width: 640, height: 360 },
      renderText: true,
      project: { width: 1920, height: 1080 },
    })
    const result = await preview.prerender({ startFrame: 0, endFrame: 30 })
    expect(result).toMatchObject({ status: 'stopped', reason: 'error', renderedFrames: 0 })
    expect(result.detail).toContain('media not loaded yet')
  })
})

describe('preview.prerendered, preview.cancelPrerender and preview.clearPrerender', () => {
  it('reports an empty cache and does nothing when no render runs', () => {
    expect(preview.prerendered()).toEqual({ ranges: [], bytes: 0, running: null, last: null })
    preview.cancelPrerender()
    preview.clearPrerender()
    expect(preview.prerendered().ranges).toEqual([])
  })
})
