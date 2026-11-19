/**
 * The bridge from the MCP server to the editor page (task 2.2, design §4.2).
 *
 * A tool's only way into the app is `webContents.executeJavaScript` on the one
 * window, where `window.studio` (task 2.1) is the SDK. That call measured 0.07 ms
 * per trivial call and 23 ms for a 20 MB string, so everything a tool needs
 * crosses as a string and comes back as JSON. Calls are serialised by
 * `createSerialQueue`, because two scripts writing the stores at once would
 * interleave their undo entries.
 *
 * The Electron window is described structurally here rather than imported, so
 * the server and its tests run under plain Node; `index.ts` passes the real
 * `BrowserWindow`.
 */
import type { PageBridge } from './types'

/**
 * Why the page cannot take a script. `crashed` and `reloaded` are a page that
 * went away: its renderer process died, or its main frame loaded another
 * document while a call ran. Either way the page's memory is gone (the open
 * project, the undo history, edits no save wrote).
 */
export type PageUnavailableReason = 'no-window' | 'starting' | 'no-workspace' | 'crashed' | 'reloaded'

/**
 * The page cannot take a script: no window, the editor is still starting, it
 * has no workspace folder yet, or it crashed or reloaded. The tools answer the
 * first three as `UNSUPPORTED` and a page that went away as `INTERNAL`
 * (`tools/page-failure.ts`).
 */
export class PageUnavailableError extends Error {
  readonly reason: PageUnavailableReason

  constructor(message: string, reason: PageUnavailableReason = 'no-window') {
    super(message)
    this.name = 'PageUnavailableError'
    this.reason = reason
  }
}

/** The page did not answer in time: its main thread is busy or the script hangs. */
export class PageTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageTimeoutError'
  }
}

/**
 * An earlier script is still running in the page (it timed out or was
 * cancelled, but JavaScript cannot be interrupted), so a new one would
 * interleave its edits with it. The tools answer it as `CONFLICT`.
 */
export class PageBusyError extends Error {
  constructor(message = 'a previous script is still running in the editor') {
    super(message)
    this.name = 'PageBusyError'
  }
}

/** What Electron's `render-process-gone` reports about a renderer that ended. */
export interface PageGoneDetails {
  reason: string
  exitCode: number
}

/** What Electron's `did-start-navigation` reports about a navigation. */
export interface PageNavigationDetails {
  isMainFrame: boolean
  isSameDocument: boolean
}

/**
 * The parts of `BrowserWindow` the bridge reads. Everything but
 * `executeJavaScript` is optional so a test page can leave it out; the real
 * window has all of it.
 */
export interface PageWindow {
  isDestroyed?(): boolean
  webContents: {
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
    /** Whether the page's renderer process is gone (Electron's `isCrashed()`). */
    isCrashed?(): boolean
    /** Load the page again: the only way a crashed renderer comes back. */
    reload?(): void
    on?(
      event: 'render-process-gone',
      listener: (event: unknown, details: PageGoneDetails) => void,
    ): unknown
    on?(event: 'did-start-navigation', listener: (details: PageNavigationDetails) => void): unknown
  }
}

/** How the bridge waits for the page. */
export interface PageBridgeOptions {
  /** Shows the window; called when the app has no workspace folder to work on. */
  showWindow?: () => void
  /** How long a call waits for `window.studio` (design §4.9: 20 s). */
  readyTimeoutMs?: number
  /** How often the wait asks the page (design §4.9: 200 ms). */
  pollMs?: number
}

/** The wait of design §4.9. */
export const PAGE_READY_TIMEOUT_MS = 20_000

/** How often the wait asks the page. */
export const PAGE_READY_POLL_MS = 200

/**
 * The page global a `run` script sets while its promise is pending. A timed-out
 * or cancelled call leaves the script running; this is how the page reports it
 * is not finished (`tools/run.ts` sets and clears it).
 */
export const RUN_BUSY_GLOBAL = '__droneAgentRunBusy'

/**
 * The page's readiness: `window.studio` installed, no earlier `run` script still
 * pending, and (until it has been seen once) a workspace folder. The check is
 * one cheap call; the workspace is `studio.workspace.isOpen()`, false until the
 * folder is chosen (the SDK's own signal, not an error message read back).
 */
function readinessProbe(checkWorkspace: boolean): string {
  return `(async () => {
  const s = globalThis.studio
  if (!s || typeof s.transaction !== 'function') return 'starting'
  if (globalThis.${RUN_BUSY_GLOBAL} === true) return 'busy'
  ${
    checkWorkspace
      ? `if (s.workspace.isOpen() === false) return 'no-workspace'`
      : ''
  }
  return 'ready'
})()`
}

type Readiness = 'starting' | 'busy' | 'no-workspace' | 'ready'

function isReadiness(value: unknown): value is Readiness {
  return value === 'starting' || value === 'busy' || value === 'no-workspace' || value === 'ready'
}

/**
 * The bridge over one window: a string in, the page's JSON out, with a
 * deadline. The deadline is for the page's answer, not for the code: a script
 * that keeps running after it is not interrupted (JavaScript cannot be), main
 * only stops waiting.
 *
 * Every call first waits for the page to be ready (one wait for `run`, `frame`
 * and `export`): it polls every 200 ms for up to 20 s, then fails with
 * `UNSUPPORTED` ("the editor is still starting", or "the app has no workspace
 * folder yet", which also shows the window so the user can pick one). Once the
 * page has been ready, a probe that does not answer is the call's own
 * `TIMEOUT`, not a wait.
 *
 * A call whose script did not finish (timed out, cancelled, or a `run` promise
 * still pending in the page) keeps the bridge held: the next call fails at once
 * with `PageBusyError` instead of running beside it. Scripts get no user
 * gesture.
 *
 * A page that went away is said so, never read as "starting": the tool scripts
 * catch their own errors, so their `executeJavaScript` rejects only when the
 * frame it ran in is disposed. When the renderer crashed (`isCrashed()`), the
 * bridge reloads the window and the call fails with `PageUnavailableError`
 * reason `crashed`, naming Electron's reason and exit code; when the main frame
 * started loading another document during the call, reason `reloaded`. Either
 * way the next call waits for the new page as a launch does (the 20 s wait,
 * the workspace check again), and runs there. Electron may drop the script
 * before it reports the crash (measured in the packaged app): that call says
 * the page went away, and the next one reloads the crashed page and runs. A
 * crash found between two calls is reported, and the window reloaded, by the
 * next call.
 */
export function createPageBridge(
  getWindow: () => PageWindow | null | undefined,
  options: PageBridgeOptions = {},
): PageBridge {
  const readyTimeoutMs = options.readyTimeoutMs ?? PAGE_READY_TIMEOUT_MS
  const pollMs = options.pollMs ?? PAGE_READY_POLL_MS
  let running: Promise<unknown> | null = null
  let everReady = false
  let workspaceSeen = false
  /** The last renderer exit Electron reported and no call has reported yet. */
  let gone: PageGoneDetails | null = null
  /**
   * A call already told its caller the page went away, without knowing why
   * (its script was dropped before Electron reported the crash): a crash the
   * next call finds is then reloaded without being told twice.
   */
  let goneTold = false
  /** Counts the documents the window has had: a crash or a main-frame load adds one. */
  let pageEpoch = 0
  /** The pages whose events the bridge already listens to. */
  const watched = new WeakSet<object>()

  /** A new document: the next call waits for its SDK and its workspace again. */
  function forgetReadiness(): void {
    pageEpoch += 1
    everReady = false
    workspaceSeen = false
  }

  /** Listen once per page for its renderer's end and its main-frame loads. */
  function watch(window: PageWindow): void {
    const contents = window.webContents
    if (watched.has(contents)) return
    watched.add(contents)
    contents.on?.('render-process-gone', (_event, details) => {
      gone = { reason: details.reason, exitCode: details.exitCode }
      forgetReadiness()
    })
    contents.on?.('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) forgetReadiness()
    })
  }

  /**
   * Reload a crashed page. The error that says so, or `null` when an earlier
   * call already told its caller the page went away: the call that found the
   * crash then waits for the new page and runs there.
   */
  function recoverCrashedPage(window: PageWindow): PageUnavailableError | null {
    const details = gone
    gone = null
    forgetReadiness()
    window.webContents.reload?.()
    if (goneTold) {
      goneTold = false
      return null
    }
    const why = details === null ? '' : ` (${details.reason}, exit code ${details.exitCode})`
    return new PageUnavailableError(
      `the editor page crashed${why}; the app reloaded it, so the open project and every edit no save wrote are gone`,
      'crashed',
    )
  }

  /** Reload the page when its renderer is gone; throws the crash when no call has told it yet. */
  function recoverIfCrashed(window: PageWindow): void {
    if (!isCrashed(window)) return
    const error = recoverCrashedPage(window)
    if (error !== null) throw error
  }

  /** Whether the page's renderer is gone right now. */
  function isCrashed(window: PageWindow): boolean {
    return window.webContents.isCrashed?.() === true
  }

  /**
   * Why an execution rejected: the page went away under it. A tool script
   * catches its own errors, so its `executeJavaScript` rejects only when the
   * frame it ran in is disposed. A crash Electron already reported reloads the
   * window and says so; a main-frame load since `epoch` is a reload. Electron
   * may drop the script before it reports the crash: then the call says the
   * page went away, and the next call reloads the crashed page and runs.
   */
  function pageGoneError(window: PageWindow, epoch: number, error: unknown): PageUnavailableError {
    if (isCrashed(window)) {
      const crashed = recoverCrashedPage(window)
      if (crashed !== null) return crashed
    }
    if (pageEpoch !== epoch) {
      return new PageUnavailableError(
        'the editor page reloaded while this call ran, so its result is lost, and with it the open project and every edit no save wrote',
        'reloaded',
      )
    }
    goneTold = true
    forgetReadiness()
    const said = error instanceof Error ? error.message : String(error)
    return new PageUnavailableError(
      `the editor page went away while this call ran ("${said}": its renderer crashed or it reloaded), so its result is lost, and with it the open project and every edit no save wrote`,
      'crashed',
    )
  }

  /** `value` or `undefined` when it did not settle within `ms`. */
  function within<T>(value: Promise<T>, ms: number): Promise<{ value: T } | undefined> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), Math.max(0, ms))
    })
    return Promise.race([value.then((resolved) => ({ value: resolved })), timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }

  /** Ask the page once; a page that is loading rejects, which reads as "starting". */
  async function probe(window: PageWindow, budgetMs: number): Promise<Readiness | undefined> {
    const asked = Promise.resolve()
      .then(() => window.webContents.executeJavaScript(readinessProbe(!workspaceSeen), false))
      .then((answer) => (isReadiness(answer) ? answer : 'starting'), () => 'starting' as const)
    const answered = await within(asked, budgetMs)
    return answered?.value
  }

  async function waitUntilReady(window: PageWindow, callTimeoutMs: number): Promise<void> {
    const deadline = Date.now() + (everReady ? callTimeoutMs : readyTimeoutMs)
    let last: Readiness = 'starting'
    for (;;) {
      const answer = await probe(window, deadline - Date.now())
      // A crashed page rejects every probe: that is not "starting". A crash
      // already told is reloaded, and the wait goes on for the new page.
      recoverIfCrashed(window)
      if (answer === undefined) {
        if (everReady) {
          throw new PageTimeoutError(`the editor did not answer within ${callTimeoutMs} ms`)
        }
        break
      }
      if (answer === 'busy') throw new PageBusyError('a previous script is still running in the editor')
      if (answer === 'ready') {
        everReady = true
        workspaceSeen = true
        goneTold = false
        return
      }
      last = answer
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))))
    }
    if (last === 'no-workspace') {
      options.showWindow?.()
      throw new PageUnavailableError('the app has no workspace folder yet', 'no-workspace')
    }
    throw new PageUnavailableError('the editor is still starting', 'starting')
  }

  return {
    async execute(code, timeoutMs) {
      const window = getWindow()
      if (!window || window.isDestroyed?.() === true) {
        throw new PageUnavailableError(
          'the editor window is not open, so the SDK cannot be reached',
          'no-window',
        )
      }
      watch(window)
      recoverIfCrashed(window)
      if (running !== null) throw new PageBusyError('a previous script is still running in the editor')
      await waitUntilReady(window, timeoutMs)
      if (running !== null) throw new PageBusyError('a previous script is still running in the editor')

      const epoch = pageEpoch
      const execution = Promise.resolve().then(() => window.webContents.executeJavaScript(code, false))
      const held = execution.then(
        () => undefined,
        () => undefined,
      )
      running = held
      void held.then(() => {
        if (running === held) running = null
      })
      const answered = await within(execution, timeoutMs).catch((error: unknown) => {
        if (running === held) running = null
        throw pageGoneError(window, epoch, error)
      })
      if (answered === undefined) {
        // The script is still running: `running` stays set until the page settles it.
        throw new PageTimeoutError(`the editor did not answer within ${timeoutMs} ms`)
      }
      if (running === held) running = null
      return answered.value
    },
  }
}

/**
 * One queue for every tool call: each task starts after the one before has
 * settled, so no two scripts touch the stores (and their undo stacks) at once.
 * A failed task does not break the chain.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const start = tail.then(task, task)
    tail = start.catch(() => undefined)
    return start
  }
}
