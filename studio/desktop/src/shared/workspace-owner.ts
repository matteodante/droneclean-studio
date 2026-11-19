/**
 * One owner of a workspace folder, shell side (task 2.3, design
 * `docs/designs/2.2-mcp.md` §4.10 layer 2).
 *
 * Two writers on one workspace folder corrupt it, so the folder has one owner at
 * a time: `.droneclean/owner.json` in its root says who, and a second instance
 * that finds a live owner shows a modal instead of opening the folder. In the
 * desktop app the lock belongs to the main process
 * (`main/workspace-lock.ts`), which writes it from Node and knows the owner's
 * pid; the page only reads the verdict. In the browser the page owns the same
 * file through the folder handle (`src/studio/agent/workspace-owner.ts`).
 *
 * The file is the meeting point of the two, so its shape and the two numbers
 * live here and in the page module, and `workspace-owner.test.ts` holds the two
 * copies together at compile time:
 *
 * ```json
 * { "version": 1, "app": "desktop", "pid": 51234, "host": "Mac.lan",
 *   "startedAt": 1763462400000, "heartbeatAt": 1763462415000, "token": "…" }
 * ```
 *
 * The page reaches the main process through `window.dronecleanWorkspaceOwner`,
 * exposed by the second preload `preload/workspace-owner.ts` — a sandboxed
 * preload cannot import a sibling file, so it writes the channel names out and
 * `test/workspace-lock.test.mjs` holds them to this module, as
 * `test/agent-access.test.mjs` does for the agent switch.
 *
 * **Which folder.** The page's folder handle has no path, so the page proves
 * which folder it opened: it writes `.droneclean/claim-<nonce>` through the
 * handle and passes the nonce to `acquire`; the main process looks for that
 * file in the folders Chromium has granted and holds the one that has it.
 */

/** The folder and file name of the owner record, inside the workspace root. */
export const WORKSPACE_OWNER_DIR = '.droneclean'
export const WORKSPACE_OWNER_FILE = 'owner.json'

/** The page's proof of its folder: `.droneclean/claim-<nonce>`, written through the handle. */
export const WORKSPACE_CLAIM_PREFIX = 'claim-'

/**
 * How often the owner refreshes `heartbeatAt`. Main refreshes from Node for the
 * desktop app; the page does it in the browser.
 */
export const WORKSPACE_OWNER_HEARTBEAT_MS = 5_000

/**
 * How old a heartbeat may be before its owner is stale. This is the design's 60
 * seconds; a stale owner cannot block a folder for longer.
 */
export const WORKSPACE_OWNER_LIVE_MS = 60_000

/** The four IPC channels the page calls; the preload writes the same names out. */
export const WORKSPACE_OWNER_CHANNELS = {
  acquire: 'workspaceOwner:acquire',
  status: 'workspaceOwner:status',
  takeOver: 'workspaceOwner:takeOver',
  close: 'workspaceOwner:close',
} as const

/** Who wrote the record: the desktop app on some machine, or a browser page. */
export type WorkspaceOwnerApp = 'desktop' | 'web'

/** What `.droneclean/owner.json` holds. */
export interface WorkspaceOwnerRecord {
  readonly version: 1
  readonly app: WorkspaceOwnerApp
  /** The writer's process id; `0` when a browser page wrote it. */
  readonly pid: number
  /** The writer's host name; `''` when a browser page wrote it (it cannot know it). */
  readonly host: string
  /** Epoch milliseconds when the owner took the folder. */
  readonly startedAt: number
  /** Epoch milliseconds of the last sign of life; older than 60 s means stale. */
  readonly heartbeatAt: number
  /** Identifies one ownership: a record with another token is another owner. */
  readonly token: string
}

/** The owner a blocked page names in its modal: what holds the folder and since when. */
export interface WorkspaceOwnerHolder {
  readonly app: WorkspaceOwnerApp
  readonly startedAt: number
  readonly heartbeatAt: number
}

/**
 * What the shell says about the folder the page is opening:
 *
 * - `owned`: this app holds it, checked on disk at this moment;
 * - `blocked`: another instance holds it — `holder` names it when its record
 *   could be read, `stale` says whether Take over may replace it (its owner is
 *   confirmed dead, or its heartbeat is 60 s old);
 * - `free`: no record in the folder (the previous owner let go) — a poll's
 *   answer; `acquire` takes it, `takeOver` too;
 * - `unowned`: the shell could not find the folder the page proved (no claim
 *   file in any folder it was granted). The page opens nothing;
 * - `temporary`: the folder is inside a temporary location (`os.tmpdir()`, `/tmp`,
 *   `/private/var/folders`, `%TEMP%`), which the system may delete with the
 *   projects in it (review finding E1). The shell holds nothing and the page asks
 *   for another folder.
 */
export type WorkspaceOwnerStatus =
  | { readonly kind: 'owned' }
  | { readonly kind: 'blocked'; readonly holder?: WorkspaceOwnerHolder; readonly stale: boolean }
  | { readonly kind: 'free' }
  | { readonly kind: 'unowned' }
  | { readonly kind: 'temporary' }

/** What `window.dronecleanWorkspaceOwner` offers the page. */
export interface DesktopWorkspaceOwner {
  /**
   * Hold the folder that has `.droneclean/claim-<nonce>` (the page wrote it just
   * before), giving back any folder held before; take it when it is free. A
   * taken folder is reported, never displaced.
   */
  acquire(nonce: string): Promise<WorkspaceOwnerStatus>
  /** Read the folder's owner without taking it; `owned` only when the record on disk is this app's. */
  status(): Promise<WorkspaceOwnerStatus>
  /** The person's click: replace a dead or stale owner (or take a free folder); a live owner is never displaced. */
  takeOver(): Promise<WorkspaceOwnerStatus>
  /** Close the app: without the folder there is nothing to show. */
  close(): void
}

declare global {
  interface Window {
    /** Installed by `preload/workspace-owner.ts`; absent in the browser. */
    dronecleanWorkspaceOwner?: DesktopWorkspaceOwner
  }
}
