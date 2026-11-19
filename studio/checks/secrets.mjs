#!/usr/bin/env node
// Secrets check: no secret may sit in the files the repository tracks (AGENTS.md: "No secrets, `.env` files,
// model weights or footage in git").
//
//   node checks/secrets.mjs               the repository this folder belongs to
//   node checks/secrets.mjs <folder>      another folder, for this check's own tests
//
// In a git repository the check scans exactly the files `git ls-files` lists, as they are in the working tree:
// a folder git does not track (`cloud/`, the separate clone of the live product, `node_modules`, `dist`,
// `.worktrees/`) is never scanned, in the main checkout as in a worktree. The files are copied (cloned on
// APFS) into a temporary folder and gitleaks scans that. A folder that is not a git repository, as the tests
// make, is scanned whole. `--redact` keeps a finding's value out of every log this script writes; the finding
// is named by file, line and rule, never by the leak itself.
//
// Files larger than MAX_TARGET_MEGABYTES are skipped: gitleaks already skips binaries, and a secret is a short
// piece of text. With that bound the scan of this repository takes about 5 s; without it, about 11 s.
//
// Exit codes: 0 no finding, 1 at least one finding, 2 the check could not run (gitleaks missing or failed).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** `studio/checks/` sits two levels below the repository root this check scans by default. */
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const MAX_TARGET_MEGABYTES = 1

const USAGE = `Usage: node checks/secrets.mjs [folder]

  folder  the folder to scan; default: the repository root above this file
`

/**
 * The files git tracks under `root`, relative to it, or null when `root` is not inside a git work tree.
 * Deleted-but-tracked files and anything that is not a regular file are left out.
 */
function trackedFiles(root) {
  const inside = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return null
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (listed.status !== 0) return null
  return listed.stdout
    .split('\0')
    .filter(Boolean)
    .filter((file) => {
      try {
        const stat = fs.lstatSync(path.join(root, file))
        return stat.isFile() && stat.size <= MAX_TARGET_MEGABYTES * 1024 * 1024
      } catch {
        return false
      }
    })
}

/** Copies `files` of `root` into a new temporary folder (a clone on APFS, so it takes a second) and returns it. */
function mirrorOf(root, files) {
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-secrets-scan-'))
  for (const file of files) {
    const target = path.join(mirror, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_FICLONE)
  }
  return mirror
}

/** Runs gitleaks over `root` and returns its result, or throws when the binary is not there. */
function runGitleaks(root) {
  return spawnSync(
    'gitleaks',
    [
      'dir',
      root,
      '--redact',
      '--no-banner',
      '--log-level',
      'error',
      '--exit-code',
      '0',
      '--max-target-megabytes',
      String(MAX_TARGET_MEGABYTES),
      '--report-format',
      'json',
      '--report-path',
      '-',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
}

/** The findings of a gitleaks JSON report: file, line and rule, with the secret itself left out. */
function findingsOf(stdout, root) {
  const parsed = JSON.parse(stdout.trim() || '[]')
  const findings = Array.isArray(parsed) ? parsed : []
  return findings.map((finding) => ({
    file: path.relative(root, path.resolve(root, finding.File ?? '')),
    line: finding.StartLine,
    rule: finding.RuleID,
  }))
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

  const tracked = trackedFiles(root)
  const scanned = tracked ? mirrorOf(root, tracked) : root
  let result
  try {
    result = runGitleaks(scanned)
  } finally {
    if (tracked) fs.rmSync(scanned, { recursive: true, force: true })
  }
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      process.stderr.write(
        'Secrets check: gitleaks is not installed, so nothing was scanned.\n' +
          '  Install gitleaks 8.x (`brew install gitleaks`, task 0.2 of PLAN.md) and run `npm run check:secrets` again.\n',
      )
      return 2
    }
    process.stderr.write(`Secrets check: gitleaks could not start: ${result.error.message}\n`)
    return 2
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.signal || `exit code ${result.status}`
    process.stderr.write(`Secrets check: gitleaks failed: ${detail}\n`)
    return 2
  }

  let findings
  try {
    findings = findingsOf(result.stdout, scanned)
  } catch (error) {
    process.stderr.write(`Secrets check: gitleaks wrote no readable report: ${error.message}\n`)
    return 2
  }

  if (findings.length === 0) {
    process.stdout.write(`Secrets check: no findings in ${tracked ? `${tracked.length} tracked file(s) of ${root}` : root}.\n`)
    return 0
  }

  process.stderr.write(`Secrets check: ${findings.length} finding(s) in ${root}:\n`)
  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}:${finding.line}  ${finding.rule}\n`)
  }
  process.stderr.write(
    '  A real secret must be removed from the file and the history; a false positive gets a\n',
  )
  process.stderr.write('  `// gitleaks:allow` comment on the line, with the reason next to it.\n')
  return 1
}

process.exit(main())
