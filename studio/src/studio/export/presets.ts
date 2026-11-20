/**
 * Export presets a drone pilot understands: "Same as source", "YouTube 4K",
 * "Instagram Reel" and "Small file", each resolved to concrete numbers (resolution, frame rate,
 * codec, bitrate, bit depth) that the dialog shows and lets the user edit.
 * "Master ProRes" and 10-bit HEVC need the native encoder (task 3.3); they are
 * defined here behind the `nativeEncoder` capability, which only the desktop
 * shell sets (`native-capabilities.ts`), so the web build never offers them. Each
 * carries the native export format it stands for (`nativeFormat`): the dialog
 * runs the export through the desktop's encoder for it.
 *
 * Pure: no React, no i18n. Callers pass the project frame, the dominant source
 * clip and the capabilities.
 *
 * Frame rate: the export settings carry no frame rate of their own, the output
 * runs at the project's (whole-number) rate, so every preset reports that rate.
 */

import type { ExportSettings } from '@/types/export'

export type PilotPresetId =
  | 'same-as-source'
  | 'youtube-4k'
  | 'instagram-reel'
  | 'small-file'
  | 'master-prores'
  | 'master-hevc-10bit'

/** The native export formats the masters stand for (`EXPORT_FORMATS` of the render contract: HEVC Main 10, ProRes 422 HQ). */
export type NativeMasterFormat = 'hevc-main10' | 'prores-422-hq'

export interface PresetCapabilities {
  /** True only where the native (desktop) encoder is available: ProRes and 10-bit. */
  nativeEncoder: boolean
  /** Which of the native formats the encoder can write; absent means both (when `nativeEncoder` is true). */
  nativeFormats?: readonly NativeMasterFormat[]
}

export const WEB_PRESET_CAPABILITIES: PresetCapabilities = { nativeEncoder: false }

export interface PresetFrame {
  width: number
  height: number
  fps: number
}

export interface PresetSource extends PresetFrame {
  /** Average bitrate in bits per second; 0 when unknown. */
  bitrate: number
}

export interface PresetContext {
  project: PresetFrame
  source?: PresetSource
  capabilities: PresetCapabilities
}

/** The numbers a preset stands for, as shown to the user. */
export interface PresetNumbers {
  width: number
  height: number
  fps: number
  codec: ExportSettings['codec']
  /** Bits per second. */
  bitrate: number
  bitDepth: 8 | 10
}

export interface ResolvedPilotPreset {
  container: 'mp4' | 'mov'
  /** Set for the masters: the export runs through the desktop's native encoder in this format. */
  nativeFormat?: NativeMasterFormat
  /** Fields to merge into the dialog's export settings. */
  settings: Pick<
    ExportSettings,
    'codec' | 'quality' | 'resolution' | 'rateControl' | 'videoBitrate' | 'smartCopy'
  > &
    /** Present on every preset, undefined unless the preset states one: the dialog's merge then clears an earlier preset's. */
    Pick<ExportSettings, 'audioBitrate'> &
    Partial<Pick<ExportSettings, 'proResProfile'>>
  numbers: PresetNumbers
}

interface PilotPresetDefinition {
  id: PilotPresetId
  labelKey: string
  requires?: 'nativeEncoder'
  /** The native format the preset needs the encoder to be able to write. */
  nativeFormat?: NativeMasterFormat
  /** Meaningless without a source clip on the timeline: hidden then. */
  needsSource?: boolean
  resolve(context: PresetContext): ResolvedPilotPreset
}

const MIN_VIDEO_BITRATE = 100_000
const MAX_VIDEO_BITRATE = 500_000_000

/**
 * YouTube's published upload recommendations for SDR 2160p are 35-45 Mbps up to
 * 30 fps and 53-68 Mbps at 48-60 fps (support.google.com/youtube/answer/1722171,
 * "Recommended upload encoding settings"). H.265 is accepted; FPV footage is
 * high-motion and YouTube re-encodes the upload, so we sit at the top of the
 * range: 60 Mbps above 30 fps, 40 Mbps at or below.
 */
function youtube4kBitrate(fps: number): number {
  return fps > 30 ? 60_000_000 : 40_000_000
}

/**
 * Meta's Reels specification (developers.facebook.com, IG User Media › Reel Specifications, read 19 Nov 2026): MP4,
 * H.264 or HEVC, closed GOP, 4:2:0, 23-60 fps, at most 1920 columns, VBR at most 25 Mbps, AAC at most 48 kHz stereo,
 * 128 kbps, 300 MB at most. Instagram shows Reels at 1080x1920 and re-encodes every upload, so the preset gives it
 * exactly that frame (no scaling of its own) with the bits under the cap: 20 Mbps above 30 fps (peaks stay under
 * 25: 23.5 measured on a 44 s reel), 12 Mbps at or below. H.264 is what every Instagram client decodes.
 */
function instagramReelBox(project: PresetFrame): { width: number; height: number } {
  return project.height >= project.width ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }
}

function instagramReelBitrate(fps: number): number {
  return fps > 30 ? 20_000_000 : 12_000_000
}

/**
 * Sharing size. YouTube recommends 8 Mbps (up to 30 fps) and 12 Mbps (48-60 fps)
 * for SDR 1080p, same source. H.265 needs about 0.6 of H.264's rate for the
 * same quality (the factor the renderer already uses for it in
 * `runtime/renderer/video-bitrate.ts`): 8 x 0.6 = 4.8 and 12 x 0.6 = 7.2, rounded
 * to 5 and 7 Mbps.
 */
function smallFileBitrate(fps: number): number {
  return fps > 30 ? 7_000_000 : 5_000_000
}

/**
 * ProRes 422 HQ is intra-frame at a fixed budget per pixel: Apple's published rates are 176 Mbps at 1920x1080 and
 * 707 Mbps at 3840x2160, both at 29.97 fps, which is 2.83 to 2.84 bits per pixel per frame. The encoder sets the
 * real rate itself; this is the figure the dialog shows.
 */
const PRORES_HQ_BITS_PER_PIXEL = 2.83

function proresHqBitrate(frame: PresetFrame): number {
  return Math.round((frame.width * frame.height * frame.fps * PRORES_HQ_BITS_PER_PIXEL) / 1_000_000) * 1_000_000
}

function clampBitrate(bitrate: number): number {
  const rounded = Math.round(bitrate / 1000) * 1000
  return Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, rounded))
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * The largest frame of the project's aspect ratio inside a box. An exact fit
 * when the project already has the box's aspect ratio (within 1%), so output
 * is never stretched. Otherwise the frame is scaled (up or down) to touch the
 * box on one side.
 */
function fitInBox(
  frame: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } {
  const frameAspect = frame.width / frame.height
  const boxAspect = box.width / box.height
  if (Math.abs(frameAspect / boxAspect - 1) <= 0.01) return { ...box }
  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  return {
    width: evenDimension(frame.width * scale),
    height: evenDimension(frame.height * scale),
  }
}

function build(
  context: PresetContext,
  options: {
    container: 'mp4' | 'mov'
    codec: ExportSettings['codec']
    resolution: { width: number; height: number }
    bitrate: number
    bitDepth: 8 | 10
    quality?: ExportSettings['quality']
    audioBitrate?: string
    proResProfile?: ExportSettings['proResProfile']
    nativeFormat?: NativeMasterFormat
    /** The rate the preset shows when it is above what the bitrate field takes (ProRes is far above it). */
    shownBitrate?: number
  },
): ResolvedPilotPreset {
  const bitrate = clampBitrate(options.bitrate)
  return {
    container: options.container,
    ...(options.nativeFormat ? { nativeFormat: options.nativeFormat } : {}),
    settings: {
      codec: options.codec,
      quality: options.quality ?? 'high',
      resolution: options.resolution,
      rateControl: 'variable',
      videoBitrate: bitrate,
      // A preset states exact numbers: copying the source bytes would ignore them.
      smartCopy: false,
      audioBitrate: options.audioBitrate,
      ...(options.proResProfile ? { proResProfile: options.proResProfile } : {}),
    },
    numbers: {
      width: options.resolution.width,
      height: options.resolution.height,
      fps: context.project.fps,
      codec: options.codec,
      bitrate: options.shownBitrate ?? bitrate,
      bitDepth: options.bitDepth,
    },
  }
}

const DEFINITIONS: PilotPresetDefinition[] = [
  {
    id: 'same-as-source',
    labelKey: 'export.settings.presetSameAsSource',
    needsSource: true,
    resolve(context) {
      const source = context.source
      // The source's own frame size, unless its shape differs from the project's
      // (a stabilized or reframed project): then the project's frame, so nothing is stretched.
      const sameShape =
        source !== undefined &&
        Math.abs(
          source.width / source.height / (context.project.width / context.project.height) - 1,
        ) <= 0.01
      const resolution = sameShape
        ? { width: evenDimension(source.width), height: evenDimension(source.height) }
        : { width: context.project.width, height: context.project.height }
      const fallback = context.project.fps > 30 ? 60_000_000 : 40_000_000
      const bitrate = source && source.bitrate > 0 ? source.bitrate : fallback
      return build(context, { container: 'mp4', codec: 'h265', resolution, bitrate, bitDepth: 8 })
    },
  },
  {
    id: 'youtube-4k',
    labelKey: 'export.settings.presetYoutube4k',
    resolve(context) {
      return build(context, {
        container: 'mp4',
        codec: 'h265',
        resolution: fitInBox(context.project, { width: 3840, height: 2160 }),
        bitrate: youtube4kBitrate(context.project.fps),
        bitDepth: 8,
      })
    },
  },
  {
    id: 'instagram-reel',
    labelKey: 'export.settings.presetInstagramReel',
    resolve(context) {
      const resolution = fitInBox(context.project, instagramReelBox(context.project))
      return build(context, {
        container: 'mp4',
        codec: 'h264',
        resolution,
        bitrate: instagramReelBitrate(context.project.fps),
        bitDepth: 8,
        // Meta's Reel specification: AAC at 128 kbps.
        audioBitrate: '128k',
      })
    },
  },
  {
    id: 'small-file',
    labelKey: 'export.settings.presetSmallFile',
    resolve(context) {
      return build(context, {
        container: 'mp4',
        codec: 'h265',
        resolution: fitInBox(context.project, { width: 1920, height: 1080 }),
        bitrate: smallFileBitrate(context.project.fps),
        bitDepth: 8,
        quality: 'medium',
      })
    },
  },
  {
    id: 'master-prores',
    labelKey: 'export.settings.presetMasterProres',
    requires: 'nativeEncoder',
    nativeFormat: 'prores-422-hq',
    resolve(context) {
      // The native encoder sets the exact rate; the bitrate field is capped at 500 Mbps and
      // ProRes is above it at 4K, so the settings carry the cap and the dialog shows the real figure.
      return build(context, {
        container: 'mov',
        codec: 'prores',
        resolution: { width: context.project.width, height: context.project.height },
        bitrate: MAX_VIDEO_BITRATE,
        shownBitrate: proresHqBitrate({ ...context.project }),
        bitDepth: 10,
        proResProfile: 'hq',
        nativeFormat: 'prores-422-hq',
      })
    },
  },
  {
    id: 'master-hevc-10bit',
    labelKey: 'export.settings.presetMasterHevc10',
    requires: 'nativeEncoder',
    nativeFormat: 'hevc-main10',
    resolve(context) {
      return build(context, {
        container: 'mp4',
        codec: 'h265',
        resolution: { width: context.project.width, height: context.project.height },
        bitrate: context.project.fps > 30 ? 120_000_000 : 80_000_000,
        bitDepth: 10,
        nativeFormat: 'hevc-main10',
      })
    },
  },
]

export interface PilotPresetChoice {
  id: PilotPresetId
  labelKey: string
}

function isAvailable(definition: PilotPresetDefinition, context: PresetContext): boolean {
  if (definition.needsSource && !context.source) return false
  if (definition.requires === undefined) return true
  if (!context.capabilities.nativeEncoder) return false
  const formats = context.capabilities.nativeFormats
  return definition.nativeFormat === undefined || formats === undefined || formats.includes(definition.nativeFormat)
}

/** The presets offered in this context (the web build with a clip on the timeline gets three). */
export function getPilotPresets(context: PresetContext): PilotPresetChoice[] {
  return DEFINITIONS.filter((d) => isAvailable(d, context)).map(({ id, labelKey }) => ({
    id,
    labelKey,
  }))
}

export function isPilotPresetId(id: string): id is PilotPresetId {
  return DEFINITIONS.some((d) => d.id === id)
}

/** Resolves a preset to its numbers; null when the capabilities or the lack of a source do not allow it. */
export function resolvePilotPreset(
  id: PilotPresetId,
  context: PresetContext,
): ResolvedPilotPreset | null {
  const definition = DEFINITIONS.find((d) => d.id === id)
  if (!definition || !isAvailable(definition, context)) return null
  return definition.resolve(context)
}

/**
 * Which pilot preset the current settings still match exactly (container,
 * codec, resolution and the stated bitrate); null once the user edits any of
 * them, which the dialog shows as "Custom".
 */
export function findActivePilotPresetId(
  container: string,
  settings: ExportSettings,
  context: PresetContext,
): PilotPresetId | null {
  if ((settings.rateControl ?? 'auto') === 'auto') return null
  for (const { id } of getPilotPresets(context)) {
    const resolved = resolvePilotPreset(id, context)
    if (!resolved) continue
    const s = resolved.settings
    if (
      resolved.container === container &&
      s.codec === settings.codec &&
      s.resolution.width === settings.resolution.width &&
      s.resolution.height === settings.resolution.height &&
      s.videoBitrate === settings.videoBitrate
    ) {
      return id
    }
  }
  return null
}
