/**
 * A video whose file has no audio track (the Avata 2 records none) is silent in the export mix, and nothing reads the
 * whole file to look for sound: on 19 Nov 2026 FreeCut's Web Audio fallback fetched a 3.7 GB clip into one
 * ArrayBuffer on the editor page and the renderer died of it, mid-export.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useCompositionsStore } from '@/runtime/renderer/deps/timeline-compositions-contract'

const { opened } = vi.hoisted(() => ({ opened: [] as string[] }))

vi.mock('mediabunny', () => {
  class UrlSource {
    constructor(public readonly url: string) {}
  }

  /** A container mediabunny reads: a silent file has no audio track, a sound file one. */
  class Input {
    constructor(private readonly params: { source: UrlSource }) {
      opened.push(params.source.url)
    }

    async getPrimaryAudioTrack() {
      return this.params.source.url.includes('silent') ? null : { src: this.params.source.url }
    }

    async computeDuration() {
      return 600
    }

    dispose() {}
  }

  class AudioSampleSink {
    async *samples(startTime = 0, endTime = 0) {
      const frameCount = Math.max(1, Math.round((endTime - startTime) * 48_000))
      const plane = new Float32Array(frameCount).fill(0.25)
      yield {
        numberOfFrames: frameCount,
        numberOfChannels: 2,
        sampleRate: 48_000,
        copyTo(destination: Float32Array) {
          destination.set(plane)
        },
        close() {},
      }
    }
  }

  return { ALL_FORMATS: [], Input, UrlSource, AudioSampleSink }
})

vi.mock('@/shared/utils/ac3-decoder', () => ({
  ensureAc3DecoderRegistered: vi.fn(async () => undefined),
  isAc3AudioCodec: () => false,
}))

import { ensureAc3DecoderRegistered } from '@/shared/utils/ac3-decoder'
import { clearAudioDecodeCache, decodeAudioFromSource } from '@/runtime/renderer/audio/decode'
import { processAudio } from '@/runtime/renderer/audio/pipeline'
import { processAudioWindows } from '@/runtime/renderer/audio/windowed'
import { NoAudioTrackError } from './no-audio-track'

const fetchSpy = vi.fn(async () => new Response(new ArrayBuffer(8)))

function videoItem(id: string, src: string, overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'v1',
    from: 0,
    durationInFrames: 90,
    src,
    mediaId: `${id}-media`,
    label: id,
    sourceStart: 0,
    sourceEnd: 90,
    sourceFps: 30,
    ...overrides,
  } as VideoItem
}

function track(id: string, kind: 'video' | 'audio', items: TimelineTrack['items']): TimelineTrack {
  return { id, name: id, kind, order: 0, height: 80, locked: false, visible: true, muted: false, solo: false, volume: 0, items }
}

function composition(tracks: TimelineTrack[], durationInFrames = 90): CompositionInputProps {
  return { fps: 30, durationInFrames, width: 1920, height: 1080, tracks, transitions: [], keyframes: [] }
}

beforeEach(() => {
  useCompositionsStore.setState({
    compositions: [],
    compositionById: {},
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,
  })
  clearAudioDecodeCache()
  opened.length = 0
  fetchSpy.mockClear()
  vi.mocked(ensureAc3DecoderRegistered).mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a source with no audio track', () => {
  it('is answered at once: no AC3 retry, no whole-file Web Audio fallback', async () => {
    await expect(decodeAudioFromSource('blob:silent-0020', 'clip-1', 20, 23)).rejects.toBeInstanceOf(
      NoAudioTrackError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ensureAc3DecoderRegistered).not.toHaveBeenCalled()
    expect(opened).toEqual(['blob:silent-0020'])
  })

  it('adds silence to the export mix: a silent video alone gives no audio, without reading the file', async () => {
    const mix = await processAudio(composition([track('v1', 'video', [videoItem('clip-1', 'blob:silent-0020')])]))

    expect(mix).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('leaves the sound of the other clips in the mix', async () => {
    const sound = { ...videoItem('music', 'blob:music'), type: 'audio', trackId: 'a1' } as unknown as AudioItem
    const mix = await processAudio(
      composition([
        track('v1', 'video', [videoItem('clip-1', 'blob:silent-0020')]),
        track('a1', 'audio', [sound]),
      ]),
    )

    expect(mix).not.toBeNull()
    expect(Math.max(...Array.from(mix!.samples[0]!.subarray(0, 48_000)))).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is silent in every window of a long mix, and the windows still come', async () => {
    const long = composition([track('v1', 'video', [videoItem('clip-1', 'blob:silent-0020', { durationInFrames: 1800, sourceEnd: 1800 })])], 1800)

    const windows = []
    for await (const window of processAudioWindows(long)) windows.push(window)

    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((window) => window.samples.every((plane) => plane.every((value) => value === 0)))).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
