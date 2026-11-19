// The page's half of the export worker: what it snapshots for the worker, the host it serves, and what it does with
// the worker's answer (design 3.6 section 2.15).

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDerivedSizeStore, derivedSizeKey } from '@/studio/render/stages/derived-sizes'
import { SourceError } from '@/studio/render/source-error'
import { StageError } from '@/studio/render/stages/types'
import { STAGE_TIMINGS_FLAG } from '@/studio/render/timings'
import {
  setStabilizationProjectFrame,
  stabilizationEngineKey,
} from '@/studio/stabilization/engine-key'
import type { StabilizationSeat } from '@/studio/stabilization/seat'
import type { CompositionInputProps } from '@/types/export'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import {
  blobUrlsOf,
  openWorkerExport,
  recordWorkerTimings,
  snapshotDerivedSizes,
  snapshotMedia,
  snapshotObjectUrls,
  type PageSources,
} from './page'
import { serializeFailure } from './protocol'

const STABILIZATION = {
  enabled: true,
  method: 'Default',
  params: { smoothness: 0.5 },
  fov: 1,
  horizonLockPercent: 0,
  horizonLockRoll: 0,
  adaptiveZoomSeconds: 4,
}

function video(id: string, overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 't1',
    label: id,
    mediaId: 'media-1',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 60,
    ...overrides,
  } as VideoItem
}

function media(id: string, overrides: Partial<MediaMetadata> = {}): MediaMetadata {
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

function compositionOf(items: TimelineItem[]): CompositionInputProps {
  return {
    fps: 59.94,
    width: 3840,
    height: 2880,
    durationInFrames: 60,
    tracks: [{ id: 't1', items }],
  } as unknown as CompositionInputProps
}

function sourcesWith(overrides: Partial<PageSources> = {}): PageSources {
  return {
    derivedSizes: async () => createDerivedSizeStore(),
    mediaById: async () => ({}),
    stabilizationHost: async () => ({}) as StabilizationSeat,
    objectUrl: () => null,
    ...overrides,
  }
}

afterEach(() => {
  ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = false
  performance.clearMeasures()
})

describe('the page’s snapshot for the worker', () => {
  it('takes the derived sizes the page knows for the stabilized clips, once per key', () => {
    const stabilized = video('a', { stabilization: STABILIZATION })
    const twin = video('b', { stabilization: STABILIZATION })
    const unknown = video('c', { mediaId: 'media-2', stabilization: STABILIZATION })
    const plain = video('d')
    const sizes = createDerivedSizeStore()
    const key = derivedSizeKey('stabilize', stabilizationEngineKey(stabilized)!)
    sizes.set(key, { width: 3840, height: 2160 })
    sizes.set('stabilize|someone-else', { width: 1, height: 1 })
    expect(snapshotDerivedSizes([stabilized, twin, unknown, plain], sizes)).toEqual([
      [key, { width: 3840, height: 2160 }],
    ])
  })

  it('takes the media records the items use, once each, without the file handle', () => {
    const records = {
      'media-1': media('media-1', { fileHandle: {} as FileSystemFileHandle }),
      'media-2': media('media-2', { audioCodec: 'aac' }),
      'media-3': media('media-3'),
    }
    const items = [video('a'), video('b'), video('c', { mediaId: 'media-2' }), video('d', { mediaId: 'gone' })]
    const snapshot = snapshotMedia(items, records)
    expect(snapshot.map((record) => record.id)).toEqual(['media-1', 'media-2'])
    expect('fileHandle' in snapshot[0]!).toBe(false)
    expect(snapshot[1]!.audioCodec).toBe('aac')
    // What crosses is a structured clone
    expect(structuredClone(snapshot)).toEqual(snapshot)
  })
})

describe('the files behind the composition’s blob: URLs', () => {
  it('finds every blob: URL of the composition once: sources, shadow pieces, nested anywhere', () => {
    const composition = compositionOf([
      video('a', { src: 'blob:app/source' }),
      video('b', {
        src: 'blob:app/source',
        shadowRemoval: { pieces: [{ src: 'blob:app/piece', path: 'p', startFrame: 0, frames: 10 }] },
      } as unknown as Partial<VideoItem>),
      { id: 'img', type: 'image', src: 'https://not-a-blob', from: 0, durationInFrames: 1 } as unknown as TimelineItem,
    ])
    expect(blobUrlsOf(composition).sort()).toEqual(['blob:app/piece', 'blob:app/source'])
  })

  it('hands over the file and its metadata the page holds for each URL, and leaves out a URL it does not hold', () => {
    const file = new Blob(['frames'])
    const held = snapshotObjectUrls(['blob:app/source', 'blob:app/stale'], (url) =>
      url === 'blob:app/source' ? { blob: file, metadata: { mediaId: 'media-1', fileSize: 6 } } : null,
    )
    expect(held).toEqual([
      { url: 'blob:app/source', blob: file, metadata: { mediaId: 'media-1', fileSize: 6 } },
    ])
  })

  it('reads the page’s own object-URL registry when the export opens', async () => {
    const { registerObjectUrl, unregisterObjectUrl } = await import(
      '@/infrastructure/browser/object-url-registry'
    )
    const file = new Blob(['frames'])
    registerObjectUrl('blob:app/registered', file, { mediaId: 'media-1', fileSize: 6 })
    // The page's own sources: its object-URL registry, its media library, its size store
    const session = await openWorkerExport(compositionOf([video('a', { src: 'blob:app/registered' })]))
    expect(session.start.objectUrls).toEqual([
      { url: 'blob:app/registered', blob: file, metadata: { mediaId: 'media-1', fileSize: 6 } },
    ])
    unregisterObjectUrl('blob:app/registered')
  })
})

describe('opening a worker export', () => {
  it('serves no host and transfers nothing when no clip is stabilized', async () => {
    const stabilizationHost = vi.fn(async () => ({}) as StabilizationSeat)
    const session = await openWorkerExport(
      compositionOf([video('a')]),
      sourcesWith({ mediaById: async () => ({ 'media-1': media('media-1') }), stabilizationHost }),
    )
    expect(session.start.engines).toBeNull()
    expect(session.transfer).toEqual([])
    expect(session.start.media.map((record) => record.id)).toEqual(['media-1'])
    expect(session.start.projectFps).toBe(59.94)
    expect(session.start.timings).toBe(false)
    expect(stabilizationHost).not.toHaveBeenCalled()
    session.close()
  })

  it('tells the worker the aspect of the project’s frame the page’s stabilization keys its clips by', async () => {
    const sources = sourcesWith({ mediaById: async () => ({}) })
    try {
      expect((await openWorkerExport(compositionOf([video('a')]), sources)).start.projectFrame).toBeNull()
      setStabilizationProjectFrame({ width: 1440, height: 1080 })
      const session = await openWorkerExport(compositionOf([video('a')]), sources)
      expect(session.start.projectFrame).toEqual({ width: 4, height: 3 })
      session.close()
    } finally {
      setStabilizationProjectFrame(undefined)
    }
  })

  it('serves the page’s host on a port it transfers, and stops serving on close', async () => {
    const stabilized = video('a', { stabilization: STABILIZATION })
    const sizes = createDerivedSizeStore()
    const key = derivedSizeKey('stabilize', stabilizationEngineKey(stabilized)!)
    sizes.set(key, { width: 3840, height: 2160 })
    const session = await openWorkerExport(
      compositionOf([stabilized]),
      sourcesWith({ derivedSizes: async () => sizes }),
    )
    expect(session.start.engines).not.toBeNull()
    expect(session.transfer).toEqual([session.start.engines])
    expect(session.start.derivedSizes).toEqual([[key, { width: 3840, height: 2160 }]])
    session.close()
    session.close()
    session.start.engines?.close()
  })

  it('answers the worker’s asks with the page’s host until it is closed', async () => {
    const stabilized = video('a', { stabilization: STABILIZATION })
    const assets = vi.fn(async () => ({ kernelWgsl: 'k' }))
    const session = await openWorkerExport(
      compositionOf([stabilized]),
      sourcesWith({
        stabilizationHost: async () => ({ stageAssets: assets }) as unknown as StabilizationSeat,
      }),
    )
    const port = session.start.engines!
    const replies: unknown[] = []
    port.onmessage = (event) => replies.push(event.data)
    port.postMessage({ id: 1, op: 'assets', key: 'k1' })
    await vi.waitFor(() => expect(replies).toEqual([{ id: 1, ok: true, value: { kernelWgsl: 'k' } }]))
    session.close()
    port.postMessage({ id: 2, op: 'assets', key: 'k1' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(assets).toHaveBeenCalledTimes(1)
    expect(replies).toHaveLength(1)
    port.close()
  })

  it('asks the worker for the stage marks when the page records them', async () => {
    ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = true
    const session = await openWorkerExport(compositionOf([video('a')]), sourcesWith())
    expect(session.start.timings).toBe(true)
  })

  it('turns the worker’s failure back into the same named error', async () => {
    const session = await openWorkerExport(compositionOf([video('a')]), sourcesWith())
    const raised = new StageError({ clip: 'a', stage: 'input-colour', sourceIndex: 9, reason: 'no' })
    const error = session.failed({
      type: 'error',
      requestId: 'r',
      error: raised.message,
      failure: structuredClone(serializeFailure(raised)),
    })
    expect(error).toBeInstanceOf(StageError)
    expect(error.message).toBe(raised.message)
  })

  it('turns the worker’s SourceError back into a SourceError that names the clip', async () => {
    const session = await openWorkerExport(compositionOf([video('a')]), sourcesWith())
    const raised = new SourceError({ clip: 'DJI_0020', mediaId: 'media-1', frame: 3, reason: 'moved' })
    const error = session.failed({
      type: 'error',
      requestId: 'r',
      error: raised.message,
      failure: structuredClone(serializeFailure(raised)),
    })
    expect(error).toBeInstanceOf(SourceError)
    expect(error.message).toBe(raised.message)
    expect(error.message).toContain("'DJI_0020'")
    expect((error as SourceError).mediaId).toBe('media-1')
  })

  it('records the worker’s stage marks on the page’s timeline, on the page’s clock', async () => {
    const session = await openWorkerExport(compositionOf([video('a')]), sourcesWith())
    const workerOrigin = performance.timeOrigin - 1000
    session.completed({
      type: 'complete',
      requestId: 'r',
      result: {} as never,
      timings: {
        timeOrigin: workerOrigin,
        marks: [
          { name: 'dc.decode', startTime: 1500, duration: 4, detail: { frame: 7 } },
          { name: 'other', startTime: 1500, duration: 4, detail: null },
        ],
      },
    })
    const marks = performance.getEntriesByType('measure')
    expect(marks.map((mark) => mark.name)).toEqual(['dc.decode'])
    expect(marks[0]!.startTime).toBeCloseTo(500, 3)
    expect(marks[0]!.duration).toBeCloseTo(4, 3)
    expect((marks[0] as PerformanceMeasure).detail).toEqual({ frame: 7 })
  })

  it('ignores a mark the page’s timeline refuses', () => {
    expect(() =>
      recordWorkerTimings({
        timeOrigin: performance.timeOrigin,
        marks: [{ name: 'dc.encode', startTime: -1e12, duration: 1, detail: null }],
      }),
    ).not.toThrow()
  })
})
