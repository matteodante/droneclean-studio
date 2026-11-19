import { describe, expect, it } from 'vite-plus/test'
import { StageError, isNotReady } from './types'

describe('StageError', () => {
  it('names the clip, the stage and the source frame', () => {
    const error = new StageError({
      clip: 'FPV run 3',
      stage: 'stabilize',
      sourceIndex: 1234,
      reason: 'the motion data has no frame 1234',
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('StageError')
    expect(error.message).toBe(
      "Clip 'FPV run 3', stabilization, source frame 1234: the motion data has no frame 1234",
    )
    expect([error.clip, error.stage, error.sourceIndex]).toEqual(['FPV run 3', 'stabilize', 1234])
  })

  it('leaves the frame out when the failure is not about one, and keeps the cause', () => {
    const cause = new Error('worker died')
    const error = new StageError({ clip: 'A', stage: 'input-colour', reason: 'pass failed', cause })
    expect(error.message).toBe("Clip 'A', input colour: pass failed")
    expect(error.sourceIndex).toBeUndefined()
    expect(error.cause).toBe(cause)
  })
})

describe('isNotReady', () => {
  it('recognises the not-ready answer and nothing else', () => {
    expect(isNotReady({ kind: 'not-ready', stage: 'look', ready: Promise.resolve() })).toBe(true)
    expect(isNotReady(true)).toBe(false)
    expect(isNotReady({ width: 1, height: 1 })).toBe(false)
    expect(isNotReady(null)).toBe(false)
  })
})
