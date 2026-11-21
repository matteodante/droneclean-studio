// The running pre-render in the transport bar: how far it is, and Cancel (the frames rendered so far stay).

import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cancelPrerender } from '../job'
import { usePrerenderStore } from '../store'

export function PrerenderProgress({ buttonStyle }: { buttonStyle: CSSProperties }) {
  const { t } = useTranslation()
  const job = usePrerenderStore((s) => s.job)
  if (job === null) return null
  const percent = job.total === 0 ? 100 : Math.floor((job.done / job.total) * 100)
  const label = t('preview.previewRender.prerender.rendering', { percent })

  return (
    <div
      className="flex items-center gap-1 flex-shrink-0 text-xs text-muted-foreground tabular-nums"
      role="status"
      data-testid="prerender-progress"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" aria-hidden="true" />
      <span className="hidden @min-[560px]:inline">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0"
        style={buttonStyle}
        onClick={cancelPrerender}
        data-tooltip={t('preview.previewRender.prerender.cancel')}
        aria-label={`${label}. ${t('preview.previewRender.prerender.cancel')}`}
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}
