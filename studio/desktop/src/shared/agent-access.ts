/**
 * The Agent access bridge of the desktop shell (task 2.2 slice 6): the page's
 * way to read and change "Allow AI agents", the switch that starts and stops the
 * MCP socket.
 *
 * The main process registers the four channels (`main/mcp/ipc.ts`) and the page
 * reaches them through `window.dronecleanAgentAccess`, exposed by the second
 * preload `preload/agent-access.ts`. That preload is registered on the session
 * by `main/index.ts`, not imported by `preload/index.ts`: a sandboxed preload's
 * `require` resolves `electron` and little else (measured: a sibling file fails
 * with "module not found"), so it writes the channel names out.
 * `test/agent-access.test.mjs` holds the compiled preload and this module
 * together, the way `test/native-media.test.mjs` holds the native media names.
 */

import type { AgentLogLine } from '../../../mcp/protocol'

/** Whether the socket should be up: off while the setting is off, `conflict` when another process owns it. */
export type AgentAccessStatus = 'off' | 'on' | 'conflict' | 'error'

/** The four IPC channels, shared by the main process and the test. */
export const AGENT_ACCESS_CHANNELS = {
  status: 'agentAccess:status',
  enable: 'agentAccess:enable',
  disable: 'agentAccess:disable',
  log: 'agentAccess:log',
} as const

/** What the page reads after every call: the setting, the socket and why it failed. */
export interface AgentAccessInfo {
  /** Whether `userData/agent-access.json` says on. */
  enabled: boolean
  /** Whether the socket is up right now. */
  status: AgentAccessStatus
  /** The per-user socket (or the Windows pipe) the launcher connects to. */
  socketPath: string
  /** Absolute path of the stdio launcher wrapper the panel's snippets name. */
  launcherPath: string
  /** Why a turn-on failed, when it did; absent on success. */
  error?: string
}

/** What `window.dronecleanAgentAccess` offers the page. */
export interface DesktopAgentAccess {
  /** The shape this bridge speaks; the page ignores one it does not know. */
  readonly version: 1
  /** Read the setting and the socket's state; changes nothing. */
  status(): Promise<AgentAccessInfo>
  /** Turn "Allow AI agents" on and start the socket; a second call is a no-op. */
  enable(): Promise<AgentAccessInfo>
  /** Turn it off and remove the socket; the setting stays off across launches. */
  disable(): Promise<AgentAccessInfo>
  /** The last 50 calls, oldest first; empty when nothing was called yet. */
  log(): Promise<AgentLogLine[]>
}

declare global {
  interface Window {
    /** Installed by `preload/agent-access.ts`; absent in a shell that predates it. */
    dronecleanAgentAccess?: DesktopAgentAccess
  }
}
