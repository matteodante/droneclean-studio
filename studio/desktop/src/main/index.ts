/**
 * Main process of DroneClean Studio's desktop shell.
 *
 * One window, the built editor served from `droneclean://app/` (so the origin and
 * with it IndexedDB, OPFS and file handles are the same on every launch), a
 * persistent profile in `~/Library/Application Support/DroneClean Studio`, and an
 * explicit permission policy instead of Electron's grant-everything default.
 *
 * Two launches have nothing in common with an ordinary one:
 *
 * - `--mcp` is how `studio/mcp/launcher.mjs` starts the app for an MCP client
 *   (task 2.2, design §4.9): the window is created hidden and stays hidden until
 *   an agent asks for it (`run({ show: true })`) or the user opens the app.
 * - A second launch forwards to the one process that holds
 *   `requestSingleInstanceLock()` and shows its window, so one profile has one
 *   owner, one MCP socket and one window.
 *
 * `DRONECLEAN_USER_DATA` moves the profile (the proof runs and the e2e use a
 * throwaway one); the MCP launcher reads the same variable. That variable,
 * `DRONECLEAN_DEV_URL` and `DRONECLEAN_FFMPEG` are read only by an unpackaged
 * run (`launch-env.ts`).
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  systemPreferences,
  type Session,
} from 'electron'
import path from 'node:path'
import { installAgentAccess } from './mcp'
import { installAgentAccessIpc } from './mcp/ipc'
import { EXPORT_FILE_SCHEME_PRIVILEGES, registerExportFileProtocol } from './export-file-protocol'
import { NATIVE_ENCODE_SCHEME_PRIVILEGES, registerNativeEncodeProtocol } from './media/encode-protocol'
import { NATIVE_FRAME_SCHEME_PRIVILEGES, registerNativeFrameProtocol } from './media/frame-protocol'
import { configureFfmpegOverride } from './media/ffmpeg'
import { decideExternalLink, isGuideUrl } from './external-links'
import { decidePermissionCheck, decidePermissionRequest } from './permissions'
import { resolveLaunchEnvironment } from './launch-env'
import { APP_HOST, APP_SCHEME, APP_URL } from './protocol'
import { registerAppProtocol } from './protocol-handler'
import { isAppUrl, trustDevUrl } from './sender'
import { installMicrophoneIpc } from './microphone'
import { ShadowSession, installShadowSessionIpc } from './shadow-session'
import { installWorkspaceOwnerLock, observeWorkspaceAccess } from './workspace-lock'
import { createMainTelemetry, installMainTelemetry } from './telemetry'
import { createUpdateChecker, installUpdatesIpc, scheduleUpdateCheck } from './updates'

/**
 * The product name, read before any `setName`. The packaged test variant
 * (`npm run package:test`) is the same build named "DroneClean Studio Test", and
 * its profile folder follows that name, so it never shares the real one (review
 * finding E1). Any other name keeps the real app's `DroneClean Studio`.
 */
const TEST_APP_NAME = 'DroneClean Studio Test'
const APP_NAME = app.getName() === TEST_APP_NAME ? TEST_APP_NAME : 'DroneClean Studio'

/** What this launch may take from the environment: nothing, in a packaged app (finding D5). */
const LAUNCH = resolveLaunchEnvironment(process.env, app.isPackaged)

/** `npm run dev` starts Electron with this set, pointing at `vp dev`. */
const DEV_URL = LAUNCH.devUrl
trustDevUrl(DEV_URL)
configureFfmpegOverride(LAUNCH.allowFfmpegOverride)

/** The flag `studio/mcp/launcher.mjs` starts the app with; it keeps the window hidden. */
const MCP_LAUNCH_FLAG = '--mcp'

/** Whether this launch is the one the MCP launcher started for a client. */
const STARTED_FOR_MCP = process.argv.slice(1).includes(MCP_LAUNCH_FLAG)

app.setName(APP_NAME)
// Explicit rather than the default: the profile must be the same folder for the dev
// run and the packaged app, so a project opened in one is there in the other.
// `DRONECLEAN_USER_DATA` moves it for a throwaway profile (the MCP proof and the
// e2e); the launcher resolves the same folder from the same variable.
app.setPath('userData', LAUNCH.userData ?? path.join(app.getPath('appData'), APP_NAME))

// Opt-in crash reports and usage statistics (`telemetry/`): the user's answer is read now, so an
// error from here on is reported if, and only if, the user switched reports on.
const telemetry = createMainTelemetry({
  userDataDir: app.getPath('userData'),
  context: { version: app.getVersion(), platform: process.platform },
  fetch: (url, init) => net.fetch(url, init),
})
installMainTelemetry(app, ipcMain, telemetry)

// "A new version is available" (`updates/`): one GET to GitHub's latest-release address, once a day
// at most, switched off in Settings › Privacy. It is the one request the user did not ask for, by
// Matteo's decision of 21 Nov 2026 (the app is unsigned, so it cannot update itself); off means none.
const updates = createUpdateChecker({
  userDataDir: app.getPath('userData'),
  appVersion: app.getVersion(),
  fetch: (url, init) => net.fetch(url, init),
})
installUpdatesIpc(ipcMain, updates, (url) => shell.openExternal(url))

// Ask Chromium for the high-performance GPU (task 8.1). On a machine with an
// integrated and a discrete GPU the default is the integrated one, which is the
// wrong one for WebGPU rendering and export; this makes the GPU process pick the
// discrete one (Chromium: `kForceHighPerformanceGPU` in `gpu/config/gpu_switches.cc`,
// turned into the `force_high_performance_gpu` workaround in
// `content/browser/gpu/gpu_process_host.cc`, read in `gpu/ipc/service/gpu_init.cc`).
// It must be set before `ready`; on a machine with one GPU it changes nothing.
app.commandLine.appendSwitch('force-high-performance-gpu')

// Must happen before `ready`, and in one call: a second call replaces this list
// rather than adding to it (measured on Electron 45). No `allowServiceWorkers`: the
// editor registers a service worker in production, it fails here, and `main.tsx`
// only logs a warning.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
  NATIVE_FRAME_SCHEME_PRIVILEGES,
  NATIVE_ENCODE_SCHEME_PRIVILEGES,
  EXPORT_FILE_SCHEME_PRIVILEGES,
])

/** The built editor: bundled next to the app's code, or `studio/dist` in a working copy. */
function editorDistDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.resolve(__dirname, '../../../dist')
}

/** The one window; null before it exists and after the user closed it. */
let mainWindow: BrowserWindow | null = null

function isAllowedNavigation(rawUrl: string): boolean {
  return isAppUrl(rawUrl, DEV_URL)
}

function installPermissionPolicy(target: Session): void {
  target.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    // Electron passes one of several request shapes; the policy only declares the
    // fields it reads, so each shape is narrowed here rather than cast as a whole.
    let granted = false
    if (permission === 'fileSystem') {
      const fileSystem = details as Electron.FilesystemPermissionRequest
      granted = decidePermissionRequest(permission, fileSystem)
      console.log(
        `[desktop] fileSystem request ${fileSystem.fileAccessType ?? '?'} ` +
          `${fileSystem.isDirectory ? 'folder' : 'file'} ${fileSystem.filePath ?? '?'} -> ${granted}`,
      )
    } else if (permission === 'media') {
      // The microphone is for the editor's own page only: a frame of any other
      // origin (an embedded page, a stray navigation) is refused.
      const media = details as Electron.MediaAccessPermissionRequest
      granted = isAppUrl(media.requestingUrl, DEV_URL) && decidePermissionRequest(permission, media)
    } else {
      granted = decidePermissionRequest(permission)
    }
    // Exactly one answer on every path: a request left unanswered keeps the page's
    // `getUserMedia` waiting for ever.
    callback(granted)
  })

  target.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    const granted = decidePermissionCheck(permission, details)
    // The workspace folder's only real path in the main process: a granted
    // directory is the folder the page is being let into (design §4.10, and the
    // comment in `workspace-lock.ts`).
    observeWorkspaceAccess(granted, permission, details)
    return granted
  })

  // No `file-system-access-restricted` listener, on purpose: a path Chromium
  // blocks (system folders, the home folder itself) stays blocked, and the picker
  // fails for it as in any Chromium browser. Answering `allow` for every path
  // would turn the picker into a way to hand the page a system folder (D3).
}

/**
 * `preload/agent-access.ts` beside the window's preload: it exposes
 * `window.dronecleanAgentAccess`, the page's switch for "Allow AI agents".
 *
 * It is registered on the session because a sandboxed preload cannot import a
 * sibling file, and it is scoped to the editor's own origin so no other page of
 * this session (a dev iframe, a site the editor links to) gets the switch.
 */
function installAgentAccessPreload(target: Session): void {
  const origin = DEV_URL ? new URL(DEV_URL).origin : `${APP_SCHEME}://${APP_HOST}`
  target.registerPreloadScript({
    id: 'droneclean-agent-access',
    type: 'frame',
    filePath: path.join(__dirname, '../preload/agent-access.js'),
    includeGlobs: [`${origin}/*`],
  })
  // `window.dronecleanUpdates`, the page's way to the new-version notice and its switch, on the same terms.
  target.registerPreloadScript({
    id: 'droneclean-updates',
    type: 'frame',
    filePath: path.join(__dirname, '../preload/updates.js'),
    includeGlobs: [`${origin}/*`],
  })
  // `window.dronecleanTelemetry`, the page's way to the opt-in reports' answer, on the same terms.
  target.registerPreloadScript({
    id: 'droneclean-telemetry',
    type: 'frame',
    filePath: path.join(__dirname, '../preload/telemetry.js'),
    includeGlobs: [`${origin}/*`],
  })
}

/**
 * Open the window. `hidden` is a `--mcp` launch: the window exists and the page
 * loads (the editor and the SDK need it), but `ready-to-show` does not show it.
 */
function createWindow(hidden = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#111827',
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // The editor edits video, not prose; spellcheck would load dictionaries, and
      // on Windows download them (finding C16).
      spellcheck: false,
    },
  })

  mainWindow = window
  window.once('ready-to-show', () => {
    if (!hidden) window.show()
  })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // Links leave the app: an https page of a host the editor links to opens in the system browser
  // (`external-links.ts`); the user guide, which the toolbar opens "in a new tab", opens in this window, as the
  // workspace splash's guide links do (its "Open Studio" leads back); anything else is dropped and the log says why.
  // No second window of the app is ever opened.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isGuideUrl(url, DEV_URL)) {
      void window.loadURL(url)
      return { action: 'deny' }
    }
    const link = decideExternalLink(url)
    if (link.open) void shell.openExternal(link.url)
    else console.warn(`[desktop] a link was not opened: ${link.reason}`)
    return { action: 'deny' }
  })

  // A renderer that dies leaves a blank window and no page log: the main log says why.
  // The agent bridge reloads such a page on its next call (`mcp/page.ts`).
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[desktop] the editor page's renderer is gone: ${details.reason} (exit code ${details.exitCode})`,
    )
  })

  // The window only ever shows the editor's own origin.
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault()
  })

  void window.loadURL(DEV_URL ?? APP_URL)
  return window
}

/**
 * Bring the editor window up: a dock click, a second launch, or an agent's
 * `run({ show: true })`. A closed window is opened again, which is what the
 * macOS lifecycle allows and what the agent expects to see.
 */
function showMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// One process per profile. The losing launch quits before it creates a window:
// two processes would race for the profile, the MCP socket and the workspace.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  void app.whenReady().then(async () => {
    const media = registerAppProtocol(editorDistDir())
    registerNativeFrameProtocol(media)
    registerNativeEncodeProtocol()
    registerExportFileProtocol()
    installShadowSessionIpc(
      new ShadowSession({ dir: app.getPath('userData'), storage: safeStorage }),
    )
    installMicrophoneIpc(systemPreferences)
    installPermissionPolicy(session.defaultSession)
    installAgentAccessPreload(session.defaultSession)
    installWorkspaceOwnerLock(session.defaultSession, DEV_URL)

    // The agent access and its IPC come first, and the window after them: the
    // page can call the IPC as soon as it loads, and anything awaited between
    // `createWindow` and `installAgentAccessIpc` is time in which it would find no
    // handler (finding D9). A tool called before the page exists already answers
    // "the editor is still starting".
    try {
      installAgentAccessIpc(
        await installAgentAccess(() => mainWindow, showMainWindow, {
          startedForAgent: STARTED_FOR_MCP,
          onAgentConnected: () => telemetry.agentConnected(),
        }),
      )
    } catch (error) {
      // The editor works without agent access; the window must still open.
      console.error('[desktop] agent access did not start:', error)
    }

    app.on('activate', () => {
      showMainWindow()
    })
    const window = createWindow(STARTED_FOR_MCP)
    // Only the installed app asks: not an agent's hidden launch, a development run, or the e2e's test app.
    if (app.isPackaged && !STARTED_FOR_MCP && APP_NAME !== TEST_APP_NAME) scheduleUpdateCheck(window, updates)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
