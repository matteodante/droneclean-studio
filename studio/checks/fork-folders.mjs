#!/usr/bin/env node
// Fork folders check: a file that `studio/` has and FreeCut's imported tree
// does not must live under a folder this repository declares the fork's own,
// or be a test beside the file it covers (FreeCut keeps a test next to its
// subject). This is AGENTS.md's "new code in new folders", measured (PLAN.md's
// last section), so a file added inside one of FreeCut's folders is caught
// before a later merge of upstream has to resolve it.
//
//   node checks/fork-folders.mjs              this checkout's studio/
//   node checks/fork-folders.mjs <folder>     another folder, for this check's tests
//   node checks/fork-folders.mjs --help
//
// The upstream reference is the newest `git-subtree-split` in the repository's
// history (see checks/lib/upstream.mjs), so the check runs offline and a later
// `git subtree merge --prefix=studio` moves it forward by itself.
//
// The list is FORK_FOLDERS in checks/lib/fork-areas.mjs, shared with the
// upstream rows check, each entry with the reason it is the fork's. An entry
// ending in "/" owns that folder and everything under it; an entry without the
// slash owns exactly one file. Add an entry only when the place is the fork's
// by design, never to quiet a file that belongs beside FreeCut's code.
//
// The one general exception is a test file (`*.test.ts`, `*.test.tsx`,
// `*.test.mjs`) whose subject exists in the same folder: `toolbar.test.tsx`
// covers `toolbar.tsx`, and a qualifier before `.test` is dropped until a file
// exists (`gpu.shadow.test.ts` covers `gpu.ts`). Nothing else in FreeCut's
// folders is allowed.
//
// Exit codes: 0 every file the fork adds is allowed, 1 a file is outside, 2 the
// check could not run (no git repository, no subtree import, the imported
// commit is not in this clone).

import path from 'node:path'
import { ownerOf } from './lib/fork-areas.mjs'
import {
  findUpstreamImport,
  GitError,
  listFiles,
  studioLocation,
} from './lib/upstream.mjs'

/** `studio/checks/` sits in the studio checkout this check reads by default. */
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..')
const TEST_FILE = /\.test\.(ts|tsx|mjs)$/
const SUBJECT_EXTENSIONS = ['ts', 'tsx', 'mjs', 'js']
const TESTS_BESIDE_SUBJECT = 'tests beside their subject'

const USAGE = `Usage: node checks/fork-folders.mjs [folder]

  folder  the studio checkout to check; default: the folder above this script

Exit codes: 0 every fork file is allowed, 1 a file is outside, 2 the check could not run.
`

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true, root: null }
  if (argv.length > 1) throw new Error(`expected at most one folder\n${USAGE}`)
  return { help: false, root: argv[0] ? path.resolve(argv[0]) : DEFAULT_ROOT }
}

/**
 * The file a test beside FreeCut's code covers, or null when there is none.
 * `toolbar.test.tsx` covers `toolbar.tsx`; `gpu.shadow.test.ts` carries a
 * qualifier, so trailing `.segment`s are dropped until a file with that name
 * exists beside the test.
 */
function testSubject(file, files) {
  const suffix = TEST_FILE.exec(file)
  if (!suffix) return null
  const directory = path.posix.dirname(file)
  let stem = path.posix.basename(file).slice(0, -suffix[0].length)
  while (stem) {
    for (const extension of SUBJECT_EXTENSIONS) {
      const subject = path.posix.join(directory, `${stem}.${extension}`)
      if (files.has(subject)) return subject
    }
    const dot = stem.lastIndexOf('.')
    if (dot <= 0) return null
    stem = stem.slice(0, dot)
  }
  return null
}

/** `{ label, why }` for an allowed file, or null when no rule allows it. */
function allowanceOf(file, files) {
  const owner = ownerOf(file)
  if (owner) return { label: owner.path, why: owner.why }
  const subject = testSubject(file, files)
  if (subject) {
    return {
      label: TESTS_BESIDE_SUBJECT,
      why: `FreeCut keeps a test beside its subject, and ${subject} exists`,
    }
  }
  return null
}

function printReport({ upstreamName, upstreamCount, oursCount, forkFiles, counts, outside }) {
  console.log(
    `FreeCut at ${upstreamName}: ${upstreamCount} files; studio/: ${oursCount} files; ` +
      `${forkFiles.length} file(s) are the fork's own.`,
  )
  if (outside.length > 0) {
    console.error(`FAIL: ${outside.length} file(s) the fork adds are outside the folders the fork owns:`)
    for (const file of outside) console.error(`  ${file}`)
    console.error(
      '  Move each under a folder in FORK_FOLDERS (checks/lib/fork-areas.mjs), list it there when its\n' +
        "  place is fixed by a framework, or name a test after the file it covers.",
    )
    return 1
  }
  const summary = [...counts]
    .map(([label, count]) => `${label} ${count}`)
    .join(', ')
  console.log(`PASS: every file the fork adds is under a folder the fork owns (${summary}).`)
  return 0
}

function main(argv) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    console.error(error.message)
    return 2
  }
  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }

  try {
    const { repoRoot, prefix } = studioLocation(options.root)
    if (!prefix) {
      console.error(`SETUP: ${options.root} is the repository root, not a folder imported from FreeCut.`)
      return 2
    }
    const imported = findUpstreamImport(repoRoot, prefix)
    if (!imported) {
      console.error(
        `SETUP: no subtree import of "${prefix}" in this repository's history (no commit message with\n` +
          `  "git-subtree-dir: ${prefix}" and "git-subtree-split:"). Nothing can be compared.`,
      )
      return 2
    }

    let upstream
    try {
      upstream = listFiles(repoRoot, imported.upstreamCommit)
    } catch (error) {
      if (error instanceof GitError) {
        console.error(
          `SETUP: the FreeCut commit the newest import names (${imported.upstreamCommit}) is not in this clone.\n` +
            '  Fetch the branch with its full history; a shallow clone cannot check the folders.',
        )
        return 2
      }
      throw error
    }
    const ours = listFiles(repoRoot, 'HEAD', prefix)
    const forkFiles = [...ours.keys()].filter((file) => !upstream.has(file)).sort()
    const counts = new Map()
    const outside = []
    for (const file of forkFiles) {
      const allowance = allowanceOf(file, ours)
      if (!allowance) {
        outside.push(file)
        continue
      }
      counts.set(allowance.label, (counts.get(allowance.label) ?? 0) + 1)
    }
    return printReport({
      upstreamName: imported.upstreamCommit.slice(0, 7),
      upstreamCount: upstream.size,
      oursCount: ours.size,
      forkFiles,
      counts,
      outside,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`SETUP: ${detail}`)
    return 2
  }
}

process.exitCode = main(process.argv.slice(2))
