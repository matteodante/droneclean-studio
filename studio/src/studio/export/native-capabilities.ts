/**
 * Whether this run of the editor can export through the desktop's native encoder (task 3.4): the masters
 * of `presets.ts` ("Master ProRes", "HEVC 10-bit") are offered only where it can.
 *
 * It can when the desktop shell's preload offers everything a native export uses (the encoder and the decoder
 * of its media engine, the media registry that names each clip's file, and the save dialog that grants the
 * output path) and the shell's FFmpeg answers `capabilities` as available with the format. The browser build has
 * no such bridge, so the answer there is known at once and no request is made.
 */
import { getDesktopBridge } from '@/studio/desktop/bridge'
import type { PresetCapabilities, NativeMasterFormat } from './presets'
import { WEB_PRESET_CAPABILITIES } from './presets'

const MASTER_FORMATS: readonly NativeMasterFormat[] = ['hevc-main10', 'prores-422-hq']

/** The members of the desktop bridge a native export uses, as far as this answer needs them. */
interface NativeExportBridge {
  readonly nativeMedia?: {
    capabilities(): Promise<
      | { readonly ok: true; readonly value: { readonly available: boolean; readonly exportFormats: readonly string[] } }
      | { readonly ok: false }
    >
  }
  readonly mediaPaths?: unknown
  readonly exportFile?: unknown
}

/** Whether the page runs in a desktop shell that has the members a native export needs; false in a browser. */
export function hasNativeExportBridge(): boolean {
  const bridge = getDesktopBridge() as NativeExportBridge | undefined
  return bridge?.nativeMedia !== undefined && bridge.mediaPaths !== undefined && bridge.exportFile !== undefined
}

/** Asks the shell once; the web capabilities when there is no shell, the engine is missing or it cannot answer. */
export async function readNativePresetCapabilities(): Promise<PresetCapabilities> {
  if (!hasNativeExportBridge()) return WEB_PRESET_CAPABILITIES
  const bridge = getDesktopBridge() as NativeExportBridge
  try {
    const answer = await bridge.nativeMedia?.capabilities()
    if (answer === undefined || !answer.ok || !answer.value.available) return WEB_PRESET_CAPABILITIES
    const nativeFormats = MASTER_FORMATS.filter((format) => answer.value.exportFormats.includes(format))
    return nativeFormats.length === 0 ? WEB_PRESET_CAPABILITIES : { nativeEncoder: true, nativeFormats }
  } catch {
    // A shell that cannot say what its FFmpeg does offers no master: the plain 8-bit presets still work.
    return WEB_PRESET_CAPABILITIES
  }
}
