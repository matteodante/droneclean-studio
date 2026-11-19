import { frameToSeconds, rateValue, secondsToFrame, toRate } from '@/studio/time'

/**
 * Time components decomposed from total seconds
 */
interface TimeComponents {
  hours: number
  minutes: number
  seconds: number
}

/**
 * Timecode fields of a frame index: whole seconds plus the frame within the second.
 */
interface TimecodeFields extends TimeComponents {
  frames: number
}

/**
 * Decompose total seconds into hours, minutes, and seconds
 * @param totalSeconds - Total time in seconds
 * @returns Object with hours, minutes, and seconds
 */
function decomposeSeconds(totalSeconds: number): TimeComponents {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: Math.floor(totalSeconds % 60),
  }
}

/**
 * Validate FPS parameter
 * @param fps - Frames per second
 * @throws Error if fps is not positive
 */
function validateFps(fps: number): void {
  if (fps <= 0) {
    throw new Error(`Invalid FPS: ${fps}. FPS must be a positive number.`)
  }
}

/**
 * The nominal rate a timecode counts with: the rate itself for an integer rate, and the
 * fractional rate's nominal family otherwise — 60 at 59.94, 30 at 29.97, 24 at 23.976. A
 * timecode is non-drop (design 1.5, section 4.4): every timecode second holds the nominal
 * number of frames, so at 59.94 the display runs 0.1 % fast against real time, the usual
 * non-drop trade, and the frame numbers it prints are the frame indices the editor edits.
 * @param fps - Frames per second
 * @returns Frames per timecode second
 */
function nominalRate(fps: number): number {
  validateFps(fps)
  // A rate slower than half a frame per second still counts one frame per timecode second,
  // so the split below cannot divide by zero.
  return Math.max(1, Math.round(rateValue(toRate(fps))))
}

/**
 * Split a frame index into the fields of non-drop timecode.
 * @param frame - Frame index
 * @param nominal - Frames per timecode second, from `nominalRate`
 * @returns Hours, minutes, seconds and the frame within the second
 */
function decomposeFrame(frame: number, nominal: number): TimecodeFields {
  const totalSeconds = Math.floor(frame / nominal)
  return {
    ...decomposeSeconds(totalSeconds),
    frames: Math.floor(frame % nominal),
  }
}

/**
 * Format a frame number as non-drop timecode (HH:MM:SS:FF)
 * @param frame - Frame number
 * @param fps - Frames per second
 * @returns Formatted timecode string (e.g., "00:01:23:15")
 */
export function formatTimecode(frame: number, fps: number): string {
  const { hours, minutes, seconds, frames } = decomposeFrame(frame, nominalRate(fps))

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

/**
 * Compact non-drop timecode — drops leading zero segments (e.g., "01:23:15" instead of "00:01:23:15")
 * Always keeps at least MM:SS:FF.
 */
export function formatTimecodeCompact(frame: number, fps: number): string {
  const { hours, minutes, seconds, frames } = decomposeFrame(frame, nominalRate(fps))

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
  }
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

/**
 * Non-drop timecode with a dot before the frame count — MM:SS.FF, promoting to
 * HH:MM:SS.FF once the duration reaches an hour. Used in the properties
 * sidebar (canvas duration, marker times) where the dot-frame style
 * distinguishes frames from seconds.
 */
export function formatTimecodeDotFrames(frame: number, fps: number): string {
  const { hours, minutes, seconds, frames } = decomposeFrame(frame, nominalRate(fps))

  const base = `${pad(minutes)}:${pad(seconds)}.${pad(frames)}`
  return hours > 0 ? `${pad(hours)}:${base}` : base
}

export function formatSignedFrameDelta(frameDelta: number, fps: number): string {
  const parts = formatTimecode(Math.abs(frameDelta), fps).split(':')
  while (parts.length > 2 && parts[0] === '00') {
    parts.shift()
  }

  return `${frameDelta > 0 ? '+' : '-'}${parts.join(':')}`
}

/**
 * Convert seconds to frame number
 * @param seconds - Time in seconds
 * @param fps - Frames per second
 * @returns Frame number
 */
export function secondsToFrames(seconds: number, fps: number): number {
  validateFps(fps)
  return secondsToFrame(toRate(fps), seconds)
}

/**
 * Convert frame number to seconds
 * @param frames - Frame number
 * @param fps - Frames per second
 * @returns Time in seconds
 */
export function framesToSeconds(frames: number, fps: number): number {
  validateFps(fps)
  return frameToSeconds(toRate(fps), frames)
}

/**
 * Format seconds as a human-readable duration string (e.g., "2m 30s")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Helper function to zero-pad numbers
 * @param num - Number to pad
 * @returns Zero-padded string (e.g., 5 -> "05")
 */
function pad(num: number): string {
  return num.toString().padStart(2, '0')
}
