import React, { useEffect, useRef, useState } from 'react'
import { useGizmoStore } from '@/runtime/composition-runtime/deps/stores'
import { usePlaybackStore } from '@/runtime/composition-runtime/deps/stores'
import { createLogger } from '@/shared/logging/logger'
import { getAudioPitchRatioFromSemitones } from '@/shared/utils/audio-pitch'
import type { AudioPlaybackProps } from './audio-playback-props'
import { getBrowserMediaPlaybackRate } from '@/shared/state/playback/shuttle'
import { useAudioPlaybackState } from './hooks/use-audio-playback-state'
import { useReverseShuttleAudio } from './hooks/use-reverse-shuttle-audio'
import { getAudioTargetTimeSeconds } from '../utils/video-timing'
import {
  createPreviewClipAudioGraph,
  rampPreviewClipEq,
  rampPreviewClipGain,
  type PreviewClipAudioGraph,
} from '../utils/preview-audio-graph'
import {
  ensureSoundTouchPreviewWorkletLoaded,
  prepareAudioBufferForSoundTouchPreview,
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME,
} from '../utils/soundtouch-preview-worklet'
import type { SoundTouchPreviewProcessorMessage } from '../utils/soundtouch-preview-shared'
import { constantSpeed, speedAt, type SpeedCurve } from '@/studio/speed'

const log = createLogger('SoundTouchWorkletAudio')
const SEEK_TOLERANCE_SECONDS = 0.05
const DRIFT_RESYNC_BEHIND_THRESHOLD_SECONDS = -0.2
const DRIFT_RESYNC_AHEAD_THRESHOLD_SECONDS = 0.5

interface SoundTouchWorkletAudioProps extends AudioPlaybackProps {
  audioBuffer: AudioBuffer
  sourceStartOffsetSec?: number
  isComplete?: boolean
  fallback?: React.ReactNode
  /**
   * The clip's speed curve, if it has one (design 7.1). A ramp plays varispeed: the worklet's
   * `rate` is `speedAt(frame)` and the pitch follows the speed (design 7.1, section 4.3); the
   * seek is the curve's source position, not the clip's average speed. A reversed clip ignores
   * its curve, as every renderer does (design 7.1, section 4.6).
   */
  speedCurve?: SpeedCurve
  /**
   * The fraction, in [0, 1), of the source position at the clip's first frame: the remainder a
   * cut between two source frames keeps (design 7.1, section 4.6). It belongs to
   * `speedCurve` and is added to the integral before the floor; absent means 0.
   */
  sourceFrameOffset?: number
}

export const SoundTouchWorkletAudio: React.FC<SoundTouchWorkletAudioProps> = React.memo(
  ({
    audioBuffer,
    itemId,
    volume = 0,
    playbackRate = 1,
    isReversed = false,
    reverseSourceEnd,
    trimBefore = 0,
    sourceFps,
    sourceStartOffsetSec = 0,
    fallback,
    muted = false,
    durationInFrames,
    audioFadeIn = 0,
    audioFadeOut = 0,
    audioFadeInCurve = 0,
    audioFadeOutCurve = 0,
    audioFadeInCurveX = 0.52,
    audioFadeOutCurveX = 0.52,
    audioPitchSemitones,
    audioPitchCents,
    audioPitchShiftSemitones,
    audioEqStages,
    clipFadeSpans,
    contentStartOffsetFrames = 0,
    contentEndOffsetFrames = 0,
    fadeInDelayFrames = 0,
    fadeOutLeadFrames = 0,
    crossfadeFadeIn,
    crossfadeFadeOut,
    liveGainItemIds,
    volumeMultiplier = 1,
    speedCurve,
    sourceFrameOffset = 0,
  }) => {
    const {
      frame,
      fps,
      playing,
      transportPlaybackRate,
      resolvedVolume: finalVolume,
      resolvedPitchShiftSemitones,
      resolvedAudioEqStages,
    } = useAudioPlaybackState({
      itemId,
      liveGainItemIds,
      volume,
      muted,
      durationInFrames,
      audioFadeIn,
      audioFadeOut,
      audioFadeInCurve,
      audioFadeOutCurve,
      audioFadeInCurveX,
      audioFadeOutCurveX,
      audioPitchSemitones,
      audioPitchCents,
      audioPitchShiftSemitones,
      audioEqStages,
      clipFadeSpans,
      contentStartOffsetFrames,
      contentEndOffsetFrames,
      fadeInDelayFrames,
      fadeOutLeadFrames,
      crossfadeFadeIn,
      crossfadeFadeOut,
      volumeMultiplier,
    })
    const isReverseShuttle = transportPlaybackRate < 0
    const mediaPlaybackRate = getBrowserMediaPlaybackRate(playbackRate, transportPlaybackRate)
    // A reversed clip ignores its curve, as `video-timing.ts` and every renderer do (design
    // 7.1, section 4.6), and a curve that holds one speed is that speed (review finding T6):
    // it keeps today's pitch-preserving tempo, exactly as the export plays it.
    const curve =
      isReversed || speedCurve === undefined || constantSpeed(speedCurve) !== undefined
        ? undefined
        : speedCurve
    // A ramped clip plays varispeed: the worklet's `rate` is the clip's own speed at the
    // playhead, so the pitch follows the speed and the audio position is the video's mapping
    // (design 7.1, section 4.3). `tempo` then carries only the transport's factor, which stays
    // pitch-preserved; a constant-speed clip keeps today's tempo with a rate of 1, the
    // processor's identity. A premounted frame is negative and the clip starts on its first
    // key, so the rate is clamped at the clip's own first frame.
    const curveRate = curve !== undefined ? speedAt(curve, Math.max(0, frame)) : 1
    const timeStretchTempo = Math.max(
      0.0625,
      Math.min(16, (curve !== undefined ? 1 : playbackRate) * Math.abs(transportPlaybackRate)),
    )
    // Source seconds consumed per second of output: what the worklet reads while it plays.
    const sourceSecondsPerContextSecond = timeStretchTempo * curveRate
    const sourceDirection: -1 | 1 = (isReversed ? -1 : 1) * (isReverseShuttle ? -1 : 1) < 0 ? -1 : 1

    const graphRef = useRef<PreviewClipAudioGraph | null>(null)
    const nodeRef = useRef<AudioWorkletNode | null>(null)
    const [nodeReady, setNodeReady] = useState(false)
    const [fallbackRequested, setFallbackRequested] = useState(false)
    const needsInitialSyncRef = useRef(true)
    const lastSyncWallClockRef = useRef(Date.now())
    const lastSyncContextTimeRef = useRef(0)
    const lastStartOffsetRef = useRef(0)
    const lastStartRateRef = useRef(mediaPlaybackRate)
    const lastFrameRef = useRef(-1)
    const shuttleFrameRef = useRef(frame)
    shuttleFrameRef.current = frame
    const lastPostedPlayingRef = useRef<boolean | null>(null)
    const mutedRef = useRef(muted)
    const finalVolumeRef = useRef(finalVolume)
    mutedRef.current = muted
    finalVolumeRef.current = finalVolume

    const postMessage = (
      message: SoundTouchPreviewProcessorMessage,
      transfer: Transferable[] = [],
    ): void => {
      nodeRef.current?.port.postMessage(message, transfer)
    }

    const postSeekSeconds = (seconds: number, sampleRate: number, direction: -1 | 1 = 1): void => {
      postMessage({
        type: 'seek',
        frame: Math.max(0, Math.floor(seconds * sampleRate)),
        direction,
      })
    }

    useEffect(() => {
      if (playing) {
        needsInitialSyncRef.current = true
      }
    }, [playing])

    useEffect(() => {
      // Keep the preview graph alive across EQ toggles; the EQ stages ramp in place below.
      const graph = createPreviewClipAudioGraph()
      if (!graph) {
        setFallbackRequested(true)
        return
      }
      graphRef.current = graph

      let cancelled = false
      const teardownNode = () => {
        try {
          nodeRef.current?.port.postMessage({ type: 'reset' })
        } catch {
          // Ignore teardown races.
        }
        nodeRef.current?.disconnect()
        nodeRef.current = null
        setNodeReady(false)
        graph.dispose()
        if (graphRef.current === graph) {
          graphRef.current = null
        }
      }

      ensureSoundTouchPreviewWorkletLoaded(graph.context)
        .then((loaded) => {
          if (cancelled) {
            return
          }
          if (!loaded) {
            teardownNode()
            setFallbackRequested(true)
            return
          }

          let node: AudioWorkletNode
          try {
            node = new AudioWorkletNode(graph.context, SOUND_TOUCH_PREVIEW_PROCESSOR_NAME, {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [2],
              channelCount: 2,
              channelCountMode: 'explicit',
              channelInterpretation: 'speakers',
            })
          } catch (error) {
            log.warn('Failed to construct SoundTouch preview node', { error })
            teardownNode()
            setFallbackRequested(true)
            return
          }

          node.connect(graph.sourceInputNode)
          nodeRef.current = node

          // Reapply current gain so the rebuilt graph doesn't start silent
          const clampedVolume = mutedRef.current ? 0 : Math.max(0, finalVolumeRef.current)
          graph.outputGainNode.gain.value = clampedVolume

          setFallbackRequested(false)
          setNodeReady(true)
        })
        .catch((error) => {
          if (!cancelled) {
            log.warn('Failed to initialize SoundTouch preview node', { error })
            teardownNode()
            setFallbackRequested(true)
          }
        })

      return () => {
        cancelled = true
        setNodeReady(false)
        lastPostedPlayingRef.current = null
        teardownNode()
      }
    }, [])

    useEffect(() => {
      const resume = () => {
        const graph = graphRef.current
        if (graph?.context.state === 'suspended') {
          void graph.context.resume().catch(() => undefined)
        }
      }

      window.addEventListener('pointerdown', resume, { capture: true })
      window.addEventListener('keydown', resume, { capture: true })

      return () => {
        window.removeEventListener('pointerdown', resume, { capture: true })
        window.removeEventListener('keydown', resume, { capture: true })
      }
    }, [])

    useEffect(() => {
      const graph = graphRef.current
      if (!graph) return
      const clampedVolume = muted ? 0 : Math.max(0, finalVolume)
      rampPreviewClipGain(graph, clampedVolume)
    }, [finalVolume, muted])

    useEffect(() => {
      const graph = graphRef.current
      if (!graph) return
      rampPreviewClipEq(graph, resolvedAudioEqStages)
    }, [resolvedAudioEqStages])

    useReverseShuttleAudio({
      graphRef,
      buffer: fallbackRequested && isReverseShuttle ? audioBuffer : null,
      frameRef: shuttleFrameRef,
      fps,
      trimBefore,
      sourceFps,
      sourceStartOffsetSec,
      authoredPlaybackRate: playbackRate,
      authoredReversed: isReversed,
      reverseSourceEnd,
      playing,
      transportPlaybackRate,
    })

    useEffect(() => {
      if (!nodeReady) return
      postMessage({
        type: 'set-tempo',
        tempo: timeStretchTempo,
      })
    }, [nodeReady, timeStretchTempo])

    useEffect(() => {
      if (!nodeReady) return
      postMessage({
        type: 'set-rate',
        rate: curveRate,
      })
    }, [nodeReady, curveRate])

    useEffect(() => {
      if (!nodeReady) return
      postMessage({
        type: 'set-pitch',
        pitch: getAudioPitchRatioFromSemitones(resolvedPitchShiftSemitones),
      })
    }, [nodeReady, resolvedPitchShiftSemitones])

    useEffect(() => {
      const graph = graphRef.current
      const node = nodeRef.current
      if (!graph || !node || !nodeReady) {
        return
      }

      let cancelled = false
      void prepareAudioBufferForSoundTouchPreview(audioBuffer, graph.context.sampleRate)
        .then((serialized) => {
          if (cancelled || nodeRef.current !== node) return
          const leftChannel = serialized.leftChannel.buffer as ArrayBuffer
          const rightChannel = serialized.rightChannel.buffer as ArrayBuffer
          postMessage(
            {
              type: 'append-source',
              startFrame: Math.max(0, Math.floor(sourceStartOffsetSec * graph.context.sampleRate)),
              leftChannel,
              rightChannel,
              frameCount: serialized.frameCount,
              sampleRate: serialized.sampleRate,
            },
            [leftChannel, rightChannel],
          )
        })
        .catch((error) => {
          if (cancelled) return
          log.warn('Failed to prepare SoundTouch preview source', { error })
          setFallbackRequested(true)
        })

      return () => {
        cancelled = true
      }
    }, [audioBuffer, nodeReady, sourceStartOffsetSec])

    useEffect(() => {
      const graph = graphRef.current
      if (!graph || !nodeReady) return

      const effectiveSourceFps = sourceFps ?? fps
      const sourceTimeSeconds = getAudioTargetTimeSeconds(
        trimBefore,
        effectiveSourceFps,
        frame,
        playbackRate,
        fps,
        isReversed,
        reverseSourceEnd,
        curve,
        sourceFrameOffset,
      )
      const clipStartTimeSeconds = Math.max(0, trimBefore / effectiveSourceFps)
      const isPremounted = frame < 0
      const targetTimeSeconds = isPremounted ? clipStartTimeSeconds : Math.max(0, sourceTimeSeconds)
      const clampedTargetTime = Math.max(0, targetTimeSeconds)

      const frameChanged = frame !== lastFrameRef.current
      lastFrameRef.current = frame

      const postPlayingState = (nextPlaying: boolean) => {
        if (lastPostedPlayingRef.current === nextPlaying) return
        postMessage({ type: 'set-playing', playing: nextPlaying })
        lastPostedPlayingRef.current = nextPlaying
      }

      const syncPremountedFrame = () => {
        postPlayingState(false)
        if (Math.abs(lastStartOffsetRef.current - clipStartTimeSeconds) > SEEK_TOLERANCE_SECONDS) {
          postSeekSeconds(clipStartTimeSeconds, graph.context.sampleRate, sourceDirection)
          lastStartOffsetRef.current = clipStartTimeSeconds
        }
        needsInitialSyncRef.current = true
      }

      const syncPlayingFrame = () => {
        if (graph.context.state === 'suspended') {
          void graph.context.resume().catch(() => undefined)
        }

        const now = graph.context.currentTime
        const expectedOffset =
          lastStartOffsetRef.current +
          Math.max(0, now - lastSyncContextTimeRef.current) *
            lastStartRateRef.current *
            sourceDirection
        // The rate follows the curve, so the next interval is predicted from the rate now in
        // force, not from the one the last sync saw. For a constant-speed clip the two are the
        // same value (`timeStretchTempo`).
        lastStartRateRef.current = sourceSecondsPerContextSecond
        const drift = expectedOffset - clampedTargetTime
        const timeSinceLastSync = Date.now() - lastSyncWallClockRef.current
        const audioBehind = drift * sourceDirection < DRIFT_RESYNC_BEHIND_THRESHOLD_SECONDS
        const audioFarAhead = drift * sourceDirection > DRIFT_RESYNC_AHEAD_THRESHOLD_SECONDS
        const needsSync =
          needsInitialSyncRef.current || audioFarAhead || (audioBehind && timeSinceLastSync > 500)

        if (needsSync) {
          postSeekSeconds(clampedTargetTime, graph.context.sampleRate, sourceDirection)
          lastSyncContextTimeRef.current = now
          lastSyncWallClockRef.current = Date.now()
          lastStartOffsetRef.current = clampedTargetTime
          needsInitialSyncRef.current = false
        }

        postPlayingState(true)
      }

      const syncPausedFrame = () => {
        postPlayingState(false)
        const playbackState = usePlaybackStore.getState()
        const isPreviewScrubbing =
          !playbackState.isPlaying &&
          playbackState.previewFrame !== null &&
          useGizmoStore.getState().activeGizmo === null

        if (frameChanged && !isPreviewScrubbing) {
          postSeekSeconds(clampedTargetTime, graph.context.sampleRate)
          lastStartOffsetRef.current = clampedTargetTime
        }

        needsInitialSyncRef.current = true
      }

      if (isPremounted) {
        syncPremountedFrame()
        return
      }
      if (playing) syncPlayingFrame()
      else syncPausedFrame()
    }, [
      curve,
      fps,
      frame,
      isReversed,
      isReverseShuttle,
      mediaPlaybackRate,
      nodeReady,
      playbackRate,
      playing,
      reverseSourceEnd,
      sourceDirection,
      sourceFps,
      sourceFrameOffset,
      sourceSecondsPerContextSecond,
      trimBefore,
    ])

    if (fallbackRequested && fallback) {
      return <>{fallback}</>
    }

    if (fallbackRequested) {
      return null
    }

    return null
  },
)
