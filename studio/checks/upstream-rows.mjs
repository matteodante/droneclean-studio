#!/usr/bin/env node
// Upstream rows check: every file of FreeCut's that differs from the tree
// `studio/` was imported from, or that the fork deleted, has a row in
// `UPSTREAM_CHANGES.md`; and every row still describes such a change. This is
// AGENTS.md's "The forks stay mergeable ... every touched file of FreeCut's
// listed in studio/UPSTREAM_CHANGES.md", measured (PLAN.md's last section).
//
//   node checks/upstream-rows.mjs              this checkout's studio/
//   node checks/upstream-rows.mjs <folder>     another folder, for this check's tests
//   node checks/upstream-rows.mjs --help
//
// The upstream reference is the merge base of HEAD and the remote branch
// `upstream-studio/main` (see checks/lib/upstream.mjs): a commit of FreeCut's own
// history, so the check runs offline and a later `git subtree merge
// --prefix=studio` moves it forward by itself. (The first import's
// `git-subtree-split` is not used: it names a branch that already held the
// fork's own commits.)
//
// Paths the fork owns (FORK_FOLDERS in checks/lib/fork-areas.mjs: src/studio/,
// the kits, and the few files whose place is fixed) are skipped: the table
// describes changes to FreeCut's files, and the imported branch `studio/main`
// already carried some of the fork's own (bench/, golden/, this table), so
// "exists in the imported tree" alone does not make a file FreeCut's.
//
// A row is a line of the table whose first cell names a path relative to
// studio/, backticks optional. A file the fork deleted on purpose keeps a row
// whose second cell begins with "Deleted"; a row for a deleted file that does
// not say so is stale, like a row for a file that no longer differs.
//
// Exit codes: 0 every changed FreeCut file has a row and every row is current,
// 1 a row is missing or stale, 2 the check could not run (no git repository, no
// subtree import, the imported commit is not in this clone, no table).

import fs from 'node:fs'
import path from 'node:path'
import { ownerOf } from './lib/fork-areas.mjs'
import {
  findUpstreamBase,
  GitError,
  UPSTREAM_REF,
  listFiles,
  studioLocation,
} from './lib/upstream.mjs'

/** `studio/checks/` sits in the studio checkout this check reads by default. */
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..')
const DOCUMENT = 'UPSTREAM_CHANGES.md'

const USAGE = `Usage: node checks/upstream-rows.mjs [folder]

  folder  the studio checkout to check; default: the folder above this script

Exit codes: 0 rows are current, 1 a row is missing or stale, 2 the check could not run.
`

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true, root: null }
  if (argv.length > 1) throw new Error(`expected at most one folder\n${USAGE}`)
  return { help: false, root: argv[0] ? path.resolve(argv[0]) : DEFAULT_ROOT }
}

/**
 * The rows of the table: the path they name and whether they mark the file as
 * deleted. Lines outside a table, the header and the separator are skipped.
 */
function readRows(documentPath) {
  const rows = []
  for (const line of fs.readFileSync(documentPath, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|')
    if (cells.length < 5) continue
    const first = cells[1].trim()
    if (first === 'File' || /^:?-+:?$/.test(first)) continue
    const file = first.replaceAll('`', '').trim()
    if (!file) continue
    rows.push({
      file,
      deleted: /^deleted\b/i.test(cells[2].replaceAll('`', '').trim()),
    })
  }
  return rows
}

/**
 * The paths with no row, and the rows that no longer describe a change.
 * A path is malformed when it is not relative to studio/, and a deleted file
 * needs a row that says `Deleted`.
 */
function compare(upstream, ours, rows) {
  const rowsByFile = new Map()
  for (const row of rows) {
    const list = rowsByFile.get(row.file) ?? []
    list.push(row)
    rowsByFile.set(row.file, list)
  }

  const missing = []
  let changed = 0
  let deleted = 0
  let skipped = 0
  for (const [file, sha] of upstream) {
    // A path the fork owns is not FreeCut's file: the imported branch already
    // carried some of the fork's own (bench/, golden/, the table), and the
    // table does not describe those.
    if (ownerOf(file)) {
      skipped++
      continue
    }
    if (!ours.has(file)) {
      deleted++
      if (!rowsByFile.get(file)?.some((row) => row.deleted)) missing.push({ file, kind: 'deleted' })
    } else if (ours.get(file) !== sha) {
      changed++
      if (!rowsByFile.has(file)) missing.push({ file, kind: 'changed' })
    }
  }

  const stale = []
  for (const [file, fileRows] of rowsByFile) {
    if (ownerOf(file)) continue
    if (file.startsWith('studio/') || file.startsWith('/') || file.startsWith('./') || file.includes('..')) {
      stale.push({ file, why: 'name the path relative to studio/, with no leading folder or ".."' })
      continue
    }
    const sha = upstream.get(file)
    if (sha === undefined) {
      stale.push({ file, why: "not a file in FreeCut's imported tree" })
    } else if (ours.has(file) && ours.get(file) === sha) {
      stale.push({ file, why: "same as FreeCut's file; the row no longer describes a change" })
    } else if (!ours.has(file) && !fileRows.some((row) => row.deleted)) {
      stale.push({ file, why: 'deleted in studio/, but the row does not begin with "Deleted"' })
    }
  }

  const checkedPaths = [...rowsByFile.keys()].filter((file) => !ownerOf(file))
  return {
    missing,
    stale,
    changed,
    deleted,
    skipped,
    rowPaths: checkedPaths.length,
    rowCount: checkedPaths.reduce((total, file) => total + rowsByFile.get(file).length, 0),
  }
}

function printReport({ upstreamName, upstreamCount, oursCount, comparison }) {
  console.log(
    `FreeCut at ${upstreamName}: ${upstreamCount} files, ${comparison.skipped} of them the fork's own (skipped); ` +
      `studio/: ${oursCount} files; ${comparison.changed} changed and ${comparison.deleted} deleted; ` +
      `${comparison.rowCount} row(s) for ${comparison.rowPaths} path(s).`,
  )
  if (comparison.missing.length === 0 && comparison.stale.length === 0) {
    console.log('PASS: every changed FreeCut file has a row, and every row still describes a change.')
    return 0
  }
  if (comparison.missing.length > 0) {
    console.error(`FAIL: ${comparison.missing.length} changed or deleted FreeCut file(s) have no row:`)
    for (const { file, kind } of comparison.missing) {
      const what =
        kind === 'deleted'
          ? 'deleted in studio/; the row must begin with "Deleted"'
          : "differs from FreeCut's file"
      console.error(`  missing  ${file}  (${what})`)
    }
  }
  if (comparison.stale.length > 0) {
    console.error(`FAIL: ${comparison.stale.length} row(s) no longer describe a change:`)
    for (const { file, why } of comparison.stale) {
      console.error(`  stale    ${file}  (${why})`)
    }
  }
  console.error(`  The table is ${DOCUMENT} in the studio folder; fix a row in the same commit as the file.`)
  return 1
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
    const base = findUpstreamBase(repoRoot)
    if (!base) {
      console.error(
        `SETUP: no merge base of HEAD and ${UPSTREAM_REF} in this clone, so nothing can be compared.\n` +
          `  Fetch FreeCut's branch with its full history: git fetch upstream-studio`,
      )
      return 2
    }
    const upstream = listFiles(repoRoot, base)
    const ours = listFiles(repoRoot, 'HEAD', prefix)
    const documentPath = path.join(options.root, DOCUMENT)
    if (!fs.existsSync(documentPath)) {
      console.error(`SETUP: ${documentPath} does not exist, so there are no rows to check.`)
      return 2
    }
    const rows = readRows(documentPath)
    const comparison = compare(upstream, ours, rows)
    return printReport({
      upstreamName: base.slice(0, 9),
      upstreamCount: upstream.size,
      oursCount: ours.size,
      comparison,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`SETUP: ${detail}`)
    return 2
  }
}

process.exitCode = main(process.argv.slice(2))
