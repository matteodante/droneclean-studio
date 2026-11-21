/**
 * "DroneClean Studio 0.2.0 is available" (21 Nov 2026): a small card in the bottom-left corner,
 * shown in the desktop app only, with **Download** (the shell opens the release page in the
 * browser) and **Later** (hidden until tomorrow). It blocks nothing, waits while the first-launch
 * privacy question is on screen, and stays out of the way while an export renders. Mounted once in
 * `src/app.tsx`. See `updates.ts` for why the check exists.
 */
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { needsTelemetryAnswer, useTelemetryConsent } from '@/studio/telemetry/consent'
import { listenForUpdates, useUpdates } from './updates'

/** Whether an export is rendering; the queue's store is loaded on demand, like the side-work holds do. */
function useExporting(): boolean {
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void import('@/features/export/stores/render-queue-store')
      .then(({ useRenderQueueStore }) => {
        if (cancelled) return
        const rendering = (jobs: Array<{ status: string }>) => jobs.some((job) => job.status === 'rendering')
        setExporting(rendering(useRenderQueueStore.getState().jobs))
        stop = useRenderQueueStore.subscribe((state) => setExporting(rendering(state.jobs)))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])
  return exporting
}

export function UpdateNotice() {
  const { t } = useTranslation()
  const notice = useUpdates((state) => state.notice)
  const telemetryLoaded = useTelemetryConsent((state) => state.loaded)
  const telemetrySettings = useTelemetryConsent((state) => state.settings)
  const exporting = useExporting()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    void useUpdates.getState().load()
    return listenForUpdates()
  }, [])

  // One card in the corner at a time: the privacy question comes first.
  if (notice === null || exporting || !telemetryLoaded || needsTelemetryAnswer(telemetrySettings)) return null

  const run = (action: () => Promise<void>) => {
    setPending(true)
    void action()
      .catch(() => undefined)
      .finally(() => setPending(false))
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-notice"
      className="fixed bottom-4 left-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t('settings.privacy.updateNoticeTitle', { version: notice.version })}</p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => useUpdates.getState().dismiss())}>
          {t('settings.privacy.updateNoticeLater')}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => run(() => useUpdates.getState().open())}>
          {t('settings.privacy.updateNoticeDownload')}
        </Button>
      </div>
    </div>
  )
}
