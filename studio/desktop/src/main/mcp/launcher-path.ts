/**
 * The stdio launcher's path, as the Agent access panel prints it (task 2.2
 * slice 7).
 *
 * The panel's snippets are pasted into a client's configuration, so they must
 * name the wrapper the app actually ships: `Resources/mcp/droneclean-mcp` in a
 * packaged app (`electron-builder.yml` copies `../mcp` there), and
 * `studio/mcp/droneclean-mcp` beside the shell's folder in a working copy. The
 * shell is the only side that knows where it lives, so it computes the path and
 * sends it with the rest of the Agent access state.
 *
 * Windows' wrapper is `droneclean-mcp.cmd` (the batch file next to the POSIX
 * one). The platform is an explicit option so the Windows shape is testable on
 * this Mac.
 */
import path from 'node:path'

/** What `launcherPathFor` needs from the shell. */
interface LauncherPathOptions {
  /** Electron's `app.isPackaged`. */
  isPackaged: boolean
  /** Electron's `process.resourcesPath`: `<App>.app/Contents/Resources`. */
  resourcesPath: string
  /** Electron's `app.getAppPath()`: `studio/desktop` in a working copy. */
  appPath: string
  /** Defaults to the running platform. */
  platform?: NodeJS.Platform
}

/** The wrapper's absolute path for this launch. */
export function launcherPathFor(options: LauncherPathOptions): string {
  const platform = options.platform ?? process.platform
  const api = platform === 'win32' ? path.win32 : path.posix
  const fileName = platform === 'win32' ? 'droneclean-mcp.cmd' : 'droneclean-mcp'
  const folder = options.isPackaged
    ? api.join(options.resourcesPath, 'mcp')
    : api.resolve(options.appPath, '..', 'mcp')
  return api.join(folder, fileName)
}
