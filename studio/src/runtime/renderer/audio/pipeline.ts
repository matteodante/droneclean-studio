/**
 * The full-segment audio pipeline: decode, DSP, ducking, mix and master bus.
 */

import type { CompositionInputProps } from '@/types/export'
import { createLogger } from '@/shared/logging/logger'
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/utils/ac3-decoder'
import { applyAudioEqStages } from '@/shared/utils/audio-eq'
import { isAudioPitchShiftActive } from '@/shared/utils/audio-pitch'
import { frameToSeconds, sampleAt, toRate, type Rate } from '@/studio/time'
import type { SpeedCurve } from '@/studio/speed'
import { curveSourceSeconds, resampleThroughCurve, type CurveAudioRead } from '@/studio/speed/audio'
import type { AudioProcessingConfig, AudioSegment } from './types'
import { decodeAudioFromSource, getErrorMessage } from './decode'
import { NoAudioTrackError } from '@/studio/render/no-audio-track'
import {
  applyAnimatedVolume,
  applyClipFadeSpans,
  applyFades,
  applySpeedAndPitch,
  applyVolume,
  dbToGain,
  resample,
  reverseAudioChannels,
} from './dsp'
import { applyDucking, collectDuckingSources } from './ducking'
import {
  createAudioMixBuffer,
  mixAudioSegmentInto,
  segmentSampleSpan,
  softClipAudioMix,
} from './mixdown'
import { resolveSubCompMediaUrls } from './media-urls'
import { extractAudioSegments } from './planning'

const log = createLogger('CanvasAudio/pipeline')

/**
 * How much source a curved segment is decoded past the curve's span: the cubic read looks two
 * samples beyond the position it reads, so the last output sample needs its two neighbours to
 * exist. In seconds at the mix rate, which is 48 kHz for every export.
 */
const CURVED_READ_AHEAD_SECONDS = 2 / 48_000

/**
 * The source seconds a curved segment needs from its decoded start: the curve's exact span,
 * from its integral rather than from `duration · speed` (an average is a length, and this is
 * the span the read walks), the remainder of a cut between two source frames — the read sits
 * that much further into the source — and the read's reach past the last sample.
 */
function curvedSourceSeconds(segment: AudioSegment, curve: SpeedCurve, rate: Rate): number {
  const preRollFrames = Math.max(0, segment.itemFrom - segment.startFrame)
  return (
    curveSourceSeconds(
      { curve, projectRate: rate, preRollFrames, averageSpeed: segment.speed },
      segment.durationFrames - preRollFrames,
    ) +
    cutRemainderSeconds(segment) +
    CURVED_READ_AHEAD_SECONDS
  )
}

/**
 * The remainder of a cut between two source frames, in source seconds: the clip starts that
 * much after the whole source frame it was decoded from, so both the decode's end and the
 * sound's start move by it (design 7.1, section 4.6). 0 for a clip that starts on a frame.
 */
function cutRemainderSeconds(segment: AudioSegment): number {
  const cutFrames = segment.sourceFrameOffset ?? 0
  if (cutFrames === 0) return 0
  const source = toRate(segment.sourceFps)
  return (cutFrames * source.den) / source.num
}

/**
 * The remainder of a cut between two source frames, in decoded samples:
 * `round(remainder · sampleRate · sDen / sNum)`. The constant-speed path trims that many samples
 * off the decoded start, so its sound starts on the picture's source position; the varispeed
 * path adds the remainder to each read instead.
 */
function cutRemainderSamples(segment: AudioSegment, sampleRate: number): number {
  const cutFrames = segment.sourceFrameOffset ?? 0
  if (cutFrames === 0) return 0
  const source = toRate(segment.sourceFps)
  return Math.round((cutFrames * sampleRate * source.den) / source.num)
}

/**
 * Apply a clip's speed curve to its decoded audio: a varispeed read through the curve, the
 * sound following the speed (design 7.1, section 4.3). The clip's own pitch shift is a shift
 * of its sound, independent of the speed, so it runs on the resampled channels afterwards.
 */
async function applySpeedCurveAudio(params: {
  channels: Float32Array[]
  segment: AudioSegment
  curve: SpeedCurve
  rate: Rate
  sampleRate: number
  outputSampleRate: number
  span: { startSample: number; endSample: number }
}): Promise<Float32Array[]> {
  const { channels, segment, curve, rate, sampleRate, outputSampleRate, span } = params
  const read: CurveAudioRead = {
    curve,
    projectRate: rate,
    sourceRate: toRate(segment.sourceFps),
    sourceSampleRate: sampleRate,
    outputSampleRate,
    firstOutputSample: span.startSample,
    outputSampleCount: Math.max(0, span.endSample - span.startSample),
    clipStartFrame: segment.itemFrom,
    preRollFrames: Math.max(0, segment.itemFrom - segment.startFrame),
    averageSpeed: segment.speed,
    sourceFrameOffset: segment.sourceFrameOffset ?? 0,
  }
  const resampled = resampleThroughCurve(channels, read)
  if (!isAudioPitchShiftActive(segment.pitchShiftSemitones)) return resampled
  return applySpeedAndPitch(resampled, 1, segment.pitchShiftSemitones, read.sourceSampleRate)
}

/**
 * Process all audio for the composition.
 *
 * @param composition - The composition with tracks
 * @param signal - Optional abort signal
 * @returns Processed audio ready for encoding
 */
export async function processAudio(
  composition: CompositionInputProps,
  signal?: AbortSignal,
): Promise<{
  samples: Float32Array[]
  sampleRate: number
  channels: number
} | null> {
  const { fps, durationInFrames = 0 } = composition
  const rate = toRate(fps)

  // Ordering contract: sub-composition media URLs must be resolved before
  // extractAudioSegments runs, or nested items read as src-less and their audio
  // is silently dropped from the mix.
  await resolveSubCompMediaUrls(composition)

  // Extract audio segments
  const segments = extractAudioSegments(composition, fps)

  // Filter out muted segments early
  const activeSegments = segments.filter((s) => !s.muted)

  if (activeSegments.length === 0) {
    log.info('No audio segments to process')
    return null
  }

  const requiresAc3Decoder = activeSegments.some((segment) => isAc3AudioCodec(segment.audioCodec))
  if (requiresAc3Decoder) {
    await ensureAc3DecoderRegistered()
    log.debug('AC-3 decoder pre-registered for export audio decode')
  }

  const duckingSources = collectDuckingSources(composition, fps)

  // Configuration
  const config: AudioProcessingConfig = {
    sampleRate: 48000, // Standard export sample rate
    channels: 2, // Stereo
    fps,
    totalFrames: durationInFrames,
  }

  log.info('Processing audio', {
    segmentCount: activeSegments.length,
    sampleRate: config.sampleRate,
    channels: config.channels,
    durationSeconds: frameToSeconds(rate, durationInFrames),
  })

  // Allocate the final mix once, then fold each processed segment into it
  // immediately. Keeping every decoded segment alive until the end multiplies
  // memory use on long, multi-clip timelines.
  const mixedSamples = createAudioMixBuffer(config)
  let processedSegmentCount = 0

  for (const segment of activeSegments) {
    if (signal?.aborted) {
      throw new DOMException('Audio processing cancelled', 'AbortError')
    }

    try {
      // Calculate the time range we actually need from the source
      // sourceStartFrame is in source-native FPS frames, so divide by sourceFps (not project fps)
      const sourceStartTime = frameToSeconds(toRate(segment.sourceFps), segment.sourceStartFrame)
      // Account for speed: at 2x speed, we need twice as much source audio. A curve's exact
      // span comes from its integral; `segment.speed` is the curve's average, a length. The
      // cut's remainder is source the clip starts into, so the end covers it too.
      const curve = segment.speedCurve
      const sourceEndTime =
        curve === undefined
          ? // The constant-speed span, plus the remainder the clip starts into.
            sourceStartTime +
            frameToSeconds(rate, segment.durationFrames) * segment.speed +
            cutRemainderSeconds(segment)
          : sourceStartTime + curvedSourceSeconds(segment, curve, rate)

      // Decode ONLY the needed range using mediabunny (huge performance improvement!)
      const decoded = await decodeAudioFromSource(
        segment.src,
        segment.itemId,
        sourceStartTime,
        sourceEndTime,
        segment.audioCodec,
      )

      // Where the segment sits on the mix grid: its first sample and its exact length, the
      // same boundary `mixAudioSegmentInto` places it at below (design 1.5, 4.3).
      const span = segmentSampleSpan(segment, rate, config.sampleRate)

      // Process audio channels.
      // Note: decoded audio is already trimmed to the range we requested. A curved segment's
      // read positions are offsets into that range, so the trim's own start cancels out.

      // Apply speed across ALL channels at once to maintain phase coherence
      // between L/R (the WSOLA pipeline finds shared overlap windows).
      let processedChannels = decoded.samples
      if (curve === undefined && segment.isReversed !== true) {
        // A cut between two source frames (design 7.1, section 4.6): the constant-speed path
        // plays from the whole source frame it decoded, so it drops the remainder's samples
        // and starts on the picture's source position. The varispeed read adds the remainder
        // per sample instead (`applySpeedCurveAudio`).
        const cutSamples = cutRemainderSamples(segment, decoded.sampleRate)
        if (cutSamples > 0) {
          processedChannels = processedChannels.map((channel) => channel.subarray(cutSamples))
        }
      }
      if (segment.isReversed) {
        processedChannels = reverseAudioChannels(processedChannels)
      }
      if (curve !== undefined) {
        // The sound follows the speed (design 7.1, 4.3): every output sample reads the source
        // where the curve's integral puts it, so the mix has exactly the segment's samples.
        processedChannels = await applySpeedCurveAudio({
          channels: processedChannels,
          segment,
          curve,
          rate,
          sampleRate: decoded.sampleRate,
          outputSampleRate: config.sampleRate,
          span,
        })
      } else if (
        Math.abs(segment.speed - 1) > 0.0001 ||
        isAudioPitchShiftActive(segment.pitchShiftSemitones)
      ) {
        processedChannels = await applySpeedAndPitch(
          processedChannels,
          segment.speed,
          segment.pitchShiftSemitones,
          decoded.sampleRate,
        )
      }
      processedChannels = applyAudioEqStages(
        processedChannels,
        decoded.sampleRate,
        segment.audioEqStages,
      )

      // Apply per-channel volume, fades, and resampling
      const fadeInSamples = sampleAt(segment.fadeInFrames, rate, decoded.sampleRate)
      const fadeOutSamples = sampleAt(segment.fadeOutFrames, rate, decoded.sampleRate)
      const crossfadeFadeInSamples = sampleAt(
        segment.crossfadeFadeInFrames ?? 0,
        rate,
        decoded.sampleRate,
      )
      const crossfadeFadeOutSamples = sampleAt(
        segment.crossfadeFadeOutFrames ?? 0,
        rate,
        decoded.sampleRate,
      )
      const contentStartOffsetSamples = sampleAt(
        segment.contentStartOffsetFrames ?? 0,
        rate,
        decoded.sampleRate,
      )
      const contentEndOffsetSamples = sampleAt(
        segment.contentEndOffsetFrames ?? 0,
        rate,
        decoded.sampleRate,
      )
      const fadeInDelaySamples = sampleAt(segment.fadeInDelayFrames ?? 0, rate, decoded.sampleRate)
      const fadeOutLeadSamples = sampleAt(segment.fadeOutLeadFrames ?? 0, rate, decoded.sampleRate)

      for (let c = 0; c < processedChannels.length; c++) {
        let channelSamples = processedChannels[c]!

        // Apply volume (animated if keyframes exist, static otherwise)
        if (segment.volumeKeyframes && segment.volumeKeyframes.length > 0) {
          channelSamples = applyAnimatedVolume(
            channelSamples,
            segment.volumeKeyframes,
            segment.volume,
            segment.startFrame,
            segment.itemFrom,
            fps,
            decoded.sampleRate,
          )
        } else if (segment.volume !== 0) {
          channelSamples = applyVolume(channelSamples, segment.volume)
        }

        // Apply fades
        if (segment.clipFadeSpans && segment.clipFadeSpans.length > 0) {
          channelSamples = applyClipFadeSpans(
            channelSamples,
            segment.clipFadeSpans,
            decoded.sampleRate,
            fps,
          )
        } else if (fadeInSamples > 0 || fadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            fadeInSamples,
            fadeOutSamples,
            false,
            segment.fadeInCurve,
            segment.fadeOutCurve,
            segment.fadeInCurveX,
            segment.fadeOutCurveX,
            contentStartOffsetSamples,
            contentEndOffsetSamples,
            fadeInDelaySamples,
            fadeOutLeadSamples,
          )
        }

        if (crossfadeFadeInSamples > 0 || crossfadeFadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            crossfadeFadeInSamples,
            crossfadeFadeOutSamples,
            true,
          )
        }

        if (duckingSources.length > 0) {
          channelSamples = applyDucking(
            channelSamples,
            duckingSources,
            segment,
            segment.startFrame,
            fps,
            decoded.sampleRate,
          )
        }

        // Resample to target sample rate
        if (decoded.sampleRate !== config.sampleRate) {
          channelSamples = await resample(channelSamples, decoded.sampleRate, config.sampleRate)
        }

        processedChannels[c] = channelSamples
      }

      // The segment's span was resolved before the read: `startSample` is where it begins in
      // the mix, the same boundary the varispeed read wrote its first sample at.
      mixAudioSegmentInto(
        mixedSamples,
        { samples: processedChannels, startSample: span.startSample },
        config,
      )
      processedSegmentCount++

      log.debug('Processed audio segment', {
        itemId: segment.itemId,
        type: segment.type,
        startSample: span.startSample,
        outputSamples: processedChannels[0]?.length,
      })
    } catch (error) {
      // A source with no audio track is silent, not a failure (DroneClean).
      if (error instanceof NoAudioTrackError) {
        log.debug('Audio segment source has no audio track', { itemId: segment.itemId })
        continue
      }
      log.error(`Failed to process audio segment ${segment.itemId}: ${getErrorMessage(error)}`)
      // Continue with other segments
    }
  }

  if (processedSegmentCount === 0) {
    log.warn('No audio segments were successfully processed')
    return null
  }

  softClipAudioMix(mixedSamples)

  // Apply project-scoped master bus gain to the final mix. Monitor volume
  // (per-device) is intentionally NOT applied during export — it's a
  // preview-only setting.
  const masterBusDb = composition.masterBusDb
  if (typeof masterBusDb === 'number' && masterBusDb !== 0) {
    const masterBusGain = dbToGain(masterBusDb)
    for (const channel of mixedSamples) {
      for (let i = 0; i < channel.length; i++) {
        channel[i] = channel[i]! * masterBusGain
      }
    }
  }

  log.info('Audio processing complete', {
    outputSamples: mixedSamples[0]?.length,
    channels: mixedSamples.length,
    durationSeconds: (mixedSamples[0]?.length ?? 0) / config.sampleRate,
    masterBusDb: masterBusDb ?? 0,
  })

  return {
    samples: mixedSamples,
    sampleRate: config.sampleRate,
    channels: config.channels,
  }
}

/**
 * Check if composition has any audio content.
 * Async because sub-composition media URLs may need to be resolved from OPFS
 * before extractAudioSegments can see valid src values.
 */
export async function hasAudioContent(composition: CompositionInputProps): Promise<boolean> {
  // Ordering contract: sub-composition media URLs must be resolved before
  // extractAudioSegments runs, or nested items read as src-less and their audio
  // is silently dropped from the mix.
  await resolveSubCompMediaUrls(composition)
  const segments = extractAudioSegments(composition, composition.fps)
  return segments.some((s) => !s.muted)
}
