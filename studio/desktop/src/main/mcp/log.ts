/**
 * The agent log: one JSON line per MCP tool call (task 2.2, design §4.3).
 *
 * It is `userData/agent-log/<YYYY-MM-DD>.jsonl`, appended, one call per line. A line carries
 * a hash of the arguments — never the arguments themselves, so a `run` script's
 * text is not written to disk — with the call's summary, duration, result code
 * and the undo entries it added. Appends are serialised through one promise
 * chain so two calls that finish together cannot interleave halves of a line.
 *
 * `readAgentLogTail` is the read side of the Agent access panel: the newest 50
 * lines across the day files, read from the end of each file without loading
 * it whole, parsed and checked; a missing folder is an empty log.
 * `pruneAgentLog` deletes the day files older than 30 days (at startup).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentLogLine, AgentResultCode, AgentToolName } from '../../../../mcp/protocol'
import { LOG_RETENTION_DAYS, LOG_SUMMARY_MAX_CHARS } from './protocol'

/** The writer the server holds. */
export interface AgentLog {
  /** Append one line; resolves when the line is on disk. */
  append(line: AgentLogLine): Promise<void>
}

/** How many lines the Agent access panel shows. */
export const PANEL_LOG_LINES = 50

/** The tools a line may name, for recognising a line this build understands. */
const AGENT_TOOL_NAMES: readonly AgentToolName[] = ['search', 'run', 'frame', 'export']

/**
 * Whether a parsed JSON value is an `AgentLogLine`. The log is written by this
 * module, but a half-written append or a hand-edited file must not break the
 * panel, so the fields it renders are checked before a line is shown.
 */
function isAgentLogLine(value: unknown): value is AgentLogLine {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Record<string, unknown>
  return (
    typeof line.at === 'string' &&
    typeof line.tool === 'string' &&
    AGENT_TOOL_NAMES.includes(line.tool as AgentToolName) &&
    typeof line.argsHash === 'string' &&
    typeof line.summary === 'string' &&
    typeof line.durationMs === 'number' &&
    typeof line.code === 'string' &&
    (line.undoSteps === undefined || typeof line.undoSteps === 'number') &&
    (line.error === undefined || typeof line.error === 'string')
  )
}

/** A day file's name, `YYYY-MM-DD.jsonl`, with a real calendar date in it. */
const DAY_FILE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/

/** The UTC midnight a day file is named for, or `null` for any other name. */
function dayOfFile(name: string): number | null {
  const match = DAY_FILE.exec(name)
  if (match === null) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real ? time : null
}

/** The day files of the folder, newest first; a missing folder has none. */
async function dayFilesNewestFirst(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await fs.promises.readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names.filter((name) => dayOfFile(name) !== null).sort().reverse()
}

/**
 * Delete the day files older than `LOG_RETENTION_DAYS` days before `now`, and
 * answer their names. Other files in the folder are not ours and stay.
 */
export async function pruneAgentLog(dir: string, now: Date = new Date()): Promise<string[]> {
  const cutoff = now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const removed: string[] = []
  for (const name of await dayFilesNewestFirst(dir)) {
    const day = dayOfFile(name)
    if (day === null || day + 24 * 60 * 60 * 1000 > cutoff) continue
    await fs.promises.rm(path.join(dir, name), { force: true })
    removed.push(name)
  }
  return removed
}

/** How much of a file's end one read takes. */
const TAIL_CHUNK_BYTES = 64 * 1024

/**
 * Up to `limit` non-empty lines from the end of a file, oldest first, read
 * backwards in chunks so a large file is never loaded whole.
 */
async function lastLinesOf(filePath: string, limit: number): Promise<string[]> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    let position = size
    // The bytes after `position` that do not yet start at a line start.
    let head = Buffer.alloc(0)
    let lines: string[] = []
    while (position > 0 && lines.length < limit) {
      const length = Math.min(TAIL_CHUNK_BYTES, position)
      position -= length
      const chunk = Buffer.alloc(length)
      await handle.read(chunk, 0, length, position)
      const text = Buffer.concat([chunk, head])
      if (position === 0) {
        lines = [...splitLines(text), ...lines]
        break
      }
      const newline = text.indexOf(0x0a)
      if (newline === -1) {
        head = text
        continue
      }
      head = text.subarray(0, newline)
      lines = [...splitLines(text.subarray(newline + 1)), ...lines]
    }
    return lines.slice(-limit)
  } finally {
    await handle.close()
  }
}

/** The non-empty lines of a buffer of complete lines. */
function splitLines(buffer: Buffer): string[] {
  return buffer
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/**
 * The newest `limit` lines of the log folder `dir`, oldest first, taken from
 * the newest day file backwards and topped up from older days. A missing folder
 * is an empty log; a line that is not an `AgentLogLine` is skipped, so a
 * partial write costs one row, not the panel. A read error other than "no
 * folder" is thrown, because an unreadable profile is not an empty log.
 */
export async function readAgentLogTail(
  dir: string,
  limit: number = PANEL_LOG_LINES,
): Promise<AgentLogLine[]> {
  let found: AgentLogLine[] = []
  for (const name of await dayFilesNewestFirst(dir)) {
    if (found.length >= limit) break
    const parsed: AgentLogLine[] = []
    for (const line of await lastLinesOf(path.join(dir, name), limit)) {
      try {
        const value: unknown = JSON.parse(line)
        if (isAgentLogLine(value)) parsed.push(value)
      } catch {
        // A partial or hand-edited line is not an entry; the rest still show.
      }
    }
    found = [...parsed, ...found]
  }
  return found.slice(-limit)
}

/**
 * Canonical JSON: object keys sorted, `undefined` members and array holes
 * dropped, exactly what `JSON.stringify` would keep. Two calls with the same
 * arguments hash the same whatever order the client wrote the keys in.
 */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** SHA-256 (hex) of the arguments' canonical JSON. */
export function hashArguments(arguments_: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(arguments_)).digest('hex')
}

/** A summary cut at the log's limit, with an ellipsis when it was cut. */
export function summarize(text: string): string {
  if (text.length <= LOG_SUMMARY_MAX_CHARS) return text
  return `${text.slice(0, LOG_SUMMARY_MAX_CHARS - 1)}…`
}

/** One line about a call, chosen per tool so no script text can slip in. */
export function summarizeCall(tool: AgentToolName, arguments_: unknown): string {
  const record =
    typeof arguments_ === 'object' && arguments_ !== null
      ? (arguments_ as Record<string, unknown>)
      : {}
  switch (tool) {
    case 'run': {
      const label = typeof record.label === 'string' && record.label ? record.label : 'script'
      const script = typeof record.script === 'string' ? record.script : ''
      return summarize(`run "${label}" (${Buffer.byteLength(script, 'utf8')} byte script)`)
    }
    case 'search': {
      const query = typeof record.query === 'string' ? record.query : ''
      return summarize(`search ${JSON.stringify(query)}`)
    }
    case 'frame': {
      const frame = typeof record.frame === 'number' ? `frame ${record.frame}` : 'contact sheet'
      return summarize(`frame ${frame}`)
    }
    case 'export': {
      if (typeof record.jobId === 'string') {
        return summarize(`export ${record.cancel === true ? 'cancel ' : 'status '}${record.jobId}`)
      }
      return summarize('export start')
    }
  }
  return summarize(tool)
}

/** Build one line, in the shape `AgentLogLine` declares. */
export function agentLogLine(
  tool: AgentToolName,
  arguments_: unknown,
  options: {
    at?: Date
    durationMs: number
    code: AgentResultCode
    undoSteps?: number
    error?: string
  },
): AgentLogLine {
  return {
    at: (options.at ?? new Date()).toISOString(),
    tool,
    argsHash: hashArguments(arguments_),
    summary: summarizeCall(tool, arguments_),
    durationMs: options.durationMs,
    code: options.code,
    ...(options.undoSteps !== undefined && { undoSteps: options.undoSteps }),
    ...(options.error !== undefined && { error: summarize(options.error) }),
  }
}

/**
 * Open the log folder `dir`: each line goes to the file of its own day. The
 * folder is created on the first append; a log that cannot be written never
 * fails the tool call it describes, it only reports through `onError`.
 */
export function createAgentLog(
  dir: string,
  onError: (error: unknown) => void = () => {},
): AgentLog {
  let tail: Promise<void> = Promise.resolve()
  return {
    append(line) {
      const write = tail.then(async () => {
        try {
          await fs.promises.mkdir(dir, { recursive: true })
          await fs.promises.appendFile(
            path.join(dir, `${line.at.slice(0, 10)}.jsonl`),
            `${JSON.stringify(line)}\n`,
            { mode: 0o600 },
          )
        } catch (error) {
          onError(error)
        }
      })
      tail = write
      return write
    },
  }
}
