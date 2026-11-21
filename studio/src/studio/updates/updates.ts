/**
 * The page's side of "a new version is available" (21 Nov 2026): the desktop shell checks GitHub
 * (`desktop/src/main/updates/`) and the page only shows what it found. The browser build has no
 * bridge and shows nothing: the web editor at /studio/ is always the latest.
 *
 * This is the one request the editor makes that the user did not ask for, by Matteo's decision of
 * 21 Nov 2026 (the desktop app is unsigned, so it cannot update itself): on by default, switched
 * off in Settings › Privacy, and off means no request at all.
 *
 * The shapes mirror `desktop/src/shared/updates.ts`, which the page cannot import.
 */
import { create } from 'zustand'

/** A newer version: the number and the release page that carries the download. */
export interface UpdateNotice {
  version: string
  url: string
}

/** What `window.dronecleanUpdates` offers the page. */
interface UpdatesBridge {
  readonly version: 1
  getEnabled(): Promise<boolean>
  setEnabled(on: boolean): Promise<boolean>
  getNotice(): Promise<UpdateNotice | null>
  dismiss(): Promise<void>
  open(): Promise<void>
  onAvailable(listener: (notice: UpdateNotice) => void): () => void
}

declare global {
  interface Window {
    /** Installed by the shell's `preload/updates.ts`; absent in the browser. */
    dronecleanUpdates?: UpdatesBridge
  }
}

function getUpdatesBridge(): UpdatesBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.dronecleanUpdates
  return bridge?.version === 1 ? bridge : undefined
}

/** Whether this build has the check at all: the desktop app does, the browser does not. */
export function hasUpdateCheck(): boolean {
  return getUpdatesBridge() !== undefined
}

/** Read a notice from the bridge: an object with a version and a link, or nothing. */
function parseNotice(value: unknown): UpdateNotice | null {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return typeof record.version === 'string' && typeof record.url === 'string'
    ? { version: record.version, url: record.url }
    : null
}

interface UpdatesState {
  /** Whether the shell's answer about the switch has been read. */
  loaded: boolean
  enabled: boolean
  notice: UpdateNotice | null
  /** Read the switch and the notice once; the notice also arrives later, when the shell's check finishes. */
  load(): Promise<void>
  setEnabled(on: boolean): Promise<void>
  /** "Later": hide the notice, and the shell keeps it hidden until tomorrow. */
  dismiss(): Promise<void>
  /** "Download": the shell opens the release page in the browser; the notice goes away. */
  open(): Promise<void>
  /** Called with a notice the shell pushed. */
  found(notice: unknown): void
}

export const useUpdates = create<UpdatesState>((set) => ({
  loaded: false,
  enabled: true,
  notice: null,
  async load() {
    const bridge = getUpdatesBridge()
    if (!bridge) return
    try {
      const [enabled, notice] = await Promise.all([bridge.getEnabled(), bridge.getNotice()])
      set({ loaded: true, enabled: enabled !== false, notice: enabled === false ? null : parseNotice(notice) })
    } catch {
      set({ loaded: true })
    }
  },
  async setEnabled(on) {
    const bridge = getUpdatesBridge()
    if (!bridge) return
    const stored = await bridge.setEnabled(on)
    set((state) => ({ enabled: stored, notice: stored ? state.notice : null }))
  },
  async dismiss() {
    set({ notice: null })
    await getUpdatesBridge()?.dismiss()
  },
  async open() {
    // The notice goes once the shell has opened the page: if it could not, Download stays there to press again
    await getUpdatesBridge()?.open()
    set({ notice: null })
  },
  found(notice) {
    set((state) => (state.enabled ? { notice: parseNotice(notice) } : {}))
  },
}))

/** Subscribe to the shell's push; answers how to stop. */
export function listenForUpdates(): () => void {
  const bridge = getUpdatesBridge()
  if (!bridge) return () => undefined
  return bridge.onAvailable((notice) => useUpdates.getState().found(notice))
}
