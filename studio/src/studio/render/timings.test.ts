import { afterEach, describe, expect, it } from 'vitest'
import {
  gpuStageClock,
  MARK_PREFIX,
  STAGE_TIMINGS_FLAG,
  stageTimingsEnabled,
  timedStage,
  timedStageAsync,
  timedWritable,
  withLoopTimings,
} from './timings'

const flag = (on: boolean | undefined) => {
  ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = on
}
const marks = () =>
  performance.getEntriesByType('measure').filter((e) => e.name.startsWith(MARK_PREFIX))

afterEach(() => {
  flag(undefined)
  performance.clearMeasures()
})

describe('stage timings', () => {
  it('records nothing with the flag off', async () => {
    expect(stageTimingsEnabled()).toBe(false)
    expect(timedStage('decode', () => 3)).toBe(3)
    expect(await timedStageAsync('encode', async () => 4)).toBe(4)
    const deps = {
      renderFrame: async () => {},
      captureSample: () => ({ close() {} }),
      encodeSample: async () => {},
    } as never
    expect(withLoopTimings(deps)).toBe(deps)
    const writable = {} as never
    expect(timedWritable(writable)).toBe(writable)
    expect(marks()).toHaveLength(0)
  })

  it('records a mark per timed call with the flag on, with the frame as detail', async () => {
    flag(true)
    timedStage('decode', () => 1, 7)
    await timedStageAsync('encode', async () => 2)
    expect(marks().map((m) => m.name)).toEqual(['dc.decode', 'dc.encode'])
    expect((marks()[0] as PerformanceMeasure).detail).toEqual({ frame: 7 })
  })

  it('times the loop steps and gives the encode the frame that was captured', async () => {
    flag(true)
    const timed = withLoopTimings({
      totalFrames: 1,
      renderFrame: async () => {},
      captureSample: () => ({ close() {} }),
      encodeSample: async () => {},
      onAbort: async () => {},
      onFrameProgress: () => {},
    })
    await timed.renderFrame(4)
    const sample = timed.captureSample(4)
    await timed.encodeSample(sample, false)
    expect(marks().map((m) => [m.name, (m as PerformanceMeasure).detail])).toEqual([
      ['dc.frame.render', { frame: 4 }],
      ['dc.readback', { frame: 4 }],
      ['dc.encode', { frame: 4 }],
    ])
  })

  it('times each write of the output stream', async () => {
    flag(true)
    const written: unknown[] = []
    const stream = new WritableStream({ write: (chunk) => void written.push(chunk) })
    const writer = timedWritable(stream).getWriter()
    await writer.write('a')
    await writer.write('b')
    expect(written).toEqual(['a', 'b'])
    expect(marks().map((m) => m.name)).toEqual(['dc.write', 'dc.write'])
  })

  it('the GPU clock marks the stage when the queue reports its work done', async () => {
    flag(true)
    const clock = gpuStageClock({ onSubmittedWorkDone: () => Promise.resolve() })
    clock.submitted('stabilize')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marks().map((m) => m.name)).toEqual(['dc.stabilize'])
  })
})
