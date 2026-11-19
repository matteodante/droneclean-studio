// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { ExportSettingsPatch } from '../types'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { StudioError } from '../errors'
import {
  readExportSettings,
  resetExportSettings,
  resolveExportSettings,
  writeExportSettings,
} from './export-settings'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Flight',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 3840, height: 2160, fps: 60 },
    ...overrides,
  }
}

/** A patch with a value the types would reject, as an agent's JSON can carry. */
function badPatch(patch: unknown): ExportSettingsPatch {
  return patch as ExportSettingsPatch
}

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

describe('the SDK export settings', () => {
  beforeEach(() => {
    resetExportSettings()
    useProjectStore.setState({ currentProject: makeProject() })
  })

  it('starts with the export dialog defaults', () => {
    expect(readExportSettings()).toEqual({
      codec: 'h264',
      quality: 'medium',
      resolution: { width: 3840, height: 2160 },
      rateControl: 'auto',
      smartCopy: true,
      mode: 'video',
      videoContainer: 'mp4',
      audioContainer: 'mp3',
      subtitleMode: 'burn',
      renderWholeProject: false,
    })
  })

  it('does not report the settings the pipeline does not read', () => {
    const settings = readExportSettings()

    expect(settings).not.toHaveProperty('audioBitrate')
    expect(settings).not.toHaveProperty('proResProfile')
  })

  it('falls back to the editor canvas when no project is open', () => {
    useProjectStore.setState({ currentProject: null })

    expect(readExportSettings().resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('follows the project size until a caller sets one', () => {
    writeExportSettings({ quality: 'high' }, 'export.setSettings')
    expect(readExportSettings().resolution).toEqual({ width: 3840, height: 2160 })

    writeExportSettings({ resolution: { width: 1920, height: 1080 } }, 'export.setSettings')
    useProjectStore.setState({
      currentProject: makeProject({ metadata: { width: 1280, height: 720, fps: 60 } }),
    })

    expect(readExportSettings().resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('merges a patch and leaves the other fields alone', () => {
    writeExportSettings({ quality: 'ultra', videoBitrate: 20_000_000 }, 'export.setSettings')

    expect(readExportSettings()).toMatchObject({
      codec: 'h264',
      quality: 'ultra',
      videoBitrate: 20_000_000,
    })
  })

  it('treats a field passed as undefined as absent', () => {
    writeExportSettings({ quality: 'low' }, 'export.setSettings')
    writeExportSettings(badPatch({ quality: undefined }), 'export.setSettings')

    expect(readExportSettings().quality).toBe('low')
  })

  it('returns a copy a caller can change without touching the state', () => {
    const settings = readExportSettings()
    settings.resolution.width = 1
    settings.quality = 'low'

    expect(readExportSettings()).toMatchObject({
      quality: 'medium',
      resolution: { width: 3840, height: 2160 },
    })
  })

  it('resolves settings for one call without storing them', () => {
    const settings = resolveExportSettings({ quality: 'high' }, 'export.start', 'settings')

    expect(settings.quality).toBe('high')
    expect(readExportSettings().quality).toBe('medium')
  })

  it('leaves every setting as it was when a patch is rejected', () => {
    writeExportSettings({ quality: 'high' }, 'export.setSettings')

    const error = caught(() =>
      writeExportSettings(badPatch({ quality: 'max' }), 'export.setSettings'),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(readExportSettings().quality).toBe('high')
  })

  it('goes back to the defaults on reset', () => {
    writeExportSettings({ quality: 'ultra', mode: 'audio' }, 'export.setSettings')
    resetExportSettings()

    expect(readExportSettings()).toMatchObject({ quality: 'medium', mode: 'video' })
  })

  it('blames the container when only the container changed', () => {
    const error = caught(() =>
      writeExportSettings(badPatch({ videoContainer: 'webm' }), 'export.setSettings'),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('patch.videoContainer')
    expect(error.valid).toEqual(['mp4', 'mov', 'mkv'])
  })

  it('blames the codec when only the codec changed', () => {
    const error = caught(() =>
      writeExportSettings(badPatch({ codec: 'vp9' }), 'export.setSettings'),
    )

    expect(error.argument).toBe('patch.codec')
    expect(error.valid).toEqual(['h264', 'h265'])
  })

  it.each([
    { field: 'proResProfile', value: 'hq', reason: 'no ProRes encoder' },
    { field: 'audioBitrate', value: '192k', reason: 'follows "quality"' },
  ])('refuses $field, which the pipeline does not read', ({ field, value, reason }) => {
    const error = caught(() =>
      writeExportSettings(badPatch({ [field]: value }), 'export.setSettings'),
    )

    expect(error.name).toBe('StudioError')
    expect(error.code).toBe('UNSUPPORTED')
    expect(error.argument).toBe(`patch.${field}`)
    expect(error.message).toMatch(
      new RegExp(
        `^export\\.setSettings: "patch\\.${field}" is not used by the export pipeline yet: `,
      ),
    )
    expect(error.message).toContain(reason)
    expect(readExportSettings()).not.toHaveProperty(field)
  })

  it('accepts a format both fields change together', () => {
    writeExportSettings({ codec: 'vp9', videoContainer: 'webm' }, 'export.setSettings')

    expect(readExportSettings()).toMatchObject({ codec: 'vp9', videoContainer: 'webm' })
  })

  it('blames the codec when both fields change and the pair does not fit', () => {
    const error = caught(() =>
      writeExportSettings(
        badPatch({ codec: 'h264', videoContainer: 'webm' }),
        'export.setSettings',
      ),
    )

    expect(error.argument).toBe('patch.codec')
    expect(error.valid).toEqual(['vp9', 'vp8', 'av1'])
  })

  it('carries embedded subtitles only in Matroska', () => {
    const error = caught(() =>
      writeExportSettings(badPatch({ subtitleMode: 'embedded' }), 'export.setSettings'),
    )

    expect(error.argument).toBe('patch.subtitleMode')
    expect(error.valid).toEqual(['off', 'burn', 'sidecar'])

    writeExportSettings({ videoContainer: 'mkv', subtitleMode: 'embedded' }, 'export.setSettings')

    expect(readExportSettings()).toMatchObject({
      videoContainer: 'mkv',
      subtitleMode: 'embedded',
    })
  })

  it('does not constrain the video format of an audio export', () => {
    writeExportSettings(
      { mode: 'audio', codec: 'vp9', videoContainer: 'webm' },
      'export.setSettings',
    )

    expect(readExportSettings()).toMatchObject({
      mode: 'audio',
      codec: 'vp9',
      videoContainer: 'webm',
    })
  })
})
