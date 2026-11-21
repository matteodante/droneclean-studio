// The program monitor's playback resolution (Full, 1/2, 1/4), in the transport bar beside the proxy switch: the
// control FreeCut's `previewQuality` setting never had. Lowering it lowers the size the preview renders at
// (`quality.ts`), and with it the work of every rendered frame and of a pre-render.

import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePlaybackStore } from '@/shared/state/playback'
import { PREVIEW_QUALITY_LEVELS, type QualityLevel } from './quality'

function qualityLabel(t: TFunction, level: QualityLevel): string {
  switch (level) {
    case 1:
      return t('preview.previewRender.quality.full')
    case 0.5:
      return t('preview.previewRender.quality.half')
    case 0.25:
      return t('preview.previewRender.quality.quarter')
  }
}

export function PreviewQualityMenu({ buttonStyle }: { buttonStyle: CSSProperties }) {
  const { t } = useTranslation()
  const quality = usePlaybackStore((s) => s.previewQuality)
  const setPreviewQuality = usePlaybackStore((s) => s.setPreviewQuality)
  const current = PREVIEW_QUALITY_LEVELS.find((level) => level === quality)
  // A quality the menu does not offer (FreeCut's 1/3, written by an older version) reads as its fraction
  const currentLabel =
    current === undefined ? `1/${Math.round(1 / quality)}` : qualityLabel(t, current)
  const tooltip = t('preview.previewRender.quality.tooltip', { value: currentLabel })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex-shrink-0 px-1.5 text-xs font-medium tabular-nums"
          style={{ height: buttonStyle.height, minWidth: buttonStyle.width }}
          data-tooltip={tooltip}
          aria-label={tooltip}
          data-testid="preview-quality-menu"
        >
          {currentLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('preview.previewRender.quality.label')}</DropdownMenuLabel>
        {PREVIEW_QUALITY_LEVELS.map((level) => (
          <DropdownMenuCheckboxItem
            key={level}
            checked={level === quality}
            onCheckedChange={() => setPreviewQuality(level)}
          >
            {qualityLabel(t, level)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
