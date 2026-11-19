/**
 * WorkspaceGate
 *
 * Wraps the router and, when the current URL is a storage-dependent route
 * (`/projects*` or `/editor*`), blocks it until the user has picked a
 * workspace folder and granted read/write permission:
 *
 *   1. Check handles-db for a saved workspace handle
 *   2. If missing → show splash prompting user to pick a folder
 *   3. If present → queryPermission; if granted, set the active root and
 *      render the children. If revoked, show a Reconnect splash.
 *
 * The landing page (`/`) is not a storage-dependent route — it renders
 * without waiting for the gate, so users see no splash flash on first
 * visit. Navigating into a protected route after the handle is initialized
 * falls through to the "ready" path without additional UI.
 *
 * Also listens for permission-lost signals from fs-primitives and flips
 * back to the Reconnect state mid-session.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ensureKnownWorkspaceForCurrent,
  getWorkspaceHandleRecord,
  isFileSystemAccessSupported,
  queryHandlePermission,
  requestHandlePermission,
  saveWorkspaceHandleRecord,
} from '@/infrastructure/storage/handles-db'
import { onPermissionLost, setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { createLogger } from '@/shared/logging/logger'
import {
  claimWorkspaceOwnership,
  type WorkspaceOwnerFileHolder,
  type WorkspaceOwnerGuard,
  type WorkspaceOwnerState,
} from '@/studio/agent/workspace-owner'
import { hasUnsavedProjectEdits } from '@/studio/agent/unsaved-edits'
import { WorkspaceGateSplash } from './workspace-gate-splash'
import { stripBase } from '@/studio/web/base-path'
import { usePathname } from './use-pathname'

/**
 * Routes that read/write the workspace and therefore need the gate to be
 * ready before their loaders run. Anything else renders freely without
 * waiting on storage initialization.
 */
function isStorageProtectedPath(pathname: string): boolean {
  const route = stripBase(pathname)
  return route.startsWith('/projects') || route.startsWith('/editor')
}

const logger = createLogger('WorkspaceGate')

type GateStatus =
  | { kind: 'initializing' }
  | { kind: 'unavailable' } // Non-Chromium browsers
  | { kind: 'pick' } // No saved handle
  | { kind: 'reconnect'; handleName: string } // Saved handle, permission revoked
  // Another instance owns the folder; the guard names it and can take over a stale one.
  | { kind: 'blocked'; handle: FileSystemDirectoryHandle; ownership: WorkspaceOwnerGuard }
  // Open; the guard turns the page read-only if the folder is lost later.
  | { kind: 'ready'; ownership: WorkspaceOwnerGuard }

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>({ kind: 'initializing' })
  const [error, setError] = useState<string | null>(null)
  // The shell refused the chosen folder because it is a temporary one (E1).
  const [temporaryRefused, setTemporaryRefused] = useState(false)
  const { t } = useTranslation()
  const pathname = usePathname()
  const needsWorkspace = isStorageProtectedPath(pathname)

  // The app half of opening the folder: the handle becomes the root every
  // storage module writes through, and the workspace is bootstrapped once.
  const openWorkspace = useCallback(async (handle: FileSystemDirectoryHandle, ownership: WorkspaceOwnerGuard) => {
    setWorkspaceRoot(handle)
    try {
      const { bootstrapWorkspace } = await import('@/infrastructure/storage/workspace-fs/bootstrap')
      await bootstrapWorkspace(handle)
    } catch (error) {
      logger.warn('bootstrapWorkspace failed', error)
    }
    // Fire the auto-purge sweep for long-trashed projects in the
    // background — it touches disk and we don't want it to block the
    // app render. Wrapped in setTimeout so it runs after first paint.
    setTimeout(() => {
      void import('./deps/trash-auto-purge').then(({ autoPurgeExpiredTrash }) =>
        autoPurgeExpiredTrash(),
      )
    }, 0)
    setStatus({ kind: 'ready', ownership })
    window.dispatchEvent(new Event('freecut:ensure-toaster'))
  }, [])

  const activate = useCallback(
    async (handle: FileSystemDirectoryHandle, workspaceId: string) => {
      // One owner of the folder (task 2.3): ask before anything is read or
      // written. A folder another instance holds is not opened; the modal names
      // the holder and never offers a way past a live one.
      const ownership = await claimWorkspaceOwnership(handle, workspaceId)
      const claimed = ownership.state().kind
      if (claimed === 'blocked') {
        setStatus({ kind: 'blocked', handle, ownership })
        return
      }
      if (claimed === 'temporary') {
        // A folder the system may delete, projects and all: nothing is opened (E1).
        ownership.release()
        setTemporaryRefused(true)
        setStatus({ kind: 'pick' })
        return
      }
      await openWorkspace(handle, ownership)
    },
    [openWorkspace],
  )

  // Initial load: check if we have a saved handle, check its permission.
  // Skipped on routes that never touch storage (landing page) so first paint
  // doesn't wait on IndexedDB; the effect re-runs when a protected route mounts.
  useEffect(() => {
    if (!needsWorkspace) return
    let cancelled = false
    ;(async () => {
      if (!isFileSystemAccessSupported()) {
        if (!cancelled) setStatus({ kind: 'unavailable' })
        return
      }
      // Promote any legacy `workspace:current` into a proper known-workspace
      // record before we read it, so the indicator's "known workspaces" list
      // includes the one the user is about to use.
      await ensureKnownWorkspaceForCurrent()
      const record = await getWorkspaceHandleRecord()
      if (!record) {
        if (!cancelled) setStatus({ kind: 'pick' })
        return
      }
      const handle = record.handle as FileSystemDirectoryHandle
      const permission = await queryHandlePermission(handle)
      if (cancelled) return
      if (permission === 'granted') {
        await activate(handle, record.activeWorkspaceId ?? record.name)
      } else {
        setStatus({ kind: 'reconnect', handleName: record.name })
      }
    })().catch((error) => {
      logger.error('Gate initialization failed', error)
      if (!cancelled) setStatus({ kind: 'pick' })
    })
    return () => {
      cancelled = true
    }
  }, [activate, needsWorkspace])

  // Permission-lost mid-session → flip to reconnect.
  useEffect(() => {
    const unsubscribe = onPermissionLost(() => {
      void (async () => {
        const record = await getWorkspaceHandleRecord()
        setStatus({ kind: 'reconnect', handleName: record?.name ?? 'workspace' })
      })()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handlePick = useCallback(async () => {
    setError(null)
    setTemporaryRefused(false)
    try {
      const handle = await window.showDirectoryPicker({
        id: 'freecut-workspace',
        mode: 'readwrite',
        startIn: 'documents',
      })
      const queryState = await queryHandlePermission(handle)
      const finalState =
        queryState === 'granted' ? queryState : await requestHandlePermission(handle)
      if (finalState !== 'granted') {
        setError(t('projects.workspaceGate.folderPermissionDenied'))
        setStatus({ kind: 'reconnect', handleName: handle.name })
        return
      }
      await saveWorkspaceHandleRecord(handle)
      const saved = await getWorkspaceHandleRecord()
      await activate(handle, saved?.activeWorkspaceId ?? handle.name)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // User cancelled the picker; stay on splash.
        return
      }
      logger.error('Folder pick failed', error)
      setError(t('projects.workspaceGate.folderPickFailed'))
    }
  }, [activate, t])

  const handleReconnect = useCallback(async () => {
    setError(null)
    const record = await getWorkspaceHandleRecord()
    if (!record) {
      setStatus({ kind: 'pick' })
      return
    }
    const handle = record.handle as FileSystemDirectoryHandle
    const permission = await requestHandlePermission(handle)
    if (permission === 'granted') {
      await activate(handle, record.activeWorkspaceId ?? record.name)
      return
    }
    setError(t('projects.workspaceGate.reconnectPermissionDenied'))
  }, [activate, t])

  // Routes that don't touch storage never wait on the gate — no splash, no
  // flash, even on first load while we're checking handles-db — and a ready
  // workspace renders its children, under the read-only banner if it is lost.
  if (!needsWorkspace) {
    return <>{children}</>
  }
  if (status.kind === 'ready') {
    return (
      <>
        {children}
        <WorkspaceReadOnlyBanner ownership={status.ownership} />
      </>
    )
  }

  // Another instance owns the folder (task 2.3): name it, offer Close, and take
  // over only once it is stale. There is deliberately no way past a live owner.
  if (status.kind === 'blocked') {
    return (
      <WorkspaceOwnerModal
        ownership={status.ownership}
        handle={status.handle}
        onOpen={openWorkspace}
      />
    )
  }

  // On protected routes during initialization, render a bare background
  // block so the transition from "checking" to "ready" or "splash" is
  // invisible instead of a logo+spinner flash.
  if (status.kind === 'initializing') {
    return <div className="min-h-screen bg-background" aria-hidden="true" />
  }

  return (
    <WorkspaceGateSplash
      status={status}
      error={error ?? (temporaryRefused ? t('projects.workspaceGate.temporaryFolder') : null)}
      onPickFolder={handlePick}
      onReconnect={handleReconnect}
    />
  )
}

/**
 * The folder is open somewhere else: who holds it, since when, and — only when
 * the owner stopped signalling — Take over (task 2.3, design §4.10 layer 2).
 *
 * While it is open the guard reads the owner again every 5 s: the owner closing
 * cleanly frees the folder and the modal opens it, and an owner whose heartbeat
 * goes 60 s old makes Take over appear. A live owner never does — there is no
 * button that forces a second writer in.
 */
export function WorkspaceOwnerModal({
  ownership,
  handle,
  onOpen,
}: {
  ownership: WorkspaceOwnerGuard
  handle: FileSystemDirectoryHandle
  onOpen: (handle: FileSystemDirectoryHandle, ownership: WorkspaceOwnerGuard) => Promise<void>
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<WorkspaceOwnerState>(() => ownership.state())
  const [taking, setTaking] = useState(false)

  useEffect(() => ownership.watch(setState), [ownership])

  const open = useCallback(() => {
    void onOpen(handle, ownership)
  }, [handle, onOpen, ownership])
  useEffect(() => {
    if (state.kind === 'owned') open()
  }, [state, open])

  const blocked = state.kind === 'blocked' ? state : null
  const stale = blocked !== null && blocked.stale

  const takeOver = useCallback(() => {
    setTaking(true)
    void ownership
      .takeOver()
      .then((next) => setState(next))
      .finally(() => setTaking(false))
  }, [ownership])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold mb-2">{t('projects.workspaceOwner.title')}</h1>
        {blocked !== null && blocked.holder !== undefined && (
          <WorkspaceOwnerSince holder={blocked.holder} />
        )}
        {stale && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('projects.workspaceOwner.stale')}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="lg" onClick={() => ownership.close()}>
            {t('common.close')}
          </Button>
          {stale && (
            <Button size="lg" disabled={taking} onClick={takeOver}>
              {t('projects.workspaceOwner.takeOver')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The open workspace was lost to another window (task 2.3, review finding D1):
 * a banner that stays while the page is read-only — every project save asks the
 * guard first and writes nothing — and Take over, after a click, only once the
 * other owner is dead, 60 s silent or gone. A live owner is never displaced.
 *
 * Take over reloads the project from disk, so it shows what the other window
 * saved; when this window has edits no save wrote, the banner says first that
 * they will be discarded, and takes over only on a second click.
 */
export function WorkspaceReadOnlyBanner({ ownership }: { ownership: WorkspaceOwnerGuard }) {
  const { t } = useTranslation()
  const subscribe = useCallback(
    (onChange: () => void) => ownership.watch(() => onChange()),
    [ownership],
  )
  const state = useSyncExternalStore(subscribe, () => ownership.state())
  const [taking, setTaking] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const takeOver = useCallback(() => {
    setTaking(true)
    void ownership.takeOver().finally(() => {
      setTaking(false)
      setConfirming(false)
    })
  }, [ownership])
  const askFirst = useCallback(() => {
    if (hasUnsavedProjectEdits()) setConfirming(true)
    else takeOver()
  }, [takeOver])

  if (state.kind !== 'blocked') return null
  const offer = state.stale
  return (
    <div
      role="alert"
      className="fixed left-1/2 top-2 z-[1000] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t('projects.workspaceOwner.readOnly')}</span>
      {offer && !confirming && (
        <Button size="sm" variant="secondary" disabled={taking} onClick={askFirst}>
          {t('projects.workspaceOwner.takeOver')}
        </Button>
      )}
      {offer && confirming && (
        <>
          <span className="font-medium">{t('projects.workspaceOwner.discardWarning')}</span>
          <Button size="sm" variant="secondary" disabled={taking} onClick={takeOver}>
            {t('projects.workspaceOwner.discardAndTakeOver')}
          </Button>
          <Button size="sm" variant="ghost" disabled={taking} onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
        </>
      )}
    </div>
  )
}

/** "The app on this Mac has had it open since 12:31", in the reader's language. */
function WorkspaceOwnerSince({ holder }: { holder: WorkspaceOwnerFileHolder }) {
  const { t, i18n } = useTranslation()
  const since = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(holder.startedAt)
  return (
    <p className="text-sm text-muted-foreground">
      {t('projects.workspaceOwner.heldSince', {
        holder: t(
          holder.app === 'desktop'
            ? 'projects.workspaceOwner.holderDesktop'
            : 'projects.workspaceOwner.holderWeb',
        ),
        time: since,
      })}
    </p>
  )
}
