/**
 * `studio.playback`: the transport (design §4.2, §4.4).
 *
 * The playhead is part of the timeline snapshot (`commands/types.ts:27`), so a
 * seek inside a transaction would become an undo entry. Every method here
 * writes the playback store directly, the way the transport controls do, and
 * none of them is an undo step.
 */

import type { Frame, PlaybackApi, PlaybackInfo } from '../types'
import { usePlaybackStore } from '@/shared/state/playback'
import { describeContext, getTimelineContext, timelineDuration } from '../context'
import { invalidArgumentError } from '../errors'

/**
 * Create the `studio.playback` namespace over `usePlaybackStore`.
 * @example const playback = createPlaybackApi()
 */
export function createPlaybackApi(): PlaybackApi {
  return {
    get(): PlaybackInfo {
      const state = usePlaybackStore.getState()
      return {
        frame: state.currentFrame,
        playing: state.isPlaying,
        rate: state.playbackRate,
        loop: state.loop,
      }
    },

    seek(frame: Frame): void {
      // The same length `project.duration()` reports, so `duration() - 1` is the
      // last frame a caller can seek to and `duration()` itself is not.
      const lastFrame = Math.max(0, timelineDuration() - 1)
      const context = describeContext(getTimelineContext())
      if (!(Number.isInteger(frame) && frame >= 0 && frame <= lastFrame)) {
        throw invalidArgumentError({
          method: 'playback.seek',
          argument: 'frame',
          expectation: `an integer frame from 0 to ${lastFrame} on ${context}`,
          value: frame,
        })
      }
      usePlaybackStore.getState().setCurrentFrame(frame)
    },

    play(): void {
      // The store's `play` resets the rate to 1 (`playback/store.ts`,
      // `enterNormalPlayback`); the SDK keeps the rate `setRate` chose.
      const { playbackRate } = usePlaybackStore.getState()
      usePlaybackStore.getState().play()
      if (playbackRate !== 1) usePlaybackStore.getState().setPlaybackRate(playbackRate)
    },

    pause(): void {
      usePlaybackStore.getState().pause()
    },

    setRate(rate: number): void {
      if (!(Number.isFinite(rate) && rate > 0)) {
        throw invalidArgumentError({
          method: 'playback.setRate',
          argument: 'rate',
          expectation: 'a positive number',
          value: rate,
        })
      }
      usePlaybackStore.getState().setPlaybackRate(rate)
    },

    setLoop(on: boolean): void {
      if (typeof on !== 'boolean') {
        throw invalidArgumentError({
          method: 'playback.setLoop',
          argument: 'on',
          expectation: 'true or false',
          value: on,
        })
      }
      const state = usePlaybackStore.getState()
      if (state.loop === on) return
      state.toggleLoop()
    },
  }
}
