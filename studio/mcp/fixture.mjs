/**
 * A recorded fake session of the DroneClean Studio MCP server (task 2.2).
 *
 * It is the second half of the meeting point: the server's tests use it as the
 * corpus and the expected messages, and the launcher's test uses
 * `createFakeSocketServer` to answer a real launcher without Electron. No test
 * starts the app or a real MCP client.
 *
 * The shapes are `studio/mcp/protocol.d.ts`; `MESSAGE_KEYS` names the keys of
 * every recorded object, so renaming one in the fixture fails the contract test
 * by name, and the launcher test (which reads `SESSION[i].request/response`)
 * fails with it.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** The example `userData` folder of the recording. */
export const USER_DATA_DIR = '/Users/example/Library/Application Support/DroneClean Studio'

/** The values both implementations must agree on; compared by the contract test. */
export const CONSTANTS = Object.freeze({
  protocolVersion: 1,
  serverName: 'droneclean',
  serverVersion: '1',
  socketFileName: 'mcp.sock',
  windowsPipePrefix: '\\\\.\\pipe\\droneclean-studio-mcp-',
  settingsFileName: 'agent-access.json',
  logDirName: 'agent-log',
  logRetentionDays: 30,
  defaultRunTimeoutMs: 120000,
  maxRunTimeoutMs: 600000,
  runTimeoutGraceMs: 5000,
  maxScriptBytes: 65536,
  maxResultBytes: 1048576,
  maxRunLabelChars: 120,
  logSummaryMaxChars: 400,
  defaultFrameWidth: 1280,
  maxFrameCount: 12,
  maxExportWaitMs: 240000,
  defaultSearchLimit: 8,
  maxSearchLimit: 20,
  launcherWaitMs: 15000,
  launcherPollMs: 200,
  exitCodes: { ok: 0, agentAccessOff: 1, appUnreachable: 2, socketClosed: 3 },
})

/** The setting file, on and off. */
export const SETTINGS_ON = { version: 1, enabled: true }
export const SETTINGS_OFF = { version: 1, enabled: false }

/** One line of the handshake: the first message a client sends. */
export const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'fixture-client', version: '0.0.0' },
  },
}

/** The server's answer to `INITIALIZE_REQUEST`. */
export const INITIALIZE_RESULT = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    protocolVersion: '2025-11-25',
    capabilities: { tools: { listChanged: true } },
    serverInfo: { name: 'droneclean', version: '1' },
    instructions:
      'DroneClean Studio is a video editor; window.studio is its SDK. Use search to find a method (an SDK hit ' +
      'carries its whole signature or declaration; search rather than studio.reference(), too long for one answer), ' +
      'run to evaluate a JavaScript function against the SDK, and the editor updates live. A synchronous run is one ' +
      'undo step, rolled back whole if it throws; an awaited script keeps the steps it made before an error, which ' +
      'the error says (Ctrl+Z or studio.history.undo() takes them back). studio.project.create({ name, width, ' +
      'height, fps: { num: 60000, den: 1001 } }) makes a project and opens it, so media can be imported next; ' +
      'studio.project.open(id) switches to another one. run saves the project after every call that changed it (its ' +
      'result says saved: true; saved: false means the save failed and studio.project.save() should be called ' +
      'again). frame renders a timeline frame or a contact sheet; export saves the project, queues a render and ' +
      'reports its progress, and a finished job\'s absolutePath is the file to name to the person. In the desktop ' +
      'app studio.media.import names media by absolute path; a browser has only file handles. A drone edit usually ' +
      'goes: studio.project.current() and studio.media.list() (newest first; sort by fileName for the order the ' +
      'files were shot) for what is open and imported; studio.tracks.list() for the track ids, top first; ' +
      'studio.clips.addMany to lay clips end to end (sourceStart and sourceEnd pick the part of each file, in frames ' +
      'of the file; a clip that would overlap another is a CONFLICT naming the first free frame); await ' +
      'studio.clips.setStabilization(clipId, {}) for each clip whose file carries gyro data (DJI, GoPro; UNSUPPORTED ' +
      'otherwise), one after another, since the engine opens each clip in seconds (raise timeoutMs for many; ' +
      'studio.clips.getStabilization(id) reads it back); a title goes on a video track of its own above the footage, ' +
      'studio.tracks.add({ kind: \'video\', name: \'Titles\', position: 0 }) (without position a track goes to the ' +
      'bottom, hidden under the footage), then studio.titles.add on it; studio.transitions.add at a cut; for a ' +
      'before and after, the same range twice, one after the other, the first without stabilization, with a title on ' +
      'each: a stabilized clip fills the canvas, so give the unstabilized one a transform that covers it too (the ' +
      'file\'s width and height times the larger of canvas width / file width and canvas height / file height, x and ' +
      'y 0: a 4:3 file in a 1920x1080 project is 1920x1440); frame with a contactSheet to look at the whole edit; ' +
      'studio.export.presets() for the export settings (same-as-source, youtube-4k, instagram-reel, small-file). ' +
      'Pass show: true on a run to bring the editor window up when the user wants to watch.',
  },
}

/** The notification that ends the handshake; it has no answer. */
export const INITIALIZED_NOTIFICATION = { jsonrpc: '2.0', method: 'notifications/initialized' }

/** The four tools, in the order the server registers them. */
export const EXPECTED_TOOL_NAMES = ['search', 'run', 'frame', 'export']

/** `tools/list`, with the descriptions the server answers. */
export const TOOLS_LIST_REQUEST = { jsonrpc: '2.0', id: 2, method: 'tools/list' }

export const TOOLS_LIST_RESULT = {
  jsonrpc: '2.0',
  id: 2,
  result: {
    tools: [
      {
        name: 'search',
        title: 'Search the DroneClean Studio reference',
        description:
          'Search the SDK reference (window.studio), the user guide and the feature map. Returns the best matches ' +
          'with title, source, text and location; does not touch the page, so it works while the editor loads.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
      },
      {
        name: 'run',
        title: 'Run a script against the editor SDK',
        description:
          'Evaluate a JavaScript function expression with window.studio as its argument, or an expression that ' +
          'uses studio, inside one undo step when the script is synchronous. Returns { value, changes, undoSteps } ' +
          'or a StudioError; the edit appears live in the editor and Ctrl+Z undoes it. Awaited SDK calls each add ' +
          'their own undo entry.',
        inputSchema: {
          type: 'object',
          properties: { script: { type: 'string' }, label: { type: 'string' }, timeoutMs: { type: 'integer' }, show: { type: 'boolean' } },
          required: ['script'],
        },
      },
      {
        name: 'frame',
        title: 'Render a frame or a contact sheet',
        description:
          "Render one timeline frame, or a contact sheet of up to 12 sampled frames, from the editor's own renderer. " +
          'Returns the PNG as base64 with its size (default 1280 px long edge), or with full: true writes ' +
          'projects/{id}/frames/frame-N-<time>-<counter>.png into the workspace (a new file each render, so a before and ' +
          'an after both stay) and returns its path and size.',
        inputSchema: { type: 'object', properties: { frame: { type: 'integer' }, contactSheet: { type: 'object' }, width: { type: 'integer' }, full: { type: 'boolean' } } },
      },
      {
        name: 'export',
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
        inputSchema: { type: 'object', properties: { start: { type: 'object' }, jobId: { type: 'string' }, cancel: { type: 'boolean' }, waitMs: { type: 'integer' } } },
      },
    ],
  },
}

/** The corpus the server test indexes: a few documents of each source. */
export const CORPUS = [
  {
    id: 'sdk:clips.split',
    source: 'sdk',
    title: 'studio.clips.split',
    text:
      'Splits a clip at a timeline frame. One undo step.\n' +
      'split(id: ClipId, frame: Frame): [ClipId, ClipId]\n' +
      'Example: const [left, right] = studio.clips.split(\'c1\', 240)',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:clips.list',
    source: 'sdk',
    title: 'studio.clips.list',
    text:
      'Clips, optionally filtered by track or kind. Not an undo step.\n' +
      'list(filter?: ClipFilter): ClipInfo[]',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:clips.add',
    source: 'sdk',
    title: 'studio.clips.add',
    text:
      'Place a media library item on a track. One undo step.\n' +
      'add(input: ClipAddInput): ClipId',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:clips.update',
    source: 'sdk',
    title: 'studio.clips.update',
    text:
      'Change a clip label, gain, fades or transform. One undo step.\n' +
      'update(id: ClipId, patch: ClipPatch): void',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:export.start',
    source: 'sdk',
    title: 'studio.export.start',
    text: 'Queue an export and return its job. Not an undo step.\nstart(options?: ExportStartInput): Promise<ExportJobInfo>',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:project.list',
    source: 'sdk',
    title: 'studio.project.list',
    text: 'Every project in the workspace storage. Not an undo step.\nlist(): Promise<ProjectInfo[]>',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:tracks.add',
    source: 'sdk',
    title: 'studio.tracks.add',
    text: 'Add a track at a position. One undo step.\nadd(input: TrackAddInput): TrackId',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'sdk:error:INVALID_ARGUMENT',
    source: 'sdk',
    title: 'INVALID_ARGUMENT',
    text: 'An argument has the wrong type, shape or range. Read the message: it names the argument and the valid values.',
    location: 'src/studio/sdk/reference/sdk-reference.json',
  },
  {
    id: 'guide:timeline:4',
    source: 'guide',
    title: 'Timeline › Split a clip',
    text:
      'Put the playhead where the cut should be, select the clip, then press the Split button or the S key. ' +
      'Splitting a clip creates two clips that share the source media; the timeline length does not change.',
    location: 'docs/timeline',
  },
  {
    id: 'guide:timeline:5',
    source: 'guide',
    title: 'Timeline › Trim a clip',
    text: 'Drag a clip edge to trim it, or use the trim tool to shorten two neighbouring clips at once.',
    location: 'docs/timeline',
  },
  {
    id: 'guide:export:0',
    source: 'guide',
    title: 'Export › Render the timeline',
    text:
      'Open the Export dialog, choose the codec and quality, and press Export. The render queue shows progress and ' +
      'writes the file into the project exports folder.',
    location: 'docs/export',
  },
  {
    id: 'feature-map:timeline:8',
    source: 'feature-map',
    title: 'Split',
    text:
      '### Split\n- Where: Editor › Timeline › tool strip\n- Does: Splits the selected clip at the playhead into two clips.\n' +
      '- SDK: `studio.clips.split`\n- Code: `src/features/timeline/components/timeline-header.tsx`',
    location: 'docs/feature-map/timeline.md#tool-strip',
  },
  {
    id: 'feature-map:export:0',
    source: 'feature-map',
    title: 'Export',
    text:
      '### Export\n- Where: Editor › toolbar › Export\n- Does: Opens the export dialog and queues a render.\n' +
      '- SDK: `studio.export.start`',
    location: 'docs/feature-map/export.md',
  },
]

/** A `search` call over `CORPUS`. */
export const SEARCH_REQUEST = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'search', arguments: { query: 'split clip', limit: 3 } },
}

/** The answer to `SEARCH_REQUEST`, recorded from the BM25 index over `CORPUS`. */
export const SEARCH_RESULT = {
  jsonrpc: '2.0',
  id: 3,
  result: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          results: [
            {
              title: 'Timeline › Split a clip',
              source: 'guide',
              text:
                'Put the playhead where the cut should be, select the clip, then press the Split button or the S key. ' +
                'Splitting a clip creates two clips that share the source media; the timeline length does not change.',
              location: 'docs/timeline',
              score: 3.598,
            },
            {
              title: 'Split',
              source: 'feature-map',
              text:
                '### Split\n- Where: Editor › Timeline › tool strip\n- Does: Splits the selected clip at the playhead into two clips.\n' +
                '- SDK: `studio.clips.split`\n- Code: `src/features/timeline/components…',
              location: 'docs/feature-map/timeline.md#tool-strip',
              score: 3.315,
            },
            {
              title: 'studio.clips.split',
              source: 'sdk',
              text:
                'Splits a clip at a timeline frame. One undo step.\nsplit(id: ClipId, frame: Frame): [ClipId, ClipId]\n' +
                "Example: const [left, right] = studio.clips.split('c1', 240)",
              location: 'src/studio/sdk/reference/sdk-reference.json',
              score: 3.245,
            },
          ],
        }),
      },
    ],
  },
}

/** A `run` call: a synchronous script with one edit, in one undo step. */
export const RUN_REQUEST = {
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: { name: 'run', arguments: { script: 's => { s.edit(); return 42 }', label: 'fixture' } },
}

/** The answer to `RUN_REQUEST`; `durationMs` is measured, so tests ignore it. */
export const RUN_RESULT = {
  jsonrpc: '2.0',
  id: 4,
  result: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          value: 42,
          changes: {
            commands: [{ type: 'EDIT' }],
            added: [],
            removed: [],
            updated: [],
            undoSteps: 1,
          },
          undoSteps: 1,
          durationMs: 3,
        }),
      },
    ],
  },
}

/** A `frame` call: one frame, at 1280 px. */
export const FRAME_REQUEST = {
  jsonrpc: '2.0',
  id: 5,
  method: 'tools/call',
  params: { name: 'frame', arguments: { frame: 42, width: 1280 } },
}

/** An `export` call: a poll of one job. */
export const EXPORT_REQUEST = {
  jsonrpc: '2.0',
  id: 6,
  method: 'tools/call',
  params: { name: 'export', arguments: { jobId: 'job-fixture' } },
}

/** Two recorded agent-log lines, one per outcome. */
export const LOG_LINES = [
  {
    at: '2026-11-18T10:00:00.000Z',
    tool: 'run',
    argsHash: '2e4bc7cd686f9a3703fea8c9d72eb521a80f9825aa14ac183bd389d2290d52a3',
    summary: 'run "fixture" (28 byte script)',
    durationMs: 4,
    code: 'OK',
    undoSteps: 1,
  },
  {
    at: '2026-11-18T10:00:01.000Z',
    tool: 'frame',
    argsHash: '2a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0',
    summary: 'frame frame 42',
    durationMs: 1,
    code: 'UNSUPPORTED',
    error: 'frame: this editor page has no frame renderer installed',
  },
]

/** The session the fake socket server replays, request by request. */
export const SESSION = [
  { request: INITIALIZE_REQUEST, response: INITIALIZE_RESULT },
  { request: INITIALIZED_NOTIFICATION, response: null },
  { request: TOOLS_LIST_REQUEST, response: TOOLS_LIST_RESULT },
  { request: SEARCH_REQUEST, response: SEARCH_RESULT },
]

/** The keys every recorded object must have; the contract test names a missing one. */
export const MESSAGE_KEYS = {
  INITIALIZE_REQUEST: ['id', 'jsonrpc', 'method', 'params'],
  INITIALIZE_PARAMS: ['capabilities', 'clientInfo', 'protocolVersion'],
  INITIALIZE_RESULT: ['id', 'jsonrpc', 'result'],
  INITIALIZED_NOTIFICATION: ['jsonrpc', 'method'],
  TOOLS_LIST_REQUEST: ['id', 'jsonrpc', 'method'],
  TOOLS_LIST_RESULT: ['id', 'jsonrpc', 'result'],
  TOOLS_LIST_TOOL: ['description', 'inputSchema', 'name', 'title'],
  SEARCH_REQUEST: ['id', 'jsonrpc', 'method', 'params'],
  SEARCH_ARGUMENTS: ['limit', 'query'],
  SEARCH_RESULT: ['id', 'jsonrpc', 'result'],
  RUN_REQUEST: ['id', 'jsonrpc', 'method', 'params'],
  RUN_ARGUMENTS: ['label', 'script'],
  RUN_RESULT: ['id', 'jsonrpc', 'result'],
  FRAME_REQUEST: ['id', 'jsonrpc', 'method', 'params'],
  EXPORT_REQUEST: ['id', 'jsonrpc', 'method', 'params'],
  SETTINGS_ON: ['enabled', 'version'],
  SETTINGS_OFF: ['enabled', 'version'],
  LOG_LINE_RUN: ['argsHash', 'at', 'code', 'durationMs', 'summary', 'tool', 'undoSteps'],
  LOG_LINE_FRAME: ['argsHash', 'at', 'code', 'durationMs', 'error', 'summary', 'tool'],
  SEARCH_HIT: ['location', 'score', 'source', 'text', 'title'],
}

/** The answer for one request: the recorded response, or a JSON-RPC error. */
function replyTo(message) {
  const entry = SESSION.find(
    (item) =>
      item.response !== null &&
      item.request.method === message.method &&
      item.request.id === message.id,
  )
  if (entry) return entry.response
  if (message.id === undefined) return null
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }
}

/** One helper that turns a client's byte chunks into replies. */
function createLineHandler(socket) {
  let buffer = ''
  const handleLine = (line) => {
    if (line.trim().length === 0) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      socket.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      )
      return
    }
    const response = replyTo(message)
    if (response !== null) socket.write(`${JSON.stringify(response)}\n`)
  }
  return (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
}

/**
 * Start a fake MCP server on `socketPath` that replays `SESSION`. It is a real
 * `net` server, so the launcher can be tested with its real pipes and no app.
 */
export async function createFakeSocketServer(socketPath) {
  fs.rmSync(socketPath, { force: true })
  fs.mkdirSync(path.dirname(socketPath), { recursive: true })
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('data', createLineHandler(socket))
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    close() {
      return new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        server.close(() => {
          fs.rmSync(socketPath, { force: true })
          resolve()
        })
      })
    },
  }
}
