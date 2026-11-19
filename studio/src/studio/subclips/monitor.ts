// What the source monitor does with a subclip window and the marks inside it (design 1.6, D3, D4).
//
// Every number here is a frame of the parent file, the same convention as a mark and as a timeline
// clip's `sourceStart`/`sourceEnd`: inside a subclip's window nothing is made relative.

import type { SourceWindow } from '@/shared/state/source-player'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import type { Subclip, SubclipParentInfo } from './model'
import { useSubclipsStore } from './store'
import { getParentFrameCount } from './validate'

export interface SourceMarks {
  in: number | null
  out: number | null
}

/** The window the monitor plays inside: the open subclip's range, else the whole file. */
export function resolveSourceWindow(window: SourceWindow | null, fileFrames: number): SourceWindow {
  return window ?? { start: 0, end: Math.max(1, fileFrames) }
}

/** An in mark kept inside the window: `[start, end - 1]`. */
export function clampInMark(frame: number, window: SourceWindow): number {
  return Math.max(window.start, Math.min(window.end - 1, frame))
}

/** An out mark (exclusive) kept inside the window: `[start + 1, end]`. */
export function clampOutMark(frame: number, window: SourceWindow): number {
  return Math.max(window.start + 1, Math.min(window.end, frame))
}

/** A played frame kept inside the window: `[start, end - 1]`. */
export function clampPlayFrame(frame: number, window: SourceWindow): number {
  return clampInMark(frame, window)
}

/**
 * The range Insert, Overwrite, Create subclip and the picture's drag act on: the marked range, a
 * missing side being the window's edge, kept inside the window. Null when nothing is left of it.
 */
export function getMarkedRange(marks: SourceMarks, window: SourceWindow): SourceWindow | null {
  const start = marks.in === null ? window.start : clampInMark(marks.in, window)
  const end = marks.out === null ? window.end : clampOutMark(marks.out, window)
  return end > start ? { start, end } : null
}

export function isWholeWindow(range: SourceWindow, window: SourceWindow): boolean {
  return range.start === window.start && range.end === window.end
}

/** `{file name without extension} {timecode of the first frame}`, the default name of a subclip. */
export function defaultSubclipName(fileName: string, startFrame: number, fps: number): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  return `${stem} ${formatTimecodeCompact(startFrame, fps)}`
}

export interface CreateSubclipFromMarksInput {
  mediaId: string
  fileName: string
  /** The probe's duration and rate, as the library stores them. */
  parent: SubclipParentInfo
  marks: SourceMarks
  window: SourceWindow
}

/**
 * Creates a subclip from the marks. Needs at least one mark; a missing side is the window edge.
 * Nothing else changes: not the marks, not the selection. Null when there is nothing to make.
 */
export function createSubclipFromMarks(input: CreateSubclipFromMarksInput): Subclip | null {
  if (input.marks.in === null && input.marks.out === null) return null
  const fileFrames = getParentFrameCount(input.parent)
  const limit: SourceWindow = {
    start: input.window.start,
    end: Math.min(input.window.end, fileFrames),
  }
  const range = getMarkedRange(input.marks, limit)
  if (!range) return null
  const fps = input.parent.fps || 30
  return useSubclipsStore.getState().create({
    mediaId: input.mediaId,
    name: defaultSubclipName(input.fileName, range.start, fps),
    startFrame: range.start,
    endFrame: range.end,
    sourceFps: fps,
    parentFrameCount: fileFrames,
  })
}

/** The payload the monitor's picture writes when it is dragged: the existing `media-item` plus the range. */
export interface MonitorDragPayload {
  type: 'media-item'
  mediaId: string
  mediaType: string
  fileName: string
  /** Seconds of the range, so the timeline's ghost has the right length. */
  duration: number
  sourceStart: number
  sourceEnd: number
  subclipId?: string
}

export interface MonitorDragInput {
  mediaId: string
  mediaType: string
  fileName: string
  fps: number
  marks: SourceMarks
  window: SourceWindow
  /** The subclip open in the monitor, if any. */
  subclip: Pick<Subclip, 'id' | 'name' | 'mediaId'> | null
}

/**
 * The drag payload for the marked range, or null when the picture must not be draggable (no mark,
 * so a plain click keeps its meaning). A range that is the whole open subclip carries its id and name.
 */
export function buildMonitorDragPayload(input: MonitorDragInput): MonitorDragPayload | null {
  if (input.marks.in === null && input.marks.out === null) return null
  const range = getMarkedRange(input.marks, input.window)
  if (!range) return null
  const whole =
    input.subclip !== null &&
    input.subclip.mediaId === input.mediaId &&
    isWholeWindow(range, input.window)
  return {
    type: 'media-item',
    mediaId: input.mediaId,
    mediaType: input.mediaType,
    fileName: whole && input.subclip ? input.subclip.name : input.fileName,
    duration: (range.end - range.start) / input.fps,
    sourceStart: range.start,
    sourceEnd: range.end,
    ...(whole && input.subclip ? { subclipId: input.subclip.id } : {}),
  }
}
