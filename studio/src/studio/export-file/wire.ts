/**
 * The editor's copy of the export file wire (task 3.5): how the export dialog's muxer writes
 * straight into the file the user chose.
 *
 * The shell's copy is `studio/desktop/src/shared/export-file.ts`. The shell is a TypeScript project of
 * its own and the editor's `src/` must not import from `desktop/`, so each side keeps what it speaks and
 * `wire.test.ts` fails when they disagree. The names differ on purpose: each side exports only what it uses.
 * Free of browser APIs, so the export worker loads it.
 */

const SCHEME = 'droneclean-export'
const HOST = 'file'
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The scheme of every URL below; `wire.test.ts` checks it against the shell's. */
export const EXPORT_URL_SCHEME = SCHEME

function checkedId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid export id: ${JSON.stringify(id)}`)
  return id
}

/** `POST` here empties the file: an attempt starts (a retry never keeps the tail of the first). */
export function exportBeginUrl(id: string): string {
  return `${SCHEME}://${HOST}/${checkedId(id)}/begin`
}

/** `POST` here with the bytes as the body writes them at `position`; the answer comes once they are on disk. */
export function exportWriteUrl(id: string, position: number): string {
  if (!Number.isSafeInteger(position) || position < 0) throw new Error(`invalid write position: ${position}`)
  return `${SCHEME}://${HOST}/${checkedId(id)}/write?position=${position}`
}

/** An `invoke`'s answer: the value, or the sentence that says why not (kept verbatim for the dialog). */
type ShellAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

/** The preload's `exportFile` member of the desktop bridge (`desktop/src/shared/bridge.ts`). */
export interface ExportFileBridge {
  /** The save dialog: the id and path of the file now open, or `null` when the user closed it. */
  choose(request: {
    readonly suggestedName: string
    readonly extension: string
    /** The dialog's title in the interface language. */
    readonly title?: string
    /** A native 10-bit export: the path is granted to the desktop's encoder, which writes the file itself. */
    readonly native?: true
  }): Promise<ShellAnswer<{ readonly id: string; readonly path: string; readonly name: string } | null>>
  /** Moves the finished file to its name, with the sidecar subtitle file beside it when given. */
  commit(request: {
    readonly id: string
    readonly sidecar?: { readonly content: string }
  }): Promise<ShellAnswer<{ readonly path: string; readonly size: number }>>
  /** Removes what was written. */
  discard(request: { readonly id: string }): Promise<ShellAnswer<null>>
}
