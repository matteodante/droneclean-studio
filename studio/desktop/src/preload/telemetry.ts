/**
 * The telemetry preload of the editor window (20 Nov 2026): exposes `window.dronecleanTelemetry`,
 * the page's way to read and store the user's answer about crash reports and usage statistics
 * (`shared/telemetry.ts`). A separate preload registered on the session, like
 * `preload/agent-access.ts`, because a sandboxed preload cannot import a sibling file: the channel
 * names are written out here and `test/telemetry.test.mjs` holds them to `shared/telemetry.ts`.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopTelemetry, TelemetryChoice, TelemetrySettings } from '../shared/telemetry'

/** `shared/telemetry.ts`'s `TELEMETRY_CHANNELS`, written out for the sandbox. */
const CHANNELS = {
  get: 'telemetry:get',
  set: 'telemetry:set',
} as const

const bridge: DesktopTelemetry = {
  version: 1,
  get(): Promise<TelemetrySettings | null> {
    return ipcRenderer.invoke(CHANNELS.get)
  },
  set(choice: TelemetryChoice): Promise<TelemetrySettings> {
    return ipcRenderer.invoke(CHANNELS.set, choice)
  },
}

contextBridge.exposeInMainWorld('dronecleanTelemetry', bridge)
