import { describe, expect, it, vi } from 'vite-plus/test'
import {
  clipStageStates,
  notifyStagedFrameReady,
  setClipStageState,
  subscribeClipStageStates,
  subscribeStagedFrameReady,
} from './failure'

describe('the preview’s clip states', () => {
  it('are set and cleared per clip, with a new snapshot and one call per change only', () => {
    const heard = vi.fn()
    const stop = subscribeClipStageStates(heard)
    const before = clipStageStates()

    setClipStageState('a', { kind: 'opening', stage: 'stabilize' })
    setClipStageState('a', { kind: 'opening', stage: 'stabilize' })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(clipStageStates()).not.toBe(before)
    expect(clipStageStates().get('a')).toEqual({ kind: 'opening', stage: 'stabilize' })

    setClipStageState('a', { kind: 'failed', stage: 'stabilize', message: 'no data' })
    setClipStageState('a', { kind: 'failed', stage: 'stabilize', message: 'other' })
    expect(heard).toHaveBeenCalledTimes(3)

    setClipStageState('a', null)
    setClipStageState('a', null)
    expect(heard).toHaveBeenCalledTimes(4)
    expect(clipStageStates().has('a')).toBe(false)
    stop()
  })

  it('tell each listener when a held frame became drawable, until it stops', () => {
    const redraw = vi.fn()
    const stop = subscribeStagedFrameReady(redraw)
    notifyStagedFrameReady()
    stop()
    notifyStagedFrameReady()
    expect(redraw).toHaveBeenCalledTimes(1)
  })
})
