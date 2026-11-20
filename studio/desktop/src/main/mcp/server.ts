/**
 * The MCP server of DroneClean Studio, in the Electron main process (task 2.2,
 * design §0 decision 1 and §4.1–§4.3).
 *
 * One per-user socket — `userData/mcp.sock` (mode 0600), a named pipe on
 * Windows — speaking MCP over the SDK's stdio framing; `studio/mcp/launcher.mjs`
 * connects a client's stdin/stdout to it. There is no HTTP listener, no port and
 * no token in v1: the file mode is the access control, and the socket exists
 * only while "Allow AI agents" is on (on by default since 20 Nov 2026, `settings.ts`).
 *
 * `initialize` and `tools/list` are answered without the editor page; a tool
 * call reaches the page through `PageBridge` (design §4.2). One queue serialises
 * calls across connections, so two clients never write the stores at once, and
 * one JSON line per call goes to `userData/agent-log/<date>.jsonl` (`log.ts`).
 *
 * The module has no Electron import: `index.ts` passes the window's page
 * bridge, which keeps the server and its tests under plain Node.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import net from 'node:net'
import type { Socket } from 'node:net'
import { z } from 'zod'
import type {
  AgentToolName,
  ExportRequest,
  FramePngResult,
  FrameRequest,
  RunRequest,
  SearchRequest,
} from '../../../../mcp/protocol'
import type { AgentAccessStatus } from '../../shared/agent-access'
import { agentError, toStudioErrorJson } from './errors'
import type { AgentActivity } from './idle-quit'
import { agentLogLine, createAgentLog, pruneAgentLog, type AgentLog } from './log'
import { createSerialQueue } from './page'
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_EXPORT_WAIT_MS,
  MAX_FRAME_COUNT,
  MAX_RUN_TIMEOUT_MS,
  MAX_SEARCH_LIMIT,
  SERVER_NAME,
  SERVER_VERSION,
  agentAccessSettingsPath,
  agentLogDir,
  socketPathFor,
} from './protocol'
import { isAgentAccessEnabledForUser, writeAgentAccessSettings } from './settings'
import { createSearchTool } from './tools/search'
import { exportTool } from './tools/export'
import { frameTool } from './tools/frame'
import { runScript } from './tools/run'
import type { LoadSearchDocuments, PageBridge, ToolOutcome } from './types'

/** Whether the socket should be up (the page's `AgentAccessInfo.status`). */
export type { AgentAccessStatus }

/** What `createAgentAccess` is given. */
export interface AgentAccessOptions {
  /** Electron's `userData` folder: the socket, the setting and the log live here. */
  userDataDir: string
  /** The editor page's bridge; tools are the only caller. */
  page: PageBridge
  /** Loads the three corpora; called once, on the first `search`. */
  loadDocuments: LoadSearchDocuments
  /**
   * Bring the app window up: a `run` that asks `show: true` calls this before
   * its script runs. A launch the stdio launcher started keeps the window hidden.
   */
  showWindow?: () => void
  /** Where the agent log goes; `userData/agent-log/` when absent. */
  log?: AgentLog
  /** Where diagnostics go; the main process console when absent. */
  logger?: (message: string) => void
  /** Told when a client connects or leaves and when a tool call starts or ends (the idle quit). */
  onActivity?: (event: AgentActivity) => void
  /** The workspace folder on disk, or null while unknown: an export's `absolutePath` is its `savedPath` joined to it. */
  workspaceFolder?: () => string | null
}

/** The object the shell (and, later, the Agent access panel) drives. */
export interface AgentAccess {
  /** `userData/mcp.sock`, or the Windows pipe. */
  readonly socketPath: string
  /** Whether the socket is up right now. */
  status(): AgentAccessStatus
  /** Whether the setting says on. */
  isEnabled(): boolean
  /** Turn the setting on and start the socket; idempotent. */
  enable(): Promise<void>
  /** Turn the setting off and remove the socket; idempotent. */
  disable(): Promise<void>
  /** Start the socket when the setting already says on (the shell's startup path). */
  startIfEnabled(): Promise<void>
  /** Stop the socket without changing the setting (quit). */
  dispose(): Promise<void>
}

/** A tool answer as MCP content. */
function textResult(text: string, isError = false): CallToolResult {
  return isError
    ? { content: [{ type: 'text', text }], isError: true }
    : { content: [{ type: 'text', text }] }
}

/**
 * The PNG of a `frame` result as MCP image content, so a client shows the
 * picture instead of 2–3 MB of base64 in a text item. The result the tool
 * returns is unchanged (`studio/mcp/protocol.d.ts`'s `FrameResult`); only what
 * crosses the protocol is turned into an image.
 *
 * `full: true` wrote the PNG into the workspace and answers a path, so it has
 * no `png` and stays a text item.
 */
function frameImage(
  result: unknown,
): { type: 'image'; data: string; mimeType: 'image/png' } | null {
  if (typeof result !== 'object' || result === null) return null
  const png = (result as { png?: unknown }).png
  return typeof png === 'string' ? { type: 'image', data: png, mimeType: 'image/png' } : null
}

/** The `initialize` instructions, shown by clients before the first call. */
const INSTRUCTIONS =
  'DroneClean Studio is a video editor; window.studio is its SDK. Use search to find a method (an SDK hit carries ' +
  'its whole signature or declaration; search rather than studio.reference(), too long for one answer), run to ' +
  'evaluate a JavaScript function against the SDK, and the editor updates live. A synchronous run is one undo step, ' +
  'rolled back whole if it throws; an awaited script keeps the steps it made before an error, which the error says ' +
  '(Ctrl+Z or studio.history.undo() takes them back). studio.project.create({ name, width, height, fps: { num: ' +
  '60000, den: 1001 } }) makes a project and opens it, so media can be imported next; studio.project.open(id) ' +
  'switches to another one. run saves the project after every call that changed it (its result says saved: true; ' +
  'saved: false means the save failed and studio.project.save() should be called again). frame renders a timeline ' +
  'frame or a contact sheet; export saves the project, queues a render and reports its progress, and a finished ' +
  'job\'s absolutePath is the file to name to the person. In the desktop app studio.media.import names media by ' +
  'absolute path; a browser has only file handles. A drone edit usually goes: studio.project.current() and ' +
  'studio.media.list() (newest first; sort by fileName for the order the files were shot) for what is open and ' +
  'imported; studio.tracks.list() for the track ids, top first; studio.clips.addMany to lay clips end to end ' +
  '(sourceStart and sourceEnd pick the part of each file, in frames of the file; a clip that would overlap another ' +
  'is a CONFLICT naming the first free frame); await studio.clips.setStabilization(clipId, {}) for each clip whose ' +
  'file carries gyro data (DJI, GoPro; UNSUPPORTED otherwise), one after another, since the engine opens each clip ' +
  'in seconds (raise timeoutMs for many; studio.clips.getStabilization(id) reads it back); a title goes on a video ' +
  'track of its own above the footage, studio.tracks.add({ kind: \'video\', name: \'Titles\', position: 0 }) ' +
  '(without position a track goes to the bottom, hidden under the footage), then studio.titles.add on it; ' +
  'studio.transitions.add at a cut; for a before and after, the same range twice, one after the other, the first ' +
  'without stabilization, with a title on each: a stabilized clip fills the canvas, so give the unstabilized one a ' +
  'transform that covers it too (the file\'s width and height times the larger of canvas width / file width and ' +
  'canvas height / file height, x and y 0: a 4:3 file in a 1920x1080 project is 1920x1440); frame with a ' +
  'contactSheet to look at the whole edit; studio.export.presets() for the export settings (same-as-source, ' +
  'youtube-4k, instagram-reel, small-file). Pass show: true on a run to bring the editor window up when the user ' +
  'wants to watch.'

/** The tool schemas; the wire shapes are in `studio/mcp/protocol.d.ts`. */
const searchInput = {
  query: z.string().min(1).describe('Free text, or a method name such as studio.clips.split'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe(`Hits to return; default ${DEFAULT_SEARCH_LIMIT}`),
}

const runInput = {
  script: z
    .string()
    .min(1)
    .describe(
      'A function expression called with the SDK, e.g. "s => s.clips.list()", or an expression using ' +
        'studio, e.g. "studio.clips.list()"; it runs in the editor page',
    ),
  label: z.string().min(1).optional().describe('Short name of the undo entry, e.g. "trim the intro"'),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_RUN_TIMEOUT_MS)
    .optional()
    .describe('Milliseconds to wait; default 120000'),
  show: z
    .boolean()
    .optional()
    .describe('Show the app window; a launch the MCP client started keeps it hidden'),
}

const frameInput = {
  frame: z.number().int().min(0).optional().describe('One timeline frame to render'),
  contactSheet: z
    .object({
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      step: z.number().int().min(1).optional(),
      columns: z.number().int().min(1).optional(),
      rows: z.number().int().min(1).optional(),
    })
    .optional()
    .describe(`Frames sampled into one PNG; at most ${MAX_FRAME_COUNT} cells`),
  width: z.number().int().min(16).max(8192).optional().describe('Long edge in pixels; default 1280'),
  full: z.boolean().optional().describe('Write the PNG into the project frames folder'),
}

const exportInput = {
  start: z
    .object({
      settings: z.record(z.string(), z.unknown()).optional(),
      inPoint: z.number().int().nullable().optional(),
      outPoint: z.number().int().nullable().optional(),
      name: z.string().optional(),
    })
    .optional()
    .describe('Start a job; returns immediately'),
  jobId: z.string().optional().describe('Read or cancel one job'),
  cancel: z.boolean().optional().describe('Cancel the job named by jobId'),
  waitMs: z.number().int().min(0).max(MAX_EXPORT_WAIT_MS).optional().describe('Wait up to this long'),
}

/** A name and a version the launcher and clients can recognise. */
function createMcpServer(tools: {
  search: ReturnType<typeof createSearchTool>
  run: (request: RunRequest, signal?: AbortSignal) => Promise<ToolOutcome>
  frame: (request: FrameRequest) => Promise<ToolOutcome>
  export: (request: ExportRequest) => Promise<ToolOutcome>
  call: (tool: AgentToolName, arguments_: unknown, handler: () => Promise<ToolOutcome>) => Promise<CallToolResult>
}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )

  server.registerTool(
    'search',
    {
      title: 'Search the DroneClean Studio reference',
      description:
        'Search the SDK reference (window.studio), the user guide and the feature map. Returns the best matches ' +
        'with title, source, text and location; does not touch the page, so it works while the editor loads.',
      inputSchema: searchInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (arguments_) => tools.call('search', arguments_, () => tools.search(arguments_ as SearchRequest)),
  )

  server.registerTool(
    'run',
    {
      title: 'Run a script against the editor SDK',
      description:
        'Evaluate a JavaScript function expression with window.studio as its argument, or an expression that uses ' +
        'studio, inside one undo step when the script is synchronous. Returns { value, changes, undoSteps } or a ' +
        'StudioError; the edit appears live in the editor and Ctrl+Z undoes it. Awaited SDK calls each add their ' +
        'own undo entry.',
      inputSchema: runInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (arguments_, extra) => tools.call('run', arguments_, () => tools.run(arguments_ as RunRequest, extra.signal)),
  )

  server.registerTool(
    'frame',
    {
      title: 'Render a frame or a contact sheet',
      description:
        'Render one timeline frame, or a contact sheet of up to 12 sampled frames, from the editor\'s own renderer. ' +
        'Returns the PNG as base64 with its size (default 1280 px long edge), or with full: true writes ' +
        'projects/{id}/frames/frame-N-<time>-<counter>.png into the workspace (a new file each render, so a before and ' +
        'an after both stay) and returns its path and size.',
      inputSchema: frameInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (arguments_) => tools.call('frame', arguments_, () => tools.frame(arguments_ as FrameRequest)),
  )

  server.registerTool(
    'export',
    {
      title: 'Export the timeline',
      description:
        'Start a render, report its progress and stop it, without blocking. { start: { settings, inPoint, outPoint, ' +
        'name } } saves the project (as studio.project.save() does), then queues a job and returns it; it never moves ' +
        'the window or touches the undo history, and the job renders the timeline as it was at the start. A second ' +
        'start while one runs for the same project is a CONFLICT naming the running job. { jobId } returns the job ' +
        '(status, progress, phase, renderedFrames, totalFrames, savedPath, absolutePath: the file on disk, fileSize, ' +
        'error). { jobId, cancel: true } ' +
        'stops it. waitMs (0..240000) waits for the job and still returns its progress on timeout; without waitMs a ' +
        'read answers within a second and a start once the save is done (at most 30 seconds).',
      inputSchema: exportInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (arguments_) =>
      tools.call('export', arguments_, () => tools.export(arguments_ as ExportRequest)),
  )

  return server
}

/** Whether something answers at `socketPath` (a live app or a stale file). */
function isListening(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath)
    const finish = (listening: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(listening)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

/** Whether a failed `listen` is the "the path is taken" kind. */
function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/**
 * Create the agent-access object. `startIfEnabled()` is the startup call: it
 * reads the setting and starts nothing while it is off, so a fresh profile has
 * no socket at all.
 */
export function createAgentAccess(options: AgentAccessOptions): AgentAccess {
  const log = options.log ?? createAgentLog(agentLogDir(options.userDataDir))
  const logger = options.logger ?? ((message: string) => console.error(message))
  const settingsPath = agentAccessSettingsPath(options.userDataDir)
  const socketPath = socketPathFor(options.userDataDir)
  const queue = createSerialQueue()
  const search = createSearchTool(options.loadDocuments)
  const connections = new Set<Socket>()
  let listener: net.Server | null = null
  let status: AgentAccessStatus = 'off'

  /** One tool call: serialised, timed, logged, and turned into MCP content. */
  async function call(
    tool: AgentToolName,
    arguments_: unknown,
    handler: () => Promise<ToolOutcome>,
  ): Promise<CallToolResult> {
    const startedAt = Date.now()
    let outcome: ToolOutcome
    options.onActivity?.('call-started')
    try {
      outcome = await queue(handler)
    } catch (error) {
      outcome = { error: toStudioErrorJson(error) }
    } finally {
      options.onActivity?.('call-ended')
    }
    const undoSteps = outcome.undoSteps
    if ('error' in outcome) {
      const error = outcome.error
      await log.append(
        agentLogLine(tool, arguments_, {
          durationMs: Date.now() - startedAt,
          code: error.code,
          ...(undoSteps !== undefined && { undoSteps }),
          error: error.message,
        }),
      )
      return textResult(JSON.stringify(error), true)
    }
    await log.append(
      agentLogLine(tool, arguments_, {
        durationMs: Date.now() - startedAt,
        code: 'OK',
        ...(undoSteps !== undefined && { undoSteps }),
      }),
    )
    const image = frameImage(outcome.result)
    if (image !== null) {
      const { bytes, width, height } = outcome.result as FramePngResult
      return { content: [image, { type: 'text', text: JSON.stringify({ bytes, width, height }) }] }
    }
    return textResult(JSON.stringify(outcome.result))
  }

  /** The MCP server for one connection; a closed client leaves the next one a fresh server. */
  function serverForConnection(): McpServer {
    return createMcpServer({
      search,
      run: (request, signal) => {
        if (request.show === true) options.showWindow?.()
        return runScript(request, options.page, signal)
      },
      frame: (request) => frameTool(request, options.page),
      export: (request) => exportTool(request, options.page, options.workspaceFolder),
      call,
    })
  }

  /** Serve one accepted client socket. */
  function handleConnection(socket: Socket): void {
    connections.add(socket)
    options.onActivity?.('client-connected')
    socket.setNoDelay(true)
    socket.once('close', () => {
      connections.delete(socket)
      options.onActivity?.('client-closed')
    })
    socket.on('error', (error) => {
      logger(`[mcp] client socket error: ${error.message}`)
      socket.destroy()
    })
    const server = serverForConnection()
    const transport = new StdioServerTransport(socket, socket)
    server.connect(transport).catch((error: unknown) => {
      logger(`[mcp] connect failed: ${error instanceof Error ? error.message : String(error)}`)
      socket.destroy()
    })
    // A client that closes its stdin is done: close this side too, so the
    // launcher sees a clean end instead of a half-closed socket forever.
    socket.once('end', () => {
      void server.close().catch(() => undefined)
      socket.end()
    })
    socket.once('close', () => {
      server.close().catch(() => undefined)
    })
  }

  /** Listen on the socket, replacing a stale file left by a crashed launch. */
  async function listen(): Promise<void> {
    const server = net.createServer(handleConnection)
    const attempt = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const onError = (error: unknown): void => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(socketPath)
      })

    try {
      await attempt()
    } catch (error) {
      if (!isAddressInUse(error)) throw error
      if (await isListening(socketPath)) {
        status = 'conflict'
        throw agentError(
          'CONFLICT',
          `agent access: another DroneClean Studio process is serving ${socketPath}`,
          { hint: 'Close the other window; one app owns the socket.' },
        )
      }
      if (process.platform !== 'win32') {
        try {
          fs.unlinkSync(socketPath)
        } catch {
          // A race with another process removing it is the same outcome.
        }
      }
      await attempt()
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(socketPath, 0o600)
    }
    listener = server
    status = 'on'
  }

  /** Close the listener, drop the clients and remove the socket file. */
  async function stop(): Promise<void> {
    for (const socket of connections) socket.destroy()
    connections.clear()
    const server = listener
    listener = null
    if (server !== null) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(socketPath)
      } catch {
        // Already gone is the state we wanted.
      }
    }
    status = 'off'
  }

  /** Start the socket; a second enable while it runs is a no-op. */
  async function start(): Promise<void> {
    if (listener !== null) {
      status = 'on'
      return
    }
    try {
      await listen()
      logger(`[mcp] listening on ${socketPath}`)
    } catch (error) {
      if (status !== 'conflict') status = 'error'
      logger(`[mcp] could not start: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  return {
    socketPath,

    status() {
      return status
    },

    isEnabled() {
      return isAgentAccessEnabledForUser(options.userDataDir)
    },

    async enable() {
      writeAgentAccessSettings(settingsPath, { version: 1, enabled: true })
      await start()
    },

    async disable() {
      writeAgentAccessSettings(settingsPath, { version: 1, enabled: false })
      await stop()
    },

    async startIfEnabled() {
      // Retention (design §4.3): 30 days of log files, trimmed at every launch.
      await pruneAgentLog(agentLogDir(options.userDataDir)).catch((error: unknown) => {
        logger(`[mcp] could not trim the agent log: ${error instanceof Error ? error.message : String(error)}`)
      })
      if (!isAgentAccessEnabledForUser(options.userDataDir)) {
        status = 'off'
        return
      }
      try {
        await start()
      } catch {
        // The status and the log carry the failure; the app still starts.
      }
    },

    async dispose() {
      await stop()
    },
  }
}

