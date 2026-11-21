/**
 * Settings › Privacy: the two switches of the opt-in reports (20 Nov 2026), each with what it sends
 * and what it never sends, in plain words. Offered only for the halves this build configures, so
 * no switch does nothing; the section itself is hidden when neither is configured
 * (`hasTelemetrySettings`).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TELEMETRY_FEATURES } from './config'
import { useUpdates, hasUpdateCheck } from '@/studio/updates/updates'
import { useTelemetryConsent, type TelemetryKind } from './consent'

/** Whether Settings has a Privacy section in this build: the reports' switches, or the desktop app's version check. */
export function hasTelemetrySettings(): boolean {
  return TELEMETRY_FEATURES.crashReports || TELEMETRY_FEATURES.usageStats || hasUpdateCheck()
}

/**
 * The desktop app's "Check for new versions" switch (21 Nov 2026): on by default, the one request the
 * editor makes that the user did not ask for (Matteo's decision; see `studio/updates/updates.ts`).
 */
function UpdateCheckSwitch() {
  const { t } = useTranslation()
  const enabled = useUpdates((state) => state.enabled)
  const loaded = useUpdates((state) => state.loaded)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    void useUpdates.getState().load()
  }, [])
  const label = t('settings.privacy.updateCheck')
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="update-check" className="text-sm">
          {label}
        </Label>
        <Switch
          id="update-check"
          checked={enabled}
          disabled={!loaded || pending}
          onCheckedChange={(on) => {
            setPending(true)
            void useUpdates
              .getState()
              .setEnabled(on)
              .finally(() => setPending(false))
          }}
          aria-label={label}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.privacy.updateCheckDescription')}</p>
    </div>
  )
}

function TelemetrySwitch({ kind, label, description }: { kind: TelemetryKind; label: string; description: string }) {
  const settings = useTelemetryConsent((state) => state.settings)
  const loaded = useTelemetryConsent((state) => state.loaded)
  const choose = useTelemetryConsent((state) => state.choose)
  const [pending, setPending] = useState(false)
  const id = `telemetry-${kind}`

  const change = (on: boolean) => {
    setPending(true)
    void choose({ [kind]: on }).finally(() => setPending(false))
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <Switch
          id={id}
          checked={settings?.[kind] === true}
          disabled={!loaded || pending}
          onCheckedChange={change}
          aria-label={label}
        />
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

export function PrivacyPanel() {
  const { t } = useTranslation()
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('settings.privacy.intro')}</p>
      {TELEMETRY_FEATURES.crashReports && (
        <TelemetrySwitch
          kind="crashReports"
          label={t('settings.privacy.crashReports')}
          description={t('settings.privacy.crashReportsDescription')}
        />
      )}
      {TELEMETRY_FEATURES.usageStats && (
        <TelemetrySwitch
          kind="usageStats"
          label={t('settings.privacy.usageStats')}
          description={t('settings.privacy.usageStatsDescription')}
        />
      )}
      {hasUpdateCheck() && <UpdateCheckSwitch />}
      <p className="text-xs text-muted-foreground">{t('settings.privacy.never')}</p>
    </div>
  )
}
