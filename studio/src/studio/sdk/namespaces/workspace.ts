/**
 * `studio.workspace`: whether the app has a workspace folder to work on.
 *
 * Until the user picks the folder the editor shows its workspace gate and every
 * storage call throws; an agent (the desktop shell's MCP readiness probe) asks
 * here instead of provoking that error and reading its message.
 */

import { getWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import type { WorkspaceApi } from '../types'

/**
 * Create the `studio.workspace` namespace over the active workspace root.
 * @example const workspace = createWorkspaceApi()
 */
export function createWorkspaceApi(): WorkspaceApi {
  return {
    isOpen(): boolean {
      return getWorkspaceRoot() !== null
    },
  }
}
