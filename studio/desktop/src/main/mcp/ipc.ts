/**
 * The Agent access IPC (task 2.2 slices 6 and 7): the page's switch for "Allow
 * AI agents", which starts and stops the MCP socket (design §0 decision 3), and
 * the read of the last calls the server logged.
 *
 * `main/index.ts` registers it once, after `installAgentAccess`, and the page
 * calls it through `window.dronecleanAgentAccess` (`preload/agent-access.ts`).
 * The panel that shows the switch and the log is `src/features/settings/…`
 * (`agent-access-panel.tsx`).
 *
 * A turn-on that fails (another process owns the socket, the folder is not
 * writable) answers the state it is in with the message in `error` instead of
 * rejecting: the setting and the socket are then read again, and the panel can
 * say what went wrong without a second call. The launcher path is computed here
 * because only the main process knows where this launch's resources are.
 */
import { app, ipcMain } from 'electron'
import { AGENT_ACCESS_CHANNELS, type AgentAccessInfo } from '../../shared/agent-access'
import { appOnly } from '../sender'
import { launcherPathFor } from './launcher-path'
import { PANEL_LOG_LINES, readAgentLogTail } from './log'
import { agentLogDir } from './protocol'
import type { AgentAccess } from './server'

/** The wrapper the panel's snippets name for this launch. */
function launcherPath(): string {
  return launcherPathFor({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
}

/** The state the page reads, plus the failure of a turn-on or turn-off. */
function infoOf(access: AgentAccess, error?: string): AgentAccessInfo {
  return {
    enabled: access.isEnabled(),
    status: access.status(),
    socketPath: access.socketPath,
    launcherPath: launcherPath(),
    ...(error !== undefined && { error }),
  }
}

/** Turn the setting on or off and answer the state, including the failure if there is one. */
async function change(access: AgentAccess, turn: 'on' | 'off'): Promise<AgentAccessInfo> {
  try {
    if (turn === 'on') await access.enable()
    else await access.disable()
    return infoOf(access)
  } catch (error) {
    return infoOf(access, error instanceof Error ? error.message : String(error))
  }
}

/** Register the four channels. Called once per launch; `ipcMain.handle` replaces, never doubles. */
export function installAgentAccessIpc(access: AgentAccess): void {
  ipcMain.handle(
    AGENT_ACCESS_CHANNELS.status,
    appOnly(() => infoOf(access)),
  )
  ipcMain.handle(
    AGENT_ACCESS_CHANNELS.enable,
    appOnly(() => change(access, 'on')),
  )
  ipcMain.handle(
    AGENT_ACCESS_CHANNELS.disable,
    appOnly(() => change(access, 'off')),
  )
  ipcMain.handle(
    AGENT_ACCESS_CHANNELS.log,
    appOnly(() => readAgentLogTail(agentLogDir(app.getPath('userData')), PANEL_LOG_LINES)),
  )
}
