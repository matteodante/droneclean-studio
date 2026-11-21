// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { beatLength, planSmoothEdit } from './plan'

/** Beats every `gap` frames from `first`, `count` of them. */
function beatsEvery(gap: number, first: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => first + index * gap)
}

const room = { footageFor: (shot: number) => Math.round(shot * 1.5) }
const clip = (id: string, availableFrames = 1000) => ({ id, availableFrames })

describe('beatLength', () => {
  it('is the spacing of an even beat', () => {
    expect(beatLength(beatsEvery(15, 30, 20))).toBe(15)
  })

  it('ignores a missed hit and an extra off-beat hit', () => {
    const beats = beatsEvery(15, 30, 20).filter((frame) => frame !== 90)
    beats.push(53)
    expect(beatLength(beats.toSorted((a, b) => a - b))).toBeCloseTo(15, 5)
  })

  it('does not drift on a tempo that is not a whole number of frames', () => {
    const beats = beatsEvery(14.7, 20, 40).map((frame) => Math.round(frame))
    expect(beatLength(beats)).toBeCloseTo(14.7, 1)
  })

  it('is 0 for fewer than two beats', () => {
    expect(beatLength([])).toBe(0)
    expect(beatLength([40])).toBe(0)
  })
})

describe('planSmoothEdit', () => {
  it('lays one-bar shots end to end from the first beat', () => {
    const plan = planSmoothEdit({
      beats: beatsEvery(15, 30, 40),
      songEnd: 630,
      bars: 1,
      clips: [clip('a'), clip('b'), clip('c')],
      ...room,
    })

    expect(plan.firstDownbeat).toBe(30)
    expect(plan.shots).toEqual([
      { clipId: 'a', from: 30, durationInFrames: 60 },
      { clipId: 'b', from: 90, durationInFrames: 60 },
      { clipId: 'c', from: 150, durationInFrames: 60 },
    ])
    expect(plan.tooShort).toEqual([])
    expect(plan.afterSong).toEqual([])
  })

  it('cuts two and four bars', () => {
    const base = { beats: beatsEvery(15, 0, 80), songEnd: 1200, clips: [clip('a'), clip('b')], ...room }

    expect(planSmoothEdit({ ...base, bars: 2 }).shots.map((s) => [s.from, s.durationInFrames])).toEqual([
      [0, 120],
      [120, 120],
    ])
    expect(planSmoothEdit({ ...base, bars: 4 }).shots.map((s) => [s.from, s.durationInFrames])).toEqual([
      [0, 240],
      [240, 240],
    ])
  })

  it('snaps a cut to a detected beat that sits a frame off the grid, and the shots still meet', () => {
    const beats = beatsEvery(15, 30, 40).map((frame) => (frame === 90 ? 91 : frame))
    const plan = planSmoothEdit({ beats, songEnd: 630, bars: 1, clips: [clip('a'), clip('b'), clip('c')], ...room })

    const ends = plan.shots.map((shot) => shot.from + shot.durationInFrames)
    expect(plan.shots.map((shot) => shot.from)).toEqual([30, 91, 150])
    expect(ends.slice(0, 2)).toEqual([91, 150])
  })

  it('leaves the clips that would end after the song after it, in order', () => {
    const plan = planSmoothEdit({
      beats: beatsEvery(15, 30, 40),
      songEnd: 210,
      bars: 1,
      clips: [clip('a'), clip('b'), clip('c'), clip('d'), clip('e')],
      ...room,
    })

    expect(plan.shots.map((shot) => shot.clipId)).toEqual(['a', 'b', 'c'])
    expect(plan.afterSong).toEqual(['d', 'e'])
  })

  it('skips a clip without the footage for its shot; the next clip takes its place', () => {
    const plan = planSmoothEdit({
      beats: beatsEvery(15, 30, 40),
      songEnd: 630,
      bars: 1,
      clips: [clip('a'), clip('short', 50), clip('b')],
      ...room,
    })

    expect(plan.shots.map((shot) => [shot.clipId, shot.from])).toEqual([
      ['a', 30],
      ['b', 90],
    ])
    expect(plan.tooShort).toEqual(['short'])
  })

  it('plans nothing without a tempo', () => {
    const plan = planSmoothEdit({ beats: [10], songEnd: 600, bars: 1, clips: [clip('a')], ...room })

    expect(plan.shots).toEqual([])
    expect(plan.afterSong).toEqual(['a'])
  })
})
