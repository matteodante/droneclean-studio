// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { mapToClientSettings } from '@/runtime/renderer/client-renderer'
import type { ExportSettings } from '@/types/export'
import {
  findActivePilotPresetId,
  getPilotPresets,
  isPilotPresetId,
  resolvePilotPreset,
  WEB_PRESET_CAPABILITIES,
  type PilotPresetId,
  type PresetContext,
} from './presets'

const web = WEB_PRESET_CAPABILITIES
const desktop = { nativeEncoder: true }

function context(overrides: Partial<PresetContext> = {}): PresetContext {
  return {
    project: { width: 3840, height: 2160, fps: 60 },
    source: { width: 3840, height: 2160, fps: 59.94, bitrate: 120_000_000 },
    capabilities: web,
    ...overrides,
  }
}

/** The export a preset produces, as the renderer will see it. */
function exported(id: PilotPresetId, ctx: PresetContext) {
  const resolved = resolvePilotPreset(id, ctx)
  if (!resolved) throw new Error(`${id} not available`)
  const settings: ExportSettings = { ...resolved.settings }
  const client = mapToClientSettings(settings, ctx.project.fps)
  return { resolved, client }
}

describe('web presets', () => {
  it('offers exactly the three pilot presets without the native encoder', () => {
    expect(getPilotPresets(context()).map((p) => p.id)).toEqual([
      'same-as-source',
      'youtube-4k',
      'small-file',
    ])
  })

  it('hides Master ProRes and 10-bit HEVC without the capability, and resolves them to nothing', () => {
    const ids = getPilotPresets(context()).map((p) => p.id)
    expect(ids).not.toContain('master-prores')
    expect(ids).not.toContain('master-hevc-10bit')
    expect(resolvePilotPreset('master-prores', context())).toBeNull()
    expect(resolvePilotPreset('master-hevc-10bit', context())).toBeNull()
  })

  it('offers them once the desktop sets the capability', () => {
    const ids = getPilotPresets(context({ capabilities: desktop })).map((p) => p.id)
    expect(ids).toContain('master-prores')
    expect(ids).toContain('master-hevc-10bit')
    const prores = resolvePilotPreset('master-prores', context({ capabilities: desktop }))
    expect(prores?.settings.codec).toBe('prores')
    expect(prores?.numbers.bitDepth).toBe(10)
    expect(
      resolvePilotPreset('master-hevc-10bit', context({ capabilities: desktop }))?.numbers.bitDepth,
    ).toBe(10)
  })

  it('names the native format of each master, and of no other preset', () => {
    const ctx = context({ capabilities: desktop })
    expect(resolvePilotPreset('master-prores', ctx)?.nativeFormat).toBe('prores-422-hq')
    expect(resolvePilotPreset('master-hevc-10bit', ctx)?.nativeFormat).toBe('hevc-main10')
    for (const id of ['same-as-source', 'youtube-4k', 'small-file'] as const) {
      expect(resolvePilotPreset(id, ctx)?.nativeFormat).toBeUndefined()
    }
  })

  it('offers only the masters whose format the native encoder can write', () => {
    const only = (nativeFormats: Array<'hevc-main10' | 'prores-422-hq'>) =>
      getPilotPresets(context({ capabilities: { nativeEncoder: true, nativeFormats } })).map((p) => p.id)
    expect(only(['hevc-main10'])).toEqual(['same-as-source', 'youtube-4k', 'small-file', 'master-hevc-10bit'])
    expect(only(['prores-422-hq'])).toEqual(['same-as-source', 'youtube-4k', 'small-file', 'master-prores'])
    expect(only([])).toEqual(['same-as-source', 'youtube-4k', 'small-file'])
    expect(
      resolvePilotPreset('master-prores', context({ capabilities: { nativeEncoder: false, nativeFormats: ['prores-422-hq'] } })),
    ).toBeNull()
  })

  it('shows the masters as 10-bit at the project size: HEVC at 120 Mbps (80 at 30 fps), ProRes by its bits per pixel', () => {
    const ctx = context({ capabilities: desktop })
    expect(resolvePilotPreset('master-hevc-10bit', ctx)).toMatchObject({
      container: 'mp4',
      settings: { codec: 'h265', videoBitrate: 120_000_000, resolution: { width: 3840, height: 2160 } },
      numbers: { bitrate: 120_000_000, bitDepth: 10, fps: 60 },
    })
    const at30 = context({ capabilities: desktop, project: { width: 3840, height: 2160, fps: 30 } })
    expect(resolvePilotPreset('master-hevc-10bit', at30)?.numbers.bitrate).toBe(80_000_000)
    const prores = resolvePilotPreset('master-prores', at30)
    expect(prores).toMatchObject({ container: 'mov', settings: { codec: 'prores', proResProfile: 'hq' } })
    // 3840x2160 at 30 fps: Apple publishes 707 Mbps for 29.97 fps
    expect(prores?.numbers.bitrate).toBeGreaterThan(700_000_000)
    expect(prores?.numbers.bitrate).toBeLessThan(720_000_000)
    expect(prores?.settings.videoBitrate).toBe(500_000_000)
  })

  it('every web preset is 8-bit H.265', () => {
    for (const { id } of getPilotPresets(context())) {
      const { resolved } = exported(id, context())
      expect(resolved.numbers.bitDepth).toBe(8)
      expect(resolved.settings.codec).toBe('h265')
    }
  })

  it('hides Same as source when no clip is on the timeline', () => {
    expect(getPilotPresets(context({ source: undefined })).map((p) => p.id)).toEqual([
      'youtube-4k',
      'small-file',
    ])
    expect(resolvePilotPreset('same-as-source', context({ source: undefined }))).toBeNull()
  })

  it('recognises pilot ids', () => {
    expect(isPilotPresetId('youtube-4k')).toBe(true)
    expect(isPilotPresetId('max')).toBe(false)
  })
})

describe('YouTube 4K', () => {
  it('is 3840x2160, H.265, 60 Mbps at 60 fps', () => {
    const { resolved, client } = exported('youtube-4k', context())
    expect(client.resolution).toEqual({ width: 3840, height: 2160 })
    expect(client.codec).toBe('hevc')
    expect(client.container).toBe('mp4')
    expect(client.fps).toBe(60)
    expect(client.videoBitrate).toBe(60_000_000)
    expect(resolved.numbers).toMatchObject({
      width: 3840,
      height: 2160,
      fps: 60,
      bitrate: 60_000_000,
    })
  })

  it('is 40 Mbps at 30 fps', () => {
    const ctx = context({ project: { width: 3840, height: 2160, fps: 30 } })
    expect(exported('youtube-4k', ctx).client.videoBitrate).toBe(40_000_000)
  })

  it('keeps a 4:3 project undistorted inside the 4K box', () => {
    const ctx = context({ project: { width: 3840, height: 2880, fps: 60 } })
    expect(exported('youtube-4k', ctx).client.resolution).toEqual({ width: 2880, height: 2160 })
  })

  it('upscales a 1080p 16:9 project to 3840x2160', () => {
    const ctx = context({ project: { width: 1920, height: 1080, fps: 60 } })
    expect(exported('youtube-4k', ctx).client.resolution).toEqual({ width: 3840, height: 2160 })
  })
})

describe('Small file', () => {
  it('is 1920x1080, H.265, 7 Mbps at 60 fps and 5 Mbps at 30 fps', () => {
    const at60 = exported('small-file', context())
    expect(at60.client.resolution).toEqual({ width: 1920, height: 1080 })
    expect(at60.client.codec).toBe('hevc')
    expect(at60.client.videoBitrate).toBe(7_000_000)
    const at30 = exported(
      'small-file',
      context({ project: { width: 3840, height: 2160, fps: 30 } }),
    )
    expect(at30.client.videoBitrate).toBe(5_000_000)
  })

  it('fits a 4:3 project in the 1080p box', () => {
    const ctx = context({ project: { width: 3840, height: 2880, fps: 60 } })
    expect(exported('small-file', ctx).client.resolution).toEqual({ width: 1440, height: 1080 })
  })
})

describe('Same as source', () => {
  it("uses the source's resolution and its bitrate, in H.265", () => {
    const ctx = context({
      project: { width: 3840, height: 2160, fps: 60 },
      source: { width: 3840, height: 2160, fps: 59.94, bitrate: 98_765_432 },
    })
    const { resolved, client } = exported('same-as-source', ctx)
    expect(client.resolution).toEqual({ width: 3840, height: 2160 })
    expect(client.codec).toBe('hevc')
    expect(client.videoBitrate).toBe(98_765_000)
    expect(resolved.numbers.fps).toBe(60)
  })

  it("takes the source's frame size when it has the project's shape but another size", () => {
    const ctx = context({
      project: { width: 1920, height: 1080, fps: 60 },
      source: { width: 3840, height: 2160, fps: 60, bitrate: 100_000_000 },
    })
    expect(exported('same-as-source', ctx).client.resolution).toEqual({ width: 3840, height: 2160 })
  })

  it("keeps the project's frame when the source has another shape", () => {
    const ctx = context({
      project: { width: 3840, height: 2160, fps: 60 },
      source: { width: 3840, height: 2880, fps: 60, bitrate: 100_000_000 },
    })
    expect(exported('same-as-source', ctx).client.resolution).toEqual({ width: 3840, height: 2160 })
  })

  it('clamps to what the encoder allows', () => {
    const high = context({ source: { width: 3840, height: 2160, fps: 60, bitrate: 900_000_000 } })
    expect(exported('same-as-source', high).client.videoBitrate).toBe(500_000_000)
    const low = context({ source: { width: 3840, height: 2160, fps: 60, bitrate: 20_000 } })
    expect(exported('same-as-source', low).client.videoBitrate).toBe(100_000)
  })

  it('falls back to a stated bitrate when the source bitrate is unknown', () => {
    const none = context({ source: { width: 3840, height: 2160, fps: 60, bitrate: 0 } })
    expect(exported('same-as-source', none).client.videoBitrate).toBe(60_000_000)
  })
})

describe('Custom detection', () => {
  it('matches the preset until a number is edited', () => {
    const ctx = context()
    const resolved = resolvePilotPreset('youtube-4k', ctx)!
    const base: ExportSettings = { ...resolved.settings }
    expect(findActivePilotPresetId('mp4', base, ctx)).toBe('youtube-4k')
    expect(findActivePilotPresetId('mp4', { ...base, videoBitrate: 55_000_000 }, ctx)).toBeNull()
    expect(
      findActivePilotPresetId('mp4', { ...base, resolution: { width: 2560, height: 1440 } }, ctx),
    ).toBeNull()
    expect(findActivePilotPresetId('mp4', { ...base, codec: 'h264' }, ctx)).toBeNull()
    expect(findActivePilotPresetId('mp4', { ...base, rateControl: 'auto' }, ctx)).toBeNull()
  })
})
