/**
 * The permission policy of the editor window, as a pure decision.
 *
 * Electron grants every permission while no handler is installed, so the shell
 * installs both handlers and this module decides. Only what FreeCut actually uses
 * is allowed; everything else is denied by default, so a new API used by a future
 * upstream merge fails here and is added on purpose.
 *
 * What the editor uses today (grepped in `studio/src`):
 * - the file system: the workspace folder, media files, the project bundle;
 * - the microphone: `MicRecorder`/`startMicLevelMonitor` in `infrastructure/audio/mic-recorder`;
 * - the clipboard: copy JSON, copy transcript, paste JSON (`navigator.clipboard`);
 * - fullscreen: the preview player and the export preview;
 * - persistent storage: `navigator.storage.persist()` before OPFS proxies are written.
 */

/** The parts of Electron's `FilesystemPermissionRequest` and `MediaAccessPermissionRequest` the policy reads. */
export interface PermissionRequestDetails {
  readonly filePath?: string
  readonly isDirectory?: boolean
  readonly fileAccessType?: 'readable' | 'writable'
  readonly mediaTypes?: readonly string[]
}

/** The parts of Electron's `PermissionCheckHandlerHandlerDetails` the policy reads. */
export interface PermissionCheckDetails {
  readonly filePath?: string
  readonly isDirectory?: boolean
  readonly fileAccessType?: 'readable' | 'writable'
  readonly mediaType?: 'video' | 'audio' | 'unknown'
}

/**
 * The file system is granted for what the page already holds, and for a file
 * only to read.
 *
 * Electron resets a page's file-system grants shortly after its last document
 * closes (see `session.setPermissionRequestHandler` in Electron's docs), so a
 * workspace folder and the media handles persisted in IndexedDB would come back
 * as `prompt` on every launch, and `requestPermission()` needs a click FreeCut
 * does not offer on start-up. A page can only hold handles the user gave it in a
 * native picker or with a drop, so granting them again is granting the user's
 * own choice.
 *
 * Write access is another matter (review finding D3): a footage file the page
 * holds must stay unwritable, because nothing in the editor edits a source
 * file. Only a directory — the workspace the user picked — is writable; what the
 * editor saves goes inside it. A file the user saves through a save dialog is
 * writable by Chromium's own rule for the handle that dialog made, without this
 * policy.
 */
function isFileSystem(
  details:
    | {
        readonly filePath?: string
        readonly isDirectory?: boolean
        readonly fileAccessType?: 'readable' | 'writable'
      }
    | undefined,
): boolean {
  if (typeof details?.filePath !== 'string' || details.filePath.length === 0) return false
  if (details.isDirectory === true) return true
  return details.fileAccessType === 'readable'
}

/**
 * The microphone is allowed; the camera is not (the editor has no camera use).
 *
 * A request lists what `getUserMedia` asked for, so a request that also wants
 * `video` is refused rather than narrowed.
 */
function isMicrophoneOnlyRequest(details: PermissionRequestDetails): boolean {
  const mediaTypes = details.mediaTypes
  if (!mediaTypes || mediaTypes.length === 0) return false
  return mediaTypes.every((mediaType) => mediaType === 'audio')
}

/** The check handler reports one media type; only audio capture is intended. */
function isMicrophoneCheck(details: PermissionCheckDetails): boolean {
  return details.mediaType === 'audio'
}

/** Permissions allowed on a request (`callback(true)`). */
export function decidePermissionRequest(
  permission: string,
  details: PermissionRequestDetails = {},
): boolean {
  switch (permission) {
    case 'fileSystem':
      return isFileSystem(details)
    case 'media':
      return isMicrophoneOnlyRequest(details)
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
    case 'fullscreen':
    case 'persistent-storage':
      return true
    default:
      return false
  }
}

/** Permissions allowed on a check (the answer `queryPermission` and friends receive). */
export function decidePermissionCheck(
  permission: string,
  details: PermissionCheckDetails = {},
): boolean {
  switch (permission) {
    case 'fileSystem':
      return isFileSystem(details)
    case 'media':
      return isMicrophoneCheck(details)
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
    case 'fullscreen':
    case 'persistent-storage':
      return true
    default:
      return false
  }
}
