/**
 * The private folder a too-long profile's socket lives in (`protocol.ts`, `shortSocketDirFor`).
 *
 * Inside the profile the profile folder's own permissions keep other users out. In `/tmp` anyone may create a folder,
 * so this one is made with mode 0700 and then checked: a folder that another user made first, a link, or a folder
 * open to others is refused, never used. The socket itself is still created 0600 (`server.ts`). The launcher makes
 * the same check before it connects (`studio/mcp/launcher.mjs`).
 */
import fs from 'node:fs'

/** Make `dir` (mode 0700) unless it exists, then throw unless it is this user's own folder, closed to everyone else. */
export function preparePrivateSocketDir(dir: string, uid: number): void {
  try {
    fs.mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const why = refusal(fs.lstatSync(dir), uid)
  if (why !== null) {
    throw new Error(
      `agent access: ${dir} cannot hold the socket: ${why}. Remove it and turn "Allow AI agents" on again.`,
    )
  }
}

/** Why a folder cannot hold the socket, or null when it can. `lstat`'s answer: a link is not a folder. */
function refusal(stats: fs.Stats, uid: number): string | null {
  if (!stats.isDirectory()) return 'it is not a folder'
  if (stats.uid !== uid) return 'another user owns it'
  if ((stats.mode & 0o077) !== 0) return `its mode is ${(stats.mode & 0o777).toString(8)}, not 700`
  return null
}
