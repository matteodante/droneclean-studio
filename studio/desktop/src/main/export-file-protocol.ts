/**
 * The export file's face to the page (task 3.5): the save dialog, the `droneclean-export:`
 * scheme the muxer's bytes are POSTed to, and the IPC that ends an export. The wire is described
 * in `shared/export-file.ts`; what happens to the file is `export-file.ts`.
 *
 * **Ending an export.** `commit` renames the finished temporary file over the final path,
 * `discard` removes it. If the page does neither (it navigated, crashed or its window was
 * closed) the window's events do (`window-jobs.ts`): an export has no idle timeout, because a
 * heavy render can go minutes between two 4 MiB chunks, so only the window going away ends it.
 *
 * The scheme must be registered as privileged before `ready`, in the app's one
 * `registerSchemesAsPrivileged` call (see `index.ts`).
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, protocol, type CustomScheme, type IpcMainInvokeEvent } from 'electron'
import {
  EXPORT_FILE_CHANNELS,
  EXPORT_FILE_ID_PATTERN,
  EXPORT_FILE_MAX_WRITE_BYTES,
  EXPORT_FILE_SCHEME,
  parseExportFileUrl,
  type ExportFileAnswer,
  type ExportFileChooseRequest,
  type ExportFileChosen,
  type ExportFileCommitRequest,
  type ExportFileCommitted,
} from '../shared/export-file'
import { ExportFiles, EXPORT_FILE_EXTENSIONS } from './export-file'
import { WindowJobs } from './media/window-jobs'
import { appOnly, isAppUrl } from './sender'

/** The scheme's privileges: the same as the native media schemes'. */
export const EXPORT_FILE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: EXPORT_FILE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

const files = new ExportFiles()

/** One export at a time per window; no idle timeout (see the header). */
const windowJobs = new WindowJobs({
  cancel: (id) => {
    void files.discard(id)
  },
  maxPerWindow: 1,
  idleMs: Number.POSITIVE_INFINITY,
  call: 'export',
  noun: 'exports',
})

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/** Registers the scheme's handler and the IPC; call after `app.whenReady()`. */
export function registerExportFileProtocol(): void {
  protocol.handle(EXPORT_FILE_SCHEME, (request) => answerWrite(request))
  ipcMain.handle(
    EXPORT_FILE_CHANNELS.choose,
    appOnly((event: IpcMainInvokeEvent, raw: unknown) => answer(() => choose(event, raw))),
  )
  ipcMain.handle(
    EXPORT_FILE_CHANNELS.commit,
    appOnly((_event: IpcMainInvokeEvent, raw: unknown) => answer(() => commit(raw))),
  )
  ipcMain.handle(
    EXPORT_FILE_CHANNELS.discard,
    appOnly((_event: IpcMainInvokeEvent, raw: unknown) => answer(() => discard(raw))),
  )
}

/** The reply of an `invoke`: the value, or the refusal's sentence kept whole. */
async function answer<T>(run: () => Promise<T>): Promise<ExportFileAnswer<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Shows the save dialog; null when the user closed it. The file is opened (as a temporary one) when a path was chosen. */
async function choose(event: IpcMainInvokeEvent, raw: unknown): Promise<ExportFileChosen | null> {
  const request = parseChooseRequest(raw)
  windowJobs.assertRoom(event.sender.id)
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = {
    title: 'Export',
    defaultPath: path.join(app.getPath('downloads'), request.suggestedName),
    filters: [{ name: request.extension.toUpperCase(), extensions: [request.extension] }],
  }
  const picked = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options)
  if (picked.canceled || picked.filePath === '') return null

  // The dialog's own overwrite question covered the name it returned; a name with another
  // extension would be a file the user was never asked about, so it is refused instead.
  if (path.extname(picked.filePath).slice(1).toLowerCase() !== request.extension) {
    throw new Error(`the file name must end in .${request.extension}`)
  }
  const id = `exp-${randomUUID().replaceAll('-', '')}`
  if (request.native === true) {
    // The native encoder writes this file: its grant (`outputGrants`, the one `encode.start` takes from) is for this path only.
    await files.openNative(id, picked.filePath)
  } else {
    files.grants.grant(picked.filePath)
    await files.open(id, picked.filePath)
  }
  windowJobs.admit(event.sender, id)
  console.log(`[desktop] export ${id}: writing to ${path.basename(picked.filePath)}`)
  return { id, path: picked.filePath, name: path.basename(picked.filePath) }
}

async function commit(raw: unknown): Promise<ExportFileCommitted> {
  const request = parseCommitRequest(raw)
  try {
    return await files.commit(request.id, request.sidecar)
  } finally {
    windowJobs.release(request.id)
  }
}

async function discard(raw: unknown): Promise<null> {
  const id = idOf(raw)
  windowJobs.release(id)
  await files.discard(id)
  return null
}

/** `POST …/begin` empties the file, `POST …/write?position=n` writes the body there. */
async function answerWrite(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin !== null && !isAppUrl(origin)) return text(403, 'not the app’s page', null)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...RESPONSE_HEADERS,
        ...(origin === null ? {} : { 'Access-Control-Allow-Origin': origin }),
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'content-type',
      },
    })
  }
  if (request.method !== 'POST') return text(400, `${request.method} is not an export request`, origin)
  const parsed = parseExportFileUrl(request.url)
  if (!parsed.ok) return text(400, parsed.reason, origin)
  try {
    if (parsed.operation === 'begin') {
      await files.begin(parsed.id)
    } else {
      const declared = Number(request.headers.get('content-length') ?? 0)
      if (declared > EXPORT_FILE_MAX_WRITE_BYTES) {
        return text(413, `a write may carry at most ${EXPORT_FILE_MAX_WRITE_BYTES} bytes`, origin)
      }
      const bytes = new Uint8Array(await request.arrayBuffer())
      await files.write(parsed.id, parsed.position, bytes)
    }
    return new Response(null, {
      status: 204,
      headers: { ...RESPONSE_HEADERS, ...(origin === null ? {} : { 'Access-Control-Allow-Origin': origin }) },
    })
  } catch (error) {
    return text(500, error instanceof Error ? error.message : String(error), origin)
  }
}

function text(status: number, message: string, origin: string | null): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      ...RESPONSE_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      ...(origin === null ? {} : { 'Access-Control-Allow-Origin': origin }),
    },
  })
}

function record(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${what}: the request must be an object`)
  return raw as Record<string, unknown>
}

function idOf(raw: unknown): string {
  const id = record(raw, 'export').id
  if (typeof id !== 'string' || !EXPORT_FILE_ID_PATTERN.test(id)) throw new Error('export: invalid id')
  return id
}

function parseChooseRequest(raw: unknown): ExportFileChooseRequest {
  const request = record(raw, 'export.choose')
  const { suggestedName, extension } = request
  if (typeof extension !== 'string' || !EXPORT_FILE_EXTENSIONS.includes(extension)) {
    throw new Error(`export.choose: the extension must be one of ${EXPORT_FILE_EXTENSIONS.join(', ')}`)
  }
  if (
    typeof suggestedName !== 'string' ||
    suggestedName === '' ||
    suggestedName.length > 200 ||
    suggestedName !== path.basename(suggestedName) ||
    /[\\/]/.test(suggestedName)
  ) {
    throw new Error('export.choose: the suggested name must be a file name without a folder')
  }
  const native = request.native
  if (native !== undefined && native !== true) throw new Error('export.choose: native must be true when given')
  return native === true ? { suggestedName, extension, native } : { suggestedName, extension }
}

function parseCommitRequest(raw: unknown): ExportFileCommitRequest {
  const request = record(raw, 'export.commit')
  const id = idOf(request)
  const sidecar = request.sidecar
  if (sidecar === undefined) return { id }
  const content = record(sidecar, 'export.commit').content
  if (typeof content !== 'string') throw new Error('export.commit: the sidecar needs text content')
  return { id, sidecar: { content } }
}
