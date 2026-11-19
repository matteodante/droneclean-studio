// Stage timings (task 8.2): how long each stage of a frame takes, for the benchmark kit. A mark is a User Timing
// measure named `dc.<stage>`; the bench page turns the flag on, plays or exports, and reads the measures back
// (`bench/lib/timings.mjs` turns them into per-stage statistics). With the flag off every function here is one
// property read and a direct call: nothing is recorded, nothing is allocated beyond the caller's closure.
//
// The stages (names are the contract with the bench's collector):
//   decode       the decoder gives the next frame (waiting for the decoder counts)
//   upload       the decoded frame enters the renderer (a canvas draw, or a copy into a GPU texture and the widening blit)
//   stabilize, input-colour, look
//                one source stage's GPU time: its own command buffer is submitted alone and timed to completion, so
//                the figure is the time the queue took for that stage (see `gpuStageClock`)
//   frame.render the whole `renderFrame` of an output frame; effects and composite are what is left of it
//   readback     the frame's pixels leave the render surface into a sample (export only)
//   encode       the encoder takes the sample (backpressure of the encoder included; export only)
//   write        the muxer's bytes reach the output file (export only; runs behind the encode)

/** The page sets this to `true` to record marks. Anything else records nothing. */
export const STAGE_TIMINGS_FLAG = '__DRONECLEAN_STAGE_TIMINGS__'

/** The prefix of every mark's name. */
export const MARK_PREFIX = 'dc.'

/** True when the flag is set: read at every call, so a page can switch it on after the modules loaded. */
export function stageTimingsEnabled(): boolean {
  return (globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] === true
}

/** Records one mark from `start` to `end` (ms, `performance.now()` scale). `frame` is the output frame when known. */
function recordStage(stage: string, start: number, end: number, frame?: number): void {
  try {
    performance.measure(`${MARK_PREFIX}${stage}`, {
      start,
      end,
      ...(frame === undefined ? {} : { detail: { frame } }),
    })
  } catch {
    // User Timing is unavailable or refused the name: a timing is never worth a failed frame.
  }
}

/** Runs `work` and, with the flag on, records how long it took as `stage`. */
export function timedStage<T>(stage: string, work: () => T, frame?: number): T {
  if (!stageTimingsEnabled()) return work()
  const start = performance.now()
  try {
    return work()
  } finally {
    recordStage(stage, start, performance.now(), frame)
  }
}

/** Like `timedStage` for an async `work`: the mark ends when the promise settles. */
export async function timedStageAsync<T>(
  stage: string,
  work: () => Promise<T>,
  frame?: number,
): Promise<T> {
  if (!stageTimingsEnabled()) return work()
  const start = performance.now()
  try {
    return await work()
  } finally {
    recordStage(stage, start, performance.now(), frame)
  }
}

import type {
  CloseableSample,
  PipelinedFrameLoopDeps,
} from '@/runtime/renderer/pipelined-frame-loop'

/**
 * The export loop's dependencies with its three steps timed as `frame.render`, `readback` and `encode`; the very
 * same object when the flag is off. The encode of a frame runs while the next frame renders, so its mark carries the
 * frame it belongs to.
 */
export function withLoopTimings<S extends CloseableSample>(
  deps: PipelinedFrameLoopDeps<S>,
): PipelinedFrameLoopDeps<S> {
  if (!stageTimingsEnabled()) return deps
  // The encode callback has no frame number: the capture just before it is the frame it encodes.
  let captured = -1
  return {
    ...deps,
    renderFrame: (frame) => timedStageAsync('frame.render', () => deps.renderFrame(frame), frame),
    captureSample: (frame) => {
      captured = frame
      return timedStage('readback', () => deps.captureSample(frame), frame)
    },
    encodeSample: (sample, keyFrame) =>
      timedStageAsync('encode', () => deps.encodeSample(sample, keyFrame), captured),
  }
}

/** The part of a writable stream the muxer's file target uses. */
interface WritableLike {
  getWriter(): WritableStreamDefaultWriter<never>
}

/**
 * The output file's writable with every `write` timed as `write`; the very same stream when the flag is off. The
 * muxer calls `getWriter()` once and `write(chunk)` for each chunk, so a proxy on those two is enough.
 */
export function timedWritable<W extends WritableLike>(writable: W): W {
  if (!stageTimingsEnabled()) return writable
  return new Proxy(writable, {
    get(target, property) {
      if (property !== 'getWriter') {
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
      return () => {
        const writer = target.getWriter()
        return new Proxy(writer, {
          get(inner, name) {
            const value = Reflect.get(inner, name, inner) as unknown
            if (name !== 'write' || typeof value !== 'function') {
              return typeof value === 'function' ? value.bind(inner) : value
            }
            return (chunk: unknown) =>
              timedStageAsync('write', () =>
                (value as (c: unknown) => Promise<void>).call(inner, chunk),
              )
          },
        })
      }
    },
  })
}

/**
 * Times source stages by their GPU completion. Commands run in the order they are submitted, so a stage submitted
 * alone is finished when `onSubmittedWorkDone` resolves, and its time is the gap since the previous stage finished
 * (or since it was submitted, when the queue had been idle). It is attributed to the stage that was submitted.
 */
export interface GpuStageClock {
  /** Call right after a stage's command buffer is submitted. */
  submitted(stage: string): void
}

export function gpuStageClock(queue: { onSubmittedWorkDone(): Promise<unknown> }): GpuStageClock {
  let lastDone = 0
  return {
    submitted(stage) {
      const submitAt = performance.now()
      void queue
        .onSubmittedWorkDone()
        .then(() => {
          const doneAt = performance.now()
          recordStage(stage, Math.max(submitAt, lastDone), doneAt)
          lastDone = doneAt
        })
        .catch(() => undefined)
    },
  }
}
