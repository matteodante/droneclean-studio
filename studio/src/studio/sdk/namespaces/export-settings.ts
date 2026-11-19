/**
 * The SDK's export settings (design §0.3, §4.7).
 *
 * The state is only what a caller changed: every other field is the default the
 * export dialog opens with — H.264 in MP4, medium quality, the project's own
 * canvas size, automatic rate control, smart copy, MP3 audio, burned-in
 * subtitles and the in/out range (`export-dialog.tsx:120-132`). The dialog keeps
 * its own `useState` in v1, so the two can disagree until task 3.4 makes it read
 * this module; `studio.export.settings()` is the SDK's half.
 *
 * Every value is checked against the exporter's own tables — the codecs a
 * container carries, the subtitle modes a container can mux — because a setting
 * the exporter rejects would otherwise only fail later, inside `export.start`.
 * The two settings the client pipeline ignores (`proResProfile`,
 * `audioBitrate`) are refused with `UNSUPPORTED` and never reported: a setting
 * that does nothing must not be accepted silently (AGENTS.md).
 * Reads return a plain copy, and nothing here is an undo step.
 */

import type {
  ExportAudioContainer,
  ExportCodec,
  ExportMode,
  ExportQuality,
  ExportRateControl,
  ExportSettingsInfo,
  ExportSettingsPatch,
  ExportSubtitleMode,
  ExportVideoContainer,
} from '../types'
import { invalidArgumentError, studioError } from '../errors'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { getCompatibleVideoCodecs, getDefaultVideoCodec } from '@/features/export/deps/renderer'
import { getSubtitleModeOptions } from '@/features/export/utils/export-subtitles'

/** The settings' fields, as `pickSettings` copies them out of a patch. */
const SETTING_FIELDS = [
  'codec',
  'quality',
  'resolution',
  'rateControl',
  'videoBitrate',
  'smartCopy',
  'mode',
  'videoContainer',
  'audioContainer',
  'subtitleMode',
  'renderWholeProject',
] as const satisfies ReadonlyArray<keyof ExportSettingsInfo>

/** The settings the export pipeline does not read, with why and what to do. */
const UNUSED_SETTINGS: ReadonlyArray<{ field: string; reason: string; hint: string }> = [
  {
    field: 'proResProfile',
    reason: 'the web export has no ProRes encoder',
    hint: 'Remove "proResProfile"; the exporter writes H.264, H.265, VP8, VP9 or AV1.',
  },
  {
    field: 'audioBitrate',
    reason: 'the audio bitrate follows "quality"',
    hint: 'Set "quality" instead: it picks the audio bitrate as well.',
  },
]

/** Container the dialog opens with (`export-dialog.tsx:129`). */
const DEFAULT_VIDEO_CONTAINER: ExportVideoContainer = 'mp4'

/** Audio container the dialog opens with (`export-dialog.tsx:130`). */
const DEFAULT_AUDIO_CONTAINER: ExportAudioContainer = 'mp3'

/** Quality presets the encoder maps to its bitrate table (`video-bitrate.ts:17-22`). */
const QUALITIES: readonly ExportQuality[] = ['low', 'medium', 'high', 'ultra']

/** Rate control modes of the dialog's select (`export-rate-control-fields.tsx:58-61`). */
const RATE_CONTROLS: readonly ExportRateControl[] = ['auto', 'variable', 'constant']

/** Export modes of the dialog's toggle. */
const MODES: readonly ExportMode[] = ['video', 'audio']

/** Video containers the exporter can mux (`client-renderer.ts:85-91`). */
const VIDEO_CONTAINERS: readonly ExportVideoContainer[] = ['mp4', 'mov', 'webm', 'mkv']

/** Audio containers an audio export can use (`client-renderer.ts:213-216`). */
const AUDIO_CONTAINERS: readonly ExportAudioContainer[] = ['mp3', 'aac', 'wav']

/** Subtitle modes `ExtendedExportSettings` declares (`@/types/export`). */
const SUBTITLE_MODES: readonly ExportSubtitleMode[] = ['off', 'burn', 'sidecar', 'embedded']

/** Target video bitrate range of the dialog's field, in bits per second (0.1–500 Mbps). */
const VIDEO_BITRATE_MIN = 100_000
const VIDEO_BITRATE_MAX = 500_000_000

/**
 * The codecs the browser exporter can encode: the union of the containers'
 * tables (`client-renderer.ts:92-97`). ProRes is declared by `ExportSettings`
 * but has no encoder here — `client-renderer.ts:82` maps it to H.264 — so it is
 * not one of them.
 */
const VIDEO_CODECS = [
  ...new Set(VIDEO_CONTAINERS.flatMap((container) => codecsFor(container))),
] as readonly ExportCodec[]

/** The settings a caller has not changed: the export dialog's defaults. */
const DEFAULT_SETTINGS: Omit<ExportSettingsInfo, 'resolution'> = {
  codec: getDefaultVideoCodec(DEFAULT_VIDEO_CONTAINER),
  quality: 'medium',
  rateControl: 'auto',
  smartCopy: true,
  mode: 'video',
  videoContainer: DEFAULT_VIDEO_CONTAINER,
  audioContainer: DEFAULT_AUDIO_CONTAINER,
  subtitleMode: 'burn',
  renderWholeProject: false,
}

/** The fields a caller changed; an absent field means the default. */
let overrides: Partial<ExportSettingsInfo> = {}

/** The codecs the exporter's table lets `container` carry (`client-renderer.ts:92`). */
function codecsFor(container: ExportVideoContainer): readonly string[] {
  return getCompatibleVideoCodecs(container)
}

/** The video container the settings use; the default when the field is absent. */
function videoContainerOf(settings: ExportSettingsInfo): ExportVideoContainer {
  return settings.videoContainer ?? DEFAULT_VIDEO_CONTAINER
}

/** Whether the exporter's table lets `codec` travel in `container`. */
function isCodecInContainer(codec: string, container: ExportVideoContainer): boolean {
  return codecsFor(container).includes(codec)
}

/** The containers that can carry `codec`. */
function containersFor(codec: string): ExportVideoContainer[] {
  return VIDEO_CONTAINERS.filter((candidate) => isCodecInContainer(codec, candidate))
}

/** A positive integer, e.g. one side of a resolution. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Throw `INVALID_ARGUMENT` unless `value` is one of `valid`, and return it typed. */
function requireOneOf<T extends string>(
  value: unknown,
  valid: readonly T[],
  argument: string,
  method: string,
  expectation: string,
): T {
  const match =
    typeof value === 'string' ? valid.find((candidate) => candidate === value) : undefined
  if (match !== undefined) return match
  throw invalidArgumentError({ method, argument, expectation, value, valid })
}

/** Throw `INVALID_ARGUMENT` unless `value` is `{ width, height }` of positive integers. */
function requireResolution(
  value: unknown,
  argument: string,
  method: string,
): { width: number; height: number } {
  if (typeof value === 'object' && value !== null) {
    const { width, height } = value as { width?: unknown; height?: unknown }
    if (isPositiveInteger(width) && isPositiveInteger(height)) return { width, height }
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'a resolution of positive integer width and height in pixels',
    value,
  })
}

/** Throw `INVALID_ARGUMENT` unless `value` is a bitrate the encoder accepts. */
function requireVideoBitrate(value: unknown, argument: string, method: string): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= VIDEO_BITRATE_MIN &&
    value <= VIDEO_BITRATE_MAX
  ) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: `a whole number of bits per second between ${VIDEO_BITRATE_MIN} and ${VIDEO_BITRATE_MAX}`,
    value,
  })
}

/** Throw `INVALID_ARGUMENT` unless `value` is a boolean. */
function requireBoolean(value: unknown, argument: string, method: string): boolean {
  if (typeof value === 'boolean') return value
  throw invalidArgumentError({ method, argument, expectation: 'a boolean', value })
}

/** The patch as an object; `undefined` is an empty patch, anything else is rejected. */
function requirePatchObject(patch: unknown, method: string, argument: string): ExportSettingsPatch {
  if (patch === undefined) return {}
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw invalidArgumentError({
      method,
      argument,
      expectation: 'an object of export settings',
      value: patch,
    })
  }
  return patch as ExportSettingsPatch
}

/**
 * Only the fields of `patch` that are set, without the unknown keys.
 * `undefined` means "leave it as it is", so it is the same as absent.
 */
function pickSettings(patch: ExportSettingsPatch): Partial<ExportSettingsInfo> {
  const fields: Partial<ExportSettingsInfo> = {}
  const source = patch as Partial<Record<keyof ExportSettingsInfo, unknown>>
  // The field and its value are correlated; a computed key hides that from the
  // compiler, so the writes go through an index signature.
  const writes = fields as Record<string, unknown>
  for (const field of SETTING_FIELDS) {
    const value = source[field]
    if (value !== undefined) writes[field] = value
  }
  return fields
}

/** The fields whose value must be one of a fixed set, with what it must be. */
const ONE_OF_FIELDS: ReadonlyArray<{
  field: keyof ExportSettingsInfo
  valid: readonly string[]
  expectation: string
}> = [
  { field: 'codec', valid: VIDEO_CODECS, expectation: 'a codec the browser exporter can encode' },
  { field: 'quality', valid: QUALITIES, expectation: 'one of the encoder quality presets' },
  { field: 'rateControl', valid: RATE_CONTROLS, expectation: 'one of the rate control modes' },
  { field: 'mode', valid: MODES, expectation: 'a video or audio export' },
  { field: 'videoContainer', valid: VIDEO_CONTAINERS, expectation: 'one of the video containers' },
  {
    field: 'audioContainer',
    valid: AUDIO_CONTAINERS,
    expectation: 'one of the audio containers',
  },
  { field: 'subtitleMode', valid: SUBTITLE_MODES, expectation: 'one of the subtitle export modes' },
]

/**
 * Refuse a setting the export pipeline does not read, instead of accepting one
 * that would do nothing (AGENTS.md).
 * @throws UNSUPPORTED when the patch names such a field
 */
function rejectUnusedSettings(patch: ExportSettingsPatch, method: string, argument: string): void {
  const source = patch as Record<string, unknown>
  for (const { field, reason, hint } of UNUSED_SETTINGS) {
    if (source[field] === undefined) continue
    const path = `${argument}.${field}`
    throw studioError({
      code: 'UNSUPPORTED',
      method,
      argument: path,
      message: `${JSON.stringify(path)} is not used by the export pipeline yet: ${reason}`,
      hint,
    })
  }
}

/** Check every field `fields` names against the exporter's value sets. */
function validateFields(fields: Partial<ExportSettingsInfo>, method: string, path: string): void {
  for (const { field, valid, expectation } of ONE_OF_FIELDS) {
    const value = fields[field]
    if (value !== undefined) requireOneOf(value, valid, `${path}.${field}`, method, expectation)
  }
  if (fields.resolution !== undefined) {
    requireResolution(fields.resolution, `${path}.resolution`, method)
  }
  if (fields.videoBitrate !== undefined) {
    requireVideoBitrate(fields.videoBitrate, `${path}.videoBitrate`, method)
  }
  if (fields.smartCopy !== undefined) {
    requireBoolean(fields.smartCopy, `${path}.smartCopy`, method)
  }
  if (fields.renderWholeProject !== undefined) {
    requireBoolean(fields.renderWholeProject, `${path}.renderWholeProject`, method)
  }
}

/** Reject a video format the exporter's container table does not carry. */
function validateVideoFormat(
  settings: ExportSettingsInfo,
  fields: Partial<ExportSettingsInfo>,
  method: string,
  path: string,
): void {
  const container = videoContainerOf(settings)
  if (!isCodecInContainer(settings.codec, container)) {
    if (fields.videoContainer !== undefined && fields.codec === undefined) {
      throw invalidArgumentError({
        method,
        argument: `${path}.videoContainer`,
        expectation: `a container that can carry ${settings.codec}`,
        value: container,
        valid: containersFor(settings.codec),
      })
    }
    throw invalidArgumentError({
      method,
      argument: `${path}.codec`,
      expectation: `a codec the ${container.toUpperCase()} container can carry`,
      value: settings.codec,
      valid: codecsFor(container),
    })
  }
  const subtitleModes = getSubtitleModeOptions(container)
  const subtitleMode = settings.subtitleMode
  if (subtitleMode === undefined || subtitleModes.includes(subtitleMode)) return
  if (fields.videoContainer !== undefined && fields.subtitleMode === undefined) {
    throw invalidArgumentError({
      method,
      argument: `${path}.videoContainer`,
      expectation: `a container that can carry ${subtitleMode} subtitles`,
      value: container,
      valid: VIDEO_CONTAINERS.filter((candidate) =>
        getSubtitleModeOptions(candidate).includes(subtitleMode),
      ),
    })
  }
  throw invalidArgumentError({
    method,
    argument: `${path}.subtitleMode`,
    expectation: `a subtitle mode the ${container.toUpperCase()} container carries`,
    value: subtitleMode,
    valid: subtitleModes,
  })
}

/** Check the fields that only make sense together: codec, container, subtitles. */
function validateCombination(
  settings: ExportSettingsInfo,
  fields: Partial<ExportSettingsInfo>,
  method: string,
  path: string,
): void {
  // An audio export never muxes a video track or captions, so those settings
  // are not constrained (`validateSettings` does the same, client-renderer.ts:356).
  if (settings.mode === 'audio') return
  validateVideoFormat(settings, fields, method, path)
}

/** The open project's canvas, or the editor's defaults when no project is open. */
function projectResolution(): { width: number; height: number } {
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}

/**
 * The settings as `studio.export.settings()` returns them: a plain copy of the
 * defaults, the fields a caller changed and the resolution those imply. The
 * resolution follows the open project until a caller sets one.
 * @example readExportSettings().codec // 'h264'
 */
export function readExportSettings(): ExportSettingsInfo {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    resolution: { ...(overrides.resolution ?? projectResolution()) },
  }
}

/**
 * The settings for one call: `patch` laid over the current ones, validated, not
 * stored. `argument` is the patch's name in an error (`settings` inside
 * `export.start`, `patch` in `export.setSettings`).
 * @throws INVALID_ARGUMENT when a value is not one the exporter accepts
 * @throws UNSUPPORTED when the patch names a setting the pipeline does not read
 * @example resolveExportSettings({ quality: 'high' }, 'export.start', 'settings')
 */
export function resolveExportSettings(
  patch: ExportSettingsPatch | undefined,
  method: string,
  argument: string,
): ExportSettingsInfo {
  const object = requirePatchObject(patch, method, argument)
  rejectUnusedSettings(object, method, argument)
  const fields = pickSettings(object)
  validateFields(fields, method, argument)
  const current = readExportSettings()
  const settings: ExportSettingsInfo = {
    ...current,
    ...fields,
    // The exporter rounds odd sizes in place (`client-renderer.ts:373-380`), so
    // the settings this call hands out own their resolution object.
    resolution: { ...(fields.resolution ?? current.resolution) },
  }
  validateCombination(settings, fields, method, argument)
  return settings
}

/**
 * `studio.export.setSettings`: validate `patch` over the current settings and
 * remember it. A rejected field leaves every setting as it was.
 * @throws INVALID_ARGUMENT when a value is not one the exporter accepts
 * @throws UNSUPPORTED when the patch names a setting the pipeline does not read
 * @example writeExportSettings({ quality: 'high' }, 'export.setSettings')
 */
export function writeExportSettings(patch: ExportSettingsPatch, method: string): void {
  const settings = resolveExportSettings(patch, method, 'patch')
  const fields = pickSettings(patch)
  overrides = { ...overrides, ...fields }
  if (fields.resolution !== undefined) overrides.resolution = { ...settings.resolution }
}

/**
 * Forget every change and go back to the defaults. For tests; the app never
 * calls it.
 * @example resetExportSettings()
 */
export function resetExportSettings(): void {
  overrides = {}
}
