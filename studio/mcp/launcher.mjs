#!/usr/bin/env node
/**
 * The stdio launcher of DroneClean Studio's MCP server (task 2.2, design §4.1
 * and §4.9).
 *
 * An MCP client configured with this script as its command gets a plain stdio
 * server: the script finds the app's per-user socket, starts the app hidden
 * when it is not running, and pipes its own stdin/stdout to the socket. It has
 * no dependencies and no MCP code — the protocol lives in the app's main
 * process — so it runs under the app's own Electron binary with
 * `ELECTRON_RUN_AS_NODE=1`, and under any Node ≥ 18.
 *
 * stdout carries only MCP frames; every message goes to stderr. It exits with
 * the codes `studio/mcp/protocol.d.ts` declares:
 *
 *   0  the client closed stdin; the round trip ended normally
 *   1  "Allow AI agents" is off in the app; nothing was started
 *   2  the app is not installed, could not be started, or did not answer
 *   3  the app's socket closed while the client was still connected
 *
 * `DRONECLEAN_APP_BINARY` names the app binary when it is not in the default
 * install location (the tests use it; a user with a moved app can too).
 * `DRONECLEAN_USER_DATA` names the profile when it is not Electron's default
 * folder (the proof runs and the e2e use a throwaway one); the app reads the
 * same variable.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** The values the contract test compares with `studio/mcp/fixture.mjs`. */
export const LAUNCHER_CONSTANTS = Object.freeze({
  socketFileName: 'mcp.sock',
  windowsPipePrefix: '\\\\.\\pipe\\droneclean-studio-mcp-',
  settingsFileName: 'agent-access.json',
  launcherWaitMs: 15000,
  launcherPollMs: 200,
  exitOk: 0,
  exitAgentAccessOff: 1,
  exitAppUnreachable: 2,
  exitSocketClosed: 3,
})

const {
  socketFileName,
  windowsPipePrefix,
  settingsFileName,
  launcherWaitMs,
  launcherPollMs,
  exitOk,
  exitAgentAccessOff,
  exitAppUnreachable,
  exitSocketClosed,
} = LAUNCHER_CONSTANTS

/** One platform's `userData` folder, matching Electron's `app.getPath`. */
const APP_DATA_FOLDERS = {
  darwin: (_env, homedir) => path.posix.join(homedir, 'Library', 'Application Support'),
  win32: (env, homedir) => env.APPDATA || path.win32.join(homedir, 'AppData', 'Roaming'),
  linux: (env, homedir) => env.XDG_CONFIG_HOME || path.posix.join(homedir, '.config'),
}

function appDataFolder(platform, env, homedir) {
  return (APP_DATA_FOLDERS[platform] ?? APP_DATA_FOLDERS.linux)(env, homedir)
}

/** Electron's `app.setName`/`userData` on this platform. */
export function userDataDirFor(
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
) {
  // The same override the app reads (`main/index.ts`): a throwaway profile for
  // the proof runs and the e2e.
  if (env.DRONECLEAN_USER_DATA) return env.DRONECLEAN_USER_DATA
  const folder = appDataFolder(platform, env, homedir)
  return platform === 'win32'
    ? path.win32.join(folder, 'DroneClean Studio')
    : path.posix.join(folder, 'DroneClean Studio')
}

/** The per-user part of the pipe name; the same function as `main/mcp/protocol.ts`'s `pipeUserPart`. */
export function pipeUserPart(userName) {
  return crypto.createHash('sha256').update(userName.toLowerCase()).digest('hex').slice(0, 16)
}

/** The listener the app opens: a socket file, or a named pipe per user on Windows. */
export function socketPathFor(userDataDir, platform = process.platform, userName = os.userInfo().username) {
  return platform === 'win32'
    ? `${windowsPipePrefix}${pipeUserPart(userName)}`
    : path.join(userDataDir, socketFileName)
}

/** `userData/agent-access.json`. */
/**
 * Opt-in crash reports (20 Nov 2026): the app's Sentry project and the app's answer
 * (`desktop/src/shared/telemetry.ts`, `userData/telemetry.json`). Only a failure the launcher did not expect is
 * reported, only when that answer says yes, and without paths or file names; `desktop/test/telemetry.test.mjs` holds
 * these values to the app's.
 */
export const LAUNCHER_TELEMETRY = Object.freeze({
  sentryDsn:
    'https://cc591f18b25bdcf7689a5814e4e4d8ad@o4510946315403264.ingest.de.sentry.io/4512177723474000',
  settingsFileName: 'telemetry.json',
  reportTimeoutMs: 2000,
})

/** Whether the app's stored answer switches crash reports on (a missing or broken file does not). */
export function crashReportsOn(userDataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(userDataDir, LAUNCHER_TELEMETRY.settingsFileName), 'utf8'))
    return value?.version === 1 && value.crashReports === true
  } catch {
    return false
  }
}

/** The app's scrubbing rules (`src/studio/telemetry/scrub.ts`): no absolute paths, no media file names. */
export function scrubLauncherText(text) {
  return text
    .replace(
      /(?:(?:file:\/\/\/?)?\/(?:Users|home|Volumes|private|var|tmp|mnt|media|run|opt|root)(?:\/[^\/\n'"`)\]>,;]*(?=\/))*\/[^\s'"`)\]>,;]*|[A-Za-z]:(?:[\\\/][^\\\/\n'"`)\]>,;]*(?=[\\\/]))*[\\\/][^\s'"`)\]>,;]*|\\\\[^\s'"`)\]>,;]+)/g,
      '<path>',
    )
    .replace(
      /[^\s/\\'"`()[\]<>,;:]+\.(?:mp4|mov|m4v|mkv|avi|mxf|insv|lrv|lrf|mts|m2ts|webm|wav|mp3|m4a|aac|flac|aiff?|ogg|opus|png|jpe?g|heic|webp|gif|dng|tiff?|cube|3dl|srt|vtt|gcsv|bbl|osd|fcpxml|xml|otio|edl|fcproject|zip)\b/gi,
      '<file>',
    )
}

/** The Sentry envelope request of a launcher failure. */
export function launcherCrashRequest(error, platform = process.platform) {
  const [, scheme, key, host, project] = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(LAUNCHER_TELEMETRY.sentryDsn)
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    logger: 'droneclean-studio.launcher',
    environment: 'studio-desktop',
    level: 'error',
    tags: { app: 'studio', where: 'launcher', os: platform },
    sdk: { name: 'droneclean-studio.launcher', version: '1', settings: { infer_ip: 'never' } },
    exception: {
      values: [
        {
          type: error instanceof Error ? error.name : 'NonError',
          value: scrubLauncherText(error instanceof Error ? error.message : String(error)),
        },
      ],
    },
  }
  return {
    url: `${scheme}://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`,
    body: `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`,
  }
}

/** Report a failure the launcher did not expect, when the user switched crash reports on; never throws. */
export async function reportLauncherCrash(error, userDataDir, send = globalThis.fetch) {
  if (!crashReportsOn(userDataDir)) return false
  try {
    const request = launcherCrashRequest(error)
    await send(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: request.body,
      signal: AbortSignal.timeout(LAUNCHER_TELEMETRY.reportTimeoutMs),
    })
    return true
  } catch {
    return false
  }
}

export function settingsPathFor(userDataDir) {
  return path.join(userDataDir, settingsFileName)
}

/** Whether a parsed settings file is the version-1 "on" object. */
function isEnabledRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.version === 1 &&
    value.enabled === true
  )
}

/**
 * Read the setting the way the app does (`desktop/src/main/mcp/settings.ts`): on when there is no file (the default
 * since 20 Nov 2026), and otherwise on only for the version-1 object that says so; a broken file is off.
 */
function readAgentAccessSetting(filePath) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    return error?.code === 'ENOENT'
  }
  try {
    return isEnabledRecord(JSON.parse(text))
  } catch {
    return false
  }
}

const LINUX_BINARY = 'droneclean-studio'
const MAC_BINARY = '/Applications/DroneClean Studio.app/Contents/MacOS/DroneClean Studio'

/** The Windows install path under `%LOCALAPPDATA%`. */
function windowsBinary(env, homedir) {
  const local = env.LOCALAPPDATA || path.win32.join(homedir, 'AppData', 'Local')
  return path.win32.join(local, 'Programs', 'DroneClean Studio', 'DroneClean Studio.exe')
}

/** Where the app binary is, from the environment or the platform's install path. */
function appBinaryFor(platform = process.platform, env = process.env, homedir = os.homedir()) {
  if (env.DRONECLEAN_APP_BINARY) return env.DRONECLEAN_APP_BINARY
  if (platform === 'win32') return windowsBinary(env, homedir)
  return platform === 'darwin' ? MAC_BINARY : LINUX_BINARY
}

/** An error that carries the launcher's exit code. */
class LauncherError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Resolve to a connected socket, or null when nothing answers this time. */
function connectOnce(socketPath, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath)
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      if (result === null) socket.destroy()
      // Hold the gap until pipeClient attaches its own error listener.
      else result.on('error', () => undefined)
      resolve(result)
    }
    socket.once('connect', () => finish(socket))
    socket.once('error', () => finish(null))
    socket.setTimeout(timeoutMs, () => finish(null))
  })
}

/** Wait up to `waitMs` for the app to open its socket. */async function waitForSocket(socketPath, waitMs = launcherWaitMs, pollMs = launcherPollMs) {
  const deadline = Date.now() + waitMs
  for (;;) {
    const socket = await connectOnce(socketPath)
    if (socket !== null) return socket
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/** The environment the app is started with: never `ELECTRON_RUN_AS_NODE`. */
function appEnvironment(env) {
  // The wrapper scripts run this launcher with `ELECTRON_RUN_AS_NODE=1` under the
  // app's own binary. The app that is then started must not inherit it, or
  // Electron would run as plain Node instead of opening a window.
  const childEnv = { ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  return childEnv
}

/** Start the app hidden (`--mcp`); resolves once the process was spawned, not when it is ready. */
function startApp(binary, env) {
  const child = spawn(binary, ['--mcp'], {
    detached: true,
    stdio: 'ignore',
    env: appEnvironment(env),
  })
  child.on('error', () => undefined)
  child.unref()
}

/** Exit through the process's `exitCode`, so a piped stdout can flush first. */
function finish(code) {
  process.exitCode = code
}

/** Throw the launcher's "not installed" error when the binary is missing. */
function requireBinary(binary) {
  if (!fs.existsSync(binary)) {
    throw new LauncherError(
      exitAppUnreachable,
      `DroneClean Studio was not found at ${binary}. Install the app there, or set DRONECLEAN_APP_BINARY to its binary.`,
    )
  }
}

/** Spawn the app, turning a synchronous spawn failure into the launcher's error. */
function startAppOrThrow(binary, env) {
  try {
    startApp(binary, env)
  } catch (error) {
    throw new LauncherError(
      exitAppUnreachable,
      `DroneClean Studio could not be started: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Start the app hidden and wait for its socket, or throw the launcher's error. */
async function startAndWait(socketPath, binary, env, waitMs, pollMs) {
  requireBinary(binary)
  startAppOrThrow(binary, env)
  const socket = await waitForSocket(socketPath, waitMs, pollMs)
  if (socket === null) {
    throw new LauncherError(
      exitAppUnreachable,
      `DroneClean Studio started but did not answer on ${socketPath} within ${waitMs} ms. Open the app once to finish starting it, then try again.`,
    )
  }
  return socket
}

/** Find the running app, or start it hidden and wait for its socket. */
async function openSocket(socketPath, binary, env, waitMs, pollMs) {
  const running = await connectOnce(socketPath)
  return running === null ? startAndWait(socketPath, binary, env, waitMs, pollMs) : running
}

/** After stdin ends the socket may half-close; the app closes its side on EOF. */
function pipeClient(socket) {
  const state = { stdinEnded: false }
  return new Promise((resolve) => {
    let settled = false
    const done = (code, message) => {
      if (settled) return
      settled = true
      if (message) process.stderr.write(`${message}\n`)
      finish(code)
      resolve(code)
    }
    socket.setNoDelay(true)
    socket.on('error', (error) => {
      done(state.stdinEnded ? exitOk : exitSocketClosed, state.stdinEnded ? '' : `DroneClean Studio: socket error: ${error.message}`)
    })
    socket.on('close', () => {
      done(
        state.stdinEnded ? exitOk : exitSocketClosed,
        state.stdinEnded ? '' : 'DroneClean Studio: the app closed the connection.',
      )
    })
    socket.pipe(process.stdout)
    process.stdout.on('error', () => {
      socket.destroy()
      done(exitOk, '')
    })
    process.stdin.pipe(socket)
    process.stdin.on('error', () => socket.destroy())
    process.stdin.on('end', () => {
      state.stdinEnded = true
      socket.end()
    })
    const stop = () => {
      socket.destroy()
      done(exitOk, '')
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

/** The whole launcher. Returns the exit code instead of calling `process.exit`. */
async function main(
  env = process.env,
  options = {
    userDataDir: userDataDirFor(process.platform, env),
    binary: appBinaryFor(process.platform, env),
    waitMs: launcherWaitMs,
    pollMs: launcherPollMs,
  },
) {
  const socketPath = socketPathFor(options.userDataDir, process.platform)
  if (!readAgentAccessSetting(settingsPathFor(options.userDataDir))) {
    process.stderr.write(
      'DroneClean Studio: agent access is off. Turn on "Allow AI agents" in Settings → Agent access, then try again.\n',
    )
    return exitAgentAccessOff
  }
  let socket
  try {
    socket = await openSocket(
      socketPath,
      options.binary,
      env,
      options.waitMs,
      options.pollMs,
    )
  } catch (error) {
    if (error instanceof LauncherError) {
      process.stderr.write(`${error.message}\n`)
      return error.code
    }
    throw error
  }
  return pipeClient(socket)
}

/**
 * Whether this file is the script the process was started with. Node loads the main module from its real path, so a
 * path through a symlinked folder is resolved the same way before comparing: compared as given, an app reached
 * through a symlink got a launcher that did nothing and exited 0, which a client sees as a closed connection.
 */
export function isEntryScript(argv1, moduleUrl) {
  if (argv1 === undefined) return false
  let entry = path.resolve(argv1)
  try {
    entry = fs.realpathSync(entry)
  } catch {
    // a missing path compares as given
  }
  return moduleUrl === pathToFileURL(entry).href
}

const invokedDirectly = isEntryScript(process.argv[1], import.meta.url)

if (invokedDirectly) {
  main().then(
    (code) => finish(code),
    async (error) => {
      process.stderr.write(
        `DroneClean Studio launcher failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      await reportLauncherCrash(error, userDataDirFor(process.platform, process.env))
      finish(exitAppUnreachable)
    },
  )
}
