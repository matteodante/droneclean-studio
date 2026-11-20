/**
 * The first-launch question about crash reports and usage statistics (20 Nov 2026).
 *
 * A card in the bottom-left corner, over the workspace picker or the editor alike, that stays until
 * it is answered and blocks nothing meanwhile: until then nothing is sent, the same as "Don't
 * allow". "Allow" switches on the halves this build offers; Settings › Privacy changes either one
 * later. Mounted once in `src/app.tsx`, outside the workspace gate, so it is there from the first
 * screen.
 */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { TELEMETRY_FEATURES } from './config'
import { needsTelemetryAnswer, useTelemetryConsent, type TelemetryChoice } from './consent'

/** The answer the two buttons store: every half this build offers, on or off. */
function answerForAll(on: boolean): TelemetryChoice {
  const choice: TelemetryChoice = {}
  if (TELEMETRY_FEATURES.crashReports) choice.crashReports = on
  if (TELEMETRY_FEATURES.usageStats) choice.usageStats = on
  return choice
}

export function TelemetryNotice() {
  const { t } = useTranslation()
  const loaded = useTelemetryConsent((state) => state.loaded)
  const settings = useTelemetryConsent((state) => state.settings)
  const choose = useTelemetryConsent((state) => state.choose)
  const [pending, setPending] = useState(false)

  if (!loaded || !needsTelemetryAnswer(settings)) return null

  const answer = (on: boolean) => {
    setPending(true)
    void choose(answerForAll(on)).finally(() => setPending(false))
  }
  const message = TELEMETRY_FEATURES.usageStats
    ? TELEMETRY_FEATURES.crashReports
      ? t('telemetry.notice.both')
      : t('telemetry.notice.usageOnly')
    : t('telemetry.notice.crashOnly')

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="telemetry-notice-title"
      data-testid="telemetry-notice"
      className="fixed bottom-4 left-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 id="telemetry-notice-title" className="font-medium">
          {t('telemetry.notice.title')}
        </h2>
      </div>
      <p className="text-muted-foreground">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">{t('telemetry.notice.later')}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => answer(false)}>
          {t('telemetry.notice.decline')}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => answer(true)}>
          {t('telemetry.notice.allow')}
        </Button>
      </div>
    </div>
  )
}
