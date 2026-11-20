// The worker's half of the export worker: what the page prepared goes into this realm before the first frame, and
// comes out again at the end (design 3.6 section 2.15).

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { setFeatureOverride } from '@/studio/feature-switches'
import { needsSourceStages } from '@/studio/render/stages/predicates'
import { createDerivedSizeStore, derivedSizeKey } from '@/studio/render/stages/derived-sizes'
import { derivedSizes, stagedSourceDimensions } from '@/studio/render/stages/staged-size'
import { STAGE_TIMINGS_FLAG, stageTimingsEnabled, timedStage } from '@/studio/render/timings'
import {
  setStabilizationProjectFrame,
  stabilizationEngineKey,
} from '@/studio/stabilization/engine-key'
import { stabilizationSeat } from '@/studio/stabilization/seat'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { snapshotDerivedSizes } from './page'
import type { WorkerExportStart } from './protocol'
import { beginWorkerExport } from './worker'

const STABILIZED = {
  id: 'clip-1',
  type: 'video',
  trackId: 't1',
  label: 'DJI_0020',
  mediaId: 'media-1',
  src: 'blob:clip',
  from: 0,
  durationInFrames: 60,
  stabilization: {
    enabled: true,
    method: 'Default',
    params: { smoothness: 0.5 },
    fov: 1.1,
    horizonLockPercent: 0,
    horizonLockRoll: 0,
    adaptiveZoomSeconds: 4,
  },
} as VideoItem

function record(id: string, overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id,
    storageType: 'workspace',
    fileName: `${id}.mp4`,
    fileSize: 1,
    mimeType: 'video/mp4',
    duration: 10,
    width: 3840,
    height: 2880,
    fps: 59.94,
    codec: 'hevc',
    bitrate: 1,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as MediaMetadata
}

function start(overrides: Partial<WorkerExportStart> = {}): WorkerExportStart {
  return {
    projectFps: 60000 / 1001,
    derivedSizes: [],
    media: [],
    objectUrls: [],
    engines: null,
    timings: false,
    ...overrides,
  }
}

afterEach(() => {
  ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = false
  performance.clearMeasures()
  setFeatureOverride('motionBlur', undefined)
})

describe('beginning a worker export', () => {
  it('gives the layout the size the page prepared, before any stage prepared anything here', async () => {
    const key = derivedSizeKey('stabilize', stabilizationEngineKey(STABILIZED)!)
    expect(stagedSourceDimensions(STABILIZED)).toBeUndefined()
    // The page's store, its snapshot, the structured clone the start message is, this realm's store
    const page = createDerivedSizeStore()
    page.set(key, { width: 3840, height: 2160 })
    const sent = structuredClone(start({ derivedSizes: snapshotDerivedSizes([STABILIZED], page) }))
    const scope = await beginWorkerExport(sent)
    expect(derivedSizes.get(key)).toEqual({ width: 3840, height: 2160 })
    expect(stagedSourceDimensions(STABILIZED)).toEqual({ width: 3840, height: 2160 })
    scope.end()
    derivedSizes.delete(key)
  })

  it('gives the worker the page’s project frame, so its keys are the page’s keys', async () => {
    setStabilizationProjectFrame({ width: 1440, height: 1080 })
    const pageKey = stabilizationEngineKey(STABILIZED)
    setStabilizationProjectFrame(undefined)
    expect(stabilizationEngineKey(STABILIZED)).not.toBe(pageKey)

    const scope = await beginWorkerExport(start({ projectFrame: { width: 4, height: 3 } }))
    expect(stabilizationEngineKey(STABILIZED)).toBe(pageKey)
    scope.end()
    // A start without it forgets a frame an earlier export set
    ;(await beginWorkerExport(start())).end()
    expect(stabilizationEngineKey(STABILIZED)).not.toBe(pageKey)
  })

  it('gives the worker the export’s project rate, and stages a blurred clip at any rate (the vector blur, design 9.2)', async () => {
    setFeatureOverride('motionBlur', true)
    const blurred = {
      ...STABILIZED,
      stabilization: undefined,
      sourceFps: 60000 / 1001,
      speed: 1,
      motionBlur: { shutterDegrees: 180 },
    } as VideoItem
    const page = await beginWorkerExport(start({ projectFps: 60000 / 1001 }))
    expect(useTimelineSettingsStore.getState().fps).toBe(60000 / 1001)
    expect(needsSourceStages(blurred)).toBe(true)
    page.end()
    const slower = await beginWorkerExport(start({ projectFps: 30 }))
    expect(useTimelineSettingsStore.getState().fps).toBe(30)
    expect(needsSourceStages(blurred)).toBe(true)
    slower.end()
  })

  it('puts the page’s media records in this realm’s media library', async () => {
    const scope = await beginWorkerExport(start({ media: [record('media-7', { audioCodec: 'aac' })] }))
    expect(useMediaLibraryStore.getState().mediaById['media-7']?.audioCodec).toBe('aac')
    scope.end()
  })

  it('registers the files behind the page’s blob: URLs, where FreeCut’s decoders look for them in a worker', async () => {
    const { getObjectUrlBlob, getObjectUrlSourceMetadata, unregisterObjectUrl } = await import(
      '@/infrastructure/browser/object-url-registry'
    )
    const file = new Blob(['frames'])
    expect(getObjectUrlBlob('blob:app/source')).toBeNull()
    const scope = await beginWorkerExport(
      start({ objectUrls: [{ url: 'blob:app/source', blob: file, metadata: { mediaId: 'media-1' } }] }),
    )
    expect(getObjectUrlBlob('blob:app/source')).toBe(file)
    expect(getObjectUrlSourceMetadata('blob:app/source')).toEqual({ mediaId: 'media-1' })
    scope.end()
    unregisterObjectUrl('blob:app/source')
  })

  it('says a clip may carry sound unless its media record names no audio codec', async () => {
    const scope = await beginWorkerExport(
      start({ media: [record('silent'), record('loud', { audioCodec: 'aac' })] }),
    )
    expect(scope.mediaMayCarryAudio('silent')).toBe(false)
    expect(scope.mediaMayCarryAudio('loud')).toBe(true)
    expect(scope.mediaMayCarryAudio('not-sent')).toBe(true)
    expect(scope.mediaMayCarryAudio(undefined)).toBe(true)
    scope.end()
    const old = await beginWorkerExport(undefined)
    expect(old.mediaMayCarryAudio('silent')).toBe(true)
    old.end()
  })

  it('makes the page’s host, through its port, this realm’s stabilization host until the export ends', async () => {
    const channel = new MessageChannel()
    const asked: unknown[] = []
    channel.port1.onmessage = (event) => asked.push(event.data)
    const scope = await beginWorkerExport(start({ engines: channel.port2 }))
    const host = stabilizationSeat()
    void host.open(STABILIZED)
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0]).toMatchObject({ op: 'open', item: { id: 'clip-1' } })
    scope.end()
    const after = await host.open({ ...STABILIZED, mediaId: 'media-9' } as VideoItem)
    expect(after.kind).toBe('failed')
    channel.port1.close()
  })

  it('records the stage marks when the page asked, sends them back, and switches them off at the end', async () => {
    const quiet = await beginWorkerExport(start())
    expect(stageTimingsEnabled()).toBe(false)
    expect(quiet.timings()).toBeUndefined()
    quiet.end()

    const scope = await beginWorkerExport(start({ timings: true }))
    expect(stageTimingsEnabled()).toBe(true)
    timedStage('decode', () => 1, 3)
    const timings = scope.timings()
    expect(timings?.timeOrigin).toBe(performance.timeOrigin)
    expect(timings?.marks.map((mark) => [mark.name, mark.detail])).toEqual([
      ['dc.decode', { frame: 3 }],
    ])
    expect(structuredClone(timings)).toEqual(timings)
    scope.end()
    expect(stageTimingsEnabled()).toBe(false)
  })
})

describe('a native 10-bit export in the worker', () => {
  it('gives the worker its own render, which reaches the page’s decode IPC through the plan’s port', async () => {
    const channel = new MessageChannel()
    const scope = await beginWorkerExport(
      start({
        native: {
          target: { format: 'hevc-main10', path: '/exports/flight.mp4', bitrate: 1 },
          paths: [['media-1', '/clips/a.mp4']],
          encode: { jobId: 'native-1', frameBytes: 24, width: 4, height: 2 },
          media: channel.port2,
        },
      }),
    )
    expect(scope.renderNative).toBeTypeOf('function')
    scope.end()
    channel.port1.close()
  })

  it('leaves every other export to FreeCut’s own render', async () => {
    const scope = await beginWorkerExport(start())
    expect(scope.renderNative).toBeNull()
    scope.end()
  })
})
