import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// The job's start, its inputs replaced: what happens when something throws after the job holds `running`
const state = vi.hoisted(() => ({ throwOnInput: true }))

vi.mock('./host', () => ({
  getPrerenderHost: () => ({ renderSize: { width: 64, height: 36 }, renderText: () => undefined }),
}))
vi.mock('./state', async (importActual) => ({
  ...(await importActual<typeof import('./state')>()),
  watchPrerenderState: () => undefined,
  collectRenderInput: () => {
    if (state.throwOnInput) throw new Error('the composition could not be read')
    return { fps: 30, tracks: [], items: [], transitions: [], keyframes: [] }
  },
  fingerprintInputFor: () => ({}),
}))
vi.mock('./fingerprint', () => ({ frameHashes: () => new Float64Array(0) }))

import { runPrerender } from './job'
import { usePrerenderStore } from './store'

describe('runPrerender', () => {
  beforeEach(() => {
    state.throwOnInput = true
    usePrerenderStore.setState({ job: null, lastOutcome: null })
  })

  it('ends a job that throws before it renders: stopped with the error, the progress gone, the next one not refused', async () => {
    const outcome = await runPrerender({ start: 0, end: 10 })

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'error', detail: expect.stringContaining('could not be read') })
    expect(usePrerenderStore.getState().job).toBeNull()
    // Not "busy": the failed job let go of `running`
    await expect(runPrerender({ start: 0, end: 10 })).resolves.toMatchObject({ status: 'stopped' })
  })
})
