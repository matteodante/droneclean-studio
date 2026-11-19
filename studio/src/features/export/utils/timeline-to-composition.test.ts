// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { SubtitleSegmentItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  averageSpeed,
  clipSourcePosition,
  sourceFrameAt,
  sourceFramesAt,
  type SpeedCurve,
} from '@/studio/speed'
import { toRate } from '@/studio/time'
import { convertTimelineToComposition } from './timeline-to-composition'

describe('convertTimelineToComposition IO marker conversion', () => {
  it('propagates Layer Group state to child tracks and omits the container from export', () => {
    const layerGroup: TimelineTrack = {
      id: 'layer-group',
      name: 'Layer Group',
      height: 72,
      locked: true,
      visible: false,
      muted: true,
      solo: true,
      order: 0,
      items: [],
      isGroup: true,
    }
    const childTrack: TimelineTrack = {
      id: 'child-track',
      name: 'Child',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [],
      parentTrackId: layerGroup.id,
    }
    const childItem: VideoItem = {
      id: 'child-item',
      type: 'video',
      trackId: childTrack.id,
      from: 0,
      durationInFrames: 30,
      label: 'Child',
      src: 'blob:child',
    }

    const composition = convertTimelineToComposition(
      [layerGroup, childTrack],
      [childItem],
      [],
      30,
      1920,
      1080,
    )

    expect(composition.tracks).toHaveLength(1)
    expect(composition.tracks[0]).toMatchObject({
      id: childTrack.id,
      locked: true,
      visible: false,
      muted: true,
      solo: true,
    })
  })

  it('converts IO trims from timeline frames to source frames using source FPS', () => {
    const fps = 30
    const sourceFps = 24
    const inPoint = 100
    const outPoint = 200

    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Track 1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }

    const item: VideoItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 300,
      label: 'Video',
      src: 'blob:test',
      trimStart: 10,
      trimEnd: 5,
      sourceStart: 1000,
      sourceFps,
      speed: 1,
    }

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint,
    )

    const exportedItem = composition.tracks[0]!.items[0] as VideoItem

    // 100 timeline frames at 30fps = 3.333s => 80 source frames at 24fps
    expect(exportedItem.sourceStart).toBe(1080)
    expect(exportedItem.trimStart).toBe(90)
    expect(exportedItem.trimEnd).toBe(85)
    expect(exportedItem.offset).toBe(90)
    expect(exportedItem.durationInFrames).toBe(100)
    expect(composition.durationInFrames).toBe(100)
  })

  it('moves sourceEnd backward when IO range trims the start of a reversed video', () => {
    const fps = 30
    const inPoint = 30
    const outPoint = 90

    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Track 1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }

    const item: VideoItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Video',
      src: 'blob:test',
      sourceStart: 100,
      sourceEnd: 220,
      sourceFps: 30,
      speed: 1,
      isReversed: true,
    }

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint,
    )

    const exportedItem = composition.tracks[0]!.items[0] as VideoItem

    expect(exportedItem.from).toBe(0)
    expect(exportedItem.durationInFrames).toBe(60)
    expect(exportedItem.isReversed).toBe(true)
    expect(exportedItem.sourceStart).toBe(130)
    expect(exportedItem.sourceEnd).toBe(190)
  })

  it('shifts and clips subtitle segment cues when IO range trims the segment', () => {
    const fps = 30
    const inPoint = 45
    const outPoint = 120

    const track: TimelineTrack = {
      id: 'track-subtitles',
      name: 'Subtitles',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }

    const item: SubtitleSegmentItem = {
      id: 'subtitle-1',
      type: 'subtitle',
      trackId: 'track-subtitles',
      from: 30,
      durationInFrames: 120,
      label: 'Transcript',
      mediaId: 'media-1',
      source: {
        type: 'transcript',
        mediaId: 'media-1',
        clipId: 'clip-1',
      },
      cues: [
        { id: 'cue-before', startSeconds: 0, endSeconds: 0.25, text: 'Before range' },
        { id: 'cue-overlap-start', startSeconds: 0.25, endSeconds: 1, text: 'Starts before' },
        { id: 'cue-inside', startSeconds: 1.5, endSeconds: 2, text: 'Inside' },
        { id: 'cue-overlap-end', startSeconds: 2.75, endSeconds: 4, text: 'Ends after' },
      ],
      color: '#ffffff',
    }

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint,
    )

    const exportedItem = composition.tracks[0]!.items[0] as SubtitleSegmentItem

    expect(exportedItem.from).toBe(0)
    expect(exportedItem.durationInFrames).toBe(75)
    expect(exportedItem.cues).toEqual([
      { id: 'cue-overlap-start', startSeconds: 0, endSeconds: 0.5, text: 'Starts before' },
      { id: 'cue-inside', startSeconds: 1, endSeconds: 1.5, text: 'Inside' },
      { id: 'cue-overlap-end', startSeconds: 2.25, endSeconds: 2.5, text: 'Ends after' },
    ])
  })
})

/**
 * An in/out export of a clip with a speed curve (design 7.1, section 4.6). The clip's `speed`
 * is the curve's average, so the constant-speed path's `duration x speed` would move the
 * source start to a frame the clip never shows and leave the keys pinned to the old length.
 * The conversion re-windows the keys and moves the source start by the curve's own integral,
 * so the exported composition asks for the same source frames the parent did on the range.
 *
 * The design's ramp, 1x -> 4x -> 1x over 600 frames at 59.94: 2,310 source frames, 195 at
 * frame 60 inside the 4x hold (design 7.1, section 5.2).
 */
describe('convertTimelineToComposition and a speed curve', () => {
  const FPS_59_94 = 60000 / 1001
  const DURATION = 600
  const ramp: SpeedCurve = {
    keys: [
      { frame: 0, speed: 1 },
      { frame: 30, speed: 4 },
      { frame: 570, speed: 4 },
      { frame: DURATION, speed: 1 },
    ],
  }

  const track: TimelineTrack = {
    id: 'track-1',
    name: 'Track 1',
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
  }

  function rampItem(): VideoItem {
    return {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: DURATION,
      label: 'Ramp',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 2310,
      sourceDuration: 2310,
      sourceFps: FPS_59_94,
      speed: averageSpeed(ramp),
      speedCurve: ramp,
    }
  }

  /** The clip the export renders, as the composition carries it. */
  function exportedClip(
    inPoint: number,
    outPoint: number,
    item: VideoItem = rampItem(),
  ): VideoItem {
    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      FPS_59_94,
      3840,
      2880,
      inPoint,
      outPoint,
    )
    return composition.tracks[0]!.items[0] as VideoItem
  }

  /** The source frame the parent clip shows at its own frame, through the app's mapping. */
  function parentSourceFrame(frame: number): number {
    return sourceFrameAt(ramp, frame, 0, toRate(FPS_59_94), toRate(FPS_59_94))
  }

  /**
   * The source frame the export's render path asks the decoder for at the clip's frame:
   * `floor(sourceStart) + floor(area(n) + cut offset)`, the curve's integral with the cut's
   * fraction added before the floor (design 7.1, section 4.6).
   */
  function exportedSourceFrame(clip: VideoItem, frame: number): number {
    return clipSourcePosition(clip, frame, FPS_59_94).frame
  }

  it('the premise: the ramp spans 2,310 source frames and holds 4x from frame 30', () => {
    expect(parentSourceFrame(0)).toBe(0)
    expect(parentSourceFrame(30)).toBe(75)
    expect(parentSourceFrame(60)).toBe(195)
    expect(parentSourceFrame(600)).toBe(2310)
  })

  it('trims the start: the exported mapping equals the parent mapping, every frame', () => {
    const clip = exportedClip(60, DURATION)
    expect(clip.durationInFrames).toBe(540)
    expect(clip.sourceStart).toBe(195)
    expect(clip.sourceEnd).toBe(2310)
    expect(clip.speedCurve).toEqual({
      keys: [
        { frame: 0, speed: 4 },
        { frame: 510, speed: 4 },
        { frame: 540, speed: 1 },
      ],
    })
    expect(clip.speed).toBe(averageSpeed(clip.speedCurve!))
    for (let frame = 0; frame < clip.durationInFrames; frame++) {
      expect(exportedSourceFrame(clip, frame), `exported frame ${frame}`).toBe(
        parentSourceFrame(frame + 60),
      )
    }
  })

  it('trims the end: the keys stop at the range and the out point is the curve’s', () => {
    const clip = exportedClip(0, 570)
    expect(clip.durationInFrames).toBe(570)
    expect(clip.sourceStart).toBe(0)
    expect(clip.sourceEnd).toBe(2235)
    expect(clip.speedCurve).toEqual({
      keys: [
        { frame: 0, speed: 1 },
        { frame: 30, speed: 4 },
        { frame: 570, speed: 4 },
      ],
    })
    for (let frame = 0; frame < clip.durationInFrames; frame++) {
      expect(exportedSourceFrame(clip, frame), `exported frame ${frame}`).toBe(
        parentSourceFrame(frame),
      )
    }
  })

  it('trims both ends: keys inside the range are kept, the ends carry the curve’s speed', () => {
    const clip = exportedClip(100, 540)
    expect(clip.durationInFrames).toBe(440)
    expect(clip.sourceStart).toBe(355)
    expect(clip.sourceEnd).toBe(2115)
    expect(clip.speedCurve).toEqual({
      keys: [
        { frame: 0, speed: 4 },
        { frame: 440, speed: 4 },
      ],
    })
    for (let frame = 0; frame < clip.durationInFrames; frame++) {
      expect(exportedSourceFrame(clip, frame), `exported frame ${frame}`).toBe(
        parentSourceFrame(frame + 100),
      )
    }
  })

  it('carries the cut’s fraction when the in-point falls between two source frames', () => {
    // Frame 15 of the ramp is 26.25 source frames in. The exported clip starts on source frame
    // 26 and carries the remaining 0.25 (design 7.1, section 4.6), which the render path adds
    // to the curve's integral before the floor: every exported frame is the parent's, not one
    // source frame behind on the segments whose position is not a whole frame.
    const inPoint = 15
    const clip = exportedClip(inPoint, DURATION)
    expect(clip.sourceStart).toBe(26)
    expect(clip.sourceFrameOffset).toEqual({ num: 1, den: 4 })
    const sourceRate = toRate(FPS_59_94)
    const projectRate = toRate(FPS_59_94)
    for (let frame = 0; frame < clip.durationInFrames; frame++) {
      const position = sourceFramesAt(clip.speedCurve!, frame, sourceRate, projectRate)
      const parentPosition = sourceFramesAt(ramp, frame + inPoint, sourceRate, projectRate)
      expect(position, `exported frame ${frame}`).toBeCloseTo(
        parentPosition - sourceFramesAt(ramp, inPoint, sourceRate, projectRate),
        9,
      )
      expect(exportedSourceFrame(clip, frame), `exported frame ${frame}`).toBe(
        parentSourceFrame(frame + inPoint),
      )
    }
    expect(clip.durationInFrames).toBe(585)
    expect(clip.speedCurve).toEqual({
      keys: [
        { frame: 0, speed: 2.5 },
        { frame: 15, speed: 4 },
        { frame: 555, speed: 4 },
        { frame: 585, speed: 1 },
      ],
    })
  })

  it('composes with a remainder the clip already carries from an earlier cut', () => {
    // The clip the export above produces, exported again from its own frame 4: 26.25 source
    // frames plus the curve's 10.8 over four frames is 37.05, so the second export starts on
    // source frame 37 with 0.05 left. Every frame of it is the first clip's, which is the ramp's.
    const cutCurve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 2.5 },
        { frame: 15, speed: 4 },
        { frame: 555, speed: 4 },
        { frame: 585, speed: 1 },
      ],
    }
    const cutItem: VideoItem = {
      ...rampItem(),
      durationInFrames: 585,
      sourceStart: 26,
      sourceEnd: 2310,
      speedCurve: cutCurve,
      speed: averageSpeed(cutCurve),
      sourceFrameOffset: { num: 1, den: 4 },
    }
    const twiceCut = exportedClip(4, 585, cutItem)

    expect(twiceCut.sourceStart).toBe(37)
    expect(twiceCut.sourceFrameOffset).toEqual({ num: 1, den: 20 })
    expect(twiceCut.durationInFrames).toBe(581)
    for (let frame = 0; frame < twiceCut.durationInFrames; frame++) {
      expect(exportedSourceFrame(twiceCut, frame), `exported frame ${frame}`).toBe(
        parentSourceFrame(frame + 4 + 15),
      )
    }
  })

  it('writes no cut fraction for a whole-frame in-point, nor for a clip at one speed cut on a frame', () => {
    const wholeFrame = exportedClip(60, DURATION)
    expect(wholeFrame.sourceFrameOffset).toBeUndefined()

    const flat: VideoItem = { ...rampItem(), speedCurve: undefined, speed: 1 }
    const composition = convertTimelineToComposition(
      [track],
      [flat],
      [],
      FPS_59_94,
      3840,
      2880,
      0,
      DURATION,
    )
    expect((composition.tracks[0]!.items[0] as VideoItem).sourceFrameOffset).toBeUndefined()
  })
})
