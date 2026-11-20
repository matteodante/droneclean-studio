#!/usr/bin/env node
// Reuse a build whose inputs are byte-identical to an earlier successful one.
//
//   node checks/build-cache.mjs studio-dist   [--out <dir>] [--fresh]   the app build (`vp build`) into dist/ (or <dir>)
//   node checks/build-cache.mjs package-test  [--fresh]                 the packaged test variant `npm run e2e` launches
//                                                                        (desktop/out + desktop/dist/test-app, and ../dist)
//
// What the key is made of, and why nothing less will do:
//   - every file of studio/ that git does not ignore (tracked or new), by path and content. The build reads
//     src/, public/, the html entries and the configs, and Tailwind scans every non-ignored file of the project
//     root for class names, so a narrower list could miss an input; a wider key only costs a rebuild.
//   - the installed dependencies (node_modules/.package-lock.json, and desktop's for the packaged app)
//   - the output folder (source maps hold paths relative to it), the Node version and platform, every VITE_* variable
//     and NODE_ENV
// A cache entry is written only after the build succeeded. `--fresh` ignores the entry and builds anyway
// (and then replaces the entry). The cache is in the git directory shared by every worktree, so a build made in
// one worktree serves the others when their studio/ is identical (the output folder being the same); it is cloned (copy-on-write, no disk used).
//
// Not cached, on purpose: unit tests, lint and type checks (they are the checks, and their result is not an artifact),
// the headless and desktop suites, golden frames, benchmarks. A key for a check's *result* would have to include
// everything the check reads (the GPU, Chrome, FFmpeg, the clock), and none of them is exactly keyable.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEEP_ENTRIES = 6

function git(args, cwd = STUDIO) {
  const result = spawnSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

/** Every file of `folder` that git does not ignore, relative to it, sorted. */
export function listInputs(folder = STUDIO) {
  const names = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], folder)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  return [...new Set(names)].sort()
}

/** sha256 over the path and content of every input file, plus the extra strings. */
// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
export function hashInputs(folder, files, extras = []) {
  const hash = crypto.createHash('sha256')
  for (const extra of extras) hash.update(`extra:${extra}\0`)
  for (const name of files) {
    const full = path.join(folder, name)
    let stat
    try {
      stat = fs.lstatSync(full)
    } catch {
      continue // tracked but deleted in the working tree: the same as absent
    }
    hash.update(`file:${name}\0`)
    if (stat.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(full)}\0`)
    else if (stat.isFile()) hash.update(fs.readFileSync(full))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function fileHash(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'absent'
}

/** The key of everything built from studio/. `desktop` adds the desktop's own dependencies. */
export function buildKey({ desktop = false, outDir = 'dist', studio = STUDIO } = {}) {
  const env = Object.keys(process.env)
    .filter((name) => name.startsWith('VITE_') || name === 'NODE_ENV')
    .sort()
    .map((name) => `${name}=${process.env[name]}`)
  const extras = [
    `node:${process.version}`,
    `platform:${process.platform}-${process.arch}`,
    // the source maps hold paths relative to the output folder, so a build is reused only for the folder it was made for
    `outDir:${outDir}`,
    `deps:${fileHash(path.join(studio, 'node_modules', '.package-lock.json'))}`,
    ...(desktop ? [`desktop-deps:${fileHash(path.join(studio, 'desktop', 'node_modules', '.package-lock.json'))}`] : []),
    ...env,
  ]
  return hashInputs(studio, listInputs(studio), extras)
}

/** The folder shared by every worktree of this repository. */
export function cacheRoot(studio = STUDIO) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], studio).toString('utf8').trim()
  return path.join(common, 'droneclean-build-cache')
}

function copyTree(from, to) {
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (process.platform === 'win32') {
    // Windows has no cp (the PC, task 8.1): Node copies the tree, keeping the times
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true })
    return
  }
  // -c clones on APFS (instant, no disk); where it cannot, cp falls back to a copy. -p keeps modes and times.
  const flags = process.platform === 'darwin' ? ['-c', '-R', '-p'] : ['-R', '-p']
  const result = spawnSync('cp', [...flags, from, to], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`cp ${from} -> ${to} failed`)
}

function prune(root) {
  if (!fs.existsSync(root)) return
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes('.tmp-'))
    .map((entry) => ({ name: entry.name, time: fs.statSync(path.join(root, entry.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
  for (const entry of entries.slice(KEEP_ENTRIES)) fs.rmSync(path.join(root, entry.name), { recursive: true, force: true })
}

/**
 * One cache entry: `parts` maps a name inside the entry to the folder it comes from and goes back to.
 * `produce()` builds them and throws or returns false when the build fails. Returns 'hit' or 'built'.
 */
// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
export function useCache({ kind, key, parts, produce, fresh = false, log = console.log, root = cacheRoot() }) {
  const entry = path.join(root, `${kind}-${key.slice(0, 20)}`)
  const label = `[cache] ${kind} key ${key.slice(0, 20)}`
  if (!fresh && fs.existsSync(path.join(entry, 'complete'))) {
    const started = Date.now()
    for (const [name, target] of Object.entries(parts)) copyTree(path.join(entry, name), target)
    fs.utimesSync(entry, new Date(), new Date())
    log(`${label}: HIT, restored in ${((Date.now() - started) / 1000).toFixed(1)} s (inputs byte-identical to a build that passed; --fresh forces a rebuild)`)
    return 'hit'
  }
  log(`${label}: ${fresh ? 'FRESH (forced)' : 'MISS'}, building`)
  const started = Date.now()
  if (produce() === false) throw new Error(`${kind} build failed`)
  log(`${label}: built in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  const staging = `${entry}.tmp-${process.pid}`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  for (const [name, target] of Object.entries(parts)) copyTree(target, path.join(staging, name))
  fs.writeFileSync(path.join(staging, 'complete'), `${new Date().toISOString()}\n`)
  fs.rmSync(entry, { recursive: true, force: true })
  fs.renameSync(staging, entry)
  prune(root)
  return 'built'
}

// On Windows npm and the .bin shims are .cmd files, which Node runs only through a shell (the PC, task 8.1)
const WINDOWS = process.platform === 'win32'

function run(command, args, cwd) {
  const result = spawnSync(WINDOWS ? `"${command}"` : command, args, { cwd, stdio: 'inherit', env: process.env, shell: WINDOWS })
  return result.status === 0
}

const vp = (args) => run(path.join(STUDIO, 'node_modules', '.bin', WINDOWS ? 'vp.cmd' : 'vp'), args, STUDIO)

export function studioDist({ out = 'dist', fresh = false } = {}) {
  const target = path.resolve(STUDIO, out)
  return useCache({
    kind: 'studio-dist',
    key: buildKey({ outDir: path.relative(STUDIO, target) }),
    parts: { dist: target },
    fresh,
    // `vp build` with no flags is what `npm run build` and `npm run verify` run; another folder is only --outDir
    produce: () => vp(out === 'dist' ? ['build'] : ['build', '--outDir', out]),
  })
}

export function packageTest({ fresh = false } = {}) {
  // The packaged app contains the studio build, so that comes first (and is served from its own entry)
  studioDist({ fresh })
  const desktop = path.join(STUDIO, 'desktop')
  return useCache({
    kind: 'package-test',
    key: buildKey({ desktop: true }),
    parts: { out: path.join(desktop, 'out'), 'test-app': path.join(desktop, 'dist', 'test-app') },
    fresh,
    // npm run package:test = build (studio build, then tsc) + electron-builder; the studio build was just made above
    produce: () => run('npm', ['--prefix', 'desktop', 'run', 'build:main'], STUDIO) && run('npm', ['--prefix', 'desktop', 'run', 'package:electron:test'], STUDIO),
  })
}

// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
function main(argv) {
  const [command, ...rest] = argv
  const fresh = rest.includes('--fresh')
  const outIndex = rest.indexOf('--out')
  const out = outIndex >= 0 ? rest[outIndex + 1] : 'dist'
  try {
    if (command === 'studio-dist') studioDist({ out, fresh })
    else if (command === 'package-test') packageTest({ fresh })
    else {
      console.error('usage: build-cache.mjs studio-dist [--out <dir>] [--fresh] | package-test [--fresh]')
      return 2
    }
  } catch (error) {
    console.error(error.message)
    return 1
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
