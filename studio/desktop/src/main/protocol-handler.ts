/**
 * Serves the built editor from the `droneclean://app` scheme, and the media an
 * agent named by path from `/__media/{id}` on that same scheme (task 2.2
 * slice 5).
 *
 * `mapRequestUrl` decides what a request means and `resolveInsideDist` turns that
 * into a file of `dist/`; `parseMediaRoute` claims the media route first, so an
 * id is looked up in `main/media.ts`'s allow-list instead of in `dist/`. This
 * module adds the isolation headers, the streams and the HTTP answers.
 */
import { ipcMain, protocol } from 'electron'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { resolveInsideDist } from './dist-files'
import {
  MEDIA_PATH_ALLOW_CHANNEL,
  MEDIA_PATH_DESCRIBE_CHANNEL,
  MediaPathAccess,
  serveMediaRequest,
} from './media'
import { APP_SCHEME, ISOLATION_HEADERS, mapRequestUrl, parseMediaRoute } from './protocol'
import { appOnly } from './sender'

function responseHeaders(contentType: string, contentLength?: number): Record<string, string> {
  const headers: Record<string, string> = { ...ISOLATION_HEADERS, 'Content-Type': contentType }
  if (contentLength !== undefined) headers['Content-Length'] = String(contentLength)
  return headers
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: responseHeaders('text/plain; charset=utf-8'),
  })
}

async function serve(distDir: string, media: MediaPathAccess, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: responseHeaders('text/plain; charset=utf-8'),
    })
  }

  // The media route is claimed before the built editor's mapping: its ids have
  // no extension, so `mapRequestUrl` would answer the SPA entry for them.
  const mediaRoute = parseMediaRoute(request.url)
  if (mediaRoute !== null) return serveMediaRequest(media, mediaRoute, request)

  const mapping = mapRequestUrl(request.url)
  if (mapping.kind === 'rejected') return notFound()

  const filePath = await resolveInsideDist(distDir, mapping.relativePath)
  if (filePath === null) return notFound()

  let size: number
  try {
    size = (await fs.promises.stat(filePath)).size
  } catch {
    return notFound()
  }

  const headers = responseHeaders(mapping.contentType, size)
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })

  const body = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>
  return new Response(body, { status: 200, headers })
}

/**
 * Register the scheme's handler and the media path channel. Call after
 * `app.whenReady()`. Returns the one allow-list the protocol handler reads, for
 * a caller that wants to inspect it (the tests do).
 */
export function registerAppProtocol(distDir: string): MediaPathAccess {
  const media = new MediaPathAccess()
  ipcMain.handle(
    MEDIA_PATH_DESCRIBE_CHANNEL,
    appOnly((_event, paths: unknown) => media.describe(paths)),
  )
  ipcMain.handle(
    MEDIA_PATH_ALLOW_CHANNEL,
    appOnly((_event, folders: unknown) => media.allow(folders)),
  )

  if (!fs.existsSync(distDir)) {
    console.error(`[desktop] the built editor is missing at ${distDir}; run "npm run build" in studio/desktop`)
  }
  protocol.handle(APP_SCHEME, (request) =>
    serve(distDir, media, request).catch((error: unknown) => {
      console.error('[desktop] serving', request.url, 'failed:', error)
      return new Response('Internal error', {
        status: 500,
        headers: responseHeaders('text/plain; charset=utf-8'),
      })
    }),
  )
  return media
}
