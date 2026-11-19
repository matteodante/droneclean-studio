/**
 * The workspace owner preload of the editor window (task 2.3, design
 * `docs/designs/2.2-mcp.md` §4.10 layer 2): exposes
 * `window.dronecleanWorkspaceOwner`, the page's view of who owns the workspace
 * folder.
 *
 * It is a **second** preload, registered on the session by
 * `installWorkspaceOwnerLock` (`main/workspace-lock.ts`) from the one call in
 * `main/index.ts`, because the window's preload (`preload/index.ts`) cannot
 * import a sibling file and is not this slice's to change (task 2.2 slice 5
 * owns it). The channel names are written out here and
 * `shared/workspace-owner.ts` is imported for types only;
 * `test/workspace-lock.test.mjs` holds the two copies together.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopWorkspaceOwner, WorkspaceOwnerStatus } from '../shared/workspace-owner'

/** `shared/workspace-owner.ts`'s `WORKSPACE_OWNER_CHANNELS`, written out for the sandbox. */
const CHANNELS = {
  acquire: 'workspaceOwner:acquire',
  status: 'workspaceOwner:status',
  takeOver: 'workspaceOwner:takeOver',
  close: 'workspaceOwner:close',
} as const

const bridge: DesktopWorkspaceOwner = {
  acquire(nonce: string): Promise<WorkspaceOwnerStatus> {
    return ipcRenderer.invoke(CHANNELS.acquire, nonce)
  },
  status(): Promise<WorkspaceOwnerStatus> {
    return ipcRenderer.invoke(CHANNELS.status)
  },
  takeOver(): Promise<WorkspaceOwnerStatus> {
    return ipcRenderer.invoke(CHANNELS.takeOver)
  },
  close(): void {
    ipcRenderer.send(CHANNELS.close)
  },
}

contextBridge.exposeInMainWorld('dronecleanWorkspaceOwner', bridge)
