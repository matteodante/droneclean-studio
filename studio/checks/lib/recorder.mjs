// Records every network request a browser context makes, and says which ones
// left the app's own origin.
//
// Playwright reports page requests, requests made by dedicated workers and
// requests made by the service worker through `context.on('request')`
// (`request.serviceWorker()` names the service worker; a dedicated worker's
// requests carry the page that started it). WebSocket handshakes are not
// requests in Playwright and come through the `websocket` events instead, so
// both are recorded into the same list.

import { classifyRequestUrl } from './origins.mjs'

const QUIET_POLL_MS = 100

function initiatorOf(request) {
  try {
    const worker = request.serviceWorker()
    if (worker) return { kind: 'service-worker', url: worker.url() }
  } catch {
    // `serviceWorker()` is only meaningful for requests a service worker made.
  }
  try {
    const frame = request.frame()
    if (frame) return { kind: 'page', url: frame.url() }
  } catch {
    // A navigation request can arrive before its frame exists.
  }
  return { kind: 'unknown', url: null }
}

function responseStatusOf(request) {
  try {
    // `response()` is a promise in the async API; the status is already known
    // by the time the request finished.
    return request.existingResponse()?.status() ?? null
  } catch {
    return null
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Attach a recorder to a browser context.
 *
 * @param {object} options
 * @param {import('playwright').BrowserContext} options.context
 * @param {string} options.servedOrigin
 * @param {string} [options.step]
 */
export function createNetworkRecorder({ context, servedOrigin, step = 'start' }) {
  /** @type {Array<{ entry: object, request: object | null }>} */
  const records = []
  /** @type {Map<object, { entry: object }>} */
  const byRequest = new Map()
  const workers = []
  let currentStep = step
  let lastActivityAt = Date.now()
  const recordedSockets = new WeakSet()

  const noteActivity = () => {
    lastActivityAt = Date.now()
  }

  const recordWebSocket = (socket, initiator) => {
    if (recordedSockets.has(socket)) return
    recordedSockets.add(socket)
    const classified = classifyRequestUrl(socket.url(), servedOrigin)
    records.push({
      request: null,
      entry: {
        step: currentStep,
        url: classified.url,
        method: 'WS',
        resourceType: 'websocket',
        origin: classified.origin,
        allowed: classified.allowed,
        initiator,
        status: null,
        failure: null,
      },
    })
    noteActivity()
  }

  context.on('page', (page) => {
    page.on('worker', (worker) => workers.push({ kind: 'dedicated', url: worker.url() }))
    page.on('websocket', (socket) => recordWebSocket(socket, { kind: 'page', url: page.url() }))
  })
  context.on('serviceworker', (worker) =>
    workers.push({ kind: 'service-worker', url: worker.url() }),
  )
  // A websocket no page owns (started by a worker or the service worker).
  context.on('websocket', (socket) => recordWebSocket(socket, { kind: 'unknown', url: null }))
  context.on('request', (request) => {
    const classified = classifyRequestUrl(request.url(), servedOrigin)
    const record = {
      entry: {
        step: currentStep,
        url: classified.url,
        method: request.method(),
        resourceType: request.resourceType(),
        origin: classified.origin,
        allowed: classified.allowed,
        initiator: initiatorOf(request),
        status: null,
        failure: null,
      },
    }
    records.push({ request, entry: record.entry })
    byRequest.set(request, record)
    noteActivity()
  })
  context.on('requestfinished', (request) => {
    const record = byRequest.get(request)
    if (record) record.entry.status = responseStatusOf(request)
    noteActivity()
  })
  context.on('requestfailed', (request) => {
    const record = byRequest.get(request)
    if (record) record.entry.failure = request.failure()?.errorText ?? 'failed'
    noteActivity()
  })

  const entries = () =>
    records.map(({ entry, request }) => ({
      ...entry,
      status: entry.status ?? (request ? responseStatusOf(request) : null),
    }))

  return {
    /** Name the step (landing, projects, editor) the requests that follow belong to. */
    setStep(nextStep) {
      currentStep = nextStep
    },
    /** Every request so far, in the order they started. JSON-serializable. */
    entries,
    /** The worker and service-worker scripts the browser started. */
    workers() {
      return [...workers]
    },
    /** Requests that left the served origin: the check's verdict. */
    offending() {
      return entries().filter((entry) => !entry.allowed)
    },
    /**
     * Wait until no request has started or finished for `quietMs`, so a step is
     * measured after the app stopped fetching. Gives up after `timeoutMs` and
     * says so: a slow third-party host must not hide its own request.
     */
    async waitForQuiet({ quietMs = 3000, timeoutMs = 30000 } = {}) {
      const startedAt = Date.now()
      const deadline = startedAt + timeoutMs
      while (Date.now() < deadline) {
        const idleMs = Date.now() - lastActivityAt
        if (idleMs >= quietMs) {
          return { quiet: true, idleMs, waitedMs: Date.now() - startedAt }
        }
        await sleep(Math.min(QUIET_POLL_MS, Math.max(1, quietMs - idleMs)))
      }
      return { quiet: false, idleMs: Date.now() - lastActivityAt, waitedMs: Date.now() - startedAt }
    },
  }
}

/** Group offending entries by origin, then by URL, keeping the steps each URL was seen in. */
export function summarizeOffenders(entries) {
  const byOrigin = new Map()
  for (const entry of entries) {
    if (entry.allowed) continue
    const originKey = entry.origin ?? '(unparseable)'
    let group = byOrigin.get(originKey)
    if (!group) {
      group = { origin: originKey, count: 0, urls: new Map() }
      byOrigin.set(originKey, group)
    }
    group.count += 1
    let url = group.urls.get(entry.url)
    if (!url) {
      url = { url: entry.url, count: 0, steps: [] }
      group.urls.set(entry.url, url)
    }
    url.count += 1
    if (!url.steps.includes(entry.step)) url.steps.push(entry.step)
  }
  return [...byOrigin.values()]
    .map((group) => ({
      origin: group.origin,
      count: group.count,
      urls: [...group.urls.values()].sort((a, b) => a.url.localeCompare(b.url)),
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin))
}
