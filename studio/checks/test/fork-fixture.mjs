// A throwaway git repository for the upstream-rows and fork-folders tests: it
// has the three commits those checks know about, labelled as this repository
// labels them. FreeCut's tree is a commit at the root of its own history (the
// "upstream" commit); the import commit puts the same tree under `studio/` and
// carries the `git-subtree-dir` / `git-subtree-split` trailers `git subtree`
// writes; the fork commit changes one FreeCut file, deletes another and adds
// the fork's own.
//
// Nothing here touches this repository: every fixture is a fresh folder under
// the operating system's temporary directory.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** FreeCut's files in the fixture, as paths relative to FreeCut's root. */
const UPSTREAM_FILES = {
  'src/base.ts': 'export const base = 1\n',
  'src/changed.ts': "export const value = 'upstream'\n",
  'src/deleted.ts': 'export const gone = true\n',
}

/** Rows that describe the fork commit's changes and nothing else. */
export const CLEAN_ROWS = [
  '| File | What we changed | Why |',
  '|---|---|---|',
  '| `src/changed.ts` | The fork changes the value. | A test fixture. |',
  '| `src/deleted.ts` | Deleted; nothing imports it. | A test fixture. |',
].join('\n')

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${dir}: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function writeFiles(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
}

function commitAll(dir, message) {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
}

/**
 * Builds the fixture. `rows` is the table's text; `upstreamFiles` are FreeCut
 * files added to the imported tree, `forkChanges` are files the fork commit
 * changes, and `forkFiles` are files it adds, all as paths relative to
 * `studio/`. `preppedChanges` (files relative to FreeCut's root) adds a commit
 * on top of FreeCut's, as the prepped branch `studio/main` was: the import
 * commit then names that commit, while `upstream-studio/main` stays at FreeCut's.
 */
export function createForkFixture({
  rows = CLEAN_ROWS,
  upstreamFiles = {},
  forkFiles = { 'src/studio/new.ts': 'export const own = true\n' },
  forkChanges = {},
  preppedChanges = null,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-fork-rules-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fork-rules-test@example.com'])
  git(dir, ['config', 'user.name', 'Fork rules test'])

  const freecut = { ...UPSTREAM_FILES, ...upstreamFiles }
  writeFiles(dir, freecut)
  const upstream = commitAll(dir, 'FreeCut at the imported commit')

  // The remote branch the check measures against: FreeCut's own history.
  git(dir, ['update-ref', 'refs/remotes/upstream-studio/main', upstream])

  let split = upstream
  let importedTree = freecut
  if (preppedChanges) {
    writeFiles(dir, preppedChanges)
    split = commitAll(dir, 'The prepped branch adds fork changes to FreeCut')
    importedTree = { ...freecut, ...preppedChanges }
  }

  const imported = {}
  for (const [file, content] of Object.entries(importedTree)) {
    imported[`studio/${file}`] = content
  }
  writeFiles(dir, imported)
  commitAll(
    dir,
    `Add 'studio/' from commit '${split}'\n\n` +
      `git-subtree-dir: studio\ngit-subtree-split: ${split}\n`,
  )

  writeFiles(dir, {
    'studio/src/changed.ts': "export const value = 'fork'\n",
    'studio/UPSTREAM_CHANGES.md': `${rows}\n`,
    ...Object.fromEntries(
      Object.entries(forkChanges).map(([file, content]) => [`studio/${file}`, content]),
    ),
    ...Object.fromEntries(
      Object.entries(forkFiles).map(([file, content]) => [`studio/${file}`, content]),
    ),
  })
  fs.rmSync(path.join(dir, 'studio/src/deleted.ts'))
  commitAll(dir, 'The fork changes FreeCut and adds its own code')

  return {
    dir,
    studio: path.join(dir, 'studio'),
    upstream,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

export function runCheck(script, studio) {
  return spawnSync(process.execPath, [script, studio], { encoding: 'utf8' })
}
