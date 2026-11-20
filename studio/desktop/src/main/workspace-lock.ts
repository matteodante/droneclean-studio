/**
 * One owner of a workspace folder, in the main process (task 2.3, design
 * `docs/designs/2.2-mcp.md` §4.10 layer 2, review findings D1 and D2).
 *
 * The page writes `project.json`, `index.json` and `media/…` into the workspace
 * folder; nothing in the folder can tell two writers apart, so the folder itself
 * carries the answer: `.droneclean/owner.json` (shape and numbers in
 * `shared/workspace-owner.ts`).
 *
 * **Claiming is one exclusive create.** `owner.json` is created with
 * `open(…, 'wx')`, which fails when the file exists: of two instances claiming
 * at once exactly one creates it, the other finds it and shows the modal. There
 * is no read-then-write step to race through (`test/workspace-lock-race.test.mjs`
 * runs two processes against one folder). A record is never overwritten to take
 * a folder: it is replaced only by **Take over** — the person's click — and only
 * when its owner is confirmed dead (this app, this machine, its pid gone) or its
 * heartbeat is 60 s old. The replacement renames the record to a name of its own,
 * checks that what it moved is the record it judged (an owner that wrote in
 * between is put back), and then creates exclusively like any claim.
 *
 * A file that holds no record — another program's, or an owner caught in the
 * instant between its create and its write — is not a free folder: it blocks
 * like a record whose owner is unknown, and is stale once its modification time
 * is 60 s old.
 *
 * **The heartbeat and every check read the token first.** The heartbeat opens
 * the record, reads it through that descriptor, and writes in place only when the
 * token is this instance's — so a record another owner put there is never
 * written over, and a write that loses a race lands in the file that was set
 * aside. `status()` (the page's poll, and its check before every save) reads the
 * file too: a record that is not this instance's, or no record, means this
 * instance has lost the folder and stops writing.
 *
 * **Which folder.** The page holds a `FileSystemDirectoryHandle`, which has no
 * path. The shell sees every `fileSystem` permission check Chromium makes, with
 * the real path (`observeWorkspaceAccess`, called from the policy in
 * `index.ts`), and remembers the granted folders — but a granted folder is not
 * the workspace: it may be a footage folder. The page proves its folder by
 * writing `.droneclean/claim-<nonce>` through its handle and passing the nonce to
 * `acquire`; the shell holds the remembered folder that has that file, and gives
 * back the folder it held before (a workspace switch reloads the page, which
 * claims again). Nothing is written into a folder until the page has proved it.
 *
 * **Who is live.** A record is live while its heartbeat is younger than 60 s
 * and, when it was written by this app on this machine, while its pid is still a
 * running process (`process.kill(pid, 0)`; `EPERM` counts as alive, as FreeCut's
 * headless writer lock does). An owner the shell cannot check — a browser page,
 * another machine — goes stale after 60 s.
 *
 * **Not a temporary folder** (review finding E1). A workspace inside a temporary
 * location (`os.tmpdir()`, `/private/var/folders`, `/tmp`, `%TEMP%`) is refused
 * when the page proves it: the system may delete such a folder, and the projects
 * in it with it. The answer is `temporary`; nothing is written into the folder.
 * Real paths are compared, so a symlink into a temporary folder is refused too.
 *
 * The page calls this through `window.dronecleanWorkspaceOwner`
 * (`preload/workspace-owner.ts`), registered here as a second session preload
 * the way `index.ts` registers the agent switch's.
 */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  WORKSPACE_CLAIM_PREFIX,
  WORKSPACE_OWNER_CHANNELS,
  WORKSPACE_OWNER_DIR,
  WORKSPACE_OWNER_FILE,
  WORKSPACE_OWNER_HEARTBEAT_MS,
  WORKSPACE_OWNER_LIVE_MS,
  type WorkspaceOwnerHolder,
  type WorkspaceOwnerRecord,
  type WorkspaceOwnerStatus,
} from '../shared/workspace-owner'
import { APP_HOST, APP_SCHEME } from './protocol'
import { appOnly, appOnlySend } from './sender'

const APP_TAG = 'workspace-lock'

/**
 * The record in `owner.json`, or null when the file is absent or does not hold a
 * record this version understands. A file another program left there is not an
 * owner: it cannot name a live writer, so the next owner replaces it.
 */
export function parseWorkspaceOwnerRecord(text: string): WorkspaceOwnerRecord | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<WorkspaceOwnerRecord>
  const app = record.app
  const numbers = [record.startedAt, record.heartbeatAt]
  if (
    record.version !== 1 ||
    (app !== 'desktop' && app !== 'web') ||
    !numbers.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
    typeof record.pid !== 'number' ||
    typeof record.host !== 'string' ||
    typeof record.token !== 'string' ||
    record.token.length === 0
  ) {
    return null
  }
  return {
    version: 1,
    app,
    pid: record.pid,
    host: record.host,
    startedAt: record.startedAt as number,
    heartbeatAt: record.heartbeatAt as number,
    token: record.token,
  }
}

/** What {@link isWorkspaceOwnerLive} reads besides the record. */
export interface LivenessCheck {
  /** Epoch milliseconds now. */
  readonly now: number
  /** This machine's host name (`os.hostname()`). */
  readonly hostname: string
  /** `process.kill(pid, 0)` as a tri-state: true alive, false gone, null unknown. */
  readonly isPidAlive: (pid: number) => boolean | null
}

/**
 * Whether `record` names an owner that is still running (design §4.10 layer 2).
 *
 * A heartbeat 60 s old or older is stale, whatever the pid says: a page whose
 * timer the browser throttled, a machine that suspended, or a process that hung
 * all look the same from here, and none of them may keep a folder forever. The
 * pid is checked on top of that, and only for this app on this machine: a live
 * pid cannot make an old heartbeat fresh, and a dead pid makes the record stale
 * before the 60 s are up.
 */
export function isWorkspaceOwnerLive(
  record: WorkspaceOwnerRecord,
  check: LivenessCheck,
): boolean {
  if (check.now - record.heartbeatAt >= WORKSPACE_OWNER_LIVE_MS) return false
  if (record.app !== 'desktop') return true
  if (record.host !== check.hostname) return true
  if (!Number.isInteger(record.pid) || record.pid <= 0) return true
  return check.isPidAlive(record.pid) !== false
}

/** `process.kill(pid, 0)` as the tri-state above; anything but ESRCH/EPERM is unknown. */
export function localPidIsAlive(pid: number): boolean | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return null
  }
}

/** The temporary locations of this machine, as the page's workspace must not be inside one. */
export function temporaryRoots(): string[] {
  const roots = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
  if (process.platform === 'win32') {
    for (const name of ['TEMP', 'TMP']) {
      const value = process.env[name]
      if (value) roots.push(value)
    }
  }
  return roots
}

/** The real path of `target`, or of its nearest existing parent with the rest appended. */
function realPathOf(target: string): string {
  const absolute = path.resolve(target)
  const missing: string[] = []
  let current = absolute
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return absolute
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

/** Whether `inner` is `outer` or below it (both real paths; case-blind where the file system is). */
function isInside(inner: string, outer: string): boolean {
  const fold = (value: string): string =>
    process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value
  const relative = path.relative(fold(outer), fold(inner))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Whether `folder` lies inside one of the temporary locations. Compares real
 * paths on both sides, so a symlink into a temporary folder counts and a
 * symlink out of one does not.
 */
export function isTemporaryFolder(folder: string, roots: readonly string[] = temporaryRoots()): boolean {
  const real = realPathOf(folder)
  return roots.some((root) => isInside(real, realPathOf(root)))
}

/** What the owner names in the modal. */
function holderOf(record: WorkspaceOwnerRecord): WorkspaceOwnerHolder {
  return { app: record.app, startedAt: record.startedAt, heartbeatAt: record.heartbeatAt }
}

/** What `owner.json` holds at one moment. */
type OwnerFile =
  | { readonly kind: 'none' }
  | { readonly kind: 'record'; readonly record: WorkspaceOwnerRecord; readonly text: string }
  /** Not a record: another program's file, or an owner between its create and its write. */
  | { readonly kind: 'unreadable'; readonly text: string; readonly modifiedAt: number }

const OWNED: WorkspaceOwnerStatus = { kind: 'owned' }

/** Create `file` holding `text`, failing with `EEXIST` when it is already there. */
function createExclusive(file: string, text: string): void {
  const descriptor = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeSync(descriptor, text)
  } catch (error) {
    // The file is this call's (it did not exist a moment ago); a half-written
    // record must not block the folder for a minute.
    fs.closeSync(descriptor)
    fs.rmSync(file, { force: true })
    throw error
  }
  fs.closeSync(descriptor)
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

/** What {@link WorkspaceOwnerLock} needs from the process, injectable for the tests. */
export interface WorkspaceOwnerLockOptions {
  /** The workspace folder: `owner.json` goes in `.droneclean/` below it. */
  readonly workspaceDir: string
  /** This process's id, written into the record. */
  readonly pid?: number
  /** This machine's host name, written into the record. */
  readonly hostname?: string
  /** Epoch milliseconds; a fake clock in the tests. */
  readonly now?: () => number
  /** A fresh token per ownership. */
  readonly newToken?: () => string
  /** The pid check; a fake one in the tests. */
  readonly isPidAlive?: (pid: number) => boolean | null
}

/**
 * The lock of one workspace folder, owned by this process while `token` is set.
 *
 * `acquire()` is the page's claim: it takes a free folder and reports a taken
 * one, including a stale one, without ever displacing anybody. `status()` only
 * reads — the modal polls it, the open editor polls it, and every save asks it;
 * a poll must not take the folder behind the person's back. `takeOver()` is the
 * person's click. `release()` removes this process's record, and is a no-op
 * when the record is someone else's.
 */
export class WorkspaceOwnerLock {
  readonly workspaceDir: string
  private readonly pid: number
  private readonly hostname: string
  private readonly now: () => number
  private readonly newToken: () => string
  private readonly isPidAlive: (pid: number) => boolean | null
  private token: string | null = null
  private startedAt = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: WorkspaceOwnerLockOptions) {
    this.workspaceDir = options.workspaceDir
    this.pid = options.pid ?? process.pid
    this.hostname = options.hostname ?? os.hostname()
    this.now = options.now ?? Date.now
    this.newToken = options.newToken ?? randomUUID
    this.isPidAlive = options.isPidAlive ?? localPidIsAlive
  }

  /** The record's path, for the log line and the tests. */
  get filePath(): string {
    return path.join(this.workspaceDir, WORKSPACE_OWNER_DIR, WORKSPACE_OWNER_FILE)
  }

  /** Whether this process holds the folder (not merely found it free). */
  get isOwned(): boolean {
    return this.token !== null
  }

  /** The page's claim: take the folder when nobody holds it; never displace a record. */
  acquire(): WorkspaceOwnerStatus {
    if (this.token !== null) return this.refresh() ? OWNED : this.status()
    return this.claim()
  }

  /** Read the folder's owner and change nothing (the polls, and the check before a save). */
  status(): WorkspaceOwnerStatus {
    if (this.token !== null) {
      if (this.holdsRecord()) return OWNED
      this.lose()
    }
    const file = this.read()
    return file.kind === 'none' ? { kind: 'free' } : this.blockedBy(file)
  }

  /**
   * The person's click: take a free folder, or replace an owner that is
   * confirmed dead or 60 s silent. A live owner is never displaced.
   */
  takeOver(): WorkspaceOwnerStatus {
    if (this.token !== null) {
      if (this.holdsRecord()) return OWNED
      this.lose()
    }
    const judged = this.read()
    if (judged.kind === 'none') return this.claim()
    if (!this.isReplaceable(judged)) return this.blockedBy(judged)

    // Set the judged record aside under a name nobody else uses, then check that
    // what moved is what was judged: an owner that wrote in between is alive.
    const aside = `${this.filePath}.replaced-${randomUUID()}`
    try {
      fs.renameSync(this.filePath, aside)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return this.claim()
      console.error(`[${APP_TAG}] could not set ${this.filePath} aside: ${String(error)}`)
      return this.unavailable()
    }
    let moved: string | null = null
    try {
      moved = fs.readFileSync(aside, 'utf8')
    } catch (error) {
      console.warn(`[${APP_TAG}] could not read ${aside}: ${String(error)}`)
    }
    if (moved !== judged.text) {
      this.putBack(aside, moved)
      return this.blockedBy(this.read())
    }
    fs.rmSync(aside, { force: true })
    return this.claim()
  }

  /** Stop the heartbeat and remove this process's record, if it is still this process's. */
  release(): void {
    this.stopHeartbeat()
    const token = this.token
    this.token = null
    if (token === null) return
    let descriptor: number
    try {
      descriptor = fs.openSync(this.filePath, 'r')
    } catch {
      return
    }
    try {
      if (parseWorkspaceOwnerRecord(fs.readFileSync(descriptor, 'utf8'))?.token !== token) return
      // Remove the file that was read, not whatever has that name by now.
      const read = fs.fstatSync(descriptor)
      const named = fs.statSync(this.filePath)
      if (read.ino !== named.ino || read.dev !== named.dev) return
      fs.rmSync(this.filePath)
    } catch (error) {
      console.warn(`[${APP_TAG}] could not remove ${this.filePath}: ${String(error)}`)
    } finally {
      fs.closeSync(descriptor)
    }
  }

  /** One exclusive create of this process's record: the only way a folder is taken. */
  private claim(): WorkspaceOwnerStatus {
    const token = this.newToken()
    const startedAt = this.now()
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    } catch (error) {
      console.error(`[${APP_TAG}] could not create ${path.dirname(this.filePath)}: ${String(error)}`)
      return this.unavailable()
    }
    try {
      createExclusive(this.filePath, this.recordText(token, startedAt))
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return this.blockedBy(this.read())
      console.error(`[${APP_TAG}] could not write ${this.filePath}: ${String(error)}`)
      return this.unavailable()
    }
    this.token = token
    this.startedAt = startedAt
    this.startHeartbeat()
    return OWNED
  }

  /** Put back a record that was set aside by mistake, unless a new one took its place. */
  private putBack(aside: string, text: string | null): void {
    if (text !== null) {
      try {
        createExclusive(this.filePath, text)
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          console.error(`[${APP_TAG}] could not put ${this.filePath} back: ${String(error)}`)
          return
        }
      }
    }
    fs.rmSync(aside, { force: true })
  }

  private blockedBy(file: OwnerFile): WorkspaceOwnerStatus {
    if (file.kind === 'record') {
      return { kind: 'blocked', holder: holderOf(file.record), stale: !this.isLive(file.record) }
    }
    return { kind: 'blocked', stale: file.kind === 'unreadable' && this.isReplaceable(file) }
  }

  private unavailable(): WorkspaceOwnerStatus {
    return this.blockedBy(this.read())
  }

  private isReplaceable(file: OwnerFile): boolean {
    if (file.kind === 'record') return !this.isLive(file.record)
    if (file.kind === 'unreadable') return this.now() - file.modifiedAt >= WORKSPACE_OWNER_LIVE_MS
    return true
  }

  private isLive(record: WorkspaceOwnerRecord): boolean {
    return isWorkspaceOwnerLive(record, {
      now: this.now(),
      hostname: this.hostname,
      isPidAlive: this.isPidAlive,
    })
  }

  private read(): OwnerFile {
    let text: string
    let modifiedAt: number
    try {
      text = fs.readFileSync(this.filePath, 'utf8')
      modifiedAt = fs.statSync(this.filePath).mtimeMs
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        console.warn(`[${APP_TAG}] could not read ${this.filePath}: ${String(error)}`)
      }
      return { kind: 'none' }
    }
    const record = parseWorkspaceOwnerRecord(text)
    if (record !== null) return { kind: 'record', record, text }
    console.warn(`[${APP_TAG}] ${this.filePath} holds no record this version knows`)
    return { kind: 'unreadable', text, modifiedAt }
  }

  /** Whether the record on disk is this process's, now. */
  private holdsRecord(): boolean {
    const file = this.read()
    return file.kind === 'record' && file.record.token === this.token
  }

  /** This process no longer owns the folder: stop writing, for good. */
  private lose(): void {
    console.warn(`[${APP_TAG}] ${this.filePath} is no longer this process's; heartbeat stopped`)
    this.stopHeartbeat()
    this.token = null
  }

  private recordText(token: string, startedAt: number): string {
    const record: WorkspaceOwnerRecord = {
      version: 1,
      app: 'desktop',
      pid: this.pid,
      host: this.hostname,
      startedAt,
      heartbeatAt: this.now(),
      token,
    }
    return `${JSON.stringify(record, null, 2)}\n`
  }

  /**
   * One heartbeat: open the record, read the token through that descriptor, and
   * write in place only when it is this process's. A record that is another
   * owner's, or none, means the folder was lost.
   */
  private refresh(): boolean {
    const token = this.token
    if (token === null) return false
    let descriptor: number
    try {
      descriptor = fs.openSync(this.filePath, 'r+')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') this.lose()
      else console.warn(`[${APP_TAG}] could not open ${this.filePath}: ${String(error)}`)
      return false
    }
    try {
      if (parseWorkspaceOwnerRecord(fs.readFileSync(descriptor, 'utf8'))?.token !== token) {
        this.lose()
        return false
      }
      const bytes = Buffer.from(this.recordText(token, this.startedAt))
      fs.writeSync(descriptor, bytes, 0, bytes.length, 0)
      fs.ftruncateSync(descriptor, bytes.length)
      return true
    } catch (error) {
      console.warn(`[${APP_TAG}] heartbeat could not be written to ${this.filePath}: ${String(error)}`)
      return false
    } finally {
      fs.closeSync(descriptor)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.timer = setInterval(() => this.refresh(), WORKSPACE_OWNER_HEARTBEAT_MS)
    // The lock must not keep the process alive on its own.
    this.timer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }
}

/** The origin the preload is scoped to, as `index.ts` scopes the agent switch's. */
function editorOrigin(): string {
  const devUrl = process.env.DRONECLEAN_DEV_URL
  if (devUrl) {
    try {
      return new URL(devUrl).origin
    } catch {
      // A malformed dev URL falls through to the app's own origin.
    }
  }
  return `${APP_SCHEME}://${APP_HOST}`
}

/** A claim nonce the page made (`crypto.randomUUID()`); anything else names no file. */
const CLAIM_NONCE = /^[A-Za-z0-9-]{16,128}$/

/** How many granted folders the shell remembers; the workspace is checked just before its claim. */
const REMEMBERED_FOLDERS = 256

/**
 * The main process's owner of the folder the page opens: the folders Chromium
 * granted, the one lock the page proved, and the page's calls answered from it.
 */
export class WorkspaceOwnerHost {
  private readonly lockOptions: Omit<WorkspaceOwnerLockOptions, 'workspaceDir'>
  private readonly temporaryRoots: readonly string[] | undefined
  /** Whether the last claim was a temporary folder, which the polls and Take over keep answering. */
  private refusedTemporary = false
  /** Granted folders, the most recent last. */
  private readonly granted: string[] = []
  private lock: WorkspaceOwnerLock | null = null
  private page: WebContents | null = null

  /** `temporaryRoots` replaces the machine's temporary locations (the tests'). */
  constructor(
    lockOptions: Omit<WorkspaceOwnerLockOptions, 'workspaceDir'> = {},
    options: { readonly temporaryRoots?: readonly string[] } = {},
  ) {
    this.lockOptions = lockOptions
    this.temporaryRoots = options.temporaryRoots
  }

  /** The folder the page proved and this process holds the lock of, or null before the first claim. */
  heldFolder(): string | null {
    return this.lock?.workspaceDir ?? null
  }

  /** Remember a folder the page was granted. Seeing a folder writes nothing into it. */
  observe(folder: string): void {
    const known = this.granted.indexOf(folder)
    if (known !== -1) this.granted.splice(known, 1)
    this.granted.push(folder)
    if (this.granted.length > REMEMBERED_FOLDERS) this.granted.shift()
  }

  /**
   * The page's claim: hold the granted folder that has `.droneclean/claim-<nonce>`,
   * giving back the folder held before, and take it when it is free. `unowned`
   * when no granted folder has the file.
   */
  acquire(nonce: unknown): WorkspaceOwnerStatus {
    const folder = typeof nonce === 'string' && CLAIM_NONCE.test(nonce) ? this.provenFolder(nonce) : null
    if (folder === null) console.error(`[${APP_TAG}] no granted folder holds the page's claim`)
    this.refusedTemporary = false
    if (folder !== null && isTemporaryFolder(folder, this.temporaryRoots)) {
      console.error(`[${APP_TAG}] ${folder} is inside a temporary folder; the workspace is refused`)
      this.lock?.release()
      this.lock = null
      this.refusedTemporary = true
      return { kind: 'temporary' }
    }
    if (this.lock?.workspaceDir !== folder) {
      this.lock?.release()
      this.lock = folder === null ? null : new WorkspaceOwnerLock({ ...this.lockOptions, workspaceDir: folder })
    }
    return this.lock === null ? { kind: 'unowned' } : this.lock.acquire()
  }

  /** The polls and the check before a save: read the owner, take nothing. */
  status(): WorkspaceOwnerStatus {
    if (this.lock === null) return this.refusedTemporary ? { kind: 'temporary' } : { kind: 'unowned' }
    return this.lock.status()
  }

  /** The person's Take over, only for a dead, stale or absent owner. */
  takeOver(): WorkspaceOwnerStatus {
    if (this.lock === null) return this.refusedTemporary ? { kind: 'temporary' } : { kind: 'unowned' }
    return this.lock.takeOver()
  }

  /** Stop writing and remove this process's record. */
  release(): void {
    this.lock?.release()
  }

  /**
   * Give the folder back when the page that calls is gone: a closed window has
   * no writer, and the next launch (or the next window) takes the folder then.
   */
  notePage(sender: WebContents): void {
    if (this.page !== null) return
    this.page = sender
    sender.once('destroyed', () => {
      this.page = null
      this.release()
    })
  }

  private provenFolder(nonce: string): string | null {
    for (let index = this.granted.length - 1; index >= 0; index -= 1) {
      const folder = this.granted[index] as string
      const proof = path.join(folder, WORKSPACE_OWNER_DIR, `${WORKSPACE_CLAIM_PREFIX}${nonce}`)
      try {
        if (fs.statSync(proof).isFile()) return folder
      } catch {
        // Not this folder.
      }
    }
    return null
  }
}

/** The host `installWorkspaceOwnerLock` installed; `observeWorkspaceAccess` reports to it. */
let installedHost: WorkspaceOwnerHost | null = null

/**
 * Remember a folder Chromium granted. Called from the permission policy in
 * `index.ts` with the check's decision and details; the page's claim then says
 * which remembered folder is the workspace (see the module comment).
 */
export function observeWorkspaceAccess(
  granted: boolean,
  permission: string,
  details: { readonly filePath?: string; readonly isDirectory?: boolean },
): void {
  if (!granted || permission !== 'fileSystem' || details.isDirectory !== true) return
  const filePath = details.filePath
  if (typeof filePath !== 'string' || filePath.length === 0) return
  installedHost?.observe(filePath)
}

/**
 * The workspace folder on disk, as the page proved it, or null before the page claimed one: what a path the editor
 * gives relative to the workspace (an export's `savedPath`) is joined to, so an agent can name the file.
 */
export function heldWorkspaceFolder(): string | null {
  return installedHost?.heldFolder() ?? null
}

/** What the page may call; `close` quits, which is what a Close on the modal does. */
function showBlockedWindow(event: IpcMainInvokeEvent): void {
  BrowserWindow.fromWebContents(event.sender)?.show()
}

/**
 * Register the lock's IPC and its preload. Called once from `index.ts`, before
 * the window exists, and answers the page's calls from then on.
 */
export function installWorkspaceOwnerLock(target: Session): WorkspaceOwnerHost {
  const host = new WorkspaceOwnerHost()
  installedHost = host

  target.registerPreloadScript({
    id: 'droneclean-workspace-owner',
    type: 'frame',
    filePath: path.join(__dirname, '../preload/workspace-owner.js'),
    includeGlobs: [`${editorOrigin()}/*`],
  })

  const answer = (event: IpcMainInvokeEvent, status: WorkspaceOwnerStatus): WorkspaceOwnerStatus => {
    host.notePage(event.sender)
    return status
  }

  // Every handler answers the app's own page only (review finding D9).
  ipcMain.handle(
    WORKSPACE_OWNER_CHANNELS.acquire,
    appOnly((event: IpcMainInvokeEvent, nonce: unknown) => {
      const status = host.acquire(nonce)
      // A blocked hidden launch (an MCP client's) must show the modal: the person
      // at the machine is the only one who can close the other window. Only the
      // claim shows it; the polls that follow every 5 s must not raise the window.
      if (status.kind !== 'owned') showBlockedWindow(event)
      return answer(event, status)
    }),
  )
  ipcMain.handle(
    WORKSPACE_OWNER_CHANNELS.status,
    appOnly((event: IpcMainInvokeEvent) => answer(event, host.status())),
  )
  ipcMain.handle(
    WORKSPACE_OWNER_CHANNELS.takeOver,
    appOnly((event: IpcMainInvokeEvent) => answer(event, host.takeOver())),
  )
  ipcMain.on(
    WORKSPACE_OWNER_CHANNELS.close,
    appOnlySend(() => {
      host.release()
      app.quit()
    }),
  )
  app.on('will-quit', () => host.release())

  console.log(`[${APP_TAG}] owner file: <workspace>/${WORKSPACE_OWNER_DIR}/${WORKSPACE_OWNER_FILE}`)
  return host
}
