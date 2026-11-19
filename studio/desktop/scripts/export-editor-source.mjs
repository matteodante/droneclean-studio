/**
 * The public source of DroneClean Studio: a snapshot of `studio/` and `gyroflow/` at one commit of `editor`, written
 * into a checkout of the public editor repository (scripts/release-mac.mjs publishes it with each release). Only those
 * two folders leave the private repository (decided 19 Nov 2026): the plan, the agents' rules and everything else stay
 * private. A snapshot, not the history: the history carries internal messages and the authors' addresses.
 *
 * The snapshot replaces everything in the target but its `.git`, adds the GPL-3.0 text as `LICENSE` (Gyroflow's own
 * copy) and a README saying what the repository is and how to build it.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Paths of the two folders that are not published */
const UNPUBLISHED = ['studio/.github', 'studio/.codex', 'studio/.claude', 'studio/.impeccable', 'studio/.vite-hooks']

/** What the public repository's README says; the facts are the ones the plan measured. */
function readme(version) {
  return `# DroneClean Studio

A free, local-first video editor for FPV and drone pilots: stabilization from the drone's own gyro data (Gyroflow's
engine, compiled to WebAssembly), DJI D-Log M to Rec.709, speed ramps with motion blur, 10-bit masters (ProRes HQ,
HEVC Main 10) with the Mac's hardware encoders, and an MCP server so an AI agent can edit with you. Removing the
drone's own shadow is its one paid effect, done through the DroneClean cloud service.

This is the source of release ${version}. Downloads are on the [releases page](../../releases).

## Layout

- \`studio/\`: the editor, a fork of [FreeCut](https://github.com/walterlow/freecut) (MIT), and its desktop shell
  (\`studio/desktop/\`, Electron).
- \`gyroflow/\`: a fork of [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0); \`gyroflow/wasm/\` builds its
  engine for the editor.

## Build (macOS, Apple silicon)

Node 24, Rust with the \`wasm32-unknown-unknown\` target, \`wasm-bindgen-cli\` 0.2.130 and \`wasm-opt\` (Binaryen).

\`\`\`sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # builds the editor, Gyroflow's wasm and FFmpeg, then the app in dist/mac-arm64
\`\`\`

## Licence

GPL-3.0-or-later (see \`LICENSE\`). It includes FreeCut (MIT), Gyroflow (GPL-3.0) and, in the app, FFmpeg
(LGPL-2.1, built from its official source by \`studio/desktop/scripts/build-ffmpeg.sh\`).
`
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
  fs.writeFileSync(path.join(target, 'README.md'), readme(version))
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
