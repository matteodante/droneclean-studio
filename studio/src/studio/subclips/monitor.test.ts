// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  buildMonitorDragPayload,
  clampInMark,
  clampOutMark,
  createSubclipFromMarks,
  defaultSubclipName,
  getMarkedRange,
  resolveSourceWindow,
} from './monitor'
import { useSubclipsStore } from './store'

const window = { start: 40, end: 100 }

describe('window clamps', () => {
  it('keeps an in mark in [start, end - 1] and an out mark in [start + 1, end]', () => {
    expect(clampInMark(5, window)).toBe(40)
    expect(clampInMark(100, window)).toBe(99)
    expect(clampInMark(60, window)).toBe(60)
    expect(clampOutMark(5, window)).toBe(41)
    expect(clampOutMark(500, window)).toBe(100)
    expect(clampOutMark(60, window)).toBe(60)
  })

  it('resolves no window to the whole file', () => {
    expect(resolveSourceWindow(null, 120)).toEqual({ start: 0, end: 120 })
    expect(resolveSourceWindow(window, 120)).toEqual(window)
  })

  it('takes a missing mark as the window edge and drops an empty range', () => {
    expect(getMarkedRange({ in: null, out: null }, window)).toEqual(window)
    expect(getMarkedRange({ in: 50, out: null }, window)).toEqual({
      start: 50,
      end: 100,
    })
    expect(getMarkedRange({ in: null, out: 70 }, window)).toEqual({
      start: 40,
      end: 70,
    })
    expect(getMarkedRange({ in: 10, out: 500 }, window)).toEqual(window)
    expect(getMarkedRange({ in: 80, out: 80 }, window)).toBeNull()
  })
})

describe('createSubclipFromMarks', () => {
  beforeEach(() => useSubclipsStore.getState().reset())
  const parent = { duration: 4, fps: 30 }

  it('names it after the file and the first frame, and leaves nothing else changed', () => {
    const made = createSubclipFromMarks({
      mediaId: 'm1',
      fileName: 'DJI_0020.MP4',
      parent,
      marks: { in: 45, out: 75 },
      window: { start: 0, end: 120 },
    })
    expect(made).toMatchObject({
      mediaId: 'm1',
      name: 'DJI_0020 00:01:15',
      startFrame: 45,
      endFrame: 75,
      sourceFps: 30,
    })
    expect(useSubclipsStore.getState().subclips).toHaveLength(1)
  })

  it('does nothing without a mark', () => {
    expect(
      createSubclipFromMarks({
        mediaId: 'm1',
        fileName: 'a.mp4',
        parent,
        marks: { in: null, out: null },
        window: { start: 0, end: 120 },
      }),
    ).toBeNull()
    expect(useSubclipsStore.getState().subclips).toHaveLength(0)
  })

  it('with one mark inside a subclip window uses the window edge, in parent frames', () => {
    const made = createSubclipFromMarks({
      mediaId: 'm1',
      fileName: 'a.mp4',
      parent,
      marks: { in: 50, out: null },
      window,
    })
    expect(made).toMatchObject({ startFrame: 50, endFrame: 100 })
  })

  it('never ends past the last frame of the file', () => {
    const made = createSubclipFromMarks({
      mediaId: 'm1',
      fileName: 'a.mp4',
      parent,
      marks: { in: 100, out: null },
      window: { start: 0, end: 500 },
    })
    expect(made?.endFrame).toBe(120)
  })

  it('formats the default name without an extension', () => {
    expect(defaultSubclipName('noext', 0, 30)).toBe('noext 00:00:00')
    expect(defaultSubclipName('.hidden', 30, 30)).toBe('.hidden 00:01:00')
  })
})

describe('buildMonitorDragPayload', () => {
  const base = {
    mediaId: 'm1',
    mediaType: 'video',
    fileName: 'a.mp4',
    fps: 60,
    window: { start: 0, end: 600 },
    subclip: null,
  }

  it('is null with no mark, so a click keeps its meaning', () => {
    expect(buildMonitorDragPayload({ ...base, marks: { in: null, out: null } })).toBeNull()
  })

  it('carries the marked range and its length in seconds', () => {
    expect(buildMonitorDragPayload({ ...base, marks: { in: 60, out: 180 } })).toEqual({
      type: 'media-item',
      mediaId: 'm1',
      mediaType: 'video',
      fileName: 'a.mp4',
      duration: 2,
      sourceStart: 60,
      sourceEnd: 180,
    })
  })

  it('takes a missing side as the window edge', () => {
    expect(buildMonitorDragPayload({ ...base, marks: { in: 540, out: null } })).toMatchObject({
      sourceStart: 540,
      sourceEnd: 600,
    })
  })

  it('names the subclip only when the range is all of it', () => {
    const subclip = { id: 's1', name: 'Gap', mediaId: 'm1' }
    const win = { start: 100, end: 400 }
    expect(
      buildMonitorDragPayload({
        ...base,
        window: win,
        subclip,
        marks: { in: 100, out: 400 },
      }),
    ).toMatchObject({
      subclipId: 's1',
      fileName: 'Gap',
      sourceStart: 100,
      sourceEnd: 400,
    })
    const part = buildMonitorDragPayload({
      ...base,
      window: win,
      subclip,
      marks: { in: 150, out: 400 },
    })
    expect(part).toMatchObject({ fileName: 'a.mp4', sourceStart: 150 })
    expect(part).not.toHaveProperty('subclipId')
  })
})
