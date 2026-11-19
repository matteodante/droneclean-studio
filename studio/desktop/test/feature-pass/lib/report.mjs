/**
 * Pure helpers of the feature pass: request summaries, statuses and the Markdown table in the format of
 * `docs/feature-pass.md`. No Electron here, so `node --test` covers them.
 */

/** Statuses a feature can end in. `script-error` and `manual` say what the harness could not do, not what the app does. */
export const STATUS = {
  works: 'works',
  afterDownload: 'works after a download the user starts',
  broken: 'does not work in the desktop app',
  manual: 'manual step',
  scriptError: 'script error',
}

const OWN_SCHEMES = ['droneclean:', 'blob:', 'data:', 'devtools:', 'chrome-extension:']

export function hostOf(url) {
  try {
    const parsed = new URL(url)
    if (OWN_SCHEMES.includes(parsed.protocol)) return `${parsed.protocol}//${parsed.host || ''}`.replace(/\/\/$/, '')
    return parsed.host
  } catch {
    return 'unparseable'
  }
}

/** True for requests to the app's own origin or in-memory URLs. */
export function isOwn(url) {
  try {
    return OWN_SCHEMES.includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return 'size unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Groups the requests of one feature by host and phase.
 * `requests`: `{ url, method, bytes|null, status|null, phase: 'open'|'act', process: 'page'|'main' }`.
 * A request is flagged `beforeUserAction` when it is not to our own origin and was made in the `open` phase
 * (loading the page, opening a panel, before the click that starts the feature).
 */
export function summariseRequests(requests) {
  const external = requests.filter((request) => !isOwn(request.url))
  const byHost = new Map()
  for (const request of external) {
    const host = hostOf(request.url)
    const entry = byHost.get(host) ?? { host, requests: 0, bytes: 0, unknownSizes: 0, phases: new Set(), examples: [] }
    entry.requests += 1
    if (request.bytes === null || request.bytes === undefined) entry.unknownSizes += 1
    else entry.bytes += request.bytes
    entry.phases.add(request.phase)
    if (entry.examples.length < 3) entry.examples.push(request.url.length > 140 ? `${request.url.slice(0, 140)}…` : request.url)
    byHost.set(host, entry)
  }
  const hosts = [...byHost.values()].map((entry) => ({ ...entry, phases: [...entry.phases].sort() }))
  hosts.sort((a, b) => b.bytes - a.bytes)
  return {
    total: requests.length,
    external: external.length,
    externalBytes: hosts.reduce((sum, host) => sum + host.bytes, 0),
    hosts,
    beforeUserAction: external.filter((request) => request.phase === 'open').map((request) => request.url),
  }
}

/** The final status: a feature that worked but pulled a big external file after the click is "after a download". */
export function finalStatus(reported, summary, { expectsDownload = false, thresholdBytes = 1024 * 1024 } = {}) {
  if (reported !== STATUS.works || !expectsDownload) return reported
  const afterClick = summary.hosts.reduce((sum, host) => sum + (host.phases.includes('act') ? host.bytes : 0), 0)
  return afterClick >= thresholdBytes ? STATUS.afterDownload : reported
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** The "Requests: what, when, size" cell. */
function requestsCell(summary) {
  if (summary.external === 0) return 'none'
  const parts = summary.hosts.map((host) => {
    const when = host.phases.includes('open') ? (host.phases.includes('act') ? 'before and after the click' : 'BEFORE the user acts') : 'after the click'
    const size = host.unknownSizes === host.requests ? 'size unknown' : formatBytes(host.bytes)
    return `\`${host.host}\` ×${host.requests} (${size}, ${when})`
  })
  return parts.join('; ')
}

function storedCell(record) {
  const parts = []
  for (const entry of record.stored?.profile ?? []) parts.push(`profile \`${entry.path}\` ${entry.delta >= 0 ? '+' : ''}${formatBytes(Math.abs(entry.delta))}`)
  for (const entry of record.stored?.workspace ?? []) parts.push(`workspace \`${entry.path}\` (${formatBytes(entry.size)})`)
  return parts.length ? parts.slice(0, 6).join('; ') + (parts.length > 6 ? `; +${parts.length - 6} more` : '') : 'nothing new'
}

export function featureRow(record) {
  const status = record.manualStep ? `${record.status}: ${record.manualStep}` : record.notes ? `${record.status}. ${record.notes}` : record.status
  const flagged = record.requests.beforeUserAction.length
    ? ` **${record.requests.beforeUserAction.length} request(s) before the user acts**`
    : ''
  const shot = record.screenshot ? ` (screenshot \`${record.screenshot}\`)` : ''
  return `| ${cell(record.name)} | ${cell(record.where)} | ${cell(status + shot)} | ${cell(requestsCell(record.requests) + flagged)} | ${cell(storedCell(record))} |`
}

export function featureTable(records) {
  const header = '| Feature (on screen) | Where | Status in the desktop app | Requests: what, when, size | Stored in |\n|---|---|---|---|---|'
  return `${header}\n${records.map(featureRow).join('\n')}\n`
}
