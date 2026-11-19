// Which request URLs the network check allows.
//
// The rule (AGENTS.md): the editor makes no network request the user did not
// ask for. Opening the app and a project must therefore talk to the server that
// served the app and to nothing else. `data:` and `blob:` URLs are byte
// sequences made in the page, not network requests, so they are allowed; a
// WebSocket to the app's own server is the app's own origin.

const INLINE_SCHEMES = new Set(['data:', 'blob:'])

/**
 * Decide whether one request URL stays on the served origin.
 *
 * @param {string} rawUrl the URL a request reported
 * @param {string} servedOrigin the origin the app was served from, e.g. `http://127.0.0.1:5123`
 * @returns {{ url: string, origin: string | null, allowed: boolean, reason: string }}
 *   `origin` is what the log groups a URL by: the HTTP origin, the inline scheme,
 *   or whatever origin a foreign scheme carries (null when the URL cannot be parsed).
 */
export function classifyRequestUrl(rawUrl, servedOrigin) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { url: rawUrl, origin: null, allowed: false, reason: 'unparseable URL' }
  }

  if (INLINE_SCHEMES.has(url.protocol)) {
    return { url: rawUrl, origin: url.protocol, allowed: true, reason: 'made in the page' }
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const allowed = url.origin === servedOrigin
    return {
      url: rawUrl,
      origin: url.origin,
      allowed,
      reason: allowed ? 'served origin' : 'another origin',
    }
  }

  // A WebSocket to the app's own server is the same origin (the scheme differs
  // because the handshake upgrades an HTTP connection).
  const served = new URL(servedOrigin)
  const servedSocketProtocol = served.protocol === 'https:' ? 'wss:' : 'ws:'
  if (url.protocol === servedSocketProtocol && url.host === served.host) {
    return {
      url: rawUrl,
      origin: `${url.protocol}//${url.host}`,
      allowed: true,
      reason: 'served origin, websocket',
    }
  }

  return {
    url: rawUrl,
    origin: url.origin === 'null' ? url.protocol : url.origin,
    allowed: false,
    reason: 'another scheme',
  }
}
