#!/usr/bin/env node
/**
 * The Mac release of DroneClean Studio, built on this Mac (GitHub's checks stay off; PLAN.md, log of 19 Nov 2026).
 *
 *   node scripts/release-mac.mjs            builds and checks the release, publishes nothing
 *   node scripts/release-mac.mjs --publish  then publishes it: the matching source to the public editor repository
 *                                           (`RELEASE_REPO`, default matteodante/droneclean-studio) and a GitHub
 *                                           release there with the disk image, the zip and their checksums
 *
 * The build: the editor (`vp build`) and the shell, the app's own FFmpeg (scripts/build-ffmpeg.sh), and electron-builder
 * making `DroneClean-Studio-arm64.dmg` and `.zip` (no version in the name, so the site's link stays) with the whole bundle signed ad hoc (`-c.mac.identity=-`):
 * no Apple signature yet (a later task), so the app opens through System Settings › Privacy & Security › Open Anyway,
 * which the release notes say. The checks: the bundle's signature verifies (`codesign --verify --deep --strict`), the
 * app carries its FFmpeg, the disk image verifies (`hdiutil verify`); then SHA256SUMS.txt.
 *
 * Publishing refuses a working tree with uncommitted changes or a version whose tag already exists, so a release is
 * always one commit of `editor` and never replaces another. The source is a snapshot of `studio/` and `gyroflow/` at
 * that commit (scripts/export-editor-source.mjs), which is what GPL-3.0 asks of a binary that carries Gyroflow.
 * Without `--publish` nothing leaves this Mac.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportEditorSource } from './export-editor-source.mjs'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopDir, '../..')
const publish = process.argv.includes('--publish')
const releaseRepo = process.env.RELEASE_REPO ?? 'matteodante/droneclean-studio'
const { version } = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'))
const tag = `v${version}`
const distDir = path.join(desktopDir, 'dist')
const appPath = path.join(distDir, 'mac-arm64', 'DroneClean Studio.app')
const dmg = path.join(distDir, 'DroneClean-Studio-arm64.dmg')
const zip = path.join(distDir, 'DroneClean-Studio-arm64.zip')
const sums = path.join(distDir, 'SHA256SUMS.txt')
// The web editor of the same commit (base path /studio/, without source maps): the site's studio-web service on
// Railway downloads it from the release (studio/web/README.md), since the build is too big to upload directly
const webTarball = path.join(distDir, 'DroneClean-Studio-web.tar.gz')
const studioDir = path.resolve(desktopDir, '..')

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  return execFileSync(command, args, { stdio: 'inherit', ...options })
}

function output(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function megabytes(file) {
  return `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`
}

if (process.platform !== 'darwin' || os.arch() !== 'arm64') {
  throw new Error('release-mac: build the Mac release on an Apple silicon Mac')
}

const commit = output('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
if (publish) {
  const dirty = output('git', ['status', '--porcelain', '--', 'studio', 'gyroflow'], { cwd: repoRoot })
  if (dirty) throw new Error(`release-mac: studio/ or gyroflow/ has uncommitted changes; commit them first:\n${dirty}`)
  let tagExists = false
  try {
    output('gh', ['release', 'view', tag, '--repo', releaseRepo])
    tagExists = true
  } catch {
    // no release with that tag: the version is new
  }
  if (tagExists) throw new Error(`release-mac: ${releaseRepo} already has ${tag}; raise the version in desktop/package.json`)
}

// The build
for (const stale of [dmg, zip, sums, webTarball]) fs.rmSync(stale, { force: true })
run('npm', ['run', 'build'], { cwd: desktopDir })
run('sh', ['scripts/build-ffmpeg.sh'], { cwd: desktopDir })
run('npx', ['electron-builder', '--mac', 'dmg', 'zip', '--arm64', '--publish', 'never', '-c.mac.identity=-'], {
  cwd: desktopDir,
})

// The checks
run('codesign', ['--verify', '--deep', '--strict', '--verbose=1', appPath])
const signature = output('codesign', ['-dv', appPath], { stdio: ['ignore', 'pipe', 'pipe'] })
const ffmpeg = path.join(appPath, 'Contents', 'Resources', 'ffmpeg', 'ffmpeg')
if (!fs.existsSync(ffmpeg)) throw new Error('release-mac: the app does not carry its FFmpeg')
const encoders = output(ffmpeg, ['-hide_banner', '-encoders'])
for (const encoder of ['hevc_videotoolbox', 'prores_ks']) {
  if (!encoders.includes(encoder)) throw new Error(`release-mac: the app's FFmpeg has no ${encoder}`)
}
for (const file of [dmg, zip]) {
  if (!fs.existsSync(file)) throw new Error(`release-mac: ${path.basename(file)} was not built`)
}
run('hdiutil', ['verify', dmg])

// The web editor
run('npm', ['run', 'build:web'], { cwd: studioDir })
run('tar', ['-czf', webTarball, '--exclude', '*.map', '-C', path.join(studioDir, 'dist-web'), '.'])
const webIndex = output('tar', ['-xzOf', webTarball, './index.html'])
if (!webIndex.includes('/studio/assets/')) throw new Error('release-mac: the web build is not under /studio/')

fs.writeFileSync(
  sums,
  [dmg, zip, webTarball].map((file) => `${sha256(file)}  ${path.basename(file)}`).join('\n') + '\n',
)

const notes = path.join(distDir, 'RELEASE_NOTES.md')
// What changed in this version, when `release-notes/<version>.md` says it (shown first on the release page)
const whatsNewFile = path.join(desktopDir, 'release-notes', `${version}.md`)
const whatsNew = fs.existsSync(whatsNewFile) ? `${fs.readFileSync(whatsNewFile, 'utf8').trim()}\n\n` : ''
fs.writeFileSync(
  notes,
  `${whatsNew}DroneClean Studio ${version} for Mac (Apple silicon), built from ${commit.slice(0, 12)}.

**Install:** open the disk image and drag DroneClean Studio to Applications.

**First launch:** this build is not signed by Apple yet, so macOS stops it the first time. Open it once, then go to
System Settings › Privacy & Security, find "DroneClean Studio was blocked" and press **Open Anyway**. Later launches
open normally.

**Checksums:** SHA256SUMS.txt. The source of this exact build is the commit tagged ${tag} in this repository
(GPL-3.0-or-later; it includes Gyroflow, GPL-3.0, and FFmpeg, LGPL-2.1).
`,
)

console.log(
  `\nbuilt ${path.basename(dmg)} (${megabytes(dmg)}), ${path.basename(zip)} (${megabytes(zip)}) and ${path.basename(webTarball)} (${megabytes(webTarball)})`,
)
console.log(signature.split('\n').filter((line) => /Signature|Identifier/.test(line)).join('\n'))

if (!publish) {
  console.log('\nnot published (run with --publish to publish)')
  process.exit(0)
}

// Publishing: the source snapshot, tagged, then the release with its files
const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-studio-source-'))
run('gh', ['repo', 'clone', releaseRepo, sourceDir])
exportEditorSource({ repoRoot, commit, target: sourceDir, version })
run('git', ['add', '-A'], { cwd: sourceDir })
// The public commits name the project, not a person's address (docs/publish-audit.md, section 3)
const author = ['-c', 'user.name=DroneClean Studio', '-c', 'user.email=studio@droneclean.app']
run('git', [...author, 'commit', '--allow-empty', '-m', `DroneClean Studio ${version}`], { cwd: sourceDir })
run('git', [...author, 'tag', '-a', tag, '-m', `DroneClean Studio ${version}`], { cwd: sourceDir })
run('git', ['push', 'origin', 'HEAD', tag], { cwd: sourceDir })
run('gh', [
  'release',
  'create',
  tag,
  dmg,
  zip,
  webTarball,
  sums,
  '--repo',
  releaseRepo,
  '--title',
  `DroneClean Studio ${version}`,
  '--notes-file',
  notes,
  '--verify-tag',
])
console.log(`\npublished https://github.com/${releaseRepo}/releases/tag/${tag}`)
console.log(`download link for the site: https://github.com/${releaseRepo}/releases/latest/download/${path.basename(dmg)}`)
