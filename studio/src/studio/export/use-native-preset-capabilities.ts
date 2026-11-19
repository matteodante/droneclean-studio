/**
 * What the export dialog's presets may offer on this run (task 3.4): the web capabilities in a browser, at once;
 * in the desktop app the answer of the shell's FFmpeg, once (`readNativePresetCapabilities`), so "Master ProRes"
 * and "HEVC 10-bit" appear there and nowhere else. And what the active preset means for the export: a master runs
 * through the desktop's native encoder.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  hasNativeExportBridge,
  readNativePresetCapabilities,
} from '@/studio/export/native-capabilities'
import {
  isPilotPresetId,
  resolvePilotPreset,
  WEB_PRESET_CAPABILITIES,
  type PresetCapabilities,
  type PresetContext,
  type PresetNumbers,
  type ResolvedPilotPreset,
} from '@/studio/export/presets'
import type { ExportMode } from '@/types/export'
import type { StartExportOptions } from '@/features/export/hooks/use-client-render'

export interface NativePresetCapabilities {
  capabilities: PresetCapabilities
  /** True where the web limits (8-bit H.265 only) are to be announced: not in the desktop app, and not while it is still being asked. */
  showWebLimits: boolean
}

export function useNativePresetCapabilities(): NativePresetCapabilities {
  const [shell] = useState(hasNativeExportBridge)
  const [capabilities, setCapabilities] = useState<PresetCapabilities>(WEB_PRESET_CAPABILITIES)
  const [probing, setProbing] = useState(shell)

  useEffect(() => {
    if (!shell) return
    let cancelled = false
    void readNativePresetCapabilities().then((answer) => {
      if (cancelled) return
      setCapabilities(answer)
      setProbing(false)
    })
    return () => {
      cancelled = true
    }
  }, [shell])

  return { capabilities, showWebLimits: !capabilities.nativeEncoder && !probing }
}

export interface ActiveMaster {
  /** The numbers to show: the active pilot preset's own, else `fallback` (the current settings'). */
  numbers: PresetNumbers
  /** True when the active preset is a master: the export runs through the desktop's native encoder, not WebCodecs. */
  isNative: boolean
  /** What `startExport` is given besides the settings. */
  startOptions: StartExportOptions | undefined
}

/**
 * The active preset as the export sees it. A master's numbers are 10-bit and ProRes runs far above the bitrate
 * field's cap, so they come from the preset, not from the settings; any edit of the settings makes them Custom,
 * which is the WebCodecs path again.
 */
export function useActiveMaster(
  activePresetId: string | null,
  presetContext: PresetContext,
  exportMode: ExportMode,
  fallback: PresetNumbers,
): ActiveMaster {
  const active = useMemo<ResolvedPilotPreset | null>(
    () =>
      activePresetId !== null && isPilotPresetId(activePresetId)
        ? resolvePilotPreset(activePresetId, presetContext)
        : null,
    [activePresetId, presetContext],
  )
  const nativeFormat = exportMode === 'video' ? active?.nativeFormat : undefined
  return {
    numbers: active?.numbers ?? fallback,
    isNative: nativeFormat !== undefined,
    startOptions: useMemo(() => (nativeFormat === undefined ? undefined : { nativeFormat }), [nativeFormat]),
  }
}
