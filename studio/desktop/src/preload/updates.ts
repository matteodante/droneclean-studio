/**
 * The updates preload of the editor window (21 Nov 2026): exposes `window.dronecleanUpdates`, the
 * page's way to the "check for new versions" switch and the notice (`shared/updates.ts`). A
 * separate preload registered on the session, like `preload/telemetry.ts`, because a sandboxed
 * preload cannot import a sibling file: the channel names are written out here and
 * `test/updates.test.mjs` holds them to `shared/updates.ts`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopUpdates, UpdateNotice } from '../shared/updates'

/** `shared/updates.ts`'s `UPDATE_CHANNELS`, written out for the sandbox. */
const CHANNELS = {
  enabled: 'updates:enabled',
  setEnabled: 'updates:set-enabled',
  notice: 'updates:notice',
  dismiss: 'updates:dismiss',
  open: 'updates:open',
  available: 'updates:available',
} as const

const bridge: DesktopUpdates = {
  version: 1,
  getEnabled(): Promise<boolean> {
    return ipcRenderer.invoke(CHANNELS.enabled)
  },
  setEnabled(on: boolean): Promise<boolean> {
    return ipcRenderer.invoke(CHANNELS.setEnabled, on)
  },
  getNotice(): Promise<UpdateNotice | null> {
    return ipcRenderer.invoke(CHANNELS.notice)
  },
  dismiss(): Promise<void> {
    return ipcRenderer.invoke(CHANNELS.dismiss)
  },
  open(): Promise<void> {
    return ipcRenderer.invoke(CHANNELS.open)
  },
  onAvailable(listener: (notice: UpdateNotice) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, notice: UpdateNotice) => listener(notice)
    ipcRenderer.on(CHANNELS.available, wrapped)
    return () => {
      ipcRenderer.removeListener(CHANNELS.available, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('dronecleanUpdates', bridge)
