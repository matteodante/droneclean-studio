import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '@/studio/desktop/bridge'

export const DESKTOP_APP_URL = 'https://droneclean.app/#get-studio'
export const DESKTOP_NOTICE_DISMISSED_KEY = 'droneclean-desktop-notice-dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_NOTICE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A quiet, dismissible line on the web editor's projects page that points to the desktop app.
 * Renders nothing inside the desktop app (the bridge exists there) and after the visitor dismissed it.
 */
export function DesktopAppNotice() {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(readDismissed)

  if (getDesktopBridge() !== undefined || dismissed) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DESKTOP_NOTICE_DISMISSED_KEY, '1')
    } catch {
      // Storage may be blocked: the notice still hides for this visit.
    }
    setDismissed(true)
  }

  return (
    <div
      role="note"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
    >
      <p>
        {t('projects.desktopNotice.message')}{' '}
        <a
          href={DESKTOP_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-4 hover:no-underline"
        >
          {t('projects.desktopNotice.link')}
        </a>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('projects.desktopNotice.dismiss')}
        className="shrink-0 rounded p-1 hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
