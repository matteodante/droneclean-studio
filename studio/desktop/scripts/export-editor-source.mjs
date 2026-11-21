/**
 * The public source of DroneClean Studio: a snapshot of `studio/` and `gyroflow/` at one commit of `editor`, written
 * into a checkout of the public editor repository (scripts/release-mac.mjs publishes it with each release). Only those
 * two folders leave the private repository (decided 19 Nov 2026): the plan, the agents' rules and everything else stay
 * private. A snapshot, not the history: the history carries internal messages and the authors' addresses.
 *
 * The snapshot replaces everything in the target but its `.git`, adds the GPL-3.0 text as `LICENSE` (Gyroflow's own
 * copy) and the public repository's front page and policies from `studio/desktop/public-repo/`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Paths of `studio/` that are not published: our agents' tool folders, and FreeCut's own repository files that would
 * act at (or mean nothing in) the public repository: its CI, its Vercel deploy and its CodeRabbit review settings.
 */
const UNPUBLISHED = [
  'studio/.github',
  'studio/.codex',
  'studio/.claude',
  'studio/.impeccable',
  'studio/.vite-hooks',
  'studio/vercel.json',
  'studio/.coderabbit.yaml',
]

/**
 * The public repository's own front page and policies (README, SECURITY, CONTRIBUTING, `.github/` with the issue
 * templates and the README's picture), kept in the private repository and placed at the snapshot's root. The README's
 * `{{version}}` becomes the release's version.
 */
const PUBLIC_ROOT = 'studio/desktop/public-repo'

/** Copies `from` into `to`, file by file, replacing `{{version}}` in Markdown files. */
function copyPublicRoot(from, to, version) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const destination = path.join(to, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true })
      copyPublicRoot(source, destination, version)
    } else if (entry.name.endsWith('.md')) {
      fs.writeFileSync(destination, fs.readFileSync(source, 'utf8').replaceAll('{{version}}', version))
    } else {
      fs.copyFileSync(source, destination)
    }
  }
}

/**
 * Writes the snapshot of `commit` into `target` (a git checkout), keeping only its `.git`.
 * @param {{ repoRoot: string, commit: string, target: string, version: string }} options
 */
export function exportEditorSource({ repoRoot, commit, target, version }) {
  for (const entry of fs.readdirSync(target)) {
    if (entry !== '.git') fs.rmSync(path.join(target, entry), { recursive: true, force: true })
  }
  const archive = execFileSync('git', ['archive', '--format=tar', commit, 'studio', 'gyroflow'], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 1024,
  })
  execFileSync('tar', ['-x', '-C', target], { input: archive, maxBuffer: 1024 * 1024 * 1024 })
  // FreeCut's own repository files and our agents' tool folders would act at the public repository's root or mean
  // nothing there (docs/publish-audit.md, section 3): its funding, issue templates and CI point at FreeCut's author
  for (const internal of UNPUBLISHED) fs.rmSync(path.join(target, internal), { recursive: true, force: true })
  fs.copyFileSync(path.join(target, 'gyroflow', 'LICENSE'), path.join(target, 'LICENSE'))
  const publicRoot = path.join(target, PUBLIC_ROOT)
  copyPublicRoot(publicRoot, target, version)
  fs.rmSync(publicRoot, { recursive: true, force: true })
}

// Run directly: node scripts/export-editor-source.mjs <target folder> [commit] — for looking at a snapshot locally
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [target, commit = 'HEAD'] = process.argv.slice(2)
  if (!target) throw new Error('usage: node scripts/export-editor-source.mjs <target folder> [commit]')
  fs.mkdirSync(target, { recursive: true })
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
  const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'studio/desktop/package.json'), 'utf8'))
  exportEditorSource({ repoRoot, commit, target: path.resolve(target), version })
  console.log(`snapshot of ${commit} written to ${target}`)
}
