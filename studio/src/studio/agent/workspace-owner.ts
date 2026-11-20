/**
 * One owner of a workspace folder, page side (task 2.3, design
 * `docs/designs/2.2-mcp.md` §4.10 layer 2, review findings D1 and D2).
 *
 * The folder is the unit that needs one writer, because FreeCut writes
 * `project.json`, `index.json` and `media/…` into it from the page and shares it
 * between origins on purpose. So the folder itself says who owns it:
 * `.droneclean/owner.json` (`{version, app, pid, host, startedAt, heartbeatAt,
 * token}`, the same file and the same numbers as the desktop shell's lock in
 * `studio/desktop/src/main/workspace-lock.ts`).
 *
 * This module is the page's half. The gate asks it once before it opens
 * anything (`claimWorkspaceOwnership`): a folder somebody else holds is not
 * opened; the gate shows the modal with **Close**, and **Take over** only once
 * the owner is dead or stale. Once open, the folder can still be lost — another
 * window took over a page whose heartbeat stalled, or wrote over its record —
 * and then the page turns **read-only**: the gate shows a banner that stays,
 * and every save of a project asks first (`requireWorkspaceOwnership`, called
 * where `project.json` is written) and writes nothing when the record on disk is
 * not this page's. A lost folder is never taken back by itself, even when it
 * becomes free: what this page holds in memory may be older than what the other
 * window saved, so only a click on Take over takes it — and then the page saves
 * nothing it holds and reloads, so the editor opens what is on disk.
 *
 * **In the desktop app** the shell owns the lock — it creates the record
 * exclusively from Node, and only it can ask `process.kill(pid, 0)` whether the
 * recorded owner is still running. The page proves which folder it opened (the
 * shell cannot see a handle's path): it writes `.droneclean/claim-<nonce>`
 * through the handle, passes the nonce to the shell's `acquire`, and removes the
 * file. It then asks the shell's `status` every 5 s and before every save. It
 * never writes the record itself.
 *
 * **In the browser** the page owns the record, in two layers:
 *
 * - `navigator.locks` holds `droneclean:workspace:<id>` for the page's lifetime,
 *   so a second tab of one origin and profile is blocked exactly (design §4.10
 *   layer 3);
 * - the record covers what locks cannot: another browser or profile, another
 *   origin, or the desktop app on the same folder. A record is this page's only
 *   when its token is — the one this page wrote, or the one this tab wrote
 *   before a reload (kept in `sessionStorage`, which another tab does not
 *   share). Any other live record blocks the page; a free tab lock proves
 *   nothing, since another browser has locks of its own. A page cannot check a
 *   pid, so it judges an owner by its heartbeat alone: 60 s without one is
 *   stale.
 *
 * The heartbeat rewrites the record every 5 s, and only after reading it: a
 * record that is not this page's means the folder was lost. The page has no
 * exclusive create (the File System Access API has none), so two browsers that
 * write at the same instant are told apart by reading the record back; the one
 * whose write was replaced finds it at its next heartbeat or save and turns
 * read-only. Every write is the workspace's own atomic JSON write
 * (`writeJsonAtomic`: `.tmp` then replace), so a reader never sees half a record.
 *
 * The environment seam is what the tests drive; {@link createBrowserEnvironment}
 * is the real one.
 */
import { queryHandlePermission } from '@/infrastructure/storage/handles-db'
import {
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('WorkspaceOwner')

/** The folder and file of the record, inside the workspace root; the shell uses the same names. */
const WORKSPACE_OWNER_DIR = '.droneclean'
const WORKSPACE_OWNER_FILE = 'owner.json'

/** The proof of the folder the desktop shell looks for: `.droneclean/claim-<nonce>` (the shell's name too). */
const WORKSPACE_CLAIM_PREFIX = 'claim-'

/** How often the owner refreshes `heartbeatAt`. */
const WORKSPACE_OWNER_HEARTBEAT_MS = 5_000

/** How old a heartbeat may be before its owner is stale (the design's 60 s). */
const WORKSPACE_OWNER_LIVE_MS = 60_000

/** `.droneclean/owner.json`: the shell's `WorkspaceOwnerRecord` (`desktop/src/shared/workspace-owner.ts`). */
export interface WorkspaceOwnerFile {
  readonly version: 1
  readonly app: 'desktop' | 'web'
  /** The writer's process id; `0` when a browser page wrote it. */
  readonly pid: number
  /**
   * The writer's host: the machine's name for the app (the pid is checked only
   * against it), the page's origin for a browser window (`location.host`). A
   * page therefore knows which records came from its own origin, and the tab
   * lock tells it whether that page is still there.
   */
  readonly host: string
  readonly startedAt: number
  readonly heartbeatAt: number
  readonly token: string
}

/** The owner the modal names: what holds the folder and since when. */
export interface WorkspaceOwnerFileHolder {
  readonly app: 'desktop' | 'web'
  readonly startedAt: number
  readonly heartbeatAt: number
}

/**
 * What the gate does with the folder: open it, or show the modal. For a folder
 * already open, `blocked` is the read-only mode: the banner, and no saves.
 */
export type WorkspaceOwnerState =
  | { readonly kind: 'owned' }
  | {
      readonly kind: 'blocked'
      /** Who holds it; absent when no record could be read (none, or not one this version knows). */
      readonly holder?: WorkspaceOwnerFileHolder
      /** Whether Take over may take it: its owner is dead, 60 s silent, or gone. */
      readonly stale: boolean
    }
  /**
   * The folder is inside a temporary location the system may delete (review
   * finding E1): the shell refused it, the gate opens nothing and asks for
   * another folder.
   */
  | { readonly kind: 'temporary' }
  /**
   * The desktop app could not prove the folder: the claim file could not be
   * written into it (moved, renamed, deleted, read-only), or the shell found no
   * folder with it. Nobody else holds it, so the gate asks for a folder instead
   * of naming another window (20 Nov 2026: a remembered folder that a test had
   * deleted left the app on "open in another window", with only Close).
   */
  | { readonly kind: 'unreachable' }

/** The shell's answer to `window.dronecleanWorkspaceOwner` (`desktop/src/shared/workspace-owner.ts`). */
export type DesktopWorkspaceOwnerStatus =
  | { readonly kind: 'owned' }
  | { readonly kind: 'blocked'; readonly holder?: WorkspaceOwnerFileHolder; readonly stale: boolean }
  | { readonly kind: 'free' }
  | { readonly kind: 'unowned' }
  | { readonly kind: 'temporary' }

/** The page's view of the desktop shell's bridge. */
export interface DesktopWorkspaceOwnerBridge {
  /** Hold the folder that has `.droneclean/claim-<nonce>`. */
  acquire(nonce: string): Promise<DesktopWorkspaceOwnerStatus>
  status(): Promise<DesktopWorkspaceOwnerStatus>
  takeOver(): Promise<DesktopWorkspaceOwnerStatus>
  close(): void
}

/** The guard the gate holds: one per opening attempt. */
export interface WorkspaceOwnerGuard {
  /** The state at this moment; the same object until something changes. */
  state(): WorkspaceOwnerState
  /**
   * Follow the folder. While it is blocked, every 5 s the guard reads the owner
   * again and reports a changed state; a folder that was never opened is
   * claimed when it becomes free (then the state is `owned` and the gate opens
   * it), a folder that was lost is only offered. Returns the stop function.
   */
  watch(listener: (state: WorkspaceOwnerState) => void): () => void
  /**
   * The person's click: take a dead, stale or free folder; a live owner is never
   * displaced. A folder this page had open and lost is taken back without
   * saving anything this page holds: saves stay refused, and once the folder is
   * the page's the page reloads, so the editor shows what the other window saved.
   */
  takeOver(): Promise<WorkspaceOwnerState>
  /**
   * Check on disk, now, that the folder is still this page's. A folder that is
   * not turns the guard read-only (`blocked`) and stays so until Take over.
   */
  confirm(): Promise<boolean>
  /** Close the window: without the folder there is nothing to show (the shell quits). */
  close(): void
  /** Give the folder back: stop the heartbeat and remove this page's record. */
  release(): void
}

/** The page's store for `.droneclean/owner.json`, behind a seam so the tests need no disk. */
export interface WorkspaceOwnerPageStore {
  /** Whatever the file holds; the guard parses it, and garbage reads as no owner. */
  read(): Promise<unknown>
  write(record: WorkspaceOwnerFile): Promise<void>
  /** Remove the record when it still carries `token`; leave another owner's record alone. */
  remove(token: string): Promise<void>
  /** Write `.droneclean/claim-<nonce>`, the desktop shell's proof of which folder this is. */
  writeClaim(nonce: string): Promise<void>
  removeClaim(nonce: string): Promise<void>
}

/** What `navigator.locks` gave (or refused) for one tab. */
export type WorkspaceOriginLock =
  | { readonly kind: 'acquired'; release(): void }
  | { readonly kind: 'busy' }
  | { readonly kind: 'unsupported' }

/** What the module needs from the app; {@link createBrowserEnvironment} is the real one. */
export interface WorkspaceOwnerEnvironment {
  /** The shell's bridge, when this page runs inside the desktop app. */
  desktop(): DesktopWorkspaceOwnerBridge | undefined
  store(root: FileSystemDirectoryHandle): WorkspaceOwnerPageStore
  /** Take (or fail to take) the lock of one workspace in this origin. */
  originLock(name: string): Promise<WorkspaceOriginLock>
  now(): number
  /** The page's own host (`location.host`), written into the record it leaves. */
  originHost(): string
  newToken(): string
  /** Run `callback` every `milliseconds` until the returned function is called. */
  every(callback: () => void, milliseconds: number): () => void
  /** Run `listener` when the page goes away; used to give the folder back. */
  onPageHide(listener: () => void): void
  /** Close the window (the modal's Close in a browser tab). */
  closeWindow(): void
  /** The token this tab held on the workspace before a reload, or null. */
  previousToken(workspaceId: string): string | null
  /** Keep this page's token for the tab's next page (a reload). */
  keepToken(workspaceId: string, token: string): void
  /** Reload the page, so the project is read again from disk. */
  reloadPage(): void
}

/** A save refused because the folder is not this page's: the page is read-only. */
export class WorkspaceNotOwnedError extends Error {
  constructor() {
    super('This workspace is open in another window; changes here are not saved')
    this.name = 'WorkspaceNotOwnedError'
  }
}

/** The record in `owner.json`, or null when it is absent or not a record this version knows. */
export function parseWorkspaceOwnerFile(value: unknown): WorkspaceOwnerFile | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<WorkspaceOwnerFile>
  if (
    record.version !== 1 ||
    (record.app !== 'desktop' && record.app !== 'web') ||
    typeof record.pid !== 'number' ||
    typeof record.host !== 'string' ||
    typeof record.startedAt !== 'number' ||
    typeof record.heartbeatAt !== 'number' ||
    !Number.isFinite(record.startedAt) ||
    !Number.isFinite(record.heartbeatAt) ||
    typeof record.token !== 'string' ||
    record.token.length === 0
  ) {
    return null
  }
  return {
    version: 1,
    app: record.app,
    pid: record.pid,
    host: record.host,
    startedAt: record.startedAt,
    heartbeatAt: record.heartbeatAt,
    token: record.token,
  }
}

/**
 * Whether the record names an owner that is still running.
 *
 * A page cannot ask the operating system about a pid, so the heartbeat alone
 * decides here — and 60 s without one is stale, whatever wrote it. The shell
 * adds the pid check for its own records (`desktop/src/main/workspace-lock.ts`).
 */
export function isWorkspaceOwnerLive(record: WorkspaceOwnerFile, now: number): boolean {
  return now - record.heartbeatAt < WORKSPACE_OWNER_LIVE_MS
}

/** The part of the modal that comes from a record. */
function holderOf(record: WorkspaceOwnerFile): WorkspaceOwnerFileHolder {
  return { app: record.app, startedAt: record.startedAt, heartbeatAt: record.heartbeatAt }
}

/**
 * Ask for the workspace folder once. Owned: the gate opens it. Blocked: the gate
 * shows the modal and calls {@link WorkspaceOwnerGuard.watch}, then either
 * `takeOver()` or `close()`.
 */
export async function claimWorkspaceOwnership(
  root: FileSystemDirectoryHandle,
  workspaceId: string,
  environment: WorkspaceOwnerEnvironment = createBrowserEnvironment(),
): Promise<WorkspaceOwnerGuard> {
  const guard = new WorkspaceOwnerGuardImpl(environment, root, workspaceId)
  await guard.claim()
  claimedGuard = guard
  return guard
}

/** The guard of the page's latest claim: the folder the gate opens, or is about to. */
let claimedGuard: WorkspaceOwnerGuard | null = null

/**
 * The check before a project is written: resolves when the folder is this
 * page's, on disk, now; throws {@link WorkspaceNotOwnedError} (and the page turns
 * read-only) when it is not.
 *
 * A page that never claimed a folder has no gate in front of its storage — the
 * unit tests and the headless harness — and is let through; in the app the gate
 * claims before it sets the workspace root, so every save has a guard to ask.
 */
export async function requireWorkspaceOwnership(): Promise<void> {
  if (claimedGuard === null) return
  if (!(await claimedGuard.confirm())) throw new WorkspaceNotOwnedError()
}

/**
 * This page's ownership of one workspace, shared by every guard of that
 * workspace in the page: React's StrictMode runs the gate's effect twice in
 * development, and the second claim must not find this page's own lock busy.
 * A claim in flight is shared too, so two claims at once ask `navigator.locks`
 * once.
 */
interface PageOwnership {
  readonly token: string
  readonly startedAt: number
  readonly lock: HeldOriginLock | null
  /** Set once the ownership is given up (released or lost); the origin lock went with it. */
  released: boolean
}

/** The lock this page holds on its origin, once it has one. */
interface HeldOriginLock {
  release(): void
}

type PageClaim =
  | { readonly kind: 'owned'; readonly ownership: PageOwnership }
  | { readonly kind: 'blocked'; readonly state: WorkspaceOwnerState }

const pageOwnerships = new Map<string, PageOwnership>()
const pageClaims = new Map<string, Promise<PageClaim>>()

/**
 * The guard's implementation: one folder, one claim, a heartbeat (browser) or a
 * check (desktop) while it owns, and while blocked a read every 5 s so the modal
 * or the banner can offer Take over once the owner is dead or stale.
 *
 * The state is one object that only changes when the state changes, so a React
 * subscriber can compare it.
 */
class WorkspaceOwnerGuardImpl implements WorkspaceOwnerGuard {
  private readonly environment: WorkspaceOwnerEnvironment
  private readonly root: FileSystemDirectoryHandle
  private readonly workspaceId: string
  private readonly desktop: DesktopWorkspaceOwnerBridge | undefined
  private current: WorkspaceOwnerState = { kind: 'blocked', stale: false }
  /** Whether this guard ever owned the folder: losing it then means read-only, never a silent reclaim. */
  private opened = false
  /** Set by Take over of a lost folder: no save goes through until the page has reloaded. */
  private reloading = false

  /** The browser's ownership once it owns: the shared record and this guard's heartbeat. */
  private ownership: { readonly page: PageOwnership; stopHeartbeat: () => void } | null = null
  /** The desktop's check of the shell's verdict every 5 s while it owns. */
  private stopOwnedCheck: (() => void) | null = null

  private stopWatch: (() => void) | null = null
  private readonly listeners = new Set<(state: WorkspaceOwnerState) => void>()

  constructor(
    environment: WorkspaceOwnerEnvironment,
    root: FileSystemDirectoryHandle,
    workspaceId: string,
  ) {
    this.environment = environment
    this.root = root
    this.workspaceId = workspaceId
    this.desktop = environment.desktop()
  }

  state(): WorkspaceOwnerState {
    return this.current
  }

  async claim(): Promise<WorkspaceOwnerState> {
    return this.desktop ? this.claimDesktop() : this.claimPage()
  }

  watch(listener: (state: WorkspaceOwnerState) => void): () => void {
    this.listeners.add(listener)
    this.pollWhileBlocked()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stopWatching()
    }
  }

  async takeOver(): Promise<WorkspaceOwnerState> {
    // What a page that lost the folder holds in memory is older than what the
    // other window saved: from the click on nothing of it is saved, and the page
    // reloads once the folder is its own.
    const lost = this.opened
    if (lost) this.reloading = true
    await this.takeOverOnce()
    if (lost) {
      if (this.current.kind === 'owned') this.environment.reloadPage()
      else this.reloading = false
    }
    return this.current
  }

  private async takeOverOnce(): Promise<void> {
    if (this.desktop) {
      const status = await this.desktopAnswer(() => this.desktop?.takeOver())
      if (status.kind === 'owned') this.ownDesktop()
      else this.set(desktopBlocked(status))
      return
    }
    // The page: claim again — a live owner that appeared meanwhile still wins, and
    // the origin lock or the record decide whether this page may take the folder.
    this.stopWatching()
    const result = await this.claimPageOnce(true)
    if (result.kind === 'owned') this.own(result.ownership)
    else this.block(result.state)
  }

  async confirm(): Promise<boolean> {
    if (this.reloading || this.current.kind !== 'owned') return false
    if (this.desktop) {
      const status = await this.desktopAnswer(() => this.desktop?.status())
      if (status.kind === 'owned') return true
      this.lose(desktopBlocked(status))
      return false
    }
    const token = this.ownership?.page.token
    const record = await this.readRecord(this.store())
    if (token !== undefined && record?.token === token) return true
    this.lose(this.blockedBy(record, true))
    return false
  }

  close(): void {
    if (this.desktop) {
      this.desktop.close()
      return
    }
    this.environment.closeWindow()
  }

  release(): void {
    this.stopWatching()
    this.stopOwnedCheck?.()
    this.stopOwnedCheck = null
    const ownership = this.dropOwnership()
    if (!ownership) return
    void this.store()
      .remove(ownership.page.token)
      .catch((error: unknown) => logger.warn('could not remove the owner record', error))
  }

  /**
   * The desktop's claim: prove the folder with a claim file, let the shell hold
   * it, and remove the file again. The shell owns the record.
   */
  private async claimDesktop(): Promise<WorkspaceOwnerState> {
    const nonce = this.environment.newToken()
    const store = this.store()
    let status: DesktopWorkspaceOwnerStatus = { kind: 'unowned' }
    try {
      await store.writeClaim(nonce)
      status = await this.desktopAnswer(() => this.desktop?.acquire(nonce))
    } catch (error) {
      logger.error('could not write the claim file the shell looks for', describeError(error))
    } finally {
      await store
        .removeClaim(nonce)
        .catch((error: unknown) => logger.warn('could not remove the claim file', error))
    }
    if (status.kind === 'owned') {
      this.ownDesktop()
      return this.current
    }
    // `unowned`: the claim file could not be written, or the shell found no folder
    // with it. No owner was found either, so this is no other window's folder: the
    // gate asks for one (`unreachable`) instead of a modal with nothing to wait for.
    if (status.kind === 'unowned') {
      logger.error('the workspace folder could not be proved to the shell; asking for a folder')
      this.set({ kind: 'unreachable' })
      return this.current
    }
    // `free` cannot come from a claim (the shell takes a free folder): nothing
    // proves this page may write, so the folder is not opened.
    if (status.kind !== 'blocked' && status.kind !== 'temporary') {
      logger.error(`the shell answered "${status.kind}" to the workspace claim; the folder stays closed`)
    }
    this.block(desktopBlocked(status))
    return this.current
  }

  /** The desktop owns: check the shell's verdict every 5 s, so a loss shows without a save. */
  private ownDesktop(): void {
    this.opened = true
    this.stopWatching()
    this.set({ kind: 'owned' })
    if (this.stopOwnedCheck !== null) return
    this.stopOwnedCheck = this.environment.every(() => {
      void this.confirm()
    }, WORKSPACE_OWNER_HEARTBEAT_MS)
  }

  /** The browser's claim: this page's own lock, the origin lock, then the record. */
  private async claimPage(): Promise<WorkspaceOwnerState> {
    const known = pageOwnerships.get(this.workspaceId)
    if (known !== undefined) {
      this.own(known)
      return this.current
    }
    const claim = pageClaims.get(this.workspaceId) ?? this.startPageClaim()
    const result = await claim
    if (result.kind === 'owned') this.own(result.ownership)
    else this.block(result.state)
    return this.current
  }

  /** The claim itself, shared with any other claim of the same workspace in this page. */
  private startPageClaim(): Promise<PageClaim> {
    const claim = this.claimPageOnce().finally(() => {
      pageClaims.delete(this.workspaceId)
    })
    pageClaims.set(this.workspaceId, claim)
    return claim
  }

  private async claimPageOnce(takeStale = false): Promise<PageClaim> {
    const lock = await this.environment.originLock(`droneclean:workspace:${this.workspaceId}`)
    if (lock.kind === 'busy') {
      // Another tab of this origin has it, and its record says since when.
      return { kind: 'blocked', state: this.blockedBy(await this.readRecord(this.store()), false) }
    }

    const record = await this.readRecord(this.store())
    if (record === null || this.isThisTabs(record)) return this.writeOwnership(lock)
    // Any other record is another owner's — a free tab lock says nothing about a
    // second browser or profile. A stale owner is still an owner: the modal offers
    // Take over, and only a click (which comes back here with `takeStale`) takes it.
    const live = isWorkspaceOwnerLive(record, this.environment.now())
    if (live || !takeStale) {
      return this.giveUp(lock, { kind: 'blocked', holder: holderOf(record), stale: !live })
    }
    return this.writeOwnership(lock)
  }

  /** Whether this tab wrote the record before a reload (its token is in the tab's own storage). */
  private isThisTabs(record: WorkspaceOwnerFile): boolean {
    return record.token === this.environment.previousToken(this.workspaceId)
  }

  /** Write this page's record and check that it is the one that stayed. */
  private async writeOwnership(lock: WorkspaceOriginLock): Promise<PageClaim> {
    const token = this.environment.newToken()
    const startedAt = this.environment.now()
    const written: WorkspaceOwnerFile = {
      version: 1,
      app: 'web',
      // A page has no pid and cannot learn the machine's name; it writes its own
      // origin as the host, for the modal's and the log's sake.
      pid: 0,
      host: this.environment.originHost(),
      startedAt,
      heartbeatAt: startedAt,
      token,
    }
    try {
      await this.store().write(written)
    } catch (error) {
      logger.error('could not write the owner record', error)
      if (lock.kind === 'acquired') lock.release()
      // A workspace the page cannot write a record into is a workspace it cannot
      // edit either; the first save check finds no record of this page's and
      // turns the page read-only.
      return { kind: 'owned', ownership: { token, startedAt, lock: null, released: false } }
    }
    const readBack = await this.readRecord(this.store())
    if (readBack !== null && readBack.token !== token) {
      // Two writers started in the same instant; the record that stayed wins.
      return this.giveUp(lock, { kind: 'blocked', holder: holderOf(readBack), stale: false })
    }
    this.environment.keepToken(this.workspaceId, token)
    return {
      kind: 'owned',
      ownership: { token, startedAt, lock: lock.kind === 'acquired' ? lock : null, released: false },
    }
  }

  /** Keep the answer and let the origin lock go: this page is not opening the folder. */
  private giveUp(lock: WorkspaceOriginLock, state: WorkspaceOwnerState): PageClaim {
    if (lock.kind === 'acquired') lock.release()
    return { kind: 'blocked', state }
  }

  /**
   * The blocked state a record gives. No record is `stale` (free, so Take over
   * may take it) for a folder this page lost; while another tab of this origin
   * is still claiming, it is not.
   */
  private blockedBy(record: WorkspaceOwnerFile | null, freeIsStale: boolean): WorkspaceOwnerState {
    if (record === null) return { kind: 'blocked', stale: freeIsStale }
    return {
      kind: 'blocked',
      holder: holderOf(record),
      stale: !isWorkspaceOwnerLive(record, this.environment.now()),
    }
  }

  /** One poll while blocked: has the owner gone, gone stale, or come back? */
  private async refresh(): Promise<void> {
    if (this.desktop) {
      const status = await this.desktopAnswer(() => this.desktop?.status())
      if (status.kind === 'owned') {
        this.ownDesktop()
      } else if (status.kind === 'free' && !this.opened) {
        // The other app let go between two polls: take the folder, as the claim
        // would have if it had been free when the page asked.
        this.stopWatching()
        await this.claim()
      } else {
        this.set(desktopBlocked(status))
      }
      return
    }

    const record = await this.readRecord(this.store())
    if (!this.opened && (record === null || this.isThisTabs(record))) {
      // The owner let go of a folder this page has not opened yet: take it.
      this.stopWatching()
      await this.claimPage()
      return
    }
    this.set(this.blockedBy(record, this.opened))
  }

  /** Start this guard's heartbeat for an ownership this page holds. */
  private own(page: PageOwnership): void {
    if (!pageOwnerships.has(this.workspaceId)) pageOwnerships.set(this.workspaceId, page)
    this.opened = true
    this.stopWatching()
    if (this.ownership === null) {
      const environment = this.environment
      this.ownership = {
        page,
        stopHeartbeat: environment.every(() => {
          void this.heartbeat()
        }, WORKSPACE_OWNER_HEARTBEAT_MS),
      }
      environment.onPageHide(() => this.release())
    }
    this.set({ kind: 'owned' })
  }

  /** One heartbeat: rewrite only while the record is still this page's. */
  private async heartbeat(): Promise<void> {
    const ownership = this.ownership
    if (!ownership) return
    const store = this.store()
    const record = await this.readRecord(store)
    if (record?.token !== ownership.page.token) {
      // Another owner's record, or none: the folder was lost. Never write over
      // it; the page turns read-only and the banner says so.
      this.lose(this.blockedBy(record, true))
      return
    }
    try {
      await store.write({
        version: 1,
        app: 'web',
        pid: 0,
        host: this.environment.originHost(),
        startedAt: ownership.page.startedAt,
        heartbeatAt: this.environment.now(),
        token: ownership.page.token,
      })
    } catch (error) {
      logger.warn('heartbeat could not be written', error)
    }
  }

  /** The folder is no longer this page's: stop writing for good, show why, and follow the owner. */
  private lose(state: WorkspaceOwnerState): void {
    logger.warn('the workspace is no longer this page’s; it is read-only until Take over')
    this.stopOwnedCheck?.()
    this.stopOwnedCheck = null
    this.dropOwnership()
    this.block(state)
  }

  /** Stop the heartbeat and give the page's shared ownership up; returns what was held. */
  private dropOwnership(): { readonly page: PageOwnership; stopHeartbeat: () => void } | null {
    const ownership = this.ownership
    this.ownership = null
    if (!ownership) return null
    ownership.stopHeartbeat()
    if (!ownership.page.released) {
      ownership.page.released = true
      ownership.page.lock?.release()
      pageOwnerships.delete(this.workspaceId)
    }
    return ownership
  }

  private block(state: WorkspaceOwnerState): void {
    this.set(state)
    this.pollWhileBlocked()
  }

  /** Poll every 5 s while blocked and somebody is watching (the modal or the banner). */
  private pollWhileBlocked(): void {
    if (this.current.kind === 'owned' || this.listeners.size === 0 || this.stopWatch !== null) return
    this.stopWatch = this.environment.every(() => {
      void this.refresh()
    }, WORKSPACE_OWNER_HEARTBEAT_MS)
  }

  private async readRecord(store: WorkspaceOwnerPageStore): Promise<WorkspaceOwnerFile | null> {
    try {
      return parseWorkspaceOwnerFile(await store.read())
    } catch (error) {
      logger.warn('the owner record is unreadable', error)
      return null
    }
  }

  private store(): WorkspaceOwnerPageStore {
    return this.environment.store(this.root)
  }

  private async desktopAnswer(
    call: () => Promise<DesktopWorkspaceOwnerStatus> | undefined,
  ): Promise<DesktopWorkspaceOwnerStatus> {
    try {
      return (await call()) ?? { kind: 'unowned' }
    } catch (error) {
      logger.error('the shell did not answer the workspace owner call', error)
      return { kind: 'unowned' }
    }
  }

  private set(state: WorkspaceOwnerState): void {
    if (sameOwnerState(this.current, state)) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }

  private stopWatching(): void {
    this.stopWatch?.()
    this.stopWatch = null
  }
}

/**
 * The blocked state a shell's answer gives. `free` is offered (stale): only a
 * folder this page lost is reported free, since a claim takes a free folder.
 */
function desktopBlocked(status: DesktopWorkspaceOwnerStatus): WorkspaceOwnerState {
  if (status.kind === 'blocked') return { kind: 'blocked', holder: status.holder, stale: status.stale }
  if (status.kind === 'temporary') return { kind: 'temporary' }
  return { kind: 'blocked', stale: status.kind === 'free' }
}

/** An error as its name and message, so the log says what failed (a DOMException prints as "[object DOMException]"). */
function describeError(error: unknown): string {
  return error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException)
    ? `${error.name}: ${error.message}`
    : String(error)
}

/** Whether two states say the same thing (so a subscriber is not woken for nothing). */
function sameOwnerState(a: WorkspaceOwnerState, b: WorkspaceOwnerState): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'owned' || b.kind === 'owned') return true
  if (a.kind === 'temporary' || b.kind === 'temporary') return true
  if (a.kind === 'unreachable' || b.kind === 'unreachable') return true
  return a.stale === b.stale && sameHolder(a.holder, b.holder)
}

function sameHolder(a?: WorkspaceOwnerFileHolder, b?: WorkspaceOwnerFileHolder): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.app === b.app && a.startedAt === b.startedAt && a.heartbeatAt === b.heartbeatAt
}

/**
 * The store over the workspace folder: the app's own atomic JSON write, so
 * `.droneclean/owner.json` is never half written; a file another program left
 * there reads as no owner.
 */
function handleOwnerStore(root: FileSystemDirectoryHandle): WorkspaceOwnerPageStore {
  const segments = [WORKSPACE_OWNER_DIR, WORKSPACE_OWNER_FILE]
  const read = async (): Promise<unknown> => {
    try {
      return await readJson<unknown>(root, segments)
    } catch (error) {
      // `readJson` throws on a corrupt file; a file that holds no record is no
      // owner, and the next writer replaces it.
      logger.warn('the owner record is unreadable', error)
      return null
    }
  }
  const claim = (nonce: string): string[] => [WORKSPACE_OWNER_DIR, `${WORKSPACE_CLAIM_PREFIX}${nonce}`]
  return {
    read,
    async write(record: WorkspaceOwnerFile): Promise<void> {
      await writeJsonAtomic(root, segments, record)
    },
    async remove(token: string): Promise<void> {
      const current = parseWorkspaceOwnerFile(await read())
      if (current?.token !== token) return
      await removeEntry(root, segments)
    },
    async writeClaim(nonce: string): Promise<void> {
      // Chromium reports this check to the shell with the folder's path, so the
      // shell has the folder in its list before it looks for the claim file.
      await queryHandlePermission(root)
      await writeBlob(root, claim(nonce), nonce)
    },
    async removeClaim(nonce: string): Promise<void> {
      await removeEntry(root, claim(nonce))
    },
  }
}

/**
 * `navigator.locks.request(name, {mode: 'exclusive', ifAvailable: true}, …)`,
 * held until `release()`: a second tab of this origin is told `busy` at once,
 * and a closed tab's lock goes with it.
 */
async function takeOriginLock(name: string): Promise<WorkspaceOriginLock> {
  const manager = (
    navigator as unknown as {
      locks?: {
        request(
          name: string,
          options: { mode: 'exclusive'; ifAvailable: boolean },
          callback: (lock: unknown) => Promise<void>,
        ): Promise<unknown>
      }
    }
  ).locks
  if (!manager) return { kind: 'unsupported' }

  let release = (): void => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const acquired = await new Promise<boolean>((resolve) => {
    manager
      .request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        resolve(lock !== null && lock !== undefined)
        if (lock === null || lock === undefined) return
        await held
      })
      .catch(() => resolve(false))
  })
  return acquired ? { kind: 'acquired', release: () => release() } : { kind: 'busy' }
}

/** The environment the app runs in. */
function createBrowserEnvironment(): WorkspaceOwnerEnvironment {
  return {
    desktop() {
      if (typeof window === 'undefined') return undefined
      // The shell's `preload/workspace-owner.ts` puts it there; absent in a browser.
      return (
        window as Window & { dronecleanWorkspaceOwner?: DesktopWorkspaceOwnerBridge }
      ).dronecleanWorkspaceOwner
    },
    store: handleOwnerStore,
    originLock: takeOriginLock,
    now: () => Date.now(),
    originHost: () => location.host,
    newToken: () => crypto.randomUUID(),
    every(callback, milliseconds) {
      const timer = setInterval(callback, milliseconds)
      return () => clearInterval(timer)
    },
    onPageHide(listener) {
      window.addEventListener('pagehide', listener, { once: true })
    },
    closeWindow() {
      window.close()
    },
    previousToken(workspaceId) {
      try {
        return sessionStorage.getItem(tabTokenKey(workspaceId))
      } catch {
        return null
      }
    },
    keepToken(workspaceId, token) {
      try {
        sessionStorage.setItem(tabTokenKey(workspaceId), token)
      } catch (error) {
        // Without it a reload finds this tab's record as another owner's, and
        // waits for it to go stale; nothing is written twice.
        logger.warn('could not keep the owner token for a reload', error)
      }
    },
    reloadPage() {
      window.location.reload()
    },
  }
}

/** Where a tab keeps its token across a reload: `sessionStorage` is the tab's own. */
function tabTokenKey(workspaceId: string): string {
  return `droneclean:workspace-owner:${workspaceId}`
}
