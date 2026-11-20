/**
 * Windowed mixing for long, non-stateful audio timelines: fixed-size chunks
 * are decoded, mixed and yielded in order, so memory stays bounded.
 */

import type { CompositionInputProps } from '@/types/export'
import { createLogger } from '@/shared/logging/logger'
import {
  evaluateAudioFadeInCurve,
  evaluateAudioFadeOutCurve,
  type AudioClipFadeSpan,
} from '@/shared/utils/audio-fade-curve'
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/utils/ac3-decoder'
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import { createPrimedAudioSampleSink } from '@/studio/media/aac-priming'
import { bufferSamples, frameToSeconds, sampleAt, toRate, type Rate } from '@/studio/time'
import type { AudioSegment, DecodedAudio } from './types'
import { decodeAudioFromSource, decodeAudioRangeFromSink } from './decode'
import { NoAudioTrackError } from '@/studio/render/no-audio-track'
import { applyAnimatedVolume, applyVolume, dbToGain, resample } from './dsp'
import { applyDucking, collectDuckingSources, type DuckingSource } from './ducking'
import { downmixToOutputChannels, segmentSampleSpan, softClipAudioMix } from './mixdown'
import { resolveSubCompMediaUrls } from './media-urls'
import { extractAudioSegments, supportsWindowedAudioSegment } from './planning'

const log = createLogger('CanvasAudio/windowed')

const STREAMING_AUDIO_CHUNK_SECONDS = 30

type FramesToSamples = (frames: number | undefined) => number

function applyClipFadeSpanToWindow(
  output: Float32Array,
  span: AudioClipFadeSpan,
  segmentOffsetSamples: number,
  toSamples: FramesToSamples,
): void {
  const spanStart = toSamples(span.startFrame)
  const spanEnd = toSamples(span.startFrame + span.durationInFrames)
  const fadeInSamples = Math.min(spanEnd - spanStart, toSamples(span.fadeInFrames))
  const fadeOutSamples = Math.min(spanEnd - spanStart, toSamples(span.fadeOutFrames))

  for (let i = 0; i < output.length; i++) {
    const globalIndex = segmentOffsetSamples + i
    if (globalIndex < spanStart || globalIndex >= spanEnd) continue
    if (fadeInSamples > 0 && globalIndex < spanStart + fadeInSamples) {
      const progress = (globalIndex - spanStart) / Math.max(1, fadeInSamples)
      output[i] =
        output[i]! * evaluateAudioFadeInCurve(progress, span.fadeInCurve, span.fadeInCurveX)
    }
    const fadeOutStart = spanEnd - fadeOutSamples
    if (fadeOutSamples > 0 && globalIndex >= fadeOutStart) {
      const progress = (globalIndex - fadeOutStart) / Math.max(1, fadeOutSamples)
      output[i] =
        output[i]! * evaluateAudioFadeOutCurve(progress, span.fadeOutCurve, span.fadeOutCurveX)
    }
  }
}

function applyClipFadeSpansToWindow(
  output: Float32Array,
  segment: AudioSegment,
  segmentOffsetSamples: number,
  toSamples: FramesToSamples,
): void {
  for (const span of segment.clipFadeSpans ?? []) {
    applyClipFadeSpanToWindow(output, span, segmentOffsetSamples, toSamples)
  }
}

function applyBasicFadesToWindow(
  output: Float32Array,
  segment: AudioSegment,
  segmentOffsetSamples: number,
  totalSegmentSamples: number,
  toSamples: FramesToSamples,
): void {
  const contentStart =
    toSamples(segment.contentStartOffsetFrames) + toSamples(segment.fadeInDelayFrames)
  const contentEnd = Math.max(
    contentStart,
    totalSegmentSamples -
      toSamples(segment.contentEndOffsetFrames) -
      toSamples(segment.fadeOutLeadFrames),
  )
  const fadeInSamples = toSamples(segment.fadeInFrames)
  const fadeOutSamples = toSamples(segment.fadeOutFrames)
  const fadeOutStart = Math.max(contentStart, contentEnd - fadeOutSamples)

  for (let i = 0; i < output.length; i++) {
    const globalIndex = segmentOffsetSamples + i
    if (globalIndex < contentStart || globalIndex >= contentEnd) {
      output[i] = 0
    } else if (fadeInSamples > 0 && globalIndex < contentStart + fadeInSamples) {
      const progress = (globalIndex - contentStart) / fadeInSamples
      output[i] =
        output[i]! * evaluateAudioFadeInCurve(progress, segment.fadeInCurve, segment.fadeInCurveX)
    } else if (fadeOutSamples > 0 && globalIndex >= fadeOutStart) {
      const progress = (globalIndex - fadeOutStart) / fadeOutSamples
      output[i] =
        output[i]! *
        evaluateAudioFadeOutCurve(progress, segment.fadeOutCurve, segment.fadeOutCurveX)
    }
  }
}

function applyCrossfadesToWindow(
  output: Float32Array,
  segment: AudioSegment,
  segmentOffsetSamples: number,
  totalSegmentSamples: number,
  toSamples: FramesToSamples,
): void {
  const crossfadeIn = toSamples(segment.crossfadeFadeInFrames)
  const crossfadeOut = toSamples(segment.crossfadeFadeOutFrames)
  const fadeOutStart = totalSegmentSamples - crossfadeOut
  for (let i = 0; i < output.length; i++) {
    const globalIndex = segmentOffsetSamples + i
    if (crossfadeIn > 0 && globalIndex < crossfadeIn) {
      output[i] = output[i]! * Math.sin(((globalIndex / crossfadeIn) * Math.PI) / 2)
    }
    if (crossfadeOut > 0 && globalIndex >= fadeOutStart) {
      output[i] =
        output[i]! * Math.cos((((globalIndex - fadeOutStart) / crossfadeOut) * Math.PI) / 2)
    }
  }
}

function applyWindowedSegmentFades(
  samples: Float32Array,
  segment: AudioSegment,
  segmentOffsetSamples: number,
  totalSegmentSamples: number,
  sampleRate: number,
  rate: Rate,
): Float32Array {
  const output = new Float32Array(samples)
  const toSamples: FramesToSamples = (frames) =>
    sampleAt(Math.max(0, frames ?? 0), rate, sampleRate)

  if (segment.clipFadeSpans?.length) {
    applyClipFadeSpansToWindow(output, segment, segmentOffsetSamples, toSamples)
  } else {
    applyBasicFadesToWindow(output, segment, segmentOffsetSamples, totalSegmentSamples, toSamples)
  }
  applyCrossfadesToWindow(output, segment, segmentOffsetSamples, totalSegmentSamples, toSamples)

  return output
}

interface AudioWindowIntersection {
  segmentStart: number
  segmentLength: number
  intersectionStart: number
  intersectionEnd: number
}

interface WindowedAudioDecoderPool {
  decode: (segment: AudioSegment, startTime: number, endTime: number) => Promise<DecodedAudio>
  dispose: () => Promise<void>
}

async function createWindowedAudioDecoderPool(): Promise<WindowedAudioDecoderPool> {
  const mb = await import('mediabunny')
  type Session = {
    input: InstanceType<typeof mb.Input>
    sink: InstanceType<typeof mb.AudioSampleSink>
    duration: number
  }
  const sessions = new Map<string, Promise<Session>>()

  const getSession = (segment: AudioSegment): Promise<Session> => {
    const existing = sessions.get(segment.src)
    if (existing) return existing
    const created = (async () => {
      const input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: createMediabunnyInputSource(mb, segment.src),
      })
      try {
        const track = await input.getPrimaryAudioTrack()
        if (!track) throw new NoAudioTrackError()
        return {
          input,
          sink: await createPrimedAudioSampleSink(mb, input, track),
          duration: await input.computeDuration(),
        }
      } catch (error) {
        input.dispose()
        throw error
      }
    })()
    sessions.set(segment.src, created)
    return created
  }

  return {
    async decode(segment, startTime, endTime) {
      try {
        const session = await getSession(segment)
        return await decodeAudioRangeFromSink(
          session.sink,
          segment.itemId,
          Math.max(0, startTime),
          Math.min(session.duration, endTime),
        )
      } catch (error) {
        if (error instanceof NoAudioTrackError) throw error
        log.warn('Persistent audio decoder failed; retrying with isolated decoder', {
          itemId: segment.itemId,
          error,
        })
        return decodeAudioFromSource(
          segment.src,
          segment.itemId,
          startTime,
          endTime,
          segment.audioCodec,
        )
      }
    },
    async dispose() {
      const settledSessions = await Promise.allSettled(sessions.values())
      for (const result of settledSessions) {
        if (result.status === 'fulfilled') result.value.input.dispose()
      }
      sessions.clear()
    },
  }
}

function resolveAudioWindowIntersection(
  segment: AudioSegment,
  chunkStart: number,
  chunkEnd: number,
  sampleRate: number,
  rate: Rate,
): AudioWindowIntersection | null {
  const { startSample: segmentStart, endSample } = segmentSampleSpan(segment, rate, sampleRate)
  const segmentLength = endSample - segmentStart
  const intersectionStart = Math.max(chunkStart, segmentStart)
  const intersectionEnd = Math.min(chunkEnd, endSample)
  if (intersectionEnd <= intersectionStart) return null
  return { segmentStart, segmentLength, intersectionStart, intersectionEnd }
}

async function processAudioWindowChannels(
  decoded: DecodedAudio,
  segment: AudioSegment,
  intersection: AudioWindowIntersection,
  sampleRate: number,
  fps: number,
  rate: Rate,
  duckingSources: readonly DuckingSource[] = [],
): Promise<Float32Array[]> {
  const processed = decoded.samples
  const decodedSegmentOffset = Math.floor(
    ((intersection.intersectionStart - intersection.segmentStart) / sampleRate) *
      decoded.sampleRate,
  )
  const decodedSegmentLength = Math.ceil(
    (intersection.segmentLength / sampleRate) * decoded.sampleRate,
  )
  for (let channel = 0; channel < processed.length; channel++) {
    let samples = processed[channel]!
    if (segment.volumeKeyframes?.length) {
      samples = applyAnimatedVolume(
        samples,
        segment.volumeKeyframes,
        segment.volume,
        (intersection.intersectionStart / sampleRate) * fps,
        segment.itemFrom,
        fps,
        decoded.sampleRate,
      )
    } else if (segment.volume !== 0) {
      samples = applyVolume(samples, segment.volume)
    }
    samples = applyWindowedSegmentFades(
      samples,
      segment,
      decodedSegmentOffset,
      decodedSegmentLength,
      decoded.sampleRate,
      rate,
    )
    if (duckingSources.length > 0) {
      samples = applyDucking(
        samples,
        duckingSources,
        segment,
        (intersection.intersectionStart / sampleRate) * fps,
        fps,
        decoded.sampleRate,
      )
    }
    if (decoded.sampleRate !== sampleRate) {
      samples = await resample(samples, decoded.sampleRate, sampleRate)
    }
    processed[channel] = samples
  }
  return processed
}

function mixAudioWindowChannels(
  mixed: Float32Array[],
  processed: Float32Array[],
  destinationOffset: number,
  requestedFrames: number,
): void {
  const downmixed = downmixToOutputChannels(processed, mixed.length)
  for (let channel = 0; channel < mixed.length; channel++) {
    const source = downmixed[channel]!
    const destination = mixed[channel]!
    const framesToMix = Math.min(
      requestedFrames,
      source.length,
      destination.length - destinationOffset,
    )
    for (let i = 0; i < framesToMix; i++) {
      destination[destinationOffset + i] = destination[destinationOffset + i]! + source[i]!
    }
  }
}

async function mixSegmentIntoAudioWindow(params: {
  segment: AudioSegment
  mixed: Float32Array[]
  chunkStart: number
  chunkEnd: number
  sampleRate: number
  rate: Rate
  fps: number
  decoderPool: WindowedAudioDecoderPool
  duckingSources: readonly DuckingSource[]
}): Promise<void> {
  const {
    segment,
    mixed,
    chunkStart,
    chunkEnd,
    sampleRate,
    rate,
    fps,
    decoderPool,
    duckingSources,
  } = params
  const intersection = resolveAudioWindowIntersection(
    segment,
    chunkStart,
    chunkEnd,
    sampleRate,
    rate,
  )
  if (!intersection) return

  const segmentOffset = intersection.intersectionStart - intersection.segmentStart
  const requestedFrames = intersection.intersectionEnd - intersection.intersectionStart
  const sourceStartTime =
    frameToSeconds(toRate(segment.sourceFps), segment.sourceStartFrame) + segmentOffset / sampleRate
  let decoded: DecodedAudio
  try {
    decoded = await decoderPool.decode(
      segment,
      sourceStartTime,
      sourceStartTime + requestedFrames / sampleRate,
    )
  } catch (error) {
    // A source with no audio track is silent in every window (DroneClean).
    if (error instanceof NoAudioTrackError) return
    throw error
  }
  const processed = await processAudioWindowChannels(
    decoded,
    segment,
    intersection,
    sampleRate,
    fps,
    rate,
    duckingSources,
  )
  mixAudioWindowChannels(
    mixed,
    processed,
    intersection.intersectionStart - chunkStart,
    requestedFrames,
  )
}

function applyAudioWindowMasterGain(mixed: Float32Array[], masterGain: number): void {
  for (const channel of mixed) {
    for (let i = 0; i < channel.length; i++) channel[i] = channel[i]! * masterGain
  }
}

/**
 * Mix long, non-stateful audio timelines in fixed windows. Every yielded chunk
 * begins exactly where the previous one ended, including silent windows.
 */
export async function* processAudioWindows(
  composition: CompositionInputProps,
  signal?: AbortSignal,
): AsyncGenerator<{ samples: Float32Array[]; sampleRate: number; channels: number }> {
  const { fps, durationInFrames = 0 } = composition
  // Ordering contract: sub-composition media URLs must be resolved before
  // extractAudioSegments runs, or nested items read as src-less and their audio
  // is silently dropped from the mix.
  await resolveSubCompMediaUrls(composition)

  const segments = extractAudioSegments(composition, fps).filter((segment) => !segment.muted)
  if (segments.length === 0 || !segments.every(supportsWindowedAudioSegment)) {
    throw new Error('Audio timeline requires full-segment processing')
  }

  if (segments.some((segment) => isAc3AudioCodec(segment.audioCodec))) {
    await ensureAc3DecoderRegistered()
  }

  const sampleRate = 48_000
  const channels = 2
  const rate = toRate(fps)
  const totalSamples = bufferSamples(durationInFrames, rate, sampleRate)
  const chunkSamples = STREAMING_AUDIO_CHUNK_SECONDS * sampleRate
  const masterGain =
    typeof composition.masterBusDb === 'number' && composition.masterBusDb !== 0
      ? dbToGain(composition.masterBusDb)
      : 1

  const duckingSources = collectDuckingSources(composition, fps)

  const decoderPool = await createWindowedAudioDecoderPool()
  try {
    for (let chunkStart = 0; chunkStart < totalSamples; chunkStart += chunkSamples) {
      if (signal?.aborted) throw new DOMException('Audio processing cancelled', 'AbortError')

      const chunkLength = Math.min(chunkSamples, totalSamples - chunkStart)
      const chunkEnd = chunkStart + chunkLength
      const mixed = [new Float32Array(chunkLength), new Float32Array(chunkLength)]

      for (const segment of segments) {
        await mixSegmentIntoAudioWindow({
          segment,
          mixed,
          chunkStart,
          chunkEnd,
          sampleRate,
          rate,
          fps,
          decoderPool,
          duckingSources,
        })
      }

      softClipAudioMix(mixed)
      applyAudioWindowMasterGain(mixed, masterGain)

      yield { samples: mixed, sampleRate, channels }
    }
  } finally {
    await decoderPool.dispose()
  }
}
