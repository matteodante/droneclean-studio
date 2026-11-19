/**
 * Quick presets for the export dialog: one-click container/codec/quality/
 * resolution targets, with the active one marked and "Custom" shown otherwise.
 */

import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import type { PresetNumbers } from '@/studio/export/presets'
import type { ExportPresetChoice, ExportPresetId } from '../utils/export-options'

/** How the numbers line names a codec; the rest are shown in capitals. */
const CODEC_LABELS: Partial<Record<PresetNumbers['codec'], string>> = { h265: 'H.265', prores: 'ProRes' }

export interface ExportPresetGridProps {
  presets: readonly ExportPresetChoice[]
  /** The preset the current settings exactly match, or null for "Custom". */
  activePresetId: ExportPresetId | null
  onApplyPreset: (preset: ExportPresetChoice) => void
  /** The numbers the export will use right now (shown under the presets). */
  numbers?: PresetNumbers
  /** Plain-words limit of this build (8-bit H.265, no ProRes, no 10-bit); omitted where none applies. */
  limitNote?: string
}

export function ExportPresetGrid({
  presets,
  activePresetId,
  onApplyPreset,
  numbers,
  limitNote,
}: ExportPresetGridProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('export.settings.presetLabel')}</Label>
        {activePresetId === null && (
          <span className="text-xs text-muted-foreground">{t('export.settings.presetCustom')}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((preset) => {
          const isActive = activePresetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              aria-pressed={isActive}
              className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
                isActive
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              {t(preset.labelKey)}
            </button>
          )
        })}
      </div>
      {numbers && (
        <p className="text-xs text-muted-foreground" data-testid="export-preset-numbers">
          {t('export.settings.presetNumbers', {
            width: numbers.width,
            height: numbers.height,
            fps: Number(numbers.fps.toFixed(2)),
            codec: CODEC_LABELS[numbers.codec] ?? numbers.codec.toUpperCase(),
            bitrate: (numbers.bitrate / 1_000_000).toFixed(1),
            bitDepth: numbers.bitDepth,
          })}
        </p>
      )}
      {limitNote && <p className="text-xs text-muted-foreground">{limitNote}</p>}
    </div>
  )
}
