/**
 * Access to the desktop shell's preload API.
 *
 * The Electron app (built in `studio/desktop/`) exposes `window.dronecleanDesktop`
 * from its preload script. The editor runs unchanged in both shells: this is the
 * only place where it asks whether a real file path is available.
 */

export interface DesktopBridge {
  readonly version: 1
  readonly platform: 'darwin' | 'win32' | 'linux'
  /** Absolute path of a File that comes from the local disk, '' otherwise. */
  getPathForFile(file: File): string
}

declare global {
  interface Window {
    dronecleanDesktop?: DesktopBridge
  }
}

/** The desktop bridge when the editor runs inside the desktop shell, otherwise undefined. */
export function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.dronecleanDesktop
  return bridge?.version === 1 ? bridge : undefined
}
