/**
 * Where an export's file goes (task 3.3, slice P5): straight to the path the user
 * chose, never through a temporary copy, and only to a path the user chose.
 *
 * FFmpeg is given the final path, so the shell must not let the page name any
 * file it likes: that would be a way to overwrite any file the user can write.
 * A path is *granted* by the save dialog (`grantOutputPath`, called by the
 * code that shows it) and an `encode.start` is accepted only for a granted path,
 * once: the grant is used up by the start. A path that is not absolute, is a
 * network or device path, has the wrong extension for the format, names a folder
 * or sits in a folder that does not exist is refused with a sentence that says why.
 *
 * **Nothing the user had is ever lost.** FFmpeg writes a hidden temporary file
 * beside the final path (`partialPathFor`), and `commitOutput` renames it over the
 * final path only once FFmpeg exited 0 with every frame. A failure or a cancel
 * removes the temporary file (`discardPartial`) and nothing else, so a file
 * already at the final path survives byte for byte. The rename is within one
 * folder, so it is atomic and takes no copy.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PreciseExportFormatId } from '../../shared/native-media'
import { outputExtension } from './formats'
import { refuseUncPath } from './path-guard'

/** The key two spellings of one path share: resolved, and lower case where the disk ignores case. */
function grantKey(file: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(file)
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved
}

/** The paths the user chose, each good for one export. */
export class OutputGrants {
  private readonly granted = new Set<string>()
  private readonly platform: NodeJS.Platform

  constructor(platform: NodeJS.Platform = process.platform) {
    this.platform = platform
  }

  /** The user chose `file` in a save dialog. */
  grant(file: string): void {
    this.granted.add(grantKey(file, this.platform))
  }

  /** Uses the grant of `file` up; false when there was none. */
  claim(file: string): boolean {
    return this.granted.delete(grantKey(file, this.platform))
  }

  /** Whether `file` is granted, without using it up. */
  has(file: string): boolean {
    return this.granted.has(grantKey(file, this.platform))
  }
}

/** The grants of this shell: the save dialog's code adds to it, `encode.start` takes from it. */
export const outputGrants = new OutputGrants()

/**
 * Checks the path of an export before anything is started and throws the refusal.
 * Pure of grants: `claim` is the caller's, after this passes, so a refused request
 * does not use a grant up.
 */
export async function checkOutputPath(
  file: string,
  format: PreciseExportFormatId,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  refuseUncPath(file, 'encode.start', platform)
  if (file === '' || !path.isAbsolute(file)) {
    throw new Error(`encode.start: the path must be absolute, got ${JSON.stringify(file)}`)
  }
  const extension = outputExtension(format)
  if (path.extname(file).toLowerCase() !== extension) {
    throw new Error(`encode.start: ${format} is written to a ${extension} file, got ${JSON.stringify(file)}`)
  }
  const folder = await fs.stat(path.dirname(file)).catch(() => null)
  if (folder === null || !folder.isDirectory()) {
    throw new Error(`encode.start: the folder ${JSON.stringify(path.dirname(file))} does not exist`)
  }
  const existing = await fs.stat(file).catch(() => null)
  if (existing !== null && !existing.isFile()) {
    throw new Error(`encode.start: ${JSON.stringify(file)} is not a file`)
  }
}

/** Removes the temporary file of a failed or cancelled export; a missing file is not an error. */
export async function discardPartial(file: string): Promise<void> {
  await fs.rm(file, { force: true })
}

/** The temporary file an export is written to: `.<name>.droneclean-partial` in the final path's folder. */
export function partialPathFor(finalPath: string): string {
  return path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.droneclean-partial`)
}

/** Moves the finished temporary file over the final path; the old file is replaced in one step. */
export async function commitOutput(partialPath: string, finalPath: string): Promise<void> {
  try {
    await fs.rename(partialPath, finalPath)
  } catch (error) {
    throw new Error(
      `could not move the finished export to ${JSON.stringify(finalPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
