/**
 * Asks macOS for the microphone when the page is about to record (see `shared/microphone.ts`).
 *
 * macOS shows its prompt once, the first time an app asks, and only for the string
 * `NSMicrophoneUsageDescription` in the app's Info.plist (`electron-builder.yml`). After a "Don't allow"
 * the answer is `denied` for good: only System Settings › Privacy & Security › Microphone changes it, so
 * the page is told, and shows that path.
 */
import { ipcMain } from 'electron'
import { MICROPHONE_CHANNELS, type MicrophoneAccess } from '../shared/microphone'
import { appOnly } from './sender'

/** The part of Electron's `systemPreferences` this module uses. */
export interface MediaAccessSource {
  getMediaAccessStatus(mediaType: 'microphone'): string
  askForMediaAccess(mediaType: 'microphone'): Promise<boolean>
}

function narrowed(status: string): MicrophoneAccess {
  switch (status) {
    case 'granted':
    case 'denied':
    case 'restricted':
    case 'not-determined':
      return status
    default:
      return 'unknown'
  }
}

/**
 * The microphone's state after asking when it is still undecided. Off macOS there is no system switch
 * (`getMediaAccessStatus` is macOS and Windows only, and Windows answers `granted`/`denied` itself),
 * and Linux has none: those are `granted`.
 */
export async function requestMicrophoneAccess(
  source: MediaAccessSource,
  platform: NodeJS.Platform = process.platform,
): Promise<MicrophoneAccess> {
  if (platform !== 'darwin') return 'granted'
  let status = narrowed(source.getMediaAccessStatus('microphone'))
  if (status === 'not-determined') {
    try {
      status = (await source.askForMediaAccess('microphone')) ? 'granted' : 'denied'
    } catch {
      status = narrowed(source.getMediaAccessStatus('microphone'))
    }
  }
  return status
}

/** Registers the channel; answers only the app's own frame. Called once per launch. */
export function installMicrophoneIpc(source: MediaAccessSource): void {
  ipcMain.handle(
    MICROPHONE_CHANNELS.request,
    appOnly(() => requestMicrophoneAccess(source)),
  )
}
