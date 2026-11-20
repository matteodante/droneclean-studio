/**
 * Starts the editor's opt-in reports once at startup (`src/main.tsx`): reads the user's answer,
 * starts crash reports if they are on, and sends `app_opened` if usage statistics are on. Later
 * answers (the first-launch notice, Settings › Privacy) apply at once, without a restart.
 */
import { applyCrashReports } from './crash'
import { isTelemetryOn, useTelemetryConsent, type TelemetrySettings } from './consent'
import { track } from './usage'

let installed = false
let openedSent = false

function apply(settings: TelemetrySettings | null): void {
  // A failed start (the SDK's chunk did not load) leaves reports off; it is not itself reported.
  applyCrashReports(isTelemetryOn(settings, 'crashReports')).catch(() => undefined)
  if (!openedSent && isTelemetryOn(settings, 'usageStats')) {
    openedSent = true
    track('app_opened', {})
  }
}

export function installTelemetry(): void {
  if (installed) return
  installed = true
  useTelemetryConsent.subscribe((state, previous) => {
    if (state.loaded && (state.settings !== previous.settings || !previous.loaded)) apply(state.settings)
  })
  void useTelemetryConsent.getState().load()
}
