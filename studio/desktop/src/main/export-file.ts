/**
 * The files the export dialog's muxer writes (task 3.5): straight into the folder the
 * user chose, with no second copy and with nothing the user had ever lost.
 *
 * It is `output-file.ts`'s rule, applied to a muxer that writes in the page's own process
 * instead of an FFmpeg: the bytes go to a hidden temporary file beside the final path
 * (`partialPathFor`), `commit` renames it over the final path once the muxer finished, and a
 * failure or a cancel removes the temporary file (`discard`) and nothing else, so a file
 * already at the final path survives byte for byte. The rename is inside one folder, so it is
 * atomic and takes no copy.
 *
 * The muxer writes 4 MiB chunks at positions (it goes back to patch sizes), so a write is
 * `(position, bytes)`. Writes of one export run one after the other, in the order they were
 * asked, and a write is answered only when the bytes are in the file: the page's next write waits
 * for it, which is what keeps memory flat however slow the disk is.
 *
 * No Electron import: `export-file-protocol.ts` binds this to the scheme, the dialog and the IPC.
 */
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import {
  EXPORT_FILE_ID_PATTERN,
  EXPORT_FILE_MAX_WRITE_BYTES,
  type ExportFileCommitted,
} from '../shared/export-file'
import { commitOutput, discardPartial, OutputGrants, outputGrants, partialPathFor } from './media/output-file'
import { refuseUncPath } from './media/path-guard'

/** The extensions the muxer's containers write (`ClientContainer` in the editor). */
export const EXPORT_FILE_EXTENSIONS: readonly string[] = ['mp4', 'mov', 'webm', 'mkv', 'mp3', 'aac', 'wav']

/** The sidecar subtitle file is written beside the video; it can hold at most this much text. */
const MAX_SIDECAR_BYTES = 8 * 1024 * 1024

interface OpenExport {
  readonly finalPath: string
  readonly partialPath: string
  readonly handle: FileHandle
  /** The writes and the end of this export, one after the other. */
  tail: Promise<unknown>
  /** The file's length so far: the highest end of a write. */
  size: number
  /** `commit` or `discard` was asked: no further write is accepted. */
  closing: boolean
  /** `discard` was asked: what still waits its turn fails instead of running. */
  discarded: boolean
}

/** A native export (the desktop's FFmpeg writes the file): only its path, and the grant that lets the encoder write there. */
interface NativeExport {
  readonly finalPath: string
}

/** The files being written, by export id. */
export class ExportFiles {
  private readonly exports = new Map<string, OpenExport>()
  private readonly natives = new Map<string, NativeExport>()

  constructor(
    /** The paths the save dialog granted; each is good for one export. */
    readonly grants: OutputGrants = new OutputGrants(),
    private readonly platform: NodeJS.Platform = process.platform,
    /** The grants `encode.start` takes from: a native export's path is granted here, and nowhere else. */
    private readonly encoderGrants: OutputGrants = outputGrants,
  ) {}

  /** Whether an export with this id is open. */
  has(id: string): boolean {
    return this.exports.has(id) || this.natives.has(id)
  }

  /**
   * Opens a native export: the save dialog's path is granted to the native encoder (`encode.start` takes the grant),
   * which writes the hidden temporary file beside it and renames it itself (`output-file.ts`'s rule, the same helpers),
   * so no temporary file is made here and the muxer's route is not used. Throws the refusal for a path the muxer's
   * route would refuse too (not absolute, a network path, a missing folder, a folder instead of a file).
   */
  async openNative(id: string, finalPath: string): Promise<void> {
    if (!EXPORT_FILE_ID_PATTERN.test(id)) throw new Error(`export: invalid id ${JSON.stringify(id)}`)
    if (this.has(id)) throw new Error(`export: ${JSON.stringify(id)} is already open`)
    await checkExportPath(finalPath, this.platform)
    this.encoderGrants.grant(finalPath)
    this.natives.set(id, { finalPath })
  }

  /**
   * Ends a native export: the encoder already renamed its temporary file over the final path, so this only looks
   * at the result (the file must be there, and its size is the answer), withdraws a grant the encoder never used,
   * and writes the sidecar subtitle file beside the video when given.
   */
  private async commitNative(id: string, sidecar?: { readonly content: string }): Promise<ExportFileCommitted> {
    const native = this.natives.get(id)
    if (native === undefined) throw new Error(`export: ${JSON.stringify(id)} is not open`)
    this.natives.delete(id)
    this.encoderGrants.claim(native.finalPath)
    if (sidecar !== undefined && Buffer.byteLength(sidecar.content) > MAX_SIDECAR_BYTES) {
      throw new Error('export: the subtitle text is too large')
    }
    const written = await fs.stat(native.finalPath).catch(() => null)
    if (written === null || !written.isFile()) {
      throw new Error(`export: the encoder left no file at ${JSON.stringify(native.finalPath)}`)
    }
    let sidecarPath: string | undefined
    if (sidecar !== undefined) {
      try {
        sidecarPath = await writeSidecar(native.finalPath, sidecar.content)
      } catch (error) {
        throw new Error(
          `the video was saved, but its subtitle file could not be written: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    return { path: native.finalPath, size: written.size, ...(sidecarPath !== undefined && { sidecarPath }) }
  }

  /**
   * Opens the temporary file for a path the save dialog granted. Throws the refusal when the
   * path is not granted, is not absolute, is a network path, has an extension the muxer does not
   * write, names a folder, or sits in a folder that does not exist.
   */
  async open(id: string, finalPath: string): Promise<void> {
    if (!EXPORT_FILE_ID_PATTERN.test(id)) throw new Error(`export: invalid id ${JSON.stringify(id)}`)
    if (this.exports.has(id)) throw new Error(`export: ${JSON.stringify(id)} is already open`)
    await checkExportPath(finalPath, this.platform)
    if (!this.grants.claim(finalPath)) {
      throw new Error(`export: ${JSON.stringify(finalPath)} is not a path the user chose in a save dialog`)
    }
    const partialPath = partialPathFor(finalPath)
    const handle = await fs.open(partialPath, 'w')
    this.exports.set(id, { finalPath, partialPath, handle, tail: Promise.resolve(), size: 0, closing: false, discarded: false })
  }

  /** An attempt starts (again): the temporary file is emptied, so a retry never leaves the tail of the first. */
  async begin(id: string): Promise<void> {
    const open = this.require(id)
    await this.enqueue(open, async () => {
      await open.handle.truncate(0)
      open.size = 0
    })
  }

  /** Puts `bytes` at `position`; answers once they are in the file. */
  async write(id: string, position: number, bytes: Uint8Array): Promise<void> {
    if (!Number.isSafeInteger(position) || position < 0) throw new Error(`export: invalid position ${position}`)
    if (bytes.byteLength > EXPORT_FILE_MAX_WRITE_BYTES) {
      throw new Error(`export: a write of ${bytes.byteLength} bytes is over the ${EXPORT_FILE_MAX_WRITE_BYTES} limit`)
    }
    const open = this.require(id)
    await this.enqueue(open, async () => {
      let done = 0
      while (done < bytes.byteLength) {
        const { bytesWritten } = await open.handle.write(bytes, done, bytes.byteLength - done, position + done)
        if (bytesWritten === 0) throw new Error('export: the disk accepted no more bytes')
        done += bytesWritten
      }
      open.size = Math.max(open.size, position + bytes.byteLength)
    })
  }

  /**
   * Ends the export: the file is flushed and closed, and the temporary file replaces the final
   * path in one step. With a sidecar, the subtitle text is written beside it the same way. A
   * failure removes the temporary file.
   */
  async commit(id: string, sidecar?: { readonly content: string }): Promise<ExportFileCommitted> {
    if (this.natives.has(id)) return this.commitNative(id, sidecar)
    const open = this.require(id)
    if (sidecar !== undefined && Buffer.byteLength(sidecar.content) > MAX_SIDECAR_BYTES) {
      await this.discard(id)
      throw new Error('export: the subtitle text is too large')
    }
    open.closing = true
    try {
      await this.enqueue(open, async () => {
        await open.handle.sync()
        await open.handle.close()
        await commitOutput(open.partialPath, open.finalPath)
      })
    } catch (error) {
      await this.discard(id)
      throw error
    }
    this.exports.delete(id)
    let sidecarPath: string | undefined
    if (sidecar !== undefined) {
      try {
        sidecarPath = await writeSidecar(open.finalPath, sidecar.content)
      } catch (error) {
        throw new Error(
          `the video was saved, but its subtitle file could not be written: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    return { path: open.finalPath, size: open.size, ...(sidecarPath !== undefined && { sidecarPath }) }
  }

  /** A failure, a cancel or a closed window: the temporary file is removed. A second call, or one for an unknown id, does nothing. */
  async discard(id: string): Promise<void> {
    const native = this.natives.get(id)
    if (native !== undefined) {
      // A native export that failed or was cancelled: the encoder removes its own temporary file; this withdraws the
      // grant it never used (a failure before `encode.start`) and removes the file again, which is harmless. A file
      // already at the final path is never touched.
      this.natives.delete(id)
      this.encoderGrants.claim(native.finalPath)
      await discardPartial(partialPathFor(native.finalPath))
      return
    }
    const open = this.exports.get(id)
    if (open === undefined) return
    this.exports.delete(id)
    open.closing = true
    open.discarded = true
    await open.tail.catch(() => undefined)
    await open.handle.close().catch(() => undefined)
    await discardPartial(open.partialPath)
  }

  private require(id: string): OpenExport {
    const open = this.exports.get(id)
    if (open === undefined || open.closing) throw new Error(`export: ${JSON.stringify(id)} is not open`)
    return open
  }

  private enqueue(open: OpenExport, run: () => Promise<void>): Promise<void> {
    const result = open.tail.then(() => {
      if (open.discarded) throw new Error('export: it was cancelled')
      return run()
    })
    open.tail = result.catch(() => undefined)
    return result
  }
}

/** Checks the path of an export before the temporary file is made; throws the refusal. */
export async function checkExportPath(file: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  refuseUncPath(file, 'export', platform)
  if (file === '' || !path.isAbsolute(file)) {
    throw new Error(`export: the path must be absolute, got ${JSON.stringify(file)}`)
  }
  const extension = path.extname(file).slice(1).toLowerCase()
  if (!EXPORT_FILE_EXTENSIONS.includes(extension)) {
    throw new Error(`export: ${JSON.stringify(file)} must end in one of ${EXPORT_FILE_EXTENSIONS.join(', ')}`)
  }
  const folder = await fs.stat(path.dirname(file)).catch(() => null)
  if (folder === null || !folder.isDirectory()) {
    throw new Error(`export: the folder ${JSON.stringify(path.dirname(file))} does not exist`)
  }
  const existing = await fs.stat(file).catch(() => null)
  if (existing !== null && !existing.isFile()) {
    throw new Error(`export: ${JSON.stringify(file)} is not a file`)
  }
}

/**
 * Where the subtitle file goes: `<video without its extension>.srt`, or `<name> (2).srt`, `(3)`... when a file of that
 * name is already there. The save dialog asked about the video's name only, so a subtitle file the user had is never
 * replaced (review finding F7).
 */
export async function freeSidecarPath(videoPath: string): Promise<string> {
  const folder = path.dirname(videoPath)
  const stem = path.basename(videoPath, path.extname(videoPath))
  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const candidate = path.join(folder, attempt === 1 ? `${stem}.srt` : `${stem} (${attempt}).srt`)
    if ((await fs.lstat(candidate).catch(() => null)) === null) return candidate
  }
  throw new Error(`no free name for the subtitle file beside ${JSON.stringify(videoPath)}`)
}

/** The subtitle file beside the video, written through a temporary file like the video; answers the path it took. */
async function writeSidecar(videoPath: string, content: string): Promise<string> {
  const target = await freeSidecarPath(videoPath)
  const partial = partialPathFor(target)
  try {
    await fs.writeFile(partial, content, 'utf8')
    await commitOutput(partial, target)
  } catch (error) {
    await discardPartial(partial)
    throw error
  }
  return target
}
