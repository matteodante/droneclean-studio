#!/usr/bin/env node
// Licence check: every production dependency in the two lock files carries a licence the editor may ship under
// GPL-3.0-or-later (docs/publish-audit.md, section 4). A package whose licence is not in the allow-list below, or
// that declares none, fails the check and is named; a new dependency with a copyleft-incompatible or non-commercial
// licence cannot slip in with an ordinary `npm install`.
//
//   node checks/licenses.mjs               the studio folder this file belongs to
//   node checks/licenses.mjs <folder>      another folder, for this check's own tests
//
// It reads `<folder>/package-lock.json` and `<folder>/desktop/package-lock.json` (lockfile version 2 or 3) and looks
// at every package that is not `dev: true`. A licence expression is allowed when it is an allowed identifier, an
// `OR` of which at least one alternative is allowed (the licensee chooses), or an `AND` of which every part is
// allowed. `WITH` exceptions and anything the parser does not know are not allowed.
//
// Exit codes: 0 nothing found, 1 at least one package is not allowed, 2 the check could not run.

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..')
const LOCK_FILES = ['package-lock.json', path.join('desktop', 'package-lock.json')]

/** SPDX identifiers the editor may ship (the licence of the editor itself is GPL-3.0-or-later). */
export const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'OFL-1.1',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'Zlib',
  '0BSD',
  'Unlicense',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'UFL-1.0',
  'CC-BY-4.0',
])

/**
 * Packages the audit judged acceptable although their declared licence is missing or not an allowed expression.
 * Key: the package name; value: why. Keep it short, and give every entry its reason.
 */
export const EXCEPTIONS = new Map([])

/** Whether an SPDX expression is allowed. A malformed or unknown one is not. */
export function isAllowedExpression(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let position = 0

  // or := and ('OR' and)*      and := term ('AND' term)*      term := '(' or ')' | identifier
  function parseOr() {
    let allowed = parseAnd()
    while (tokens[position]?.toUpperCase() === 'OR') {
      position += 1
      const next = parseAnd()
      allowed = allowed || next
    }
    return allowed
  }
  function parseAnd() {
    let allowed = parseTerm()
    while (tokens[position]?.toUpperCase() === 'AND') {
      position += 1
      const next = parseTerm()
      allowed = allowed && next
    }
    return allowed
  }
  function parseTerm() {
    const token = tokens[position]
    position += 1
    if (token === undefined) throw new SyntaxError('unexpected end of expression')
    if (token === '(') {
      const allowed = parseOr()
      if (tokens[position] !== ')') throw new SyntaxError('missing )')
      position += 1
      return allowed
    }
    if (token === ')' || /^(AND|OR|WITH)$/i.test(token)) throw new SyntaxError(`unexpected ${token}`)
    return ALLOWED_LICENSES.has(token)
  }

  try {
    const allowed = parseOr()
    return allowed && position === tokens.length
  } catch {
    return false
  }
}

/** The package name of a lock entry: its `name`, else the last `node_modules/` segment of its path. */
function packageName(lockPath, entry) {
  return entry.name ?? lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length)
}

/** Every production package of one lock file that is not allowed: `{ name, version, license, reason }`. */
export function findingsInLock(lock) {
  const findings = []
  for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
    if (lockPath === '' || entry.dev === true || entry.link === true) continue
    const name = packageName(lockPath, entry)
    const license = typeof entry.license === 'string' ? entry.license.trim() : undefined
    if (EXCEPTIONS.has(name)) continue
    if (license === undefined || license === '') {
      findings.push({ name, version: entry.version, license: '(none declared)' })
    } else if (!isAllowedExpression(license)) {
      findings.push({ name, version: entry.version, license })
    }
  }
  return findings.toSorted((left, right) => left.name.localeCompare(right.name))
}

function main() {
  const root = path.resolve(process.argv[2] ?? DEFAULT_ROOT)
  let failed = false
  let checked = 0
  for (const relative of LOCK_FILES) {
    const file = path.join(root, relative)
    let lock
    try {
      lock = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      console.error(`licences: cannot read ${file}: ${error.message}`)
      process.exit(2)
    }
    const findings = findingsInLock(lock)
    checked += Object.keys(lock.packages ?? {}).length
    for (const { name, version, license } of findings) {
      failed = true
      console.error(`${relative}: ${name}@${version} has licence "${license}", which is not in the allow-list`)
    }
  }
  if (failed) {
    console.error('\nAllowed: ' + [...ALLOWED_LICENSES].join(', ') + ' (and OR / AND expressions of them).')
    console.error('A package judged acceptable anyway goes in EXCEPTIONS in checks/licenses.mjs, with the reason.')
    process.exit(1)
  }
  console.log(`licences ok: the production dependencies of ${LOCK_FILES.join(' and ')} (${checked} lock entries) are all allowed`)
}

if (process.argv[1] === import.meta.filename) main()
