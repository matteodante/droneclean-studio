/**
 * Turns a path of the build into a real file inside the `dist/` folder.
 *
 * `protocol.ts` refuses the lexical attempts (`..`, encoded dots, backslashes,
 * colons); this module is the part that needs the filesystem, so it can follow
 * symlinks and refuse a link that points outside the folder. It is separate from
 * `protocol-handler.ts` (which needs Electron) so it can be unit-tested in Node.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isPathInside } from './protocol'

const realRoots = new Map<string, Promise<string>>()

/** The folder resolved through symlinks, resolved once per folder. */
function realRoot(distDir: string): Promise<string> {
  const resolved = path.resolve(distDir)
  let root = realRoots.get(resolved)
  if (!root) {
    root = fs.promises.realpath(resolved)
    realRoots.set(resolved, root)
  }
  return root
}

/**
 * Absolute path of `relativePath` inside `distDir`, or null when the file is
 * missing, is not a file, or resolves outside the folder (a symlink pointing out of
 * the build). `relativePath` is already free of `..` — `mapRequestUrl` guarantees
 * that — and the realpath check is what makes a symlink harmless anyway.
 */
export async function resolveInsideDist(distDir: string, relativePath: string): Promise<string | null> {
  let root: string
  try {
    root = await realRoot(distDir)
  } catch {
    return null
  }

  const candidate = path.resolve(root, relativePath)
  if (!isPathInside(root, candidate)) return null

  try {
    const real = await fs.promises.realpath(candidate)
    if (!isPathInside(root, real)) return null
    const stat = await fs.promises.stat(real)
    return stat.isFile() ? real : null
  } catch {
    return null
  }
}
