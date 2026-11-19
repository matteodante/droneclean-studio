export const SOUND_TOUCH_PREVIEW_PROCESSOR_NAME = 'freecut-soundtouch-preview'

export interface SoundTouchAppendSourceMessage {
  type: 'append-source'
  startFrame: number
  leftChannel: ArrayBuffer
  rightChannel: ArrayBuffer
  frameCount: number
  sampleRate: number
}

export interface SoundTouchSeekMessage {
  type: 'seek'
  frame: number
  direction?: -1 | 1
}

export interface SoundTouchSetTempoMessage {
  type: 'set-tempo'
  tempo: number
}

/**
 * The SoundTouch `rate`: speed and pitch move together. On a speed ramp the preview reads the
 * source varispeed, so the pitch follows the speed (design 7.1, section 4.3); at 1 it is the
 * identity, and a constant-speed clip keeps the pitch its tempo preserves.
 */
export interface SoundTouchSetRateMessage {
  type: 'set-rate'
  rate: number
}

export interface SoundTouchSetPitchMessage {
  type: 'set-pitch'
  pitch: number
}

export interface SoundTouchSetPlayingMessage {
  type: 'set-playing'
  playing: boolean
}

export interface SoundTouchResetMessage {
  type: 'reset'
}

export type SoundTouchPreviewProcessorMessage =
  | SoundTouchAppendSourceMessage
  | SoundTouchSeekMessage
  | SoundTouchSetTempoMessage
  | SoundTouchSetRateMessage
  | SoundTouchSetPitchMessage
  | SoundTouchSetPlayingMessage
  | SoundTouchResetMessage
