import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Film, Loader2, Plus, RotateCcw } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { LottieFilesAnimation } from '../services/lottiefiles-api'

interface LottieCardProps {
  animation: LottieFilesAnimation
  isImporting: boolean
  isImported: boolean
  isFailed: boolean
  onImport: (animation: LottieFilesAnimation) => void
}

function LottieCardComponent({
  animation,
  isImporting,
  isImported,
  isFailed,
  onImport,
}: LottieCardProps) {
  const { t } = useTranslation()
  const disabled = isImporting || isImported
  // Some (often freshly uploaded) animations have no rendered still yet.
  const [previewFailed, setPreviewFailed] = useState(false)
  // The still is a cross-origin image like the GIF was, but a page of them is
  // about a megabyte: load one only after its card has scrolled into view.
  const [previewRequested, setPreviewRequested] = useState(false)
  const cardRef = useRef<HTMLButtonElement>(null)
  const showPreview = Boolean(animation.imageUrl) && !previewFailed

  useEffect(() => {
    if (!showPreview || previewRequested) return
    const card = cardRef.current
    if (!card) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setPreviewRequested(true)
        observer.disconnect()
      }
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [previewRequested, showPreview])

  const actionLabel = isImported
    ? t('lottieBrowser.added')
    : isFailed
      ? t('lottieBrowser.importFailed')
      : t('lottieBrowser.addToMedia')

  return (
    <div className="group flex flex-col gap-1">
      <button
        ref={cardRef}
        type="button"
        onClick={() => onImport(animation)}
        disabled={disabled}
        aria-label={actionLabel}
        data-tooltip={actionLabel}
        data-tooltip-side="top"
        className={cn(
          'relative aspect-square w-full overflow-hidden rounded-lg border border-border transition-colors',
          !disabled && 'hover:border-primary/60',
          disabled && 'cursor-default',
          isFailed && 'border-destructive/70',
        )}
        style={{ backgroundColor: animation.bgColor ?? undefined }}
      >
        {showPreview && previewRequested ? (
          <img
            // COEP is `require-corp`; a cross-origin <img> must be a CORS
            // request or it is blocked. The CDN serves `Access-Control-Allow-
            // Origin: *`, so anonymous CORS loads fine.
            crossOrigin="anonymous"
            src={animation.imageUrl ?? undefined}
            alt={animation.name}
            onError={() => setPreviewFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Film className="h-6 w-6" />
          </div>
        )}

        {!disabled && !isFailed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Plus className="h-6 w-6 text-white" />
          </div>
        )}

        {isFailed && !isImporting && (
          <div className="absolute inset-0 flex items-center justify-center bg-destructive/30">
            <RotateCcw className="h-5 w-5 text-white" />
          </div>
        )}

        {isImporting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        )}

        {isImported && (
          <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
            <Check className="h-3 w-3" />
          </div>
        )}
      </button>

      <div className="min-w-0 px-0.5">
        <div className="truncate text-[11px] font-medium text-foreground">{animation.name}</div>
        {animation.author && (
          <div className="truncate text-[10px] text-muted-foreground">
            {t('lottieBrowser.by', { author: animation.author })}
          </div>
        )}
      </div>
    </div>
  )
}

export const LottieCard = memo(LottieCardComponent)
