/**
 * The desktop shell's copy of the export file wire (task 3.5): how the export dialog's
 * muxer writes straight into the file the user chose.
 *
 * The editor's copy is `studio/src/studio/export-file/wire.ts`; the shell is a TypeScript project
 * of its own and cannot import it, so `wire.test.ts` there holds the two together. Free of Node and
 * Electron imports so that test, the sandboxed preload and the page can all load it.
 *
 * **The flow.** `choose` shows the save dialog, grants the path and opens `<name>` as a temporary
 * file beside it (`output-file.ts`'s rule: nothing the user had is touched before the end). The
 * muxer's bytes are POSTed to `droneclean-export://file/<id>/write?position=<n>`, because the
 * muxer runs in a worker and a worker has no IPC; each POST is answered once the bytes are in the
 * file, which is the backpressure. `commit` renames the temporary file over the final name; `discard`
 * (a failure, a cancel, a closed window) removes it.
 */

/** The scheme the bytes are POSTed to; privileged like the native media schemes. */
export const EXPORT_FILE_SCHEME = 'droneclean-export'

/** The URL host of every request: `droneclean-export://file/…`. */
const EXPORT_FILE_HOST = 'file'

/** An export id in its URLs: 1–64 of `A–Z a–z 0–9 _ -`. */
export const EXPORT_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The most one write may carry; the muxer writes 4 MiB at a time. */
export const EXPORT_FILE_MAX_WRITE_BYTES = 64 * 1024 * 1024

/** The IPC channels: all `invoke`s, answered by an `ExportFileAnswer`. */
export const EXPORT_FILE_CHANNELS = {
  choose: 'export-file:choose',
  commit: 'export-file:commit',
  discard: 'export-file:discard',
} as const

/** What the save dialog is asked for: the name it suggests and the extension the file must have. */
export interface ExportFileChooseRequest {
  /** A file name, no folder; the dialog opens in the Downloads folder. */
  readonly suggestedName: string
  /** The extension without its dot (`mp4`). */
  readonly extension: string
  /**
   * A native 10-bit export: the path is granted to the desktop's encoder, which writes the file itself (through its
   * own hidden temporary file); nothing is opened here and no bytes are POSTed. `commit` then answers the file's size.
   */
  readonly native?: true
}

/** The file the user chose, and the id its writes and its end are addressed with. */
export interface ExportFileChosen {
  readonly id: string
  /** The final path, absolute. */
  readonly path: string
  /** Its base name, for the dialog's words. */
  readonly name: string
}

/** What ends an export: the sidecar subtitle file written beside the video, when there is one. */
export interface ExportFileCommitRequest {
  readonly id: string
  readonly sidecar?: { readonly content: string }
}

/** What a commit answers: the size of the finished file. */
export interface ExportFileCommitted {
  readonly path: string
  readonly size: number
}

/** An `invoke`'s answer: the value, or the sentence that says why not (kept verbatim for the dialog). */
export type ExportFileAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

/** A request URL read back: the export and the operation, or why the URL names none. */
export type ParsedExportFileUrl =
  | { readonly ok: true; readonly id: string; readonly operation: 'begin' }
  | { readonly ok: true; readonly id: string; readonly operation: 'write'; readonly position: number }
  | { readonly ok: false; readonly reason: string }

/** Reads a request URL back; anything but `/<id>/begin` and `/<id>/write?position=<n>` is a refusal. */
export function parseExportFileUrl(href: string): ParsedExportFileUrl {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { ok: false, reason: `not a URL: ${JSON.stringify(href)}` }
  }
  if (url.protocol !== `${EXPORT_FILE_SCHEME}:`) return { ok: false, reason: `wrong scheme: ${url.protocol}` }
  if (url.host !== EXPORT_FILE_HOST) return { ok: false, reason: `wrong route: ${url.host}` }
  const [id = '', operation = '', ...rest] = url.pathname.split('/').slice(1)
  if (rest.length > 0) return { ok: false, reason: 'an export URL is /<id>/<operation>' }
  if (!EXPORT_FILE_ID_PATTERN.test(id)) return { ok: false, reason: `invalid export id: ${JSON.stringify(id)}` }
  if (operation === 'begin') return { ok: true, id, operation }
  if (operation !== 'write') return { ok: false, reason: `unknown operation: ${JSON.stringify(operation)}` }
  const raw = url.searchParams.get('position') ?? ''
  if (!/^\d{1,16}$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    return { ok: false, reason: `invalid write position: ${JSON.stringify(raw)}` }
  }
  return { ok: true, id, operation, position: Number(raw) }
}
