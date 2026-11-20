/**
 * Decode the audio of a clip's source span and find its beats, off the main
 * thread. The decode is the one the timeline's silence removal uses
 * (`getOrDecodeAudioSliceForPlayback`: cached, shared with playback); only the
 * analysis moves to a worker, with the mono mix transferred, not copied.
 */

import { getOrDecodeAudioSliceForPlayback } from '@/features/timeline/deps/composition-runtime'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { detectBeats, type BeatDetectionOptions } from './detect'

/** Seconds of the media's own timeline: `start` is where the analysed span begins. */
export interface BeatSpan {
  start: number
  end: number
}

interface BeatsResponse {
  error?: string
  id: string
  times?: number[]
}

/** The channels of `buffer` between `span.start` and `span.end`, averaged into a new mono array. */
export function mixToMono(
  buffer: AudioBuffer,
  sliceStartTime: number,
  span: BeatSpan,
): Float32Array {
  const startSample = Math.max(0, Math.round((span.start - sliceStartTime) * buffer.sampleRate))
  const endSample = Math.min(
    buffer.length,
    Math.max(startSample, Math.round((span.end - sliceStartTime) * buffer.sampleRate)),
  )
  const channelCount = buffer.numberOfChannels
  const mono = new Float32Array(endSample - startSample)
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < mono.length; i += 1) {
      mono[i] = (mono[i] as number) + (data[startSample + i] as number) / channelCount
    }
  }
  return mono
}

/** Run `detectBeats` in a worker, or on this thread where there are no workers. */
export function detectBeatsOffThread(
  samples: Float32Array,
  sampleRate: number,
  options: BeatDetectionOptions,
): Promise<number[]> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(detectBeats(samples, sampleRate, options))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./beats-worker.ts', import.meta.url), { type: 'module' })
    const id = crypto.randomUUID()
    const finish = (callback: () => void) => {
      worker.terminate()
      callback()
    }
    worker.addEventListener('message', (event: MessageEvent<BeatsResponse>) => {
      if (event.data.id !== id) return
      finish(() => {
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.times ?? [])
      })
    })
    worker.addEventListener('error', (event) => {
      finish(() => reject(event.error instanceof Error ? event.error : new Error(event.message)))
    })
    worker.postMessage({ id, samples: samples.buffer, sampleRate, strength: options.strength }, [
      samples.buffer,
    ])
  })
}

/**
 * Beat times, in seconds of the media's own timeline, inside `span` of a
 * library media.
 * @throws Error when the media's file cannot be loaded or decoded
 */
export async function analyzeMediaBeats(
  mediaId: string,
  span: BeatSpan,
  options: BeatDetectionOptions,
): Promise<number[]> {
  const url = await resolveMediaUrl(mediaId)
  if (!url) throw new Error('Could not load media for beat detection')
  const slice = await getOrDecodeAudioSliceForPlayback(mediaId, url, {
    targetTimeSeconds: span.start,
    minReadySeconds: Math.max(1, span.end - span.start),
    preRollSeconds: 0,
    waitTimeoutMs: 0,
  })
  const mono = mixToMono(slice.buffer, slice.startTime, span)
  const times = await detectBeatsOffThread(mono, slice.buffer.sampleRate, options)
  return times.map((time) => time + span.start)
}
