/**
 * Runtime constants of the MCP contract (task 2.2).
 *
 * The shapes and their documentation are in `studio/mcp/protocol.d.ts`, which
 * this file imports with `import type` (a declaration file outside the
 * desktop's `rootDir` is not emitted, a source file would be refused). Each
 * constant is typed by the contract's literal type, so changing the contract
 * fails `npm run check` here instead of drifting silently. The launcher keeps
 * its own copy because it must run as a dependency-free Node script; the
 * contract test (`studio/desktop/test/agent-contract.test.mjs`) compares both
 * with `studio/mcp/fixture.mjs`.
 */
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type {
  DefaultFrameWidth,
  DefaultRunTimeoutMs,
  DefaultSearchLimit,
  LauncherPollMs,
  LauncherWaitMs,
  LogDirName,
  LogRetentionDays,
  LogSummaryMaxChars,
  MaxExportWaitMs,
  MaxFrameCount,
  MaxResultBytes,
  MaxRunLabelChars,
  MaxRunTimeoutMs,
  MaxScriptBytes,
  MaxSearchLimit,
  ProtocolVersion,
  RunTimeoutGraceMs,
  ServerName,
  ServerVersion,
  SettingsFileName,
  SocketFileName,
  WindowsPipeNamePrefix,
} from '../../../../mcp/protocol'

/** Format version of the MCP contract. */
export const PROTOCOL_VERSION: ProtocolVersion = 1

/** Name in the MCP `initialize` result's `serverInfo`. */
export const SERVER_NAME: ServerName = 'droneclean'

/** Version in the MCP `initialize` result's `serverInfo`. */
export const SERVER_VERSION: ServerVersion = '1'

/** The setting, in Electron's `userData` folder. */
export const SETTINGS_FILE_NAME: SettingsFileName = 'agent-access.json'

/** The agent log's folder in Electron's `userData`: one `<YYYY-MM-DD>.jsonl` per day. */
export const LOG_DIR_NAME: LogDirName = 'agent-log'

/** Log files older than this many days are deleted at startup. */
export const LOG_RETENTION_DAYS: LogRetentionDays = 30

/** The socket file, in Electron's `userData` folder. */
export const SOCKET_FILE_NAME: SocketFileName = 'mcp.sock'

/** The Windows listener is a named pipe: this prefix, then the per-user part. */
export const WINDOWS_PIPE_NAME_PREFIX: WindowsPipeNamePrefix = '\\\\.\\pipe\\droneclean-studio-mcp-'

/** `run`'s timeout when the call does not give one. */
export const DEFAULT_RUN_TIMEOUT_MS: DefaultRunTimeoutMs = 120000

/** The largest `run` timeout a call may ask for. */
export const MAX_RUN_TIMEOUT_MS: MaxRunTimeoutMs = 600000

/** How long main waits for the page past the page's own timeout. */
export const RUN_TIMEOUT_GRACE_MS: RunTimeoutGraceMs = 5000

/** Longest `run` script, in UTF-8 bytes. */
export const MAX_SCRIPT_BYTES: MaxScriptBytes = 65536

/** Longest `run` result, in UTF-8 bytes. */
export const MAX_RESULT_BYTES: MaxResultBytes = 1048576

/** Longest `run` label, in characters. */
export const MAX_RUN_LABEL_CHARS: MaxRunLabelChars = 120

/** Longest agent-log summary, in characters. */
export const LOG_SUMMARY_MAX_CHARS: LogSummaryMaxChars = 400

/** Default `frame` width (the long edge). */
export const DEFAULT_FRAME_WIDTH: DefaultFrameWidth = 1280

/** Most frames one `frame` call may render. */
export const MAX_FRAME_COUNT: MaxFrameCount = 12

/** Longest `waitMs` an `export` call may ask for. */
export const MAX_EXPORT_WAIT_MS: MaxExportWaitMs = 240_000

/** Hits `search` returns when the call does not give a limit. */
export const DEFAULT_SEARCH_LIMIT: DefaultSearchLimit = 8

/** Most hits one `search` call may ask for. */
export const MAX_SEARCH_LIMIT: MaxSearchLimit = 20

/** How long the launcher waits for the app's socket. */
export const LAUNCHER_WAIT_MS: LauncherWaitMs = 15000

/** How often the launcher retries the connection. */
export const LAUNCHER_POLL_MS: LauncherPollMs = 200

/** `userData/agent-access.json`. */
export function agentAccessSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, SETTINGS_FILE_NAME)
}

/** `userData/agent-log`. */
export function agentLogDir(userDataDir: string): string {
  return path.join(userDataDir, LOG_DIR_NAME)
}

/** The day's log file, `userData/agent-log/<YYYY-MM-DD>.jsonl` (UTC, like the lines' `at`). */
export function agentLogPath(userDataDir: string, at: Date = new Date()): string {
  return path.join(agentLogDir(userDataDir), `${at.toISOString().slice(0, 10)}.jsonl`)
}

/**
 * The per-user part of the Windows pipe name: the first 16 hex digits of the
 * SHA-256 of the lower-cased user name. The user name, not the SID, because the
 * app (Electron) and the dependency-free launcher both read it synchronously
 * from `os.userInfo()` and get the same string, where the SID needs a child
 * process. It separates users who share a machine (fast user switching, RDP):
 * each gets their own pipe, so one user's app is not "another process serving
 * the pipe" for the next. It is not a secret; the pipe's access control stays
 * Windows' default (only the creating user and administrators may write).
 */
export function pipeUserPart(userName: string): string {
  return crypto.createHash('sha256').update(userName.toLowerCase()).digest('hex').slice(0, 16)
}

/**
 * The longest Unix socket path, in bytes, that `bind` and `connect` take: the
 * size of `sockaddr_un.sun_path` less its terminator, 104 - 1 on macOS (and the
 * BSDs) and 108 - 1 on Linux. Measured on macOS with Node 24.14: 104 bytes still
 * bound, 105 failed with EINVAL; the terminator is kept as margin.
 */
export function maxSocketPathBytes(platform: NodeJS.Platform): number {
  return platform === 'linux' ? 107 : 103
}

/** This process's user id; -1 where there is none (Windows, which never needs it). */
export function currentUid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1
}

/**
 * The folder a socket moves to when its path in the profile is too long: one
 * per user, `/tmp/droneclean-mcp-<uid>`, mode 0700 (`socket-dir.ts`). `/tmp`
 * rather than `os.tmpdir()`: `$TMPDIR` can differ between the app started from
 * the Finder and the launcher started by an MCP client (a sandbox sets its own),
 * while `/tmp` is the same folder for both, and short on every machine.
 */
export function shortSocketDirFor(uid: number = currentUid()): string {
  return path.posix.join('/tmp', `droneclean-mcp-${uid}`)
}

/**
 * The per-user socket the app listens on. Windows has named pipes instead of
 * socket files, named per user; the other platforms keep the socket in
 * `userData`, whose folder Electron creates with the user's mode and whose
 * socket is created 0600. A profile whose socket path would be longer than the
 * platform takes (`maxSocketPathBytes`: a long user name, a profile moved deep
 * into a folder) gets `<shortSocketDirFor(uid)>/<16 hex digits of the
 * profile path's SHA-256>.sock` instead, one per profile, so a throwaway
 * profile never meets the real one. The launcher computes the same path
 * (`studio/mcp/launcher.mjs`); the contract test holds the two together.
 */
export function socketPathFor(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
  userName: string = os.userInfo().username,
  uid: number = currentUid(),
): string {
  if (platform === 'win32') return `${WINDOWS_PIPE_NAME_PREFIX}${pipeUserPart(userName)}`
  const inProfile = path.join(userDataDir, SOCKET_FILE_NAME)
  if (Buffer.byteLength(inProfile) <= maxSocketPathBytes(platform)) return inProfile
  const profile = crypto.createHash('sha256').update(userDataDir).digest('hex').slice(0, 16)
  return path.posix.join(shortSocketDirFor(uid), `${profile}.sock`)
}

/** The private folder `socketPath` was moved to (`shortSocketDirFor`), or null for a socket in the profile or a pipe. */
export function shortSocketDirOf(socketPath: string, uid: number = currentUid()): string | null {
  const dir = shortSocketDirFor(uid)
  return path.posix.dirname(socketPath) === dir ? dir : null
}
