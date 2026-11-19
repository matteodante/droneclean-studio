/**
 * Who may call the shell's IPC (review findings R7 and D9).
 *
 * Every handler answers only the app's own page: `droneclean://app/…`, or the dev
 * server's origin in a development run. The window never shows another origin
 * (`will-navigate` refuses it), but a frame the page embeds, or a page that
 * outlives a navigation, would still reach `ipcRenderer` through a preload that
 * is registered for the session; the handler is the last place that can say no.
 *
 * Structural on purpose, so the checks run under plain Node: Electron's
 * `IpcMainInvokeEvent` and `IpcMainEvent` both carry `senderFrame` with a `url`.
 */
import { APP_HOST, APP_SCHEME } from './protocol'

/** The parts of an IPC event the check reads; `senderFrame` is null once its frame is gone. */
export interface SenderEvent {
  readonly senderFrame?: { readonly url: string } | null
}

let devUrl: string | null = null

/** In a development run the dev server's origin is the app's origin. Call once, at start-up. */
export function trustDevUrl(url: string | null): void {
  devUrl = url
}

/** Whether `rawUrl` is a page of the app: its own scheme and host, or the dev server's origin. */
export function isAppUrl(rawUrl: unknown, dev: string | null = devUrl): boolean {
  if (typeof rawUrl !== 'string') return false
  try {
    const url = new URL(rawUrl)
    if (dev !== null) return url.origin === new URL(dev).origin
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
  } catch {
    return false
  }
}

/** Whether the event comes from a frame of the app's own page. */
export function isAppSender(event: SenderEvent): boolean {
  return isAppUrl(event.senderFrame?.url ?? null)
}

/** The refusal a page can read. */
export class ForeignSenderError extends Error {
  constructor(channelNote = 'this call') {
    super(`refused: ${channelNote} only answers the app's own frame`)
    this.name = 'ForeignSenderError'
  }
}

/** An `ipcMain.handle` handler that answers the app's own frame and rejects anything else. */
export function appOnly<E extends SenderEvent, A extends unknown[], R>(
  handler: (event: E, ...args: A) => R,
): (event: E, ...args: A) => R {
  return (event, ...args) => {
    if (!isAppSender(event)) throw new ForeignSenderError()
    return handler(event, ...args)
  }
}

/** An `ipcMain.on` listener (a send has no reply) that ignores anything but the app's own frame. */
export function appOnlySend<E extends SenderEvent, A extends unknown[]>(
  listener: (event: E, ...args: A) => void,
): (event: E, ...args: A) => void {
  return (event, ...args) => {
    if (isAppSender(event)) listener(event, ...args)
  }
}
