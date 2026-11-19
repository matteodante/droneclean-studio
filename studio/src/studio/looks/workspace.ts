/**
 * The looks library's files in the workspace folder (design 5.1 §4.4, §6 slice 5.2b).
 *
 * ```
 * {workspace}/
 * └── looks/
 *     ├── index.json              # the list: one entry per look, with its format and hash
 *     └── {id}/
 *         └── {file name}.cube    # the bytes the user added, kept as they are
 * ```
 *
 * The `.cube` files are workspace-level, like the media library: a look is the user's own, any
 * project can use it, and the project JSON keeps only its id. The path builders live here rather
 * than in FreeCut's `workspace-fs/paths.ts` so the fork keeps that file mergeable; the files
 * themselves are read and written with the same primitives every other workspace file uses.
 */

import {
  readBlob,
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { sanitizeWorkspaceFileName } from '@/infrastructure/storage/workspace-fs/paths'
import { getWorkspaceHandleRecord } from '@/infrastructure/storage/handles-db'
import { getWorkspaceRoot, requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { CUBE_MAX_SIZE, CUBE_MIN_SIZE, type CubeEntryOrder } from '@/studio/color/cube'
import type { LookEntry, LooksIndexFile } from './types'

const LOOKS_DIR = 'looks'
const LOOKS_INDEX_FILENAME = 'index.json'

/** The workspace folder's looks directory. */
function looksDir(): string[] {
  return [LOOKS_DIR]
}

/** `looks/index.json`. */
function looksIndexPath(): string[] {
  return [...looksDir(), LOOKS_INDEX_FILENAME]
}

/** One look's folder, `looks/{id}/`. */
function lookDir(id: string): string[] {
  return [...looksDir(), id]
}

/** One look's `.cube` file, `looks/{id}/{fileName}`. */
function lookFilePath(id: string, fileName: string): string[] {
  return [...lookDir(id), sanitizeWorkspaceFileName(fileName)]
}

/** SHA-256 of a `.cube` file's text, as 64 lowercase hex digits. */
export async function hashLookText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isEntryOrder(value: unknown): value is CubeEntryOrder {
  return value === 'red-fastest' || value === 'blue-fastest'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The strings an entry needs: the look's id, its name, the stored file name and its hash. */
function hasEntryStrings(entry: Partial<LookEntry>): boolean {
  return (
    isNonEmptyString(entry.id) &&
    isNonEmptyString(entry.name) &&
    isNonEmptyString(entry.fileName) &&
    isNonEmptyString(entry.filePath) &&
    isNonEmptyString(entry.hash)
  )
}

/** The format an entry records: a grid a look may have, its row order, and when it was added. */
function hasEntryFormat(entry: Partial<LookEntry>): boolean {
  return (
    isEntryOrder(entry.entryOrder) &&
    typeof entry.size === 'number' &&
    Number.isInteger(entry.size) &&
    entry.size >= CUBE_MIN_SIZE &&
    entry.size <= CUBE_MAX_SIZE &&
    typeof entry.hasShaper === 'boolean' &&
    typeof entry.addedAt === 'number' &&
    Number.isFinite(entry.addedAt)
  )
}

/** Whether a partial entry carries everything a `LookEntry` is. */
function isLookEntry(entry: Partial<LookEntry>): entry is LookEntry {
  return hasEntryStrings(entry) && hasEntryFormat(entry)
}

/** One index entry, or null when the stored value is not a look this library wrote. */
function sanitizeEntry(value: unknown): LookEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Partial<LookEntry>
  return isLookEntry(entry) ? { ...entry } : null
}

/**
 * The workspace folder to read the library from.
 *
 * The page's gate sets the root once. The export's worker is another realm: nobody calls `setWorkspaceRoot` there,
 * yet its look stage asks the library for the clips' tables (found by the packaged e2e, where an export of a clip
 * with a look stopped with "the look is not in the looks library"). So a realm with no root reads the folder the page
 * saved as the active workspace, as the gate does, when the browser still grants it. The handle is used for reading
 * only and is not made the realm's root: every write stays with the page.
 *
 * @throws when this realm has no root and no saved, readable workspace: the caller reports it like any read failure.
 */
async function rootForReading(): Promise<FileSystemDirectoryHandle> {
  const open = getWorkspaceRoot()
  if (open !== null) return open
  const record = await getWorkspaceHandleRecord()
  const saved = record?.handle as FileSystemDirectoryHandle | undefined
  if (saved === undefined || (await saved.queryPermission({ mode: 'read' })) !== 'granted') {
    return requireWorkspaceRoot()
  }
  return saved
}

/**
 * The library's index, in the order the looks were added. A missing index is an empty library; a
 * stored entry that is not a look this module wrote is dropped rather than breaking the list.
 *
 * @throws when the index exists but cannot be read, or holds invalid JSON: the caller reports it
 *   instead of pretending the user's library is empty.
 */
export async function readLooksIndex(): Promise<LookEntry[]> {
  const root = await rootForReading()
  const file = await readJson<LooksIndexFile>(root, looksIndexPath())
  if (file === null || !Array.isArray(file.looks)) return []
  return file.looks.flatMap((value) => {
    const entry = sanitizeEntry(value)
    return entry === null ? [] : [entry]
  })
}

/** Replaces `looks/index.json`. */
export async function writeLooksIndex(looks: readonly LookEntry[]): Promise<void> {
  const root = requireWorkspaceRoot()
  await writeJsonAtomic(root, looksIndexPath(), { version: 1, looks })
}

/**
 * One look's stored `.cube` text.
 *
 * @throws when the file is gone: the entry is in the index but its bytes are not on disk.
 */
export async function readLookText(entry: LookEntry): Promise<string> {
  const root = await rootForReading()
  const blob = await readBlob(root, lookFilePath(entry.id, entry.filePath))
  if (blob === null) {
    throw new Error(`The .cube file of the look "${entry.name}" is missing from the workspace`)
  }
  return blob.text()
}

/** Writes one look's `.cube` text into its folder, creating both. */
export async function writeLookText(entry: LookEntry, text: string): Promise<void> {
  const root = requireWorkspaceRoot()
  await writeBlob(root, lookFilePath(entry.id, entry.filePath), text)
}

/** Removes one look's folder and the file in it; a look that is already gone is ignored. */
export async function removeLookFiles(id: string): Promise<void> {
  const root = requireWorkspaceRoot()
  await removeEntry(root, lookDir(id), { recursive: true })
}
