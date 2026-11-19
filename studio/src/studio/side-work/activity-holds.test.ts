import { describe, expect, it } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
import { startActivityHolds } from './activity-holds'
import { SideWorkScheduler } from './scheduler'

const loaded = () => new Promise<void>((resolve) => setTimeout(resolve, 50))

describe('startActivityHolds', () => {
  it('holds the scheduler while the pilot plays and while a render runs, and releases after', async () => {
    const scheduler = new SideWorkScheduler()
    usePlaybackStore.setState({ isPlaying: false })
    useRenderQueueStore.setState({ jobs: [] })
    startActivityHolds(scheduler)
    await loaded()
    expect(scheduler.isHeld()).toBe(false)

    usePlaybackStore.setState({ isPlaying: true })
    expect(scheduler.isHeld()).toBe(true)

    useRenderQueueStore.setState({ jobs: [{ status: 'rendering' } as never] })
    usePlaybackStore.setState({ isPlaying: false })
    expect(scheduler.isHeld()).toBe(true)

    useRenderQueueStore.setState({ jobs: [{ status: 'completed' } as never] })
    expect(scheduler.isHeld()).toBe(false)
  })
})
