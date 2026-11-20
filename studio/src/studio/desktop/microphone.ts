/**
 * The desktop app's microphone permission, as the page asks for it.
 *
 * On macOS the app has to ask the system for the microphone itself (`desktop/src/main/microphone.ts`):
 * left to `getUserMedia`, a never-asked or pending permission makes the recording wait for ever. The web
 * editor has no such bridge and lets the browser prompt as usual.
 */

/** `desktop/src/shared/microphone.ts`'s answers. */
export type DesktopMicrophoneAccess =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

interface MicrophoneBridge {
  request(): Promise<DesktopMicrophoneAccess>
}

/**
 * Asks the desktop shell for the microphone and says where it stands; null in the web editor, in a shell
 * that predates the bridge member, and when the shell does not answer (the recording then tries anyway,
 * under its own timeout).
 */
export async function askDesktopMicrophone(): Promise<DesktopMicrophoneAccess | null> {
  if (typeof window === 'undefined') return null
  const bridge = (
    window.dronecleanDesktop as { readonly microphone?: MicrophoneBridge } | undefined
  )?.microphone
  if (!bridge) return null
  try {
    return await bridge.request()
  } catch {
    return null
  }
}

/** Whether the system says the microphone cannot be used and only System Settings can change that. */
export function isMicrophoneBlockedBySystem(access: DesktopMicrophoneAccess | null): boolean {
  return access === 'denied' || access === 'restricted'
}
