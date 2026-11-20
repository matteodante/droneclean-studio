/**
 * The MCP server's Electron wiring (task 2.2).
 *
 * `studio/desktop/src/main/index.ts` owns the app lifecycle and the window, so
 * it installs this module with one call after `createWindow()`:
 *
 *     const access = await installAgentAccess(() => mainWindow, showMainWindow)
 *
 * Nothing else in the shell changes for the server itself. `installAgentAccess`
 * starts the socket only when "Allow AI agents" is on; `agentAccess.enable()`,
 * `.disable()` and `.status()` are what the Agent access panel drives through
 * the IPC in `ipc.ts`.
 *
 * The search corpora are read from the working copy's `studio/` folder in
 * development; a packaged app needs them copied next to `Resources/dist` (the
 * exact `electron-builder.yml` lines are reported with this task), so a missing
 * folder only warns and leaves the other corpora searchable.
 */
import { app, type BrowserWindow } from 'electron'
import path from 'node:path'
import { IDLE_QUIT_MS, createIdleQuit, saveBeforeQuit } from './idle-quit'
import { createPageBridge } from './page'
import { corpusRootsFor, loadCorpusDocuments, type CorpusRoots } from './search/corpus'
import type { SearchDocument } from './search/bm25'
import { createAgentAccess, type AgentAccess } from './server'
import { heldWorkspaceFolder } from '../workspace-lock'

/** Where the three corpora are for this launch. */
function studioCorpusRoots(): CorpusRoots {
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, 'corpus')
    return {
      sdkReference: path.join(base, 'sdk-reference.json'),
      guideDir: path.join(base, 'guide'),
      featureMapDir: path.join(base, 'feature-map'),
    }
  }
  return corpusRootsFor(path.resolve(app.getAppPath(), '..'))
}

/**
 * Load the corpora, reporting (not failing on) a source that was not packaged.
 * A missing source leaves the others indexed; `search` still answers.
 */
async function loadDocumentsForSearch(): Promise<SearchDocument[]> {
  const load = await loadCorpusDocuments(studioCorpusRoots())
  if (load.missing.length > 0) {
    console.warn(`[mcp] search corpus missing: ${load.missing.join(', ')}`)
  }
  return load.documents
}

/**
 * Create and start the agent access of this launch. The page is the one window;
 * a tool called before it exists answers `UNSUPPORTED` and says the editor is
 * still starting. `before-quit` removes the socket without touching the
 * setting, so the next launch starts it again.
 *
 * `showWindow` is how a `run` that asks `show: true` brings the window up: the
 * stdio launcher starts the app hidden, and the agent is the one that decides
 * when the user should see the edit. `startedForAgent` is that hidden launch:
 * such an app quits when idle, unless a window was shown (`idle-quit.ts`).
 */
export async function installAgentAccess(
  getWindow: () => BrowserWindow | null,
  showWindow: () => void = () => undefined,
  options: { startedForAgent?: boolean } = {},
): Promise<AgentAccess> {
  const page = createPageBridge(getWindow, { showWindow })
  // An app the launcher started hidden quits, after saving, when no client has
  // used it for a while and its window was never shown (`idle-quit.ts`).
  const idle = createIdleQuit({
    startedForAgent: options.startedForAgent === true,
    idleMs: IDLE_QUIT_MS,
    save: () => saveBeforeQuit(page),
    quit: () => app.quit(),
  })
  app.on('browser-window-created', (_event, window) => {
    window.on('show', () => idle.windowShown())
  })
  const access = createAgentAccess({
    userDataDir: app.getPath('userData'),
    page,
    loadDocuments: loadDocumentsForSearch,
    showWindow,
    onActivity: (event) => idle.activity(event),
    workspaceFolder: heldWorkspaceFolder,
  })
  await access.startIfEnabled()
  app.on('before-quit', () => {
    idle.dispose()
    void access.dispose()
  })
  return access
}

export { createAgentAccess, type AgentAccess, type AgentAccessStatus } from './server'
export { agentAccessSettingsPath, agentLogDir, agentLogPath, socketPathFor } from './protocol'
export type {
  AgentAccessSettings,
  AgentLogLine,
  ExportRequest,
  ExportResult,
  FrameRequest,
  FrameResult,
  RunRequest,
  RunResult,
  SearchRequest,
  SearchResult,
} from '../../../../mcp/protocol'
