#!/usr/bin/env node
// No-CDN check: no file the app ships may name a public CDN, so the "local" AI features cannot slip back to
// fetching a runtime from one (AGENTS.md: "The editor makes no network request the user did not ask for").
//
//   node checks/no-cdn.mjs               the studio folder this file belongs to
//   node checks/no-cdn.mjs <folder>      another folder, for this check's own tests
//
// The check reads every file under `<folder>/src` and `<folder>/public`, plus `<folder>/index.html`, and fails
// on a line that names one of the hosts below. A line that is only a comment may name a host when it also
// carries the marker `no-cdn-ok`, which is how a comment explains the old behaviour it replaced; the marker on
// a line of code does not count.
//
// Exit codes: 0 nothing found, 1 at least one finding, 2 the check could not run.

import fs from 'node:fs'
import path from 'node:path'

/** `studio/checks/` sits one level below the folder this check scans by default. */
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..')
/** The marker a comment uses when it has to name an old CDN URL. */
const MARKER = 'no-cdn-ok'
/** A line that begins a comment (in JS, JSX, CSS or HTML), so a marker on it is a comment, not code. */
const COMMENT_LINE = /^\s*(?:\{\s*)?(?:\/\/|\/\*|\*|<!--)/
const BANNED_HOSTS = ['cdn.jsdelivr.net', 'esm.sh', 'unpkg.com', 'cdnjs']
const SCANNED_PATHS = ['src', 'public', 'index.html']

const USAGE = `Usage: node checks/no-cdn.mjs [folder]

  folder  the studio folder to scan; default: the folder above this file
`

/** Every file under `entry`, sorted so a finding is always reported the same way. */
function filesUnder(entry) {
  const stats = fs.statSync(entry)
  if (stats.isFile()) {
    return [entry]
  }

  const files = []
  for (const dirent of fs.readdirSync(entry, { withFileTypes: true }).toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = path.join(entry, dirent.name)
    if (dirent.isDirectory()) {
      files.push(...filesUnder(child))
    } else if (dirent.isFile()) {
      files.push(child)
    }
  }
  return files
}

/** Whether a line may name a host: a comment line that carries the marker. */
function isMarkedComment(line) {
  return COMMENT_LINE.test(line) && line.includes(MARKER)
}

/** Every hit in one file: `{ line, host }`, one entry per finding line. */
function findingsInFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const findings = []
  const lines = text.split('\n')

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r$/, '')
    const host = BANNED_HOSTS.find((candidate) => line.toLowerCase().includes(candidate))
    if (host === undefined || isMarkedComment(line)) {
      continue
    }
    findings.push({ line: index + 1, host })
  }

  return findings
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }
  if (args.length > 1) {
    process.stderr.write(USAGE)
    return 2
  }
  const root = args[0] ? path.resolve(args[0]) : DEFAULT_ROOT

  const scanned = []
  const findings = []
  let fileCount = 0

  try {
    for (const relative of SCANNED_PATHS) {
      const entry = path.join(root, relative)
      if (!fs.existsSync(entry)) {
        continue
      }
      scanned.push(relative)
      for (const file of filesUnder(entry)) {
        fileCount += 1
        for (const finding of findingsInFile(file)) {
          findings.push({ file: path.relative(root, file), ...finding })
        }
      }
    }
  } catch (error) {
    process.stderr.write(`No-CDN check: could not scan ${root}: ${error.message}\n`)
    return 2
  }

  if (scanned.length === 0) {
    process.stderr.write(
      `No-CDN check: ${root} has none of ${SCANNED_PATHS.join(', ')}, so nothing was scanned.\n`,
    )
    return 2
  }

  if (findings.length === 0) {
    process.stdout.write(
      `No-CDN check: no CDN host named in ${fileCount} file(s) under ${root}.\n`,
    )
    return 0
  }

  process.stderr.write(`No-CDN check: ${findings.length} finding(s) in ${root}:\n`)
  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}:${finding.line}  ${finding.host}\n`)
  }
  process.stderr.write(
    '  A runtime or script must be an asset of this app (see src/shared/utils/ort-runtime.ts).\n',
  )
  process.stderr.write(
    `  A comment that has to name an old URL carries the marker \`${MARKER}\` on that same line.\n`,
  )
  return 1
}

process.exit(main())
