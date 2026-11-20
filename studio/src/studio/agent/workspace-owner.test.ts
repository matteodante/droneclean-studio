/**
 * One owner of a workspace folder, page side (task 2.3, design
 * `docs/designs/2.2-mcp.md` §4.10 layers 2 and 3).
 *
 * What is pinned here is everything the page decides without a disk: the two
 * layers of the browser (the tab's `navigator.locks` and the folder's record),
 * the 60-second staleness, Take over only when stale, the heartbeat that stops
 * instead of overwriting another owner, and the desktop path where the shell
 * owns the record and the page only reads the verdict.
 *
 * The record the page writes is read back by the **shell's** parser and typed
 * against the shell's status union (`desktop/src/shared/workspace-owner.ts`), so
 * the two halves of the lock are held together here, as `media.test.ts` holds
 * the page's media-path copy to the shell's.
 */
import { describe, expect, it } from 'vite-plus/test'
import type {
  DesktopWorkspaceOwner as ShellDesktopWorkspaceOwner,
  WorkspaceOwnerRecord as ShellWorkspaceOwnerRecord,
  WorkspaceOwnerStatus as ShellWorkspaceOwnerStatus,
} from '../../../desktop/src/shared/workspace-owner'
import {
  WORKSPACE_OWNER_HEARTBEAT_MS,
  WORKSPACE_OWNER_LIVE_MS,
} from '../../../desktop/src/shared/workspace-owner'
import {
  claimWorkspaceOwnership,
  isWorkspaceOwnerLive,
  parseWorkspaceOwnerFile,
  requireWorkspaceOwnership,
  WorkspaceNotOwnedError,
  type DesktopWorkspaceOwnerBridge,
  type DesktopWorkspaceOwnerStatus,
  type WorkspaceOwnerEnvironment,
  type WorkspaceOwnerFile,
  type WorkspaceOwnerState,
} from './workspace-owner'

const HANDLE = {} as FileSystemDirectoryHandle

/** One workspace id per test: ownership is per page and per folder. */
let folders = 0
function workspaceId(): string {
  folders += 1
  return `workspace-${folders}`
}

/** The design's record, as a desktop app or another page would have left it. */
function record(overrides: Partial<WorkspaceOwnerFile> = {}): WorkspaceOwnerFile {
  return {
    version: 1,
    app: 'desktop',
    pid: 4242,
    host: 'Mac.lan',
    startedAt: 1_000,
    heartbeatAt: 9_500,
    token: 'other-token',
    ...overrides,
  }
}

interface Timed {
  callback: () => void
  active: boolean
}

/** What the fake app was asked to do. */
interface Faked {
  /** The owner file, as it is at this moment. */
  file: unknown
  writes: WorkspaceOwnerFile[]
  removed: string[]
  busy: boolean
  lockName: string | null
  lockReleased: boolean
  timers: Timed[]
  pageHide: Array<() => void>
  closed: number
  now: number
  tokens: number
  /** The claim files (`.droneclean/claim-<nonce>`) in the folder at this moment. */
  claims: Set<string>
  /** What this tab's sessionStorage keeps across a reload, per workspace. */
  kept: Map<string, string>
  /** How many times the page asked to be reloaded. */
  reloads: number
}

/**
 * The page's world without a disk: one file, one origin lock, timers the test
 * runs by hand, and optionally a desktop shell's bridge.
 */
function fakeApp(
  options: {
    file?: unknown
    busy?: boolean
    desktop?: DesktopWorkspaceOwnerBridge
    kept?: Map<string, string>
    /** The claim file cannot be written: the folder is gone, renamed or read-only. */
    claimFails?: boolean
  } = {},
): {
  environment: WorkspaceOwnerEnvironment
  faked: Faked
} {
  const faked: Faked = {
    file: options.file ?? null,
    writes: [],
    removed: [],
    busy: options.busy ?? false,
    lockName: null,
    lockReleased: false,
    timers: [],
    pageHide: [],
    closed: 0,
    now: 10_000,
    tokens: 0,
    claims: new Set(),
    kept: options.kept ?? new Map(),
    reloads: 0,
  }
  const environment: WorkspaceOwnerEnvironment = {
    desktop: () => options.desktop,
    store: () => ({
      read: async () => faked.file,
      write: async (written) => {
        faked.file = written
        faked.writes.push(written)
      },
      remove: async (token) => {
        const current = parseWorkspaceOwnerFile(faked.file)
        if (current?.token !== token) return
        faked.file = null
        faked.removed.push(token)
      },
      writeClaim: async (nonce) => {
        if (options.claimFails) throw new DOMException('A requested file or directory could not be found', 'NotFoundError')
        faked.claims.add(nonce)
      },
      removeClaim: async (nonce) => {
        faked.claims.delete(nonce)
      },
    }),
    originLock: async (name) => {
      faked.lockName = name
      if (faked.busy) return { kind: 'busy' }
      return {
        kind: 'acquired',
        release: () => {
          faked.lockReleased = true
        },
      }
    },
    now: () => faked.now,
    originHost: () => 'localhost:4399',
    newToken: () => {
      faked.tokens += 1
      return `token-${faked.tokens}`
    },
    every: (callback) => {
      const timed: Timed = { callback, active: true }
      faked.timers.push(timed)
      return () => {
        timed.active = false
      }
    },
    onPageHide: (listener) => {
      faked.pageHide.push(listener)
    },
    closeWindow: () => {
      faked.closed += 1
    },
    previousToken: (workspaceId) => faked.kept.get(workspaceId) ?? null,
    keepToken: (workspaceId, token) => {
      faked.kept.set(workspaceId, token)
    },
    reloadPage: () => {
      faked.reloads += 1
    },
  }
  return { environment, faked }
}

/** The heartbeat the guard started, when it has one. */
function heartbeatOf(faked: Faked): Timed | undefined {
  return faked.timers.find((timed) => timed.active)
}

/**
 * Let the pending promises of one timer callback run. The guard's work is a
 * chain of `await`s over the fake store, so microtasks are enough — the loop
 * only stops waiting once the condition holds.
 */
/** Let every pending promise of one poll run (the fake store resolves immediately). */
async function flush(): Promise<void> {
  for (let step = 0; step < 50; step += 1) await Promise.resolve()
}

async function settled(condition: () => boolean): Promise<void> {
  for (let step = 0; step < 200; step += 1) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error('the guard did not settle')
}

describe('the owner record', () => {
  it('is the shell’s record: the same fields, read back by the shell’s parser', async () => {
    const id = workspaceId()
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, id, environment)

    expect(guard.state()).toEqual({ kind: 'owned' })
    expect(faked.writes).toHaveLength(1)
    const written = faked.writes[0] as WorkspaceOwnerFile
    expect(written).toEqual({
      version: 1,
      app: 'web',
      pid: 0,
      host: 'localhost:4399',
      startedAt: 10_000,
      heartbeatAt: 10_000,
      token: 'token-1',
    })
    // The shell's own record type: one contract, checked at compile time and in
    // the shell's own test (`desktop/test/workspace-lock.test.mjs`).
    const shellRecord: ShellWorkspaceOwnerRecord = written
    const pageRecord: WorkspaceOwnerFile = shellRecord
    expect(pageRecord).toEqual(written)
    expect(faked.lockName).toBe(`droneclean:workspace:${id}`)
    guard.release()
  })

  it('accepts a record and refuses anything else', () => {
    expect(parseWorkspaceOwnerFile(record())).toEqual(record())
    for (const broken of [
      null,
      'a string',
      [],
      { ...record(), version: 2 },
      { ...record(), app: 'electron' },
      { ...record(), pid: '4242' },
      { ...record(), startedAt: 'yesterday' },
      { ...record(), token: '' },
    ]) {
      expect(parseWorkspaceOwnerFile(broken)).toBeNull()
    }
  })

  it('is live for 60 s of heartbeat, from the page’s side too', () => {
    expect(isWorkspaceOwnerLive(record({ heartbeatAt: 1_000 }), 1_000)).toBe(true)
    expect(
      isWorkspaceOwnerLive(record({ heartbeatAt: 1_000 }), 1_000 + WORKSPACE_OWNER_LIVE_MS - 1),
    ).toBe(true)
    expect(
      isWorkspaceOwnerLive(record({ heartbeatAt: 1_000 }), 1_000 + WORKSPACE_OWNER_LIVE_MS),
    ).toBe(false)
  })
})

describe('a browser page', () => {
  it('takes a free folder and leaves a live one alone', async () => {
    const free = fakeApp()
    const first = await claimWorkspaceOwnership(HANDLE, workspaceId(), free.environment)
    expect(first.state()).toEqual({ kind: 'owned' })
    first.release()

    const taken = fakeApp({ file: record({ heartbeatAt: 9_500 }) })
    const second = await claimWorkspaceOwnership(HANDLE, workspaceId(), taken.environment)
    expect(second.state()).toEqual({
      kind: 'blocked',
      holder: { app: 'desktop', startedAt: 1_000, heartbeatAt: 9_500 },
      stale: false,
    })
    expect(taken.faked.writes).toHaveLength(0)
    expect(taken.faked.lockReleased).toBe(true)
  })

  it('leaves a live record of its own origin alone: a free tab lock is no proof (another browser has its own)', async () => {
    const sameOrigin = record({ app: 'web', pid: 0, host: 'localhost:4399', heartbeatAt: 10_000 })
    const { environment, faked } = fakeApp({ file: sameOrigin })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toEqual({
      kind: 'blocked',
      holder: { app: 'web', startedAt: 1_000, heartbeatAt: 10_000 },
      stale: false,
    })
    expect(faked.writes).toHaveLength(0)
    expect(faked.file).toEqual(sameOrigin)
    expect(faked.lockReleased).toBe(true)
  })

  it('takes back the record this tab left before a reload, and only that one', async () => {
    const id = workspaceId()
    const left = record({ app: 'web', pid: 0, host: 'localhost:4399', heartbeatAt: 10_000, token: 'before-reload' })
    const { environment, faked } = fakeApp({ file: left, kept: new Map([[id, 'before-reload']]) })
    const guard = await claimWorkspaceOwnership(HANDLE, id, environment)
    expect(guard.state()).toEqual({ kind: 'owned' })
    expect(faked.writes.at(-1)?.token).toBe('token-1')
    expect(faked.kept.get(id)).toBe('token-1')
    guard.release()
  })

  it('does not take another origin’s fresh record', async () => {
    const other = record({ app: 'web', pid: 0, host: 'other.example:5000', heartbeatAt: 10_000 })
    const { environment, faked } = fakeApp({ file: other })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toMatchObject({ kind: 'blocked', stale: false })
    expect(faked.writes).toHaveLength(0)
  })

  it('shows the modal at once when another tab of this origin holds the tab lock', async () => {
    const { environment, faked } = fakeApp({ busy: true, file: record() })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)

    expect(guard.state().kind).toBe('blocked')
    expect(faked.writes).toHaveLength(0)
    expect(faked.file).toEqual(record())
  })

  it('offers Take over only once the owner is stale, and then takes it', async () => {
    const stale = record({ heartbeatAt: 10_000 - WORKSPACE_OWNER_LIVE_MS })
    const { environment, faked } = fakeApp({ file: stale })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toEqual({
      kind: 'blocked',
      holder: { app: 'desktop', startedAt: 1_000, heartbeatAt: stale.heartbeatAt },
      stale: true,
    })

    const taken = await guard.takeOver()
    expect(taken).toEqual({ kind: 'owned' })
    expect(faked.writes.at(-1)?.token).toBe('token-1')
    expect(faked.writes.at(-1)?.app).toBe('web')
    expect(faked.reloads).toBe(0)
    guard.release()
  })

  it('reloads the page after taking back a folder it lost, and saves nothing until then', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    faked.file = record({ heartbeatAt: 9_900, token: 'winner-token' })
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)

    // The other window goes silent; Take over takes the folder back. What this
    // page holds in memory is older than what the other window saved, so the
    // page reloads from disk, and no save goes through on the way there.
    faked.now = 9_900 + WORKSPACE_OWNER_LIVE_MS
    expect(await guard.takeOver()).toEqual({ kind: 'owned' })
    expect(faked.reloads).toBe(1)
    expect(parseWorkspaceOwnerFile(faked.file)?.token).toBe('token-2')
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
    expect(faked.kept.size).toBe(1)
    guard.release()
  })

  it('never takes a live owner’s place, even when asked to', async () => {
    const live = record({ heartbeatAt: 9_500 })
    const { environment, faked } = fakeApp({ file: live })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)

    expect((await guard.takeOver()).kind).toBe('blocked')
    expect(faked.file).toEqual(live)
  })

  it('asks for one lock and writes one record when the gate runs twice (StrictMode)', async () => {
    const id = workspaceId()
    const { environment, faked } = fakeApp()
    const [first, second] = await Promise.all([
      claimWorkspaceOwnership(HANDLE, id, environment),
      claimWorkspaceOwnership(HANDLE, id, environment),
    ])

    expect(first.state()).toEqual({ kind: 'owned' })
    expect(second.state()).toEqual({ kind: 'owned' })
    expect(faked.writes).toHaveLength(1)
    expect(faked.tokens).toBe(1)
    first.release()
    second.release()
  })

  it('refreshes the heartbeat every 5 s and keeps the start', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    const heartbeat = heartbeatOf(faked)
    expect(heartbeat).toBeDefined()

    faked.now = 15_000
    heartbeat?.callback()
    await settled(() => parseWorkspaceOwnerFile(faked.file)?.heartbeatAt === 15_000)

    const written = parseWorkspaceOwnerFile(faked.file)
    expect(written?.startedAt).toBe(10_000)
    expect(written?.heartbeatAt).toBe(15_000)
    guard.release()
  })

  it('opens a same-origin tab’s folder once that tab gives it back', async () => {
    const own = record({ app: 'web', pid: 0, host: 'localhost:4399', heartbeatAt: 10_000 })
    const { environment, faked } = fakeApp({ busy: true, file: own })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    guard.watch(() => {})
    const poll = faked.timers.at(-1)
    expect(guard.state()).toMatchObject({ kind: 'blocked', stale: false })

    faked.busy = false
    poll?.callback()
    await flush()
    expect(guard.state()).toMatchObject({ kind: 'blocked', stale: false })

    faked.file = null
    poll?.callback()
    await settled(() => guard.state().kind === 'owned')
    expect(faked.writes.at(-1)?.token).toBe('token-1')
    guard.release()
  })

  it('keeps waiting while a same-origin tab still holds the lock', async () => {
    const own = record({ app: 'web', pid: 0, host: 'localhost:4399', heartbeatAt: 10_000 })
    const { environment, faked } = fakeApp({ busy: true, file: own })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    guard.watch(() => {})
    const poll = faked.timers.at(-1)

    poll?.callback()
    await flush()
    expect(guard.state()).toMatchObject({ kind: 'blocked', stale: false })
    expect(faked.writes).toHaveLength(0)
  })

  it('turns read-only when its heartbeat finds another owner’s record, and leaves it alone', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    const heartbeat = heartbeatOf(faked)
    const winner = record({ heartbeatAt: 9_900, token: 'winner-token' })
    faked.file = winner

    heartbeat?.callback()
    await settled(() => heartbeat?.active === false)

    expect(faked.file).toEqual(winner)
    expect(guard.state()).toEqual({
      kind: 'blocked',
      holder: { app: 'desktop', startedAt: 1_000, heartbeatAt: 9_900 },
      stale: false,
    })
    expect(faked.lockReleased).toBe(true)
  })

  it('turns read-only when its record is gone, and does not write it again by itself', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    guard.watch(() => {})
    const heartbeat = heartbeatOf(faked)
    faked.file = null

    heartbeat?.callback()
    await settled(() => guard.state().kind === 'blocked')
    expect(faked.writes).toHaveLength(1)

    // The poll of a lost folder offers Take over and never takes it alone: what
    // this page holds in memory may be older than what the other window saved.
    const poll = faked.timers.filter((timed) => timed.active).at(-1)
    poll?.callback()
    await flush()
    expect(guard.state()).toEqual({ kind: 'blocked', stale: true })
    expect(faked.writes).toHaveLength(1)

    expect(await guard.takeOver()).toEqual({ kind: 'owned' })
    expect(faked.writes.at(-1)?.token).toBe('token-2')
    guard.release()
  })

  it('refuses a save once the record is another owner’s, and allows it while it is its own', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    await expect(requireWorkspaceOwnership()).resolves.toBeUndefined()

    faked.file = record({ heartbeatAt: 9_900, token: 'winner-token' })
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
    expect(guard.state()).toMatchObject({ kind: 'blocked', stale: false })
    // Read-only stays read-only: the next save is refused too.
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
  })

  it('gives the folder back on release, and only its own record', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    guard.release()

    expect(faked.file).toBeNull()
    expect(faked.removed).toEqual(['token-1'])
    expect(faked.lockReleased).toBe(true)

    const other = record()
    const second = fakeApp({ file: other })
    const blocker = await claimWorkspaceOwnership(HANDLE, workspaceId(), second.environment)
    blocker.release()
    expect(second.faked.file).toEqual(other)
  })

  it('hands the folder back when the page goes away', async () => {
    const { environment, faked } = fakeApp()
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(faked.pageHide).toHaveLength(1)

    faked.pageHide[0]?.()
    await Promise.resolve()
    expect(faked.file).toBeNull()
    expect(guard.state().kind).toBe('owned')
  })

  it('opens the folder once the modal’s poll sees it free, and reports staleness before that', async () => {
    const id = workspaceId()
    const { environment, faked } = fakeApp({ file: record({ heartbeatAt: 10_000 }) })
    const guard = await claimWorkspaceOwnership(HANDLE, id, environment)
    const states: string[] = []
    guard.watch((state) => states.push(state.kind === 'owned' ? 'owned' : 'blocked'))
    const poll = faked.timers.at(-1)
    expect(poll).toBeDefined()

    // Still fresh: no change, no Take over.
    poll?.callback()
    await settled(() => guard.state().kind === 'blocked')
    expect(guard.state()).toEqual({
      kind: 'blocked',
      holder: { app: 'desktop', startedAt: 1_000, heartbeatAt: 10_000 },
      stale: false,
    })

    // 60 s later: stale, Take over appears.
    faked.now = 10_000 + WORKSPACE_OWNER_LIVE_MS
    poll?.callback()
    await settled(() => {
      const state = guard.state()
      return state.kind === 'blocked' && state.stale
    })

    // The owner closes cleanly: the next poll takes the folder and the gate opens it.
    faked.file = null
    poll?.callback()
    await settled(() => guard.state().kind === 'owned')
    expect(states.at(-1)).toBe('owned')
    guard.release()
  })
})

describe('the desktop app', () => {
  /** A shell whose answers the test sets. */
  function fakeShell() {
    const calls: string[] = []
    let status: DesktopWorkspaceOwnerStatus = { kind: 'owned' }
    let takeOver: DesktopWorkspaceOwnerStatus = { kind: 'owned' }
    let onStatus: DesktopWorkspaceOwnerStatus = { kind: 'owned' }
    const nonces: string[] = []
    let onAcquire: (nonce: string) => void = () => undefined
    const desktop: DesktopWorkspaceOwnerBridge = {
      acquire: async (nonce) => {
        calls.push('acquire')
        nonces.push(nonce)
        onAcquire(nonce)
        return status
      },
      status: async () => {
        calls.push('status')
        return onStatus
      },
      takeOver: async () => {
        calls.push('takeOver')
        return takeOver
      },
      close: () => {
        calls.push('close')
      },
    }
    const shellBridge: ShellDesktopWorkspaceOwner = desktop
    return {
      desktop,
      shellBridge,
      calls,
      nonces,
      whenAcquired: (listener: (nonce: string) => void) => {
        onAcquire = listener
      },
      answerClaim: (next: DesktopWorkspaceOwnerStatus) => {
        status = next
      },
      answerStatus: (next: DesktopWorkspaceOwnerStatus) => {
        onStatus = next
      },
      answerTakeOver: (next: DesktopWorkspaceOwnerStatus) => {
        takeOver = next
      },
    }
  }

  it('proves its folder to the shell with a claim file, and writes no record itself', async () => {
    const shell = fakeShell()
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const present: boolean[] = []
    shell.whenAcquired((nonce) => present.push(faked.claims.has(nonce)))
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)

    expect(guard.state()).toEqual({ kind: 'owned' })
    expect(shell.calls).toEqual(['acquire'])
    expect(shell.nonces).toEqual(['token-1'])
    expect(present).toEqual([true])
    expect(faked.claims.size).toBe(0)
    expect(faked.writes).toHaveLength(0)
    expect(faked.lockName).toBeNull()
  })

  it('shows the holder the shell named, and takes over only through the shell', async () => {
    const shell = fakeShell()
    const holder = { app: 'web' as const, startedAt: 1_000, heartbeatAt: 9_500 }
    shell.answerClaim({ kind: 'blocked', holder, stale: false })
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toEqual({ kind: 'blocked', holder, stale: false })

    shell.answerTakeOver({ kind: 'owned' })
    expect(await guard.takeOver()).toEqual({ kind: 'owned' })
    expect(shell.calls).toEqual(['acquire', 'takeOver'])
    expect(faked.reloads).toBe(0)
  })

  it('follows the shell’s verdict while the modal is open', async () => {
    const shell = fakeShell()
    shell.answerClaim({ kind: 'blocked', stale: false })
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    const states: string[] = []
    guard.watch((state) => states.push(state.kind))
    const poll = faked.timers.at(-1)

    shell.answerStatus({ kind: 'blocked', stale: true })
    poll?.callback()
    await settled(() => {
      const state = guard.state()
      return state.kind === 'blocked' && state.stale
    })

    // The other app closes: the shell frees the folder and the claim takes it.
    shell.answerStatus({ kind: 'free' })
    shell.answerClaim({ kind: 'owned' })
    poll?.callback()
    await settled(() => guard.state().kind === 'owned')
    expect(states.at(-1)).toBe('owned')
  })

  it('closes the app through the shell', async () => {
    const shell = fakeShell()
    shell.answerClaim({ kind: 'blocked', stale: true })
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    guard.close()
    expect(shell.calls).toEqual(['acquire', 'close'])
    expect(faked.closed).toBe(0)
  })

  it('opens nothing when the shell cannot place the folder, and says it is unreachable, not held', async () => {
    const shell = fakeShell()
    shell.answerClaim({ kind: 'unowned' })
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toEqual({ kind: 'unreachable' })
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
    expect(faked.timers).toHaveLength(0)
  })

  it('a folder it cannot write its claim into (deleted, renamed, read-only) is unreachable, and the shell is not asked', async () => {
    const shell = fakeShell()
    const { environment } = fakeApp({ desktop: shell.desktop, claimFails: true })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toEqual({ kind: 'unreachable' })
    expect(shell.calls).toEqual([])
  })

  it('E1: a temporary folder is not opened, and the guard says why', async () => {
    const shell = fakeShell()
    shell.answerClaim({ kind: 'temporary' })
    const { environment } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    expect(guard.state()).toEqual({ kind: 'temporary' })
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
    expect(shell.calls).toEqual(['acquire'])
  })

  it('turns an open project read-only when the shell says the folder was lost', async () => {
    const shell = fakeShell()
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    const states: WorkspaceOwnerState[] = []
    guard.watch((state) => states.push(state))
    const check = heartbeatOf(faked)
    expect(check).toBeDefined()

    const holder = { app: 'web' as const, startedAt: 1_000, heartbeatAt: 9_900 }
    shell.answerStatus({ kind: 'blocked', holder, stale: false })
    check?.callback()
    await settled(() => guard.state().kind === 'blocked')
    expect(states.at(-1)).toEqual({ kind: 'blocked', holder, stale: false })

    // The other app closes: the folder is free, but this window was read-only
    // meanwhile, so it is offered, not taken.
    shell.answerStatus({ kind: 'free' })
    const poll = faked.timers.filter((timed) => timed.active).at(-1)
    poll?.callback()
    await settled(() => {
      const state = guard.state()
      return state.kind === 'blocked' && state.stale
    })
    expect(shell.calls).not.toContain('takeOver')
    expect(shell.calls.filter((call) => call === 'acquire')).toHaveLength(1)
  })

  it('reloads the page after the shell takes back a folder the page lost', async () => {
    const shell = fakeShell()
    const { environment, faked } = fakeApp({ desktop: shell.desktop })
    const guard = await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    shell.answerStatus({ kind: 'blocked', stale: true })
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)

    shell.answerTakeOver({ kind: 'owned' })
    shell.answerStatus({ kind: 'owned' })
    expect(await guard.takeOver()).toEqual({ kind: 'owned' })
    expect(faked.reloads).toBe(1)
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
  })

  it('asks the shell before every save', async () => {
    const shell = fakeShell()
    const { environment } = fakeApp({ desktop: shell.desktop })
    await claimWorkspaceOwnership(HANDLE, workspaceId(), environment)
    await expect(requireWorkspaceOwnership()).resolves.toBeUndefined()
    expect(shell.calls).toEqual(['acquire', 'status'])

    shell.answerStatus({ kind: 'blocked', stale: false })
    await expect(requireWorkspaceOwnership()).rejects.toBeInstanceOf(WorkspaceNotOwnedError)
  })

  it('has the same status union as the shell', () => {
    // Compile-time: the page's copy and the shell's copy must not drift.
    const page: DesktopWorkspaceOwnerStatus = { kind: 'free' }
    const shell: ShellWorkspaceOwnerStatus = page
    const back: DesktopWorkspaceOwnerStatus = shell
    expect(back).toEqual({ kind: 'free' })
    expect(WORKSPACE_OWNER_HEARTBEAT_MS).toBe(5_000)
  })
})
