#!/usr/bin/env node
// Reachability check (finding F1 of docs/reviews/2026-11-18-findings.md): which modules of the fork are
// never loaded by the app?
//
//   node checks/reachable.mjs                     check against the baseline
//   node checks/reachable.mjs --shrink-baseline   drop the entries that are reachable now (never adds one)
//   node checks/reachable.mjs --list              print every unreachable module
//
// The walk starts at the production entries only and follows imports, re-exports, dynamic imports,
// `new URL('./x', import.meta.url)` (workers) and `import.meta.glob`:
//
//   src/bootstrap.ts          the editor page (index.html)       src/routes/**       every route module
//   src/headless/main.ts      the headless page (headless.html)  desktop/src/main/index.ts       the main process
//   desktop/src/preload/*.ts  the three preload scripts, which the main process loads by file path
//   vite.config.ts            the build (it loads src/studio/build/*)
//
// Tests, probes, harnesses, bench and golden are not entries: a module that only they load is not used by the
// product. (`fallow` counts them as entries, which is why the dead-code ratchets let such modules through.)
//
// The modules judged are the non-test source files of `src/studio/` and `desktop/src/`, minus test-only support
// code: `__fixtures__/` folders and `*.fixture.ts` / `*.fixture.mjs` files are not production code and are ignored. Today's unreachable
// ones are listed in `checks/baselines/reachable.json`, which may only shrink: a new unreachable module fails
// the check, and a module that became reachable must leave the baseline (the check says so). The fix for an
// entry is to give it a real caller or to delete it; never to add it here.
//
// Exit codes: 0 baseline matches, 1 a module is newly unreachable or an entry is stale, 2 the check could not run.

import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..')
export const BASELINE_PATH = path.join(import.meta.dirname, 'baselines', 'reachable.json')

/** Production entries: exact files, and folders whose every source file is one. */
export const ENTRIES = [
  'src/bootstrap.ts',
  'src/headless/main.ts',
  'src/routes/',
  'desktop/src/main/index.ts',
  'desktop/src/preload/',
  'vite.config.ts',
]

/** The folders whose modules are judged. */
export const JUDGED = ['src/studio/', 'desktop/src/']

const CODE = /\.(?:[cm]?[jt]sx?)$/
const isTest = (file) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)__(tests|mocks)__\//.test(file) || /\.d\.ts$/.test(file)
/** Test-only support code (not production): `__fixtures__/` folders and `*.fixture.ts` / `*.fixture.mjs` files. */
const isFixture = (file) => /(^|\/)__fixtures__\//.test(file) || /\.fixture\.[cm]?[jt]sx?$/.test(file)
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every file under `directory`, as paths relative to `root`; skips node_modules and dot folders. */
function walk(root, directory, out = []) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const relative = `${directory}${entry.name}`
    if (entry.isDirectory()) walk(root, `${relative}/`, out)
    else if (entry.isFile()) out.push(relative)
  }
  return out
}

/** The file a specifier names, relative to `root`, or null for a package or a file that is not code. */
function resolveSpecifier(root, from, rawSpecifier) {
  const specifier = rawSpecifier.split(/[?#]/)[0]
  let base
  if (specifier.startsWith('@/')) base = path.join('src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.join(path.dirname(from), specifier)
  else return null
  base = base.split(path.sep).join('/')
  const candidates = [
    base,
    // TypeScript's node16 resolution names the emitted file: './x.js' is './x.ts'.
    base.replace(/\.([cm]?)js$/, '.$1ts'),
    base.replace(/\.js$/, '.tsx'),
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ]
  for (const candidate of candidates) {
    const absolute = path.join(root, candidate)
    if (CODE.test(candidate) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return candidate
  }
  return null
}

/** The code files matched by a Vite glob pattern, relative to `root`; a star stands for part of one path segment. */
function expandGlob(root, from, pattern, files) {
  if (pattern.startsWith('!')) return []
  const base = pattern.startsWith('/') ? pattern.slice(1) : path.join(path.dirname(from), pattern)
  const normalized = base.split(path.sep).join('/')
  const expression = new RegExp(
    `^${normalized
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*/g, '[^/]*')}$`,
  )
  return files.filter((file) => expression.test(file) && CODE.test(file))
}

/** The modules a file loads, as paths relative to `root`. */
function importsOf(root, file, source, allFiles) {
  const code = stripComments(source)
  const specifiers = new Set()
  const staticPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const urlPattern = /new\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g
  for (const pattern of [staticPattern, dynamicPattern, urlPattern]) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1])
  }
  const targets = new Set()
  for (const specifier of specifiers) {
    const target = resolveSpecifier(root, file, specifier)
    if (target) targets.add(target)
  }
  for (const match of code.matchAll(/import\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
    const patterns = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1])
    for (const pattern of patterns) for (const found of expandGlob(root, file, pattern, allFiles)) targets.add(found)
  }
  return [...targets]
}

/**
 * The modules judged and the ones the entries reach, for the tree at `root`:
 * `{ judged, unreachable }`, both sorted lists of paths relative to `root`.
 */
export function measure(root, { entries = ENTRIES, judged = JUDGED } = {}) {
  const allFiles = ['src/', 'desktop/src/'].flatMap((folder) =>
    fs.existsSync(path.join(root, folder)) ? walk(root, folder) : [],
  )
  if (fs.existsSync(path.join(root, 'vite.config.ts'))) allFiles.push('vite.config.ts')
  const codeFiles = allFiles.filter((file) => CODE.test(file))
  const starts = codeFiles.filter((file) =>
    entries.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)),
  ).filter((file) => !isTest(file))
  if (starts.length === 0) throw new Error(`none of the production entries exists under ${root}`)

  const reached = new Set(starts)
  const queue = [...starts]
  while (queue.length > 0) {
    const file = queue.pop()
    for (const target of importsOf(root, file, fs.readFileSync(path.join(root, file), 'utf8'), allFiles)) {
      if (!reached.has(target)) {
        reached.add(target)
        queue.push(target)
      }
    }
  }

  const judgedFiles = codeFiles
    .filter((file) => judged.some((folder) => file.startsWith(folder)) && !isTest(file) && !isFixture(file))
    .sort()
  return { judged: judgedFiles, unreachable: judgedFiles.filter((file) => !reached.has(file)) }
}

export function readBaseline(baselinePath = BASELINE_PATH) {
  if (!fs.existsSync(baselinePath)) return []
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).unreachable
}

export function writeBaseline(files, baselinePath = BASELINE_PATH) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({ comment: 'May only shrink. See checks/reachable.mjs.', unreachable: files }, null, 2)}\n`,
  )
}

/** The newly unreachable modules and the baseline entries that are reachable (or gone) now. */
export function compareWithBaseline(unreachable, baseline) {
  const known = new Set(baseline)
  const current = new Set(unreachable)
  return {
    added: unreachable.filter((file) => !known.has(file)),
    fixed: baseline.filter((file) => !current.has(file)),
  }
}

function main(argv) {
  const root = DEFAULT_ROOT
  let result
  try {
    result = measure(root)
  } catch (error) {
    console.error(`SETUP: ${error.message}`)
    return 2
  }
  const baseline = readBaseline()
  const { added, fixed } = compareWithBaseline(result.unreachable, baseline)

  if (argv.includes('--list')) {
    for (const file of result.unreachable) console.log(file)
    return 0
  }
  if (argv.includes('--shrink-baseline')) {
    writeBaseline(baseline.filter((file) => !fixed.includes(file)))
    console.log(`Reachability baseline: ${fixed.length} entr${fixed.length === 1 ? 'y' : 'ies'} removed.`)
    return added.length > 0 ? 1 : 0
  }

  console.log(
    `Reachability: ${result.judged.length} modules of src/studio and desktop/src judged from the production entries; ` +
      `${result.unreachable.length} unreachable (${baseline.length} in the baseline).`,
  )
  if (added.length === 0 && fixed.length === 0) {
    console.log('PASS: no module became unreachable, and no baseline entry became reachable.')
    return 0
  }
  if (added.length > 0) {
    console.error(`FAIL: ${added.length} module(s) are not reachable from any production entry:`)
    for (const file of added) console.error(`  unreachable  ${file}`)
    console.error('  Give each a real caller in the app, or delete it. Tests and probes do not count as callers.')
  }
  if (fixed.length > 0) {
    console.error(`FAIL: ${fixed.length} baseline entr${fixed.length === 1 ? 'y is' : 'ies are'} reachable (or deleted) now:`)
    for (const file of fixed) console.error(`  reachable    ${file}`)
    console.error('  Remove them from checks/baselines/reachable.json (node checks/reachable.mjs --shrink-baseline).')
  }
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2))
