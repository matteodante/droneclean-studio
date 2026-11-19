// A small static server for the network check: the built app, on an origin of
// its own, with the headers the editor needs.
//
// The app is a multi-page build served from `/`: `index.html` and
// `headless.html`, hashed assets, and the files Vite copies out of `public/`.
// Its routes use browser history (`/projects`, `/editor/<id>`, …), so a request
// for an extension-less path falls back to `index.html`. Cross-origin isolation
// (COOP/COEP) is what the editor needs for WebGPU and `SharedArrayBuffer`, the
// same headers `vite.config.ts` and `headless/server.mjs` send.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
}

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

const INDEX_FILE = 'index.html'
/** Browser favicon probes are not app requests: the headless server answers them the same way. */
const FAVICON_PROBE = '/favicon.ico'

/**
 * Map a request path onto the built app.
 *
 * - `/` and every extension-less path (`/projects`, `/editor/<id>`): `index.html`,
 *   because the router owns those routes.
 * - an existing file: itself.
 * - a path with an extension that is not there: not found, so a missing script
 *   fails as a missing script instead of returning the app's HTML.
 * - `..`, encoded separators, NUL and backslashes: refused.
 *
 * @returns {(
 *   | { kind: 'file', filePath: string }
 *   | { kind: 'index' }
 *   | { kind: 'not-found' }
 *   | { kind: 'bad-request' }
 * )}
 */
export function resolveRequestPath(distDir, requestUrl) {
  let pathname
  try {
    pathname = decodeURIComponent(requestUrl.split('?')[0].split('#')[0])
  } catch {
    return { kind: 'bad-request' }
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return { kind: 'bad-request' }

  const segments = pathname.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.some((segment) => segment === '..')) return { kind: 'bad-request' }
  if (segments.length === 0) return { kind: 'index' }

  const filePath = path.resolve(distDir, ...segments)
  const contained = filePath === distDir || filePath.startsWith(distDir + path.sep)
  if (!contained) return { kind: 'bad-request' }

  let isFile = false
  try {
    isFile = fs.statSync(filePath).isFile()
  } catch {
    isFile = false
  }
  if (isFile) return { kind: 'file', filePath }

  const lastSegment = segments[segments.length - 1]
  return lastSegment.includes('.') ? { kind: 'not-found' } : { kind: 'index' }
}

function sendEmpty(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(message),
  })
  response.end(message)
}

function sendFile(request, response, filePath) {
  const stats = fs.statSync(filePath)
  response.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': stats.size,
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
}

/**
 * Serve a built app on 127.0.0.1 at a random port (or `port` when given).
 *
 * @param {{ distDir: string, port?: number }} options
 * @returns {Promise<{ base: string, origin: string, close: () => Promise<void> }>}
 */
export async function createStaticServer({ distDir, port = 0 }) {
  const resolvedDist = path.resolve(distDir)
  if (!fs.existsSync(path.join(resolvedDist, INDEX_FILE))) {
    throw new Error(`${resolvedDist} has no ${INDEX_FILE}; build the app first.`)
  }

  const server = http.createServer((request, response) => {
    // Cross-origin isolation, as the Vite dev server and the headless server do.
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    // A check must see what the app asks for, not what an earlier load cached.
    response.setHeader('Cache-Control', 'no-store')

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendEmpty(response, 405, 'Method not allowed\n')
      return
    }

    const requestPath = (request.url ?? '/').split('?')[0]
    if (requestPath === FAVICON_PROBE) {
      response.writeHead(204)
      response.end()
      return
    }

    const target = resolveRequestPath(resolvedDist, request.url ?? '/')
    if (target.kind === 'bad-request') {
      sendEmpty(response, 400, 'Bad request\n')
      return
    }
    if (target.kind === 'not-found') {
      sendEmpty(response, 404, 'Not found\n')
      return
    }
    const filePath = target.kind === 'file' ? target.filePath : path.join(resolvedDist, INDEX_FILE)
    try {
      sendFile(request, response, filePath)
    } catch {
      sendEmpty(response, 404, 'Not found\n')
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const base = `http://127.0.0.1:${server.address().port}`

  return {
    base,
    origin: base,
    close: () =>
      new Promise((resolve) => {
        // Chrome and a registered service worker can hold connections open;
        // closing the server must not wait for them.
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
