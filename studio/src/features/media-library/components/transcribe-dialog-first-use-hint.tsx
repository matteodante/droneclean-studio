import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaTranscriptModel } from '@/types/storage'
import { hasCachedModelEntries } from '@/shared/utils/local-model-cache'
import { TRANSCRIPTION_FIRST_USE_DOWNLOADS } from '@/studio/transcription/first-use-download'

interface FirstUseDownloadHintProps {
  open: boolean
  model: MediaTranscriptModel
}

/**
 * The same first-use hint the other local AI features show: the measured download,
 * until Cache Storage holds the model. It follows the selected model, so switching
 * engines updates it before the job starts.
 */
export function FirstUseDownloadHint({ open, model }: FirstUseDownloadHintProps) {
  const { t } = useTranslation()
  const download = TRANSCRIPTION_FIRST_USE_DOWNLOADS[model]
  const [cached, setCached] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open || !download) {
      setCached(null)
      return
    }
    let cancelled = false
    setCached(null)
    void (async () => {
      const found = await hasCachedModelEntries(
        download.cacheName,
        download.cacheMatchFragments,
      )
      if (!cancelled) setCached(found)
    })()
    return () => {
      cancelled = true
    }
  }, [open, download])

  if (!open || !download || cached !== false) {
    return null
  }

  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {t('media.transcribe.firstUseDownload', {
        size: download.sizeLabel,
        defaultValue: 'First use downloads ≈{{size}}.',
      })}
    </p>
  )
}
