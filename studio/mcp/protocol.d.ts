/**
 * The MCP contract of DroneClean Studio (PLAN.md task 2.2, design
 * `docs/designs/2.2-mcp.md` §0 decision 1 and §4): the four tools' requests and
 * results, the per-user socket, the handshake, the agent log's line, the
 * "Allow AI agents" setting and the launcher's exit codes.
 *
 * This is the meeting point of the slices: the server in
 * `studio/desktop/src/main/mcp/` fills these in, `studio/mcp/launcher.mjs`
 * speaks the socket, and `studio/mcp/fixture.mjs` records one example per
 * message. The file is declaration-only on purpose: the desktop's `tsc` program
 * has `rootDir: src`, which refuses a source file outside it, but a `.d.ts` may
 * be imported with `import type` and is not emitted. The runtime values below
 * live in two places that the contract test
 * (`studio/desktop/test/agent-contract.test.mjs`) compares with the fixture:
 *
 * - `studio/desktop/src/main/mcp/protocol.ts` (the main process), whose
 *   constants are typed by the literal types in this file, so a change here
 *   breaks `npm run check` there;
 * - `studio/mcp/launcher.mjs` (a dependency-free Node script), whose exported
 *   values the test compares with the fixture.
 *
 * Transport (design §0 decision 1): **stdio only** in v1. The app listens on a
 * per-user socket — `mcp.sock` in Electron's `userData` folder (mode 0600), or
 * a named pipe on Windows — and `studio/mcp/launcher.mjs` pipes a client's
 * stdin/stdout to it. There is no HTTP listener, no port and no token: the
 * socket's file mode is the access control. The socket carries MCP over
 * newline-delimited JSON-RPC 2.0 (the SDK's stdio framing), and the first
 * message on every connection is an `initialize` request; the server answers
 * it without the editor page.
 *
 * The setting is off by default: while `enabled` is not `true` there is no
 * socket and the launcher exits with `ExitAgentAccessOff`.
 */

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** A value that survives `JSON.stringify`: what a tool may return. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Entity kinds of the SDK's `Changes` (`src/studio/sdk/types.ts`). */
export type EntityKind =
  | 'clip'
  | 'track'
  | 'transition'
  | 'keyframe'
  | 'marker'
  | 'effect'
  | 'media'
  | 'subclip'
  | 'project'
  | 'range'

/** Reference to one entity, as the SDK's `Changes` reports it. */
export interface EntityRefJson {
  kind: EntityKind
  id: string
}

/** A changed entity and the top-level fields that changed. */
export interface UpdatedEntityJson extends EntityRefJson {
  fields: string[]
}

/** A command that ran inside a transaction, as the undo stack records it. */
export interface CommandJson {
  type: string
  payload?: Record<string, unknown>
}

/**
 * What a `run` script changed, in the SDK's `Changes` shape
 * (`src/studio/sdk/types.ts`). Copied here rather than imported because the
 * desktop's `tsc` program cannot reach that source file; the SDK's own tests
 * pin the original.
 */
export interface ChangesJson {
  /** Commands that ran inside the call, in order; empty when it changed nothing. */
  commands: CommandJson[]
  /** Entities that appeared. */
  added: EntityRefJson[]
  /** Entities that disappeared. */
  removed: EntityRefJson[]
  /** Entities that changed, with the fields that changed. */
  updated: UpdatedEntityJson[]
  /** Number of undo entries the call added: 1 or 0 for a synchronous script, more when awaited SDK calls added their own. */
  undoSteps: number
}

/** Code of a `StudioError`, plus the MCP-level `TIMEOUT` (design §4.4). */
export type StudioErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED'
  | 'MEDIA_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'INTERNAL'

/** Codes an agent result can carry: the SDK's, plus `TIMEOUT`. */
export type AgentResultCode = 'OK' | StudioErrorCode | 'TIMEOUT'

/**
 * JSON form of a `StudioError` (`src/studio/sdk/errors.ts`), what every failed
 * tool answers as the text of its `isError` result.
 */
export interface StudioErrorJson {
  /** Always `StudioError`. */
  name: 'StudioError'
  /** The error code. */
  code: AgentResultCode
  /** The full human-readable message. */
  message: string
  /** Name of the rejected argument, when one was named. */
  argument?: string
  /** Valid values for the rejected argument, when they are known. */
  valid?: readonly string[]
  /** The entity that was not found or conflicted, when there is one. */
  entity?: EntityRefJson
  /** What the caller can do to fix it. */
  hint?: string
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Value of the `serverInfo` an `initialize` result carries. */
export type ServerName = 'droneclean'

/** Version of the server's tool surface; bump it when a tool changes shape. */
export type ServerVersion = '1'

/** Format version of this contract; bump it when a message changes shape. */
export type ProtocolVersion = 1

/**
 * What every connection starts with. The concrete `initialize` request and its
 * result are in `fixture.mjs` (`INITIALIZE_REQUEST` / `INITIALIZE_RESULT`).
 */
export interface AgentHandshake {
  /** Newline-delimited JSON-RPC 2.0, the SDK's stdio framing. */
  readonly framing: 'jsonl'
  /** The first message on a connection is always an MCP `initialize` request. */
  readonly firstMessage: 'initialize'
  /** `result.serverInfo` of the `initialize` result. */
  readonly serverInfo: { readonly name: ServerName; readonly version: ServerVersion }
  /** No token: the socket's file mode 0600 (or the Windows pipe's ACL) is the access control. */
  readonly auth: 'socket-mode-0600'
}

// ---------------------------------------------------------------------------
// `run`
// ---------------------------------------------------------------------------

/** Default `timeoutMs` of `run` (design §4.4); `0` means the script is synchronous. */
export type DefaultRunTimeoutMs = 120000

/** Upper bound of `timeoutMs` of `run`. */
export type MaxRunTimeoutMs = 600000

/** After the page's own timeout, how long main waits for the page before giving up. */
export type RunTimeoutGraceMs = 5000

/** Longest `script` accepted, in UTF-8 bytes. */
export type MaxScriptBytes = 65536

/** Longest `value` + `changes` JSON accepted, in UTF-8 bytes. */
export type MaxResultBytes = 1048576

/** Longest label accepted for one `run`, in characters. */
export type MaxRunLabelChars = 120

/**
 * Arguments of `run`: a script evaluated in the editor page with `studio` in
 * scope, inside `studio.transaction('agent: <label>', …)`.
 *
 * A call that is not answered within `timeoutMs`, or that the client cancels
 * with an MCP `notifications/cancelled`, is `TIMEOUT`: the tool stops waiting,
 * tells the script to stop (its next SDK call fails; JavaScript in the page
 * cannot be interrupted) and releases the editor. A page that does not answer
 * at all is asked to save and its window is reloaded, and the `TIMEOUT` says
 * whether unsaved edits were kept. MCP does not deliver a response for a
 * cancelled request; the agent log records the `TIMEOUT`. The edits the
 * synchronous part already made are **kept** — not rolled back — as the one
 * `agent: <label>` undo entry. `studio.history.undo()` or Ctrl+Z takes the kept
 * entry back. `changes` and `undoSteps` cover the whole call, edits after an
 * `await` included.
 */
export interface RunRequest {
  /**
   * A function expression called with the SDK, e.g. `"s => s.clips.list()"`
   * or `"async s => { const p = await s.project.list(); return p.length }"`,
   * or an expression that uses `studio`, e.g. `"studio.clips.list()"`.
   * It is evaluated with `new Function` in the editor page, so it has exactly
   * the page's privileges.
   */
  script: string
  /** Short name shown in the undo entry and the agent log; `"script"` when absent. */
  label?: string
  /** Milliseconds before the tool stops waiting; default 120000, max 600000. */
  timeoutMs?: number
  /**
   * Bring the app window up before the script runs. A launch the stdio launcher
   * started for a client (`--mcp`) keeps the window hidden until this asks for
   * it, or the user opens the app (a second launch, the dock icon).
   */
  show?: boolean
}

/**
 * Result of `run`, JSON-serialised as the tool's text content. `changes`
 * describes the whole call, the edits made after an `await` included, and
 * `undoSteps` counts every entry the whole call added (the synchronous part's
 * one, plus the ones awaited SDK calls made).
 */
export interface RunResult {
  /** What the script returned; `null` when it returned nothing. */
  value: JsonValue
  /** What the whole call changed, edits after an `await` included. */
  changes: ChangesJson
  /** Undo entries the whole call added (`history.depth()` after minus before). */
  undoSteps: number
  /** Time spent in the page, milliseconds. */
  durationMs: number
  /**
   * Whether the project was written after the call: present only when the call made undo entries and a project is
   * open; `false` means the save failed and the edits live only in the editor until `studio.project.save()`.
   */
  saved?: boolean
  /** Present and `true` when `value` + `changes` exceeded `MaxResultBytes`. */
  truncated?: true
  /** How to get a smaller result, when `truncated` is set. */
  hint?: string
}

// ---------------------------------------------------------------------------
// `search`
// ---------------------------------------------------------------------------

/** Default number of hits `search` returns. */
export type DefaultSearchLimit = 8

/** Upper bound of `limit` of `search`. */
export type MaxSearchLimit = 20

/** Which corpus a hit came from. */
export type SearchSource = 'sdk' | 'guide' | 'feature-map'

/** Arguments of `search`: one query over the SDK reference, the guide and the feature map. */
export interface SearchRequest {
  /** Free text, or a method name such as `studio.clips.split`. */
  query: string
  /** Maximum number of hits; default 8, max 20. */
  limit?: number
}

/** One search hit: enough to decide whether to open it, not the whole corpus. */
export interface SearchHit {
  /** Method name, guide page › section, or feature-map entry name. */
  title: string
  /** Which corpus it came from. */
  source: SearchSource
  /** An excerpt around the best match, at most a few hundred characters. */
  text: string
  /** Where to read the whole entry: a workspace path, or a guide route. */
  location: string
  /** Relevance, higher is better; comparable within one response only. */
  score: number
}

/** Result of `search`, JSON-serialised as the tool's text content. */
export interface SearchResult {
  results: SearchHit[]
}

// ---------------------------------------------------------------------------
// `frame`
// ---------------------------------------------------------------------------

/** Width of a frame's long edge by default (design §0 decision 4). */
export type DefaultFrameWidth = 1280

/** Most frames one `frame` call may render (design §4.6). */
export type MaxFrameCount = 12

/** A contact sheet: frames sampled from `from` to `to` and tiled into one PNG. */
export interface ContactSheetRequest {
  /** First timeline frame of the sheet. */
  from: number
  /** Last timeline frame of the sheet (inclusive). */
  to: number
  /** Frames between samples; 1 or more, chosen when absent. */
  step?: number
  /** Tile columns, 1 or more. */
  columns?: number
  /** Tile rows, 1 or more. */
  rows?: number
}

/**
 * Arguments of `frame` (design §4.6). Exactly one of `frame` and
 * `contactSheet` is given.
 */
export interface FrameRequest {
  /** One timeline frame to render. */
  frame?: number
  /** A sheet of frames around the edit. */
  contactSheet?: ContactSheetRequest
  /** Long edge in pixels; default 1280. */
  width?: number
  /** Write the PNG into the project's `frames/` folder and return its path. */
  full?: boolean
}

/** A PNG returned as base64 text (the default, capped size). */
export interface FramePngResult {
  /** Base64 of the PNG bytes. */
  png: string
  /** Size of the decoded PNG in bytes. */
  bytes: number
  width: number
  height: number
}

/** A PNG written to the workspace (`full: true`). */
export interface FramePathResult {
  /** Workspace-relative path of the written PNG, e.g. `projects/p1/frames/frame-42-mhx3k9z1-0.png`; every render is a new file. */
  path: string
  /** Size of the written PNG in bytes. */
  bytes: number
  width: number
  height: number
}

/** Result of `frame`: either base64 bytes or a written path, with its size. */
export type FrameResult = FramePngResult | FramePathResult

// ---------------------------------------------------------------------------
// `export`
// ---------------------------------------------------------------------------

/** Video codec of an export (the SDK's `ExportCodec`). */
export type ExportCodec = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1'

/** Encoder quality preset (the SDK's `ExportQuality`). */
export type ExportQuality = 'low' | 'medium' | 'high' | 'ultra'

/** Rate control (the SDK's `ExportRateControl`). */
export type ExportRateControl = 'auto' | 'variable' | 'constant'

/** Video container (the SDK's `ExportVideoContainer`). */
export type ExportVideoContainer = 'mp4' | 'mov' | 'webm' | 'mkv'

/** Audio container of an audio export (the SDK's `ExportAudioContainer`). */
export type ExportAudioContainer = 'mp3' | 'aac' | 'wav'

/** Transcript subtitle handling (the SDK's `ExportSubtitleMode`). */
export type ExportSubtitleMode = 'off' | 'burn' | 'sidecar' | 'embedded'

/** Picture, sound, or both (the SDK's `ExportMode`). */
export type ExportMode = 'video' | 'audio'

/** Status of an export job (the SDK's `ExportJobStatus`). */
export type ExportJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled'

/** Longest `waitMs` an `export` call may ask for (design §4.7). */
export type MaxExportWaitMs = 240000

/** Phase of a running export (the SDK's `ExportPhase`). */
export type ExportPhase = 'preparing' | 'rendering' | 'encoding' | 'finalizing'

/** The export settings an agent may set (the SDK's `ExportSettingsInfo`). */
export interface ExportSettingsJson {
  codec: ExportCodec
  quality: ExportQuality
  resolution: { width: number; height: number }
  rateControl?: ExportRateControl
  videoBitrate?: number
  smartCopy?: boolean
  mode: ExportMode
  videoContainer?: ExportVideoContainer
  audioContainer?: ExportAudioContainer
  subtitleMode?: ExportSubtitleMode
  renderWholeProject?: boolean
}

/** Settings overlaid on the current ones for one job (the SDK's `ExportSettingsPatch`). */
export type ExportSettingsPatchJson = Partial<ExportSettingsJson>

/** What `export.start` accepts (the SDK's `ExportStartInput`). */
export interface ExportStartOptionsJson {
  settings?: ExportSettingsPatchJson
  inPoint?: number | null
  outPoint?: number | null
  name?: string
}

/** One export job (the SDK's `ExportJobInfo`). */
export interface ExportJobJson {
  id: string
  name: string
  projectId?: string
  status: ExportJobStatus
  progress: number
  phase?: ExportPhase
  progressMessage?: string
  renderedFrames?: number
  totalFrames?: number
  inPoint: number | null
  outPoint: number | null
  durationFrames: number
  exportMode: ExportMode
  fileName: string
  savedPath?: string
  fileSize?: number
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

/**
 * Arguments of `export` (design §4.7): start a job with `start`, poll it with
 * `jobId`, cancel it with `jobId` + `cancel`, optionally wait up to `waitMs`.
 */
export interface ExportRequest {
  /** Save the open project, then start a new job and return it without waiting for the render. */
  start?: ExportStartOptionsJson
  /** Read one job by id. */
  jobId?: string
  /** Cancel the job named by `jobId`. */
  cancel?: boolean
  /** Wait up to this many milliseconds (max 240000) for the job to finish. */
  waitMs?: number
}

/** Result of `export`: the job, in the SDK's `ExportJobInfo` shape. */
export type ExportResult = ExportJobJson

// ---------------------------------------------------------------------------
// The per-user socket, the setting and the log
// ---------------------------------------------------------------------------

/** File name of the socket inside Electron's `userData` folder. */
export type SocketFileName = 'mcp.sock'

/**
 * Windows has no socket files: the listener is a named pipe, this prefix plus
 * the first 16 hex digits of the SHA-256 of the lower-cased user name, so each
 * user of a machine has their own pipe.
 */
export type WindowsPipeNamePrefix = '\\\\.\\pipe\\droneclean-studio-mcp-'

/** File name of the setting inside Electron's `userData` folder. */
export type SettingsFileName = 'agent-access.json'

/** Folder of the agent log inside Electron's `userData`: one `<YYYY-MM-DD>.jsonl` file per day. */
export type LogDirName = 'agent-log'

/** Log files older than this many days are deleted when the app starts. */
export type LogRetentionDays = 30

/** Longest `summary` of an agent-log line, in characters. */
export type LogSummaryMaxChars = 400

/** How long the launcher waits for a socket after starting the app, milliseconds. */
export type LauncherWaitMs = 15000

/** How often the launcher retries the connection, milliseconds. */
export type LauncherPollMs = 200

/**
 * Contents of `userData/agent-access.json`. A missing or unreadable file means
 * the default: agent access is **off** (design §0 decision 3). The file is
 * small and readable so the launcher can tell why the socket is missing.
 */
export interface AgentAccessSettings {
  /** Format version, `1`. */
  readonly version: ProtocolVersion
  /** Whether the socket should exist; `false` when the file is missing. */
  readonly enabled: boolean
}

/** One tool of the server. */
export type AgentToolName = 'search' | 'run' | 'frame' | 'export'

/**
 * One line of `userData/agent-log/<YYYY-MM-DD>.jsonl`, appended per tool call. It carries
 * the arguments' hash, never the arguments themselves: a `run` script's text is
 * not written to disk.
 */
export interface AgentLogLine {
  /** ISO 8601 time the call finished. */
  readonly at: string
  /** Tool that was called. */
  readonly tool: AgentToolName
  /** SHA-256 (hex) of the canonical JSON of the arguments. */
  readonly argsHash: string
  /** One line about the call, at most `LogSummaryMaxChars` characters. */
  readonly summary: string
  /** Time from the start of the call to its answer, milliseconds. */
  readonly durationMs: number
  /** `OK`, the error code the call answered, or `TIMEOUT`. */
  readonly code: AgentResultCode
  /** Undo entries a `run` added, when it ran. */
  readonly undoSteps?: number
  /** The error's message, when the call failed. */
  readonly error?: string
}

// ---------------------------------------------------------------------------
// Launcher exit codes
// ---------------------------------------------------------------------------

/** Agent access is off in the app's settings: nothing was started. */
export type ExitAgentAccessOff = 1

/** The app could not be started, or did not answer on the socket in time. */
export type ExitAppUnreachable = 2

/** The client's stdin ended normally. */
export type ExitOk = 0

/** The app's socket closed while the client was still connected. */
export type ExitSocketClosed = 3

/**
 * What `studio/mcp/launcher.mjs` exits with:
 * - `0` — the client closed stdin; the round trip ended normally.
 * - `1` — agent access is off in the app; nothing was started.
 * - `2` — the app is not installed, could not be started, or did not answer.
 * - `3` — the app's socket closed while the client was still connected.
 *
 * Messages go to stderr; stdout carries only the MCP frames.
 */
export type LauncherExitCode = ExitOk | ExitAgentAccessOff | ExitAppUnreachable | ExitSocketClosed
