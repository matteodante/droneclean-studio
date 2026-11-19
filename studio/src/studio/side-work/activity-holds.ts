/**
 * Holds the side-work scheduler while the pilot plays or exports: the editor's playback store and render queue say
 * when. The stores are loaded on demand, so the producers that use the scheduler do not import them statically.
 */
import type { SideWorkScheduler } from './scheduler'

export function startActivityHolds(scheduler: SideWorkScheduler): void {
  void import('@/shared/state/playback')
    .then(({ usePlaybackStore }) => {
      const apply = (isPlaying: boolean) => scheduler.setHeld('playback', isPlaying)
      apply(usePlaybackStore.getState().isPlaying)
      usePlaybackStore.subscribe((state) => apply(state.isPlaying))
    })
    .catch(() => {})
  void import('@/features/export/stores/render-queue-store')
    .then(({ useRenderQueueStore }) => {
      const apply = (rendering: boolean) => scheduler.setHeld('export', rendering)
      const rendering = (jobs: Array<{ status: string }>) =>
        jobs.some((j) => j.status === 'rendering')
      apply(rendering(useRenderQueueStore.getState().jobs))
      useRenderQueueStore.subscribe((state) => apply(rendering(state.jobs)))
    })
    .catch(() => {})
}
