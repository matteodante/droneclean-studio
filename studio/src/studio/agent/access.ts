/**
 * The Agent access bridge of the desktop shell, as the editor page sees it
 * (task 2.2 slice 7).
 *
 * The shell's second preload (`studio/desktop/src/preload/agent-access.ts`)
 * exposes `window.dronecleanAgentAccess` on the editor's own origin only; this
 * module is the page's one way to it, and the Agent access panel
 * (`src/features/settings/components/agent-access-panel.tsx`) is its only
 * caller. The shapes mirror `studio/desktop/src/shared/agent-access.ts`, which
 * the page cannot import, the way `src/studio/desktop/bridge.ts` mirrors the
 * desktop bridge.
 *
 * `version` is the shell's handshake (`bridge.ts` uses the same one): a page
 * that does not know the shape it finds ignores the bridge instead of calling
 * methods that may mean something else. In the browser there is no bridge at
 * all, and the panel is not offered.
 */
import type { AgentLogLine } from '../../../mcp/protocol'

export type { AgentLogLine }

/** Whether the socket should be up: off while the setting is off, `conflict` when another process owns it. */
type AgentAccessStatus = 'off' | 'on' | 'conflict' | 'error'

/** What the panel reads after every call: the setting, the socket and why it failed. */
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
interface AgentAccessBridge {
  /** The shape this bridge speaks; the page ignores one it does not know. */
  readonly version: 1
  /** Read the setting and the socket's state; changes nothing. */
  status(): Promise<AgentAccessInfo>
  /** Turn "Allow AI agents" on and start the socket; a second call is a no-op. */
  enable(): Promise<AgentAccessInfo>
  /** Turn it off and remove the socket; the setting stays off across launches. */
  disable(): Promise<AgentAccessInfo>
  /** The last `PANEL_LOG_LINES` calls, oldest first; empty when nothing was called. */
  log(): Promise<AgentLogLine[]>
}

declare global {
  interface Window {
    /** Installed by the shell's `preload/agent-access.ts`; absent in the browser. */
    dronecleanAgentAccess?: AgentAccessBridge
  }
}

/** The desktop bridge when the editor runs inside the desktop shell, otherwise undefined. */
export function getAgentAccess(): AgentAccessBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.dronecleanAgentAccess
  return bridge?.version === 1 ? bridge : undefined
}

/** Whether the Agent access panel can be offered in this shell. */
export function hasAgentAccess(): boolean {
  return getAgentAccess() !== undefined
}
