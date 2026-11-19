/**
 * The Agent access preload of the editor window (task 2.2 slices 6 and 7):
 * exposes `window.dronecleanAgentAccess`, the page's switch for "Allow AI
 * agents" and its view of the last calls.
 *
 * It is a **second** preload, registered on the session by `main/index.ts`
 * (`registerPreloadScript`, scoped to the editor's own origin), because the
 * window's preload (`preload/index.ts`) cannot import a sibling file: a
 * sandboxed preload's `require` resolves `electron` and little else, and a
 * relative import fails at launch with "module not found" (measured on Electron
 * 45.3.4; `test/native-media.test.mjs` guards the same rule). The channel names
 * are therefore written out here and `shared/agent-access.ts` is imported for
 * types only; `test/agent-access.test.mjs` holds the two copies together.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { AgentLogLine } from '../../../mcp/protocol'
import type { AgentAccessInfo, DesktopAgentAccess } from '../shared/agent-access'

/** `shared/agent-access.ts`'s `AGENT_ACCESS_CHANNELS`, written out for the sandbox. */
const CHANNELS = {
  status: 'agentAccess:status',
  enable: 'agentAccess:enable',
  disable: 'agentAccess:disable',
  log: 'agentAccess:log',
} as const

const bridge: DesktopAgentAccess = {
  version: 1,
  status(): Promise<AgentAccessInfo> {
    return ipcRenderer.invoke(CHANNELS.status)
  },
  enable(): Promise<AgentAccessInfo> {
    return ipcRenderer.invoke(CHANNELS.enable)
  },
  disable(): Promise<AgentAccessInfo> {
    return ipcRenderer.invoke(CHANNELS.disable)
  },
  log(): Promise<AgentLogLine[]> {
    return ipcRenderer.invoke(CHANNELS.log)
  },
}

contextBridge.exposeInMainWorld('dronecleanAgentAccess', bridge)
