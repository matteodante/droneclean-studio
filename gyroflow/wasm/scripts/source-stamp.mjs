/**
 * The stamp of the sources the gyro wasm package is built from, in one place.
 *
 * Two callers write the same stamp: `studio/src/studio/build/gyro-wasm.ts` (the vite plugin, which
 * records the stamp it started its build from) and `gyroflow/wasm/build.sh` (a build run by hand,
 * which calls this file as a command), so a package built either way is fresh for the other.
 *
 * Command: `node source-stamp.mjs <repoRoot>` writes `gyroflow/wasm/pkg/source-stamp.txt`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where Gyroflow's engine and its worker live, from the repository's root */
export const GYRO_DIR = join('gyroflow', 'wasm')

/** The stamp file, from `GYRO_DIR`; written after the build, never shipped */
export const STAMP_FILE = join('pkg', 'source-stamp.txt')

/** Every source a rebuild depends on: build.sh, the crate's manifests and Rust sources, and the engine's */
export const SOURCE_GLOBS = [
  join('gyroflow', 'wasm', 'build.sh'),
  join('gyroflow', 'wasm', 'Cargo.toml'),
  join('gyroflow', 'wasm', 'Cargo.lock'),
  join('gyroflow', 'wasm', 'src'),
  join('gyroflow', 'src', 'core'),
]

/**
 * Every regular file under `path`, recursively; a missing path is no files. Entries whose name
 * starts with a dot (`.DS_Store`, an editor's swap file) are not sources and are left out.
 */
export function filesUnder(path) {
  if (!existsSync(path)) return []
  const stats = statSync(path)
  if (stats.isFile()) return [path]
  if (!stats.isDirectory()) return []
  const files = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...filesUnder(child))
    else if (entry.isFile()) files.push(child)
  }
  return files
}

/**
 * The SHA-256 of each source's path from the repository's root, its length and its bytes, in path
 * order. Content, not modification times, so a checkout that rewrites the same bytes leaves it as
 * it was; 185 files and 3.9 MB, about 25 ms.
 */
export function gyroSourceStamp(repoRoot) {
  const hash = createHash('sha256')
  const files = SOURCE_GLOBS.flatMap((relative) => filesUnder(join(repoRoot, relative)))
    .map((file) => file.slice(repoRoot.length + 1).split(sep).join('/'))
    .sort()
  for (const file of files) {
    const bytes = readFileSync(join(repoRoot, file))
    hash.update(`${file}\n${bytes.length}\n`)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

/** Writes the stamp of the sources in the tree next to the package; returns the stamp. */
export function writeGyroSourceStamp(repoRoot, stamp = gyroSourceStamp(repoRoot)) {
  writeFileSync(join(repoRoot, GYRO_DIR, STAMP_FILE), `${stamp}\n`)
  return stamp
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.argv[2]
  if (!repoRoot) {
    console.error('usage: node source-stamp.mjs <repoRoot>')
    process.exit(2)
  }
  console.log(`source stamp: ${writeGyroSourceStamp(repoRoot)}`)
}
