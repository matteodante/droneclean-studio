/**
 * An app the MCP launcher started quits when nobody uses it (task 11.15).
 *
 * `studio/mcp/launcher.mjs` starts the app hidden when a client connects, so
 * even a health check (`claude mcp get`) left a hidden app running. This
 * watcher ends that: while the app was started for an agent and its window has
 * never been shown, it waits for the app to be idle (no MCP client connected and
 * no call running) for `idleMs`, then saves the open project and quits. Any
 * connection, call or window show cancels the wait; an app the user opened, or
 * whose window was shown (by the user or by `run({ show: true })`), never quits
 * by itself.
 *
 * The module has no Electron import and takes its timer as an argument, so its
 * tests run under plain Node with a fake clock.
 */
import { PageUnavailableError, SAVE_PROJECT_SCRIPT } from './page'
import type { PageBridge } from './types'

/** Minutes of idleness after which a hidden, agent-started app quits. */
export const IDLE_QUIT_MS = 10 * 60_000

/** How long the save before quitting may take. */
const SAVE_BEFORE_QUIT_MS = 15_000

/** What the server tells the watcher. */
export type AgentActivity = 'client-connected' | 'client-closed' | 'call-started' | 'call-ended'

/** The inputs of the decision. */
export interface IdleState {
  /** The app was started by the MCP launcher (`--mcp`). */
  readonly startedForAgent: boolean
  /** A window has been shown since the launch. */
  readonly windowShown: boolean
  /** MCP clients connected right now. */
  readonly clients: number
  /** Tool calls running right now. */
  readonly calls: number
}

/**
 * Whether the app is idle in the sense that starts the quit timer: it was
 * started for an agent, no window was ever shown, and nobody is connected or
 * calling.
 */
export function isIdleForQuit(state: IdleState): boolean {
  return state.startedForAgent && !state.windowShown && state.clients === 0 && state.calls === 0
}

/** The timer the watcher uses; `setTimeout` and `clearTimeout` in the app. */
export interface IdleTimer {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** What `createIdleQuit` is given. */
export interface IdleQuitOptions {
  /** Whether the app was started by the launcher. */
  startedForAgent: boolean
  /** Idle time before the app quits; {@link IDLE_QUIT_MS} in the app. */
  idleMs: number
  /** Saves the open project; `true` when nothing is left unsaved and the app may quit. */
  save: () => Promise<boolean>
  /** Quits the app. */
  quit: () => void
  /** The timer; the global one when absent. */
  timer?: IdleTimer
}

/** The watcher the server and the window feed. */
export interface IdleQuit {
  /** Something happened at the MCP server. */
  activity(event: AgentActivity): void
  /** A window was shown: the app is the user's now. */
  windowShown(): void
  /** Stop watching (quit). */
  dispose(): void
}

const GLOBAL_TIMER: IdleTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

/**
 * Start watching. The wait begins at once (a hidden launch with no client yet
 * is idle) and restarts whenever the app becomes idle again. When it ends, the
 * project is saved; the app quits only if that save left nothing unsaved,
 * otherwise it waits another `idleMs` and tries again.
 */
export function createIdleQuit(options: IdleQuitOptions): IdleQuit {
  const timer = options.timer ?? GLOBAL_TIMER
  const state = { windowShown: false, clients: 0, calls: 0 }
  let handle: unknown = null
  let disposed = false

  const current = (): IdleState => ({ startedForAgent: options.startedForAgent, ...state })

  function disarm(): void {
    if (handle === null) return
    timer.clear(handle)
    handle = null
  }

  function arm(): void {
    disarm()
    if (disposed || !isIdleForQuit(current())) return
    handle = timer.set(() => {
      handle = null
      void expire()
    }, options.idleMs)
  }

  async function expire(): Promise<void> {
    if (disposed || !isIdleForQuit(current())) return
    const saved = await options.save().catch(() => false)
    // Something came up while the save ran, or the save left edits behind.
    if (disposed || !isIdleForQuit(current())) return
    if (saved) {
      disposed = true
      options.quit()
      return
    }
    arm()
  }

  arm()

  return {
    activity(event) {
      if (event === 'client-connected') state.clients += 1
      else if (event === 'client-closed') state.clients = Math.max(0, state.clients - 1)
      else if (event === 'call-started') state.calls += 1
      else state.calls = Math.max(0, state.calls - 1)
      arm()
    },
    windowShown() {
      state.windowShown = true
      disarm()
    },
    dispose() {
      disposed = true
      disarm()
    },
  }
}

/**
 * Save the open project through the page before the app quits. `true` when
 * nothing is left unsaved: the save went through, no project is open, or there
 * is no page to hold edits. `false` when the save failed or the page did not
 * answer, so the app stays up rather than lose edits.
 */
export async function saveBeforeQuit(page: PageBridge): Promise<boolean> {
  try {
    const answer = await page.execute(SAVE_PROJECT_SCRIPT, SAVE_BEFORE_QUIT_MS)
    return (
      typeof answer === 'object' && answer !== null && (answer as { kept?: unknown }).kept === true
    )
  } catch (error) {
    return error instanceof PageUnavailableError
  }
}
