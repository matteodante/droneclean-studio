import type { AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve'
import type { ResolvedAudioEqSettings } from '@/types/audio'
import type { SpeedCurve } from '@/studio/speed'

/**
 * Shared clip-level playback controls used by all preview audio backends.
 * Transport-specific components add source identifiers on top of this shape.
 */
export interface AudioPlaybackProps {
  itemId: string
  liveGainItemIds?: string[]
  trimBefore?: number
  sourceFps?: number
  volume?: number
  playbackRate?: number
  isReversed?: boolean
  reverseSourceEnd?: number
  muted?: boolean
  durationInFrames: number
  audioFadeIn?: number
  audioFadeOut?: number
  audioFadeInCurve?: number
  audioFadeOutCurve?: number
  audioFadeInCurveX?: number
  audioFadeOutCurveX?: number
  /** Pitch offset in whole semitones (-12 to +12), set per-clip by the user */
  audioPitchSemitones?: number
  /** Fine pitch adjustment in cents (-100 to +100), applied additively after semitones */
  audioPitchCents?: number
  /** Pre-computed total pitch shift in semitones (semitones + cents/100 + parent composition shift) */
  audioPitchShiftSemitones?: number
  audioEqStages?: ResolvedAudioEqSettings[]
  clipFadeSpans?: AudioClipFadeSpan[]
  contentStartOffsetFrames?: number
  contentEndOffsetFrames?: number
  fadeInDelayFrames?: number
  fadeOutLeadFrames?: number
  crossfadeFadeIn?: number
  crossfadeFadeOut?: number
  volumeMultiplier?: number
  /** The clip's speed curve (design 7.1); the preview audio plays a ramp varispeed. */
  speedCurve?: SpeedCurve
  /** The cut fraction that goes with the curve, in [0, 1) (design 7.1, section 4.6). */
  sourceFrameOffset?: number
}
