// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { ExportSettingsPatch, ExportStartInput } from '../types'
import type { RenderJob } from '@/features/export/stores/render-queue-store'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
import {
  registerJobController,
  unregisterJobController,
} from '@/features/export/utils/render-queue-control'
import { StudioError } from '../errors'
import { createExportApi } from './export'
import { resetExportSettings } from './export-settings'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Flight',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30 },
    ...overrides,
  }
}

/** A patch with a value the types would reject, as an agent's JSON can carry. */
function badPatch(patch: unknown): ExportSettingsPatch {
  return patch as ExportSettingsPatch
}

/** The settings the export pipeline ignores; naming one is `UNSUPPORTED`. */
const SETTINGS_THE_PIPELINE_IGNORES: Array<{ field: string; value: unknown; reason: string }> = [
  { field: 'proResProfile', value: 'hq', reason: 'no ProRes encoder' },
  { field: 'audioBitrate', value: '192k', reason: 'follows "quality"' },
]

/** Run `run` and return the `StudioError` it threw. */
function caught(run: () => unknown): StudioError {
  try {
    run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('the call did not throw')
}

/** The media and the one full-length clip smart copy needs to be eligible. */
function seedSmartCopyProject(): void {
  const media: MediaMetadata = {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'flight.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 2,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'avc1',
    bitrate: 12_000_000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }
  useMediaLibraryStore.setState({ mediaItems: [media], mediaById: { 'media-1': media } })
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'clip-1',
      trackId: 'track-v1',
      mediaId: 'media-1',
      from: 0,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 60,
      sourceFps: 30,
    }),
  ])
}

/** A queue job, as `enqueueJobs` would hold it. */
function makeJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: 'j1',
    name: 'Flight',
    projectId: 'project-1',
    status: 'queued',
    progress: 0,
    inPoint: null,
    outPoint: null,
    durationFrames: 120,
    exportMode: 'video',
    clientSettings: {
      mode: 'video',
      codec: 'avc',
      container: 'mp4',
      quality: 'medium',
      resolution: { width: 1920, height: 1080 },
      fps: 30,
    },
    snapshot: {
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
    },
    fileName: 'Flight.mp4',
    createdAt: 1,
    ...overrides,
  }
}

function enqueue(...jobs: RenderJob[]): void {
  useRenderQueueStore.setState({ jobs, isPaused: false, activeJobId: null })
}

describe('studio.export', () => {
  const api = createExportApi()

  beforeEach(() => {
    resetTimelineCompositionTestState()
    resetExportSettings()
    useProjectStore.setState({ currentProject: makeProject() })
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
    enqueue()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('settings', () => {
    it('returns the dialog defaults for the open project', () => {
      expect(api.settings()).toEqual({
        codec: 'h264',
        quality: 'medium',
        resolution: { width: 1920, height: 1080 },
        rateControl: 'auto',
        smartCopy: true,
        mode: 'video',
        videoContainer: 'mp4',
        audioContainer: 'mp3',
        subtitleMode: 'burn',
        renderWholeProject: false,
      })
    })

    it('returns a copy that does not change the state', () => {
      const settings = api.settings()
      settings.resolution.width = 1
      settings.quality = 'low'

      expect(api.settings()).toMatchObject({
        quality: 'medium',
        resolution: { width: 1920, height: 1080 },
      })
    })

    it('is not an undo step when it changes', async () => {
      api.setSettings({ quality: 'high' })
      await api.start({ settings: { mode: 'audio' } })

      expect(useTimelineCommandStore.getState().undoStack).toEqual([])
    })

    it('does not report the settings the export pipeline does not read', () => {
      api.setSettings({ quality: 'high' })

      const settings = api.settings()
      expect(settings).not.toHaveProperty('audioBitrate')
      expect(settings).not.toHaveProperty('proResProfile')
    })
  })

  describe('setSettings', () => {
    it('merges the patch into the settings', () => {
      api.setSettings({ quality: 'high', videoBitrate: 12_000_000 })

      expect(api.settings()).toMatchObject({ quality: 'high', videoBitrate: 12_000_000 })
    })

    const INVALID_FIELDS: Array<{
      field: keyof ExportSettingsPatch
      value: unknown
      argument: string
      valid?: string[]
    }> = [
      {
        field: 'codec',
        value: 'prores',
        argument: 'patch.codec',
        valid: ['h264', 'h265', 'vp9', 'vp8', 'av1'],
      },
      { field: 'quality', value: 'max', argument: 'patch.quality' },
      { field: 'resolution', value: { width: 0, height: 1080 }, argument: 'patch.resolution' },
      { field: 'resolution', value: { width: 1920 }, argument: 'patch.resolution' },
      { field: 'rateControl', value: 'cbr', argument: 'patch.rateControl' },
      { field: 'videoBitrate', value: 50_000, argument: 'patch.videoBitrate' },
      { field: 'videoBitrate', value: 1_000_000_000, argument: 'patch.videoBitrate' },
      { field: 'videoBitrate', value: 12.5, argument: 'patch.videoBitrate' },
      { field: 'smartCopy', value: 'yes', argument: 'patch.smartCopy' },
      { field: 'mode', value: 'both', argument: 'patch.mode' },
      { field: 'videoContainer', value: 'gif', argument: 'patch.videoContainer' },
      { field: 'audioContainer', value: 'flac', argument: 'patch.audioContainer' },
      { field: 'subtitleMode', value: 'soft', argument: 'patch.subtitleMode' },
      { field: 'renderWholeProject', value: 1, argument: 'patch.renderWholeProject' },
    ]

    it.each(INVALID_FIELDS)(
      'rejects $field = $value with its message',
      ({ field, value, argument, valid }) => {
        const error = caught(() => api.setSettings(badPatch({ [field]: value })))

        expect(error.name).toBe('StudioError')
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe(argument)
        expect(error.message).toMatch(new RegExp(`^export\\.setSettings: "${argument}" must be `))
        expect(error.message).toContain(`(got ${JSON.stringify(value)})`)
        if (valid) expect(error.valid).toEqual(valid)
        expect(api.settings()).toEqual({
          codec: 'h264',
          quality: 'medium',
          resolution: { width: 1920, height: 1080 },
          rateControl: 'auto',
          smartCopy: true,
          mode: 'video',
          videoContainer: 'mp4',
          audioContainer: 'mp3',
          subtitleMode: 'burn',
          renderWholeProject: false,
        })
      },
    )

    it.each([null, [], 'high', 42])('rejects a patch that is not an object (%s)', (patch) => {
      const error = caught(() => api.setSettings(badPatch(patch)))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('patch')
    })

    it.each(SETTINGS_THE_PIPELINE_IGNORES)(
      'refuses $field, which the export pipeline does not read',
      ({ field, value, reason }) => {
        const error = caught(() => api.setSettings(badPatch({ [field]: value })))

        expect(error.name).toBe('StudioError')
        expect(error.code).toBe('UNSUPPORTED')
        expect(error.argument).toBe(`patch.${field}`)
        expect(error.message).toMatch(
          new RegExp(
            `^export\\.setSettings: "patch\\.${field}" is not used by the export pipeline yet: `,
          ),
        )
        expect(error.message).toContain(reason)
        expect(api.settings()).not.toHaveProperty(field)
      },
    )

    it('rejects a video codec the container cannot carry', () => {
      const error = caught(() => api.setSettings({ codec: 'vp9' }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('patch.codec')
      expect(error.valid).toEqual(['h264', 'h265'])
    })

    it('accepts a codec and container that fit together', () => {
      api.setSettings({ codec: 'vp9', videoContainer: 'webm' })

      expect(api.settings()).toMatchObject({ codec: 'vp9', videoContainer: 'webm' })
    })
  })

  describe('start', () => {
    it('throws UNSUPPORTED when no project is open', async () => {
      useProjectStore.setState({ currentProject: null })

      await expect(api.start()).rejects.toMatchObject({
        name: 'StudioError',
        code: 'UNSUPPORTED',
        message: expect.stringMatching(/^export\.start: /),
      })
    })

    it('enqueues exactly one job carrying the settings of the call', async () => {
      const info = await api.start({
        settings: {
          mode: 'audio',
          audioContainer: 'wav',
          quality: 'high',
          resolution: { width: 1280, height: 720 },
        },
        inPoint: 30,
        outPoint: 90,
      })

      const jobs = useRenderQueueStore.getState().jobs
      expect(jobs).toHaveLength(1)
      const job = jobs[0]!
      expect(job.id).toBe(info.id)
      expect(job.clientSettings).toMatchObject({
        mode: 'audio',
        container: 'wav',
        quality: 'high',
        resolution: { width: 1280, height: 720 },
      })
      expect(job.clientSettings.audioBitrate).toBe(256_000)
      expect(job.exportMode).toBe('audio')
      expect(job.fileName.endsWith('.wav')).toBe(true)
      expect(info).toMatchObject({
        status: 'queued',
        progress: 0,
        inPoint: 30,
        outPoint: 90,
        durationFrames: 60,
        exportMode: 'audio',
      })
      // The overlay belongs to the job, not to the SDK's settings.
      expect(api.settings()).toMatchObject({ quality: 'medium', mode: 'video' })
    })

    it('enqueues one job built from the video settings', async () => {
      seedSmartCopyProject()

      const info = await api.start()

      const jobs = useRenderQueueStore.getState().jobs
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.clientSettings).toMatchObject({
        mode: 'video',
        codec: 'avc',
        container: 'mp4',
        quality: 'medium',
        resolution: { width: 1920, height: 1080 },
        smartCopy: true,
      })
      expect(info).toMatchObject({
        status: 'queued',
        inPoint: null,
        outPoint: null,
        durationFrames: 60,
        exportMode: 'video',
      })
    })

    it('renders the editor in/out range when the call names none', async () => {
      useMarkersStore.getState().setInOutPoints(15, 75)

      const info = await api.start({ settings: { mode: 'audio' } })

      expect(info).toMatchObject({ inPoint: 15, outPoint: 75, durationFrames: 60 })
    })

    it('ignores the editor range when the settings ask for the whole project', async () => {
      useMarkersStore.getState().setInOutPoints(15, 75)
      api.setSettings({ mode: 'audio', renderWholeProject: true })

      const info = await api.start()

      expect(info).toMatchObject({ inPoint: null, outPoint: null })
    })

    it('lets explicit points win over the whole-project setting', async () => {
      api.setSettings({ mode: 'audio', renderWholeProject: true })

      const info = await api.start({ inPoint: 30, outPoint: 90 })

      expect(info).toMatchObject({ inPoint: 30, outPoint: 90, durationFrames: 60 })
    })

    it('reports a build failure as INTERNAL without queueing anything', async () => {
      // No clip, so smart copy is out and Node has no WebCodecs encoder to probe.
      await expect(api.start()).rejects.toMatchObject({
        name: 'StudioError',
        code: 'INTERNAL',
        message: expect.stringMatching(/^export\.start: the job could not be built: /),
      })

      expect(useRenderQueueStore.getState().jobs).toEqual([])
    })

    it('rejects an explicit range that ends before it starts', async () => {
      await expect(api.start({ inPoint: 90, outPoint: 30 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        argument: 'outPoint',
      })
    })

    it('rejects a point that is not a frame', async () => {
      await expect(api.start({ inPoint: -5 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        argument: 'inPoint',
      })
    })

    it('rejects invalid settings of the call', async () => {
      await expect(api.start({ settings: badPatch({ quality: 'max' }) })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        argument: 'settings.quality',
      })

      expect(useRenderQueueStore.getState().jobs).toEqual([])
    })

    it.each(SETTINGS_THE_PIPELINE_IGNORES)(
      'refuses $field in the settings of a call, which the export pipeline does not read',
      async ({ field, value, reason }) => {
        await expect(api.start({ settings: badPatch({ [field]: value }) })).rejects.toMatchObject({
          name: 'StudioError',
          code: 'UNSUPPORTED',
          argument: `settings.${field}`,
          message: expect.stringContaining(reason),
        })

        expect(useRenderQueueStore.getState().jobs).toEqual([])
      },
    )

    it('rejects options that are not an object', async () => {
      await expect(api.start(badPatch(null) as unknown as ExportStartInput)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        argument: 'options',
      })
    })

    it('rejects an empty name', async () => {
      await expect(api.start({ name: '  ' })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        argument: 'name',
      })
    })
  })

  describe('jobs and status', () => {
    it('lists the queue oldest first', () => {
      enqueue(makeJob({ id: 'j1' }), makeJob({ id: 'j2' }))

      expect(api.jobs().map((job) => job.id)).toEqual(['j1', 'j2'])
    })

    it('returns plain copies without the frozen snapshot', () => {
      enqueue(makeJob({ id: 'j1' }))
      const [info] = api.jobs()

      expect(info).not.toHaveProperty('snapshot')
      expect(info).not.toHaveProperty('clientSettings')
      info!.name = 'changed'
      expect(api.status('j1')?.name).toBe('Flight')
    })

    it('reads one job or null', () => {
      enqueue(makeJob({ id: 'j1' }), makeJob({ id: 'j2', status: 'failed', error: 'encoder died' }))

      expect(api.status('j1')).toMatchObject({ id: 'j1', status: 'queued' })
      expect(api.status('j2')).toMatchObject({ status: 'failed', error: 'encoder died' })
      expect(api.status('nope')).toBeNull()
    })
  })

  describe('wait', () => {
    it('returns the job once it completes, reading the queue every 250 ms', async () => {
      vi.useFakeTimers()
      enqueue(makeJob({ id: 'j1', status: 'rendering', progress: 10, phase: 'rendering' }))

      let settled = false
      const pending = api.wait('j1').then((info) => {
        settled = true
        return info
      })
      await vi.advanceTimersByTimeAsync(249)
      expect(settled).toBe(false)

      useRenderQueueStore
        .getState()
        .markCompleted('j1', { savedPath: 'out/Flight.mp4', fileSize: 99 })
      await vi.advanceTimersByTimeAsync(1)

      await expect(pending).resolves.toMatchObject({
        id: 'j1',
        status: 'completed',
        progress: 100,
        savedPath: 'out/Flight.mp4',
        fileSize: 99,
      })
    })

    it('returns the job as it is when the timeout passes', async () => {
      vi.useFakeTimers()
      enqueue(makeJob({ id: 'j1', status: 'rendering' }))
      useRenderQueueStore.getState().updateJobProgress('j1', {
        phase: 'rendering',
        progress: 40,
        currentFrame: 48,
        totalFrames: 120,
        message: 'frame 48',
      })

      const pending = api.wait('j1', { timeoutMs: 250 })
      await vi.advanceTimersByTimeAsync(250)

      await expect(pending).resolves.toMatchObject({
        status: 'rendering',
        progress: 40,
        phase: 'rendering',
        renderedFrames: 48,
        totalFrames: 120,
        progressMessage: 'frame 48',
      })
    })

    it('throws EXPORT_FAILED with the error of a failed job', async () => {
      vi.useFakeTimers()
      enqueue(makeJob({ id: 'j1' }))

      const pending = expect(api.wait('j1')).rejects.toMatchObject({
        name: 'StudioError',
        code: 'EXPORT_FAILED',
        message: expect.stringContaining('encoder died'),
      })
      await vi.advanceTimersByTimeAsync(250)
      useRenderQueueStore.getState().markFailed('j1', 'encoder died')
      await vi.advanceTimersByTimeAsync(250)

      await pending
    })

    it('throws EXPORT_FAILED when the job is cancelled', async () => {
      vi.useFakeTimers()
      enqueue(makeJob({ id: 'j1' }))

      const pending = expect(api.wait('j1')).rejects.toMatchObject({
        code: 'EXPORT_FAILED',
        message: expect.stringContaining('cancelled'),
      })
      await vi.advanceTimersByTimeAsync(250)
      api.cancel('j1')
      await vi.advanceTimersByTimeAsync(250)

      await pending
    })

    it('throws NOT_FOUND for an unknown job', async () => {
      await expect(api.wait('nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        argument: 'id',
      })
    })

    it('rejects a negative timeout', async () => {
      await expect(api.wait('j1', { timeoutMs: -1 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        argument: 'timeoutMs',
      })
    })
  })

  describe('cancel', () => {
    it('marks a queued job cancelled', () => {
      enqueue(makeJob({ id: 'j1' }))

      api.cancel('j1')

      expect(api.status('j1')).toMatchObject({ status: 'cancelled' })
    })

    it('aborts a running job', () => {
      const controller = new AbortController()
      registerJobController('j1', controller)
      enqueue(makeJob({ id: 'j1', status: 'rendering' }))

      api.cancel('j1')

      expect(controller.signal.aborted).toBe(true)
      unregisterJobController('j1')
    })

    it('throws NOT_FOUND for an unknown job', () => {
      const error = caught(() => api.cancel('nope'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
    })
  })

  describe('the @example lines', () => {
    it('run as written', async () => {
      enqueue(makeJob({ id: 'j1', status: 'completed', progress: 100 }))
      const studio = { export: api }

      studio.export.settings()
      studio.export.setSettings({ quality: 'high' })
      studio.export.setSettings({ mode: 'audio', audioContainer: 'wav' })
      const job = await studio.export.start({ name: 'Flight 01' })
      studio.export.jobs()
      studio.export.status('j1')
      await studio.export.wait('j1', { timeoutMs: 60000 })
      studio.export.cancel('j1')

      expect(job.name).toBe('Flight 01')
      expect(studio.export.status('j1')).toMatchObject({ status: 'completed' })
    })
  })
})
