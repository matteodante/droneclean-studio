// The FreeCut tree this fork was last imported from, read from the repository's
// own git history so that `npm run verify` never needs the network.
//
// The fork takes FreeCut in with `git subtree add` / `git subtree merge
// --prefix=studio`. Git writes the imported split into that commit's message:
//
//   git-subtree-dir: studio
//   git-subtree-split: e8d76b0a6cd7121414a6ad88473c56286c1ce198
//
// Walking back from HEAD, the newest `git-subtree-split` for `studio` is the
// FreeCut tree `studio/` is derived from: `git ls-tree -r <split>` lists its
// files and blobs, and its paths are the paths `UPSTREAM_CHANGES.md` uses
// (FreeCut's root is the imported prefix). A later `git subtree merge` moves
// the reference on by itself; nothing here names a commit.
//
// Nothing here reads the `upstream-studio` remote: the split commit is in the
// history this clone already has (`git subtree` keeps it as a parent of the
// import commit), so the checks run offline and a clone without that remote
// behaves the same.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export class GitError extends Error {
  constructor(args, detail) {
    super(`git ${args.join(' ')}: ${detail}`)
    this.name = 'GitError'
  }
}

/** Runs git in `cwd` and returns its stdout, or throws a GitError with git's own message. */
function runGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw new GitError(args, result.error.message)
  if (result.status !== 0) {
    throw new GitError(args, result.stderr.trim() || result.signal || `exit code ${result.status}`)
  }
  return result.stdout
}

/**
 * The repository `root` belongs to and `root`'s path inside it, in the
 * repository's slash form (`studio` for this checkout). Both paths are made
 * real first: git reports the resolved path of the checkout, and on macOS a
 * temporary folder is reached through the `/var` symlink.
 */
export function studioLocation(root) {
  const checkout = fs.realpathSync(path.resolve(root))
  const repoRoot = fs.realpathSync(runGit(checkout, ['rev-parse', '--show-toplevel']).trim())
  const prefix = path.relative(repoRoot, checkout).split(path.sep).join('/')
  if (prefix.startsWith('..')) {
    throw new GitError(['rev-parse', '--show-toplevel'], `${checkout} is outside ${repoRoot}`)
  }
  return { repoRoot, prefix }
}

/**
 * The newest subtree import of `prefix` walking back from HEAD, or null when
 * the history has none. The `git-subtree-split` line of the import commit names
 * the upstream tree.
 */
export function findUpstreamImport(repoRoot, prefix) {
  const commits = runGit(repoRoot, [
    'log',
    '--format=%H',
    '--fixed-strings',
    `--grep=git-subtree-dir: ${prefix}`,
    'HEAD',
  ])
    .split('\n')
    .filter(Boolean)
  for (const importCommit of commits) {
    const message = runGit(repoRoot, ['log', '-1', '--format=%B', importCommit])
    const split = message
      .split(/\r?\n/)
      .find((line) => line.startsWith('git-subtree-split:'))
    if (!split) continue
    const upstreamCommit = split.slice('git-subtree-split:'.length).trim()
    if (!upstreamCommit) continue
    return { importCommit, upstreamCommit }
  }
  return null
}

/** The remote branch that is FreeCut's own history (AGENTS.md, "The repository"). */
export const UPSTREAM_REF = 'upstream-studio/main'

/**
 * The newest FreeCut commit that `HEAD` contains: the merge base of `HEAD` and
 * the remote branch `upstream-studio/main`. Unlike the subtree-split trailer of
 * the first import, it moves forward with every `git subtree merge`, and it is
 * a commit of FreeCut's own history, never one that holds fork commits.
 * Returns null when the branch is not in this clone or shares no history.
 */
export function findUpstreamBase(repoRoot, ref = UPSTREAM_REF) {
  try {
    const sha = runGit(repoRoot, ['merge-base', 'HEAD', ref]).trim()
    return sha || null
  } catch (error) {
    if (error instanceof GitError) return null
    throw error
  }
}

/**
 * The files of a tree, as a Map from path to blob id. With a `prefix`, only the
 * files under that folder of the repository are listed and the prefix is
 * stripped, so an import's own tree and `studio/`'s tree are compared by the
 * same paths.
 */
export function listFiles(repoRoot, revision, prefix = '') {
  const args = ['ls-tree', '-r', '-z', revision]
  if (prefix) args.push('--', `${prefix}/`)
  const output = runGit(repoRoot, args)
  const files = new Map()
  for (const entry of output.split('\0')) {
    if (!entry) continue
    const tab = entry.indexOf('\t')
    // `<mode> SP <type> SP <id> TAB <path>`; for a submodule the id is a commit.
    const [, , sha] = entry.slice(0, tab).split(' ')
    const fullPath = entry.slice(tab + 1)
    const filePath = prefix ? fullPath.slice(prefix.length + 1) : fullPath
    files.set(filePath, sha)
  }
  return files
}
