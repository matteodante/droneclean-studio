// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { rateValue } from '@/studio/time'
import { validateProject } from './project-schema'
const FPS_59_94 = 59.94005994005994

function makeProject(fps: number, compositionFps?: number): Record<string, unknown> {
  return {
    id: 'project-1',
    name: 'Drone flight',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    schemaVersion: 15,
    metadata: { width: 1920, height: 1080, fps },
    ...(compositionFps === undefined
      ? {}
      : {
          timeline: {
            tracks: [],
            items: [],
            compositions: [
              {
                id: 'composition-1',
                name: 'Sequence',
                items: [],
                tracks: [],
                fps: compositionFps,
                width: 1920,
                height: 1080,
                durationInFrames: 1,
              },
            ],
          },
        }),
  }
}

describe('project schema frame rates', () => {
  it('accepts the exact double of a fractional rate in metadata and in a composition', () => {
    const result = validateProject(makeProject(FPS_59_94, FPS_59_94))

    expect(result.success).toBe(true)
    expect(result.data?.metadata.fps).toBe(FPS_59_94)
    expect(result.data?.timeline?.compositions?.[0]?.fps).toBe(FPS_59_94)
  })

  it.each([
    { fps: 0, reason: 'zero' },
    { fps: 241, reason: 'above 240' },
    { fps: Number.NaN, reason: 'NaN' },
  ])('rejects $reason in metadata', ({ fps }) => {
    expect(validateProject(makeProject(fps)).success).toBe(false)
  })

  it.each([
    { fps: 0, reason: 'zero' },
    { fps: 241, reason: 'above 240' },
    { fps: Number.NaN, reason: 'NaN' },
  ])('rejects $reason in a composition', ({ fps }) => {
    expect(validateProject(makeProject(30, fps)).success).toBe(false)
  })

  it('keeps a 59.94 project bit-exact through save and load', () => {
    const saved = JSON.stringify(makeProject(FPS_59_94, FPS_59_94))
    const loaded: unknown = JSON.parse(saved)
    const result = validateProject(loaded)

    expect(result.success).toBe(true)
    expect(result.data?.metadata.fps).toBe(rateValue({ num: 60000, den: 1001 }))
  })
})

/** A one-clip project whose video clip carries `speedCurve` (design 7.1, section 4.1). */
function makeProjectWithCurve(speedCurve: unknown): Record<string, unknown> {
  return {
    ...makeProject(60),
    timeline: {
      tracks: [
        {
          id: 'track-1',
          name: 'V1',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
      ],
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 120,
          label: 'clip.mp4',
          type: 'video',
          src: 'clip.mp4',
          sourceStart: 0,
          sourceEnd: 300,
          sourceFps: 60,
          speed: 2.5,
          speedCurve,
        },
      ],
    },
  }
}

describe('project schema speed curves', () => {
  const CURVE = {
    keys: [
      { frame: 0, speed: 1 },
      { frame: 120, speed: 4 },
    ],
  }

  it('keeps a speed curve through save and load', () => {
    const saved = JSON.stringify(makeProjectWithCurve(CURVE))
    const result = validateProject(JSON.parse(saved) as unknown)

    expect(result.success).toBe(true)
    expect(result.data?.timeline?.items[0]?.speedCurve).toEqual(CURVE)
    expect(result.data?.timeline?.items[0]?.speed).toBe(2.5)
  })

  it('keeps the ease of a segment, and the slice a cut left, through save and load', () => {
    const eased = {
      keys: [
        { frame: 0, speed: 1.2, ease: 'smooth', easeSlice: { offset: 10, length: 60, from: 1, to: 4 } },
        { frame: 20, speed: 2 },
      ],
    }
    const result = validateProject(JSON.parse(JSON.stringify(makeProjectWithCurve(eased))) as unknown)

    expect(result.success).toBe(true)
    expect(result.data?.timeline?.items[0]?.speedCurve).toEqual(eased)
  })

  it('refuses an ease that is not one of the four', () => {
    const result = validateProject(
      JSON.parse(
        JSON.stringify(
          makeProjectWithCurve({
            keys: [
              { frame: 0, speed: 1, ease: 'bounce' },
              { frame: 20, speed: 2 },
            ],
          }),
        ),
      ) as unknown,
    )

    expect(result.success).toBe(false)
  })

  it.each([
    {
      curve: {
        keys: [
          { frame: 0, speed: 0.05 },
          { frame: 120, speed: 1 },
        ],
      },
      reason: 'a speed below 0.1',
    },
    {
      curve: {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 120, speed: 16 },
        ],
      },
      reason: 'a speed above 10',
    },
    {
      curve: {
        keys: [
          { frame: 0.5, speed: 1 },
          { frame: 120, speed: 4 },
        ],
      },
      reason: 'a fractional frame',
    },
    { curve: { keys: [{ frame: 0, speed: 1 }] }, reason: 'fewer than two keys' },
  ])('rejects $reason', ({ curve }) => {
    expect(validateProject(makeProjectWithCurve(curve)).success).toBe(false)
  })

  /** The cut fraction beside the curve (design 7.1, section 4.6). */
  function makeProjectWithCutFraction(sourceFrameOffset: unknown): Record<string, unknown> {
    const project = makeProjectWithCurve(CURVE)
    const items = (project.timeline as { items: Array<Record<string, unknown>> }).items
    items[0]!.sourceFrameOffset = sourceFrameOffset
    return project
  }

  it('keeps a cut fraction through save and load', () => {
    const result = validateProject(makeProjectWithCutFraction(0.25))

    expect(result.success).toBe(true)
    expect(result.data?.timeline?.items[0]?.sourceFrameOffset).toBe(0.25)
  })

  it.each([
    { value: 1, reason: 'one, which is a whole frame' },
    { value: -0.25, reason: 'a negative fraction' },
    { value: '0.25', reason: 'a string' },
  ])('rejects $reason as a cut fraction', ({ value }) => {
    expect(validateProject(makeProjectWithCutFraction(value)).success).toBe(false)
  })
})
