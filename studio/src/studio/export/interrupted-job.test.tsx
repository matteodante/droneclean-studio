import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import '@/infrastructure/storage/test-utils/storage-test-mocks'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { useRenderQueuePersistence } from '@/features/export/hooks/use-render-queue-persistence'
import { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
import { createExportApi } from '@/studio/sdk/namespaces/export'
import { INTERRUPTED_JOB_ERROR, failInterruptedJob } from './interrupted-job'

/**
 * A job `render-queue.json` still holds as "rendering" belongs to a page that went away (19 Nov 2026: the renderer
 * of the MCP tour crashed mid-export). When the project's queue loads, it is failed as interrupted, so it neither
 * sits in a paused queue for ever nor blocks the next export of the project.
 */

let root: MemDir

const snapshot = { tracks: [], items: [], transitions: [], keyframes: [], fps: 30, width: 1920, height: 1080 }

function persistedJob(id: string, status: string) {
  return {
    id,
    name: id,
    projectId: 'p1',
    status,
    progress: 0,
    phase: 'preparing',
    inPoint: 0,
    outPoint: 89,
    durationFrames: 89,
    exportMode: 'video',
    clientSettings: {},
    fileName: `${id}.mp4`,
    createdAt: 1,
    startedAt: 1,
    snapshotId: 's0',
  }
}

async function seedQueue(jobs: unknown[]): Promise<void> {
  const file = { version: 1, isPaused: false, snapshots: { s0: snapshot }, jobs }
  await writeBlob(asHandle(root), ['projects', 'p1', 'render-queue.json'], JSON.stringify(file))
}

beforeEach(() => {
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  useRenderQueueStore.getState().hydrate([], false)
})

describe('a job left rendering when the page went away', () => {
  it('is failed as interrupted when the project queue loads, and the queue is not paused', async () => {
    await seedQueue([persistedJob('lost', 'rendering')])
    const { unmount } = renderHook(() => useRenderQueuePersistence('p1'))
    await waitFor(() => expect(useRenderQueueStore.getState().jobs).toHaveLength(1))
    const [job] = useRenderQueueStore.getState().jobs
    expect(job?.status).toBe('failed')
    expect(job?.error).toBe(INTERRUPTED_JOB_ERROR)
    expect(useRenderQueueStore.getState().isPaused).toBe(false)
    unmount()
  })

  it('no longer holds the project: the SDK reports it failed, with the reason, and nothing runs for the project', async () => {
    await seedQueue([persistedJob('lost', 'rendering')])
    const { unmount } = renderHook(() => useRenderQueuePersistence('p1'))
    await waitFor(() => expect(useRenderQueueStore.getState().jobs).toHaveLength(1))
    const info = createExportApi().status('lost')
    expect(info?.status).toBe('failed')
    expect(info?.error).toMatch(/^interrupted: .*start the export again$/)
    const running = createExportApi()
      .jobs()
      .filter((job) => job.status === 'queued' || job.status === 'rendering')
    expect(running).toEqual([])
    unmount()
  })

  it('is written back failed, so the next load does not meet it again', async () => {
    await seedQueue([persistedJob('lost', 'rendering'), persistedJob('done', 'completed')])
    const { unmount } = renderHook(() => useRenderQueuePersistence('p1'))
    await waitFor(() => expect(useRenderQueueStore.getState().jobs).toHaveLength(2))
    // Unmounting flushes the queue to disk (the hook's cleanup), without awaiting the write.
    unmount()
    await waitFor(async () => {
      const written = JSON.parse((await readFileText(root, 'projects', 'p1', 'render-queue.json')) ?? '{}')
      expect(written.jobs.map((job: { status: string }) => job.status)).toEqual(['failed', 'completed'])
    })
  })
})

describe('failInterruptedJob', () => {
  it('leaves every other status as it is', () => {
    for (const status of ['queued', 'completed', 'failed', 'cancelled']) {
      const job = { status, error: undefined }
      expect(failInterruptedJob(job)).toBe(job)
    }
  })
})
