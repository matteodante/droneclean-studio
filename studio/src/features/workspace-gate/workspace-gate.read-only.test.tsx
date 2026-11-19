/**
 * Losing the workspace while a project is open (task 2.3, review finding D1):
 * the page turns read-only — a banner that stays, and saves that write nothing.
 *
 * Everything below the guard is real: the guard reads and writes
 * `.droneclean/owner.json` with the workspace's own file primitives, the project
 * is saved by the real `updateProject`, and the folder is the in-memory
 * directory handle the storage tests use. Only the clock, the timers and the tab
 * lock are the test's, so the 5-second heartbeat runs when the test says.
 */
import '@/infrastructure/storage/test-utils/storage-test-mocks'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import {
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from '@/infrastructure/storage/workspace-fs/fs-primitives'
import {
  createProject,
  getProject,
  updateProject,
} from '@/infrastructure/storage/workspace-fs/projects'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { saveProjectThumbnail } from '@/infrastructure/storage/workspace-fs/thumbnails'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import {
  claimWorkspaceOwnership,
  parseWorkspaceOwnerFile,
  type WorkspaceOwnerEnvironment,
} from '@/studio/agent/workspace-owner'
import { WorkspaceReadOnlyBanner } from './workspace-gate'

const OWNER = ['.droneclean', 'owner.json']

// Whether the open project has edits no save wrote: the timeline's dirty flag
// (`unsaved-edits.test.ts` holds the module to it); here the test sets it.
const edits = vi.hoisted(() => ({ unsaved: false }))
vi.mock('@/studio/agent/unsaved-edits', () => ({ hasUnsavedProjectEdits: () => edits.unsaved }))

/** The page's world over the folder it is given, with timers the test runs by hand. */
function pageOver() {
  const timers: Array<{ callback: () => void; active: boolean }> = []
  const clock = { now: 10_000 }
  const kept = new Map<string, string>()
  const page = { reloads: 0 }
  let tokens = 0
  const environment: WorkspaceOwnerEnvironment = {
    desktop: () => undefined,
    store: (folder) => ({
      read: () => readJson<unknown>(folder, OWNER),
      write: async (record) => {
        await writeJsonAtomic(folder, OWNER, record)
      },
      remove: async (token) => {
        const current = parseWorkspaceOwnerFile(await readJson<unknown>(folder, OWNER))
        if (current?.token === token) await removeEntry(folder, OWNER)
      },
      writeClaim: (nonce) => writeBlob(folder, ['.droneclean', `claim-${nonce}`], nonce),
      removeClaim: (nonce) => removeEntry(folder, ['.droneclean', `claim-${nonce}`]),
    }),
    originLock: async () => ({ kind: 'acquired', release: () => undefined }),
    now: () => clock.now,
    originHost: () => 'localhost:4399',
    newToken: () => {
      tokens += 1
      return `page-token-${tokens}`
    },
    every: (callback) => {
      const timed = { callback, active: true }
      timers.push(timed)
      return () => {
        timed.active = false
      }
    },
    onPageHide: () => undefined,
    closeWindow: () => undefined,
    previousToken: (workspaceId) => kept.get(workspaceId) ?? null,
    keepToken: (workspaceId, token) => {
      kept.set(workspaceId, token)
    },
    reloadPage: () => {
      page.reloads += 1
    },
  }
  /** Run every live timer once and let what it started settle. */
  const tick = async (): Promise<void> => {
    await act(async () => {
      for (const timed of timers.filter((entry) => entry.active)) timed.callback()
      for (let step = 0; step < 50; step += 1) await Promise.resolve()
    })
  }
  return { environment, timers, clock, tick, page }
}

/** Every file in the folder and what it holds, to show that nothing was written. */
async function snapshot(dir: MemDir, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for await (const entry of (dir as unknown as FileSystemDirectoryHandle).values()) {
    const name = `${prefix}${entry.name}`
    if (entry.kind === 'directory') {
      Object.assign(files, await snapshot(await dir.getDirectoryHandle(entry.name), `${name}/`))
    } else {
      files[name] = (await readFileText(dir, entry.name)) ?? ''
    }
  }
  return files
}

/** Another window's live record, written over this page's. */
function otherWindow(heartbeatAt: number) {
  return {
    version: 1,
    app: 'desktop',
    pid: 4242,
    host: 'Mac.lan',
    startedAt: 9_000,
    heartbeatAt,
    token: 'the-other-window',
  }
}

function project(id: string): Project {
  return {
    id,
    name: 'Sunday flight',
    description: '',
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    createdAt: 1_000,
    updatedAt: 1_000,
  } as Project
}

afterEach(() => {
  setWorkspaceRoot(null)
  edits.unsaved = false
})

describe('a project open in a workspace another window takes', () => {
  it('shows no banner while the folder is this page’s', async () => {
    const root = asHandle(createRoot())
    const { environment } = pageOver()
    const ownership = await claimWorkspaceOwnership(root, 'owned-workspace', environment)
    const view = render(<WorkspaceReadOnlyBanner ownership={ownership} />)
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('turns the page read-only and writes nothing when it saves', async () => {
    const folder = createRoot()
    const root = asHandle(folder)
    setWorkspaceRoot(root)
    const { environment, tick } = pageOver()
    const ownership = await claimWorkspaceOwnership(root, 'read-only-workspace', environment)
    expect(ownership.state()).toEqual({ kind: 'owned' })

    await createProject(project('p1'))
    await updateProject('p1', { name: 'Saved while it was ours' })

    // Another window writes its own live record over this page's.
    await writeJsonAtomic(root, OWNER, otherWindow(9_900))
    const before = await readFileText(folder, 'projects', 'p1', 'project.json')

    await expect(updateProject('p1', { name: 'Saved after it was lost' })).rejects.toThrow(
      /open in another window/,
    )
    expect(await readFileText(folder, 'projects', 'p1', 'project.json')).toBe(before)

    // The banner is up and stays up; no Take over while the other owner is live.
    const view = render(<WorkspaceReadOnlyBanner ownership={ownership} />)
    await tick()
    const banner = view.getByRole('alert')
    expect(banner.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    expect(view.queryAllByRole('button')).toHaveLength(0)
    expect(parseWorkspaceOwnerFile(await readJson<unknown>(root, OWNER))?.token).toBe(
      'the-other-window',
    )
  })

  it('writes nothing at all while read-only: neither the project nor its cover', async () => {
    const folder = createRoot()
    const root = asHandle(folder)
    setWorkspaceRoot(root)
    const { environment } = pageOver()
    await claimWorkspaceOwnership(root, 'nothing-written-workspace', environment)
    await createProject(project('p3'))
    await writeJsonAtomic(root, OWNER, otherWindow(9_900))
    const before = await snapshot(folder)

    // What `saveTimeline` writes, in its order: the cover, then the project.
    await expect(
      saveProjectThumbnail('p3', new Blob([new Uint8Array([0xff, 0xd8, 0xff])])),
    ).rejects.toThrow(/open in another window/)
    await expect(updateProject('p3', { name: 'Not saved' })).rejects.toThrow(/open in another window/)
    expect(await snapshot(folder)).toEqual(before)
  })

  it('takes over without overwriting what the other window saved, and reloads it', async () => {
    const folder = createRoot()
    const root = asHandle(folder)
    setWorkspaceRoot(root)
    const { environment, clock, tick, page } = pageOver()
    const ownership = await claimWorkspaceOwnership(root, 'take-over-workspace', environment)
    await createProject(project('p2'))
    await updateProject('p2', { name: 'This window’s cut' })
    const view = render(<WorkspaceReadOnlyBanner ownership={ownership} />)

    // The other window takes the folder and saves its own version of the project.
    await writeJsonAtomic(root, OWNER, otherWindow(9_900))
    const theirs = { ...project('p2'), name: 'The other window’s cut', updatedAt: 9_950 }
    await writeJsonAtomic(root, ['projects', 'p2', 'project.json'], theirs)
    await tick()
    expect(view.getByRole('alert')).toBeTruthy()

    // This window goes on editing, read-only: the edit is not saved.
    edits.unsaved = true
    await expect(updateProject('p2', { name: 'Edited while read-only' })).rejects.toThrow(
      /open in another window/,
    )

    // A minute later the other window has gone quiet: Take over is offered, and
    // with unsaved edits it first says they will be discarded.
    clock.now = 9_900 + 60_000
    await tick()
    fireEvent.click(view.getByRole('button'))
    const buttons = view.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(page.reloads).toBe(0)
    expect(parseWorkspaceOwnerFile(await readJson<unknown>(root, OWNER))?.token).toBe(
      'the-other-window',
    )

    await act(async () => {
      fireEvent.click(buttons[0] as HTMLElement)
      for (let step = 0; step < 50; step += 1) await Promise.resolve()
    })
    expect(page.reloads).toBe(1)
    expect(parseWorkspaceOwnerFile(await readJson<unknown>(root, OWNER))?.token).toBe('page-token-2')
    // On the way to the reload nothing this window holds is saved.
    await expect(updateProject('p2', { name: 'Edited while read-only' })).rejects.toThrow(
      /open in another window/,
    )

    // The reloaded page opens the project the editor reads: the other window's.
    const reloaded = await claimWorkspaceOwnership(root, 'take-over-workspace', environment)
    expect(reloaded.state()).toEqual({ kind: 'owned' })
    expect((await getProject('p2'))?.name).toBe('The other window’s cut')
  })

  it('takes over at once when this window has no unsaved edits', async () => {
    const folder = createRoot()
    const root = asHandle(folder)
    setWorkspaceRoot(root)
    const { environment, clock, tick, page } = pageOver()
    const ownership = await claimWorkspaceOwnership(root, 'clean-take-over-workspace', environment)
    edits.unsaved = false
    const view = render(<WorkspaceReadOnlyBanner ownership={ownership} />)
    await writeJsonAtomic(root, OWNER, otherWindow(9_900))
    clock.now = 9_900 + 60_000
    await tick()

    await act(async () => {
      fireEvent.click(view.getByRole('button'))
      for (let step = 0; step < 50; step += 1) await Promise.resolve()
    })
    expect(page.reloads).toBe(1)
  })
})
