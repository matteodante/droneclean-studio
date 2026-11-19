import { describe, expect, it } from 'vite-plus/test'
import { createSourceFrameProvider } from '@/studio/render/frames/provider'
import type { FrameBackend } from '@/studio/render/frames/types'
import { SourceError } from '@/studio/render/source-error'
import { StageError } from '@/studio/render/stages/types'
import type { VideoItem } from '@/types/timeline'
import { failureFromWorker, serializeFailure } from './protocol'

/** What crosses the worker boundary is the structured clone of what the worker posts */
function across<T>(value: T): T {
  return structuredClone(value)
}

describe('export worker failures', () => {
  it('brings a SourceError back as a SourceError with the same fields and the very same message', () => {
    const raised = new SourceError({
      clip: 'DJI_0020',
      mediaId: 'media-9',
      frame: 12,
      reason: 'the decoder could not open the file',
    })
    const error = failureFromWorker(across(serializeFailure(raised)), raised.message)
    expect(error).toBeInstanceOf(SourceError)
    expect(error.name).toBe('SourceError')
    expect(error.message).toBe(raised.message)
    const sourceError = error as SourceError
    expect(sourceError.clip).toBe('DJI_0020')
    expect(sourceError.mediaId).toBe('media-9')
    expect(sourceError.frame).toBe(12)
    expect(sourceError.reason).toBe('the decoder could not open the file')
  })

  it('brings a StageError back as a StageError with the same fields and the very same message', () => {
    const raised = new StageError({
      clip: 'DJI_0020',
      stage: 'stabilize',
      sourceIndex: 1234,
      reason: 'the engine could not answer frame 1234: out of range',
    })
    const error = failureFromWorker(across(serializeFailure(raised)), raised.message)
    expect(error).toBeInstanceOf(StageError)
    expect(error.name).toBe('StageError')
    expect(error.message).toBe(raised.message)
    const stageError = error as StageError
    expect(stageError.clip).toBe('DJI_0020')
    expect(stageError.stage).toBe('stabilize')
    expect(stageError.sourceIndex).toBe(1234)
  })

  it('keeps a StageError of the motion-blur gather, which is no registry stage', () => {
    const raised = new StageError({
      clip: 'DJI_0020',
      stage: 'motion-blur',
      sourceIndex: 77,
      reason: 'the gather could not blend 4 frames',
    })
    const error = failureFromWorker(across(serializeFailure(raised)), raised.message) as StageError
    expect(error).toBeInstanceOf(StageError)
    expect(error.stage).toBe('motion-blur')
    expect(error.message).toBe(raised.message)
    expect(error.message).toMatch(/^Clip 'DJI_0020', motion blur, source frame 77: /)
  })

  it('brings the colour gate’s refusal of a BT.2020 source back with the same name and message', async () => {
    // The real provider over a decoder that reports an HDR source: the error an export in the worker stops with
    const backend: FrameBackend = {
      origin: 'webcodecs',
      async decode(_file, index) {
        return {
          texture: { destroy() {} } as unknown as GPUTexture,
          index,
          width: 64,
          height: 36,
          colour: { primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc' },
        }
      },
      prefetch() {},
      destroy() {},
    }
    const provider = createSourceFrameProvider({ backend, maxSamples: 1, mode: 'export', projectRate: 30 })
    const item = {
      id: 'clip-1',
      type: 'video',
      label: 'Mini 4 HLG',
      src: 'blob:source',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceFps: 30,
      speed: 1,
    } as VideoItem
    const raised = await provider.frameAt(item, 0).then(
      () => null,
      (error: unknown) => error,
    )
    provider.destroy()
    expect(raised).toBeInstanceOf(StageError)
    const original = raised as StageError
    expect(original.message).toMatch(/not BT\.709 \(primaries bt2020, transfer smpte2084, matrix bt2020nc\)/)
    const back = failureFromWorker(across(serializeFailure(original)), original.message) as StageError
    expect(back).toBeInstanceOf(StageError)
    expect(back.name).toBe('StageError')
    expect(back.message).toBe(original.message)
    expect(back.stage).toBe(original.stage)
    expect(back.sourceIndex).toBe(original.sourceIndex)
    expect(back.clip).toBe('Mini 4 HLG')
  })

  it('keeps a StageError without a source frame, and a reason that itself holds a colon', () => {
    const raised = new StageError({
      clip: "Pilot's clip",
      stage: 'input-colour',
      reason: 'HDR / BT.2020 sources are not supported yet: bt2020nc',
    })
    const error = failureFromWorker(across(serializeFailure(raised)), raised.message) as StageError
    expect(error).toBeInstanceOf(StageError)
    expect(error.message).toBe(raised.message)
    expect(error.sourceIndex).toBeUndefined()
    expect(error.stage).toBe('input-colour')
  })

  it('keeps any other error’s message, which FreeCut’s main-thread fallback reads, and its name', () => {
    const refusal = new Error('WORKER_REQUIRES_MAIN_THREAD:animated-image')
    const back = failureFromWorker(across(serializeFailure(refusal)), refusal.message)
    expect(back).not.toBeInstanceOf(StageError)
    expect(back.message).toBe('WORKER_REQUIRES_MAIN_THREAD:animated-image')
    expect(back.name).toBe('Error')

    class SourceFrameMismatch extends Error {
      constructor() {
        super('the decoder gave frame 11 for frame 10')
        this.name = 'SourceFrameMismatch'
      }
    }
    const mismatch = new SourceFrameMismatch()
    const named = failureFromWorker(across(serializeFailure(mismatch)), mismatch.message)
    expect(named.name).toBe('SourceFrameMismatch')
    expect(named.message).toBe('the decoder gave frame 11 for frame 10')
  })

  it('serializes what is not an Error, and an answer from a worker that sent no failure', () => {
    expect(serializeFailure('plain text')).toEqual({ name: 'Error', message: 'plain text' })
    const old = failureFromWorker(undefined, 'Composition has no duration')
    expect(old.message).toBe('Composition has no duration')
    expect(old.name).toBe('Error')
  })

  it('takes the worker’s message as it is when it does not have the StageError shape', () => {
    const error = failureFromWorker(
      {
        name: 'StageError',
        message: 'something reworded',
        stage: { clip: 'c', stage: 'look', sourceIndex: 3 },
      },
      'something reworded',
    )
    expect(error).toBeInstanceOf(StageError)
    expect(error.message).toBe('something reworded')
  })
})
