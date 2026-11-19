import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useRenderQueueStore } from '../stores/render-queue-store'
import type { RenderJob } from '../stores/render-queue-store'
import { RenderQueueRunner } from '../components/render-queue-runner'

const render_ = vi.hoisted(() => ({
  started: [] as string[],
  release: [] as Array<() => void>,
}))

vi.mock('../deps/renderer', () => ({
  runRender: vi.fn(
    () =>
      new Promise((resolve) => {
        render_.release.push(() =>
          resolve({
            result: { blob: new Blob(), fileSize: 1, duration: 1 },
            renderPath: 'test',
          }),
        )
      }),
  ),
  releaseTemporaryExportOutput: vi.fn(async () => {}),
}))
vi.mock('../utils/smart-copy', () => ({
  trySmartCopyExport: vi.fn(async () => ({ result: null })),
}))
vi.mock('../utils/timeline-to-composition', () => ({
  convertTimelineToComposition: vi.fn((tracks: unknown) => {
    render_.started.push('composition')
    return { tracks: [] as unknown[], source: tracks }
  }),
}))
vi.mock('@/features/export/deps/media-library', () => ({
  resolveMediaUrls: vi.fn(async (tracks: unknown) => tracks),
}))
vi.mock('@/infrastructure/storage', () => ({
  saveExportFile: vi.fn(async () => ({ relPath: 'exports/a.mp4' })),
}))

function job(id: string): RenderJob {
  return {
    id,
    name: id,
    projectId: 'p1',
    status: 'queued',
    progress: 0,
    inPoint: 0,
    outPoint: 10,
    durationFrames: 10,
    exportMode: 'video',
    fileName: `${id}.mp4`,
    createdAt: 1,
    clientSettings: {
      codec: 'h264',
      container: 'mp4',
      resolution: { width: 16, height: 16 },
    },
    snapshot: {
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 16,
      height: 16,
    },
  } as unknown as RenderJob
}

afterEach(() => {
  render_.started = []
  render_.release = []
  useRenderQueueStore.getState().hydrate([], false)
})

describe('RenderQueueRunner', () => {
  it('drains one job at a time however many runners are mounted', async () => {
    render(
      <>
        <RenderQueueRunner />
        <RenderQueueRunner />
      </>,
    )

    useRenderQueueStore.getState().hydrate([job('a'), job('b')], false)
    await vi.waitFor(() => expect(render_.release).toHaveLength(1))

    expect(useRenderQueueStore.getState().jobs.map((j) => j.status)).toEqual([
      'rendering',
      'queued',
    ])

    render_.release[0]!()
    await vi.waitFor(() => expect(render_.release).toHaveLength(2))
    expect(useRenderQueueStore.getState().jobs.map((j) => j.status)).toEqual([
      'completed',
      'rendering',
    ])
    render_.release[1]!()
    await vi.waitFor(() =>
      expect(useRenderQueueStore.getState().jobs.map((j) => j.status)).toEqual([
        'completed',
        'completed',
      ]),
    )
  })
})
