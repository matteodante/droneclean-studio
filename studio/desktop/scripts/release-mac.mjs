#!/usr/bin/env node
/**
 * The Mac release of DroneClean Studio, built on this Mac (GitHub's checks stay off; PLAN.md, log of 19 Nov 2026).
 *
 *   node scripts/release-mac.mjs            builds and checks the release, publishes nothing
 *   node scripts/release-mac.mjs --publish  then uploads it: a DRAFT GitHub release on the public editor repository
 *                                           (`RELEASE_REPO`, default matteodante/droneclean-studio) with the disk
 *                                           image, the zip, the web build and the checksums, and then the matching
 *                                           source (tagged). The release stays a draft, so nobody is told about it
 *   node scripts/release-mac.mjs --go-live  makes the draft the latest release, only when the Mac and Windows files
 *                                           and a SHA256SUMS.txt that lists all four are there; builds nothing
 *
 * A re-run of --publish after a failed upload resumes: the same draft (built from the same commit) gets its files
 * again (`--clobber`) and the source is pushed only if the tag is not there yet.
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

/**
 * The editor's source maps to Sentry (the opt-in crash reports, 20 Nov 2026): `sourcemaps inject` writes a debug id
 * into each built script and its map, so the shipped scripts (which carry no maps) still resolve to readable stacks,
 * and `upload` sends the maps under the release the app reports (`droneclean-studio@<version>`). It needs an
 * organization auth token in `SENTRY_AUTH_TOKEN` (made in Sentry by Matteo, never stored in the repository);
 * without one the release is built the same and its crash reports show minified stacks.
 */
function uploadSourceMaps(dir) {
  if (!process.env.SENTRY_AUTH_TOKEN) {
    console.warn(`release-mac: SENTRY_AUTH_TOKEN is not set, so the source maps of ${path.basename(dir)} are not sent to Sentry`)
    return
  }
  const cli = ['--yes', '@sentry/cli@3.8.2']
  run('npx', [...cli, 'sourcemaps', 'inject', dir])
  run('npx', [
    ...cli,
    'sourcemaps',
    'upload',
    '--org',
    'matteo-dante',
    '--project',
    'droneclean',
    '--release',
    `droneclean-studio@${version}`,
    dir,
  ])
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

/** What `gh` printed on stderr (or its message) for a failed call. */
function failureText(error) {
  return `${error?.stderr ?? ''}${error?.message ?? ''}`
}

/**
 * The release of `tag` on the public repository: `null` only when GitHub says there is none; any other failure
 * (no network, not signed in, a rate limit) stops the release instead of reading as "new".
 */
function releaseOf(releaseTag) {
  try {
    const json = output('gh', ['release', 'view', releaseTag, '--repo', releaseRepo, '--json', 'isDraft,body,assets'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(json)
  } catch (error) {
    if (/release not found/i.test(failureText(error))) return null
    throw new Error(`release-mac: could not ask ${releaseRepo} about ${releaseTag}: ${failureText(error).trim()}`)
  }
}

/** Whether the public repository has the tag; a failed `ls-remote` is an error, not "no". */
function tagOnRemote(releaseTag) {
  try {
    const listed = output('git', ['ls-remote', '--tags', `https://github.com/${releaseRepo}.git`, `refs/tags/${releaseTag}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return listed !== ''
  } catch (error) {
    throw new Error(`release-mac: could not list the tags of ${releaseRepo}: ${failureText(error).trim()}`)
  }
}

if (process.argv.includes('--go-live')) {
  // Makes the draft the latest release: the update notice of the installed apps reads `releases/latest`, so this is
  // the moment users are told, and it waits until every file a user might download is there.
  const release = releaseOf(tag)
  if (release === null) throw new Error(`release-mac: ${releaseRepo} has no release ${tag}; run --publish first`)
  if (!release.isDraft) throw new Error(`release-mac: ${tag} is already published`)
  if (!tagOnRemote(tag)) throw new Error(`release-mac: the source of ${tag} is not pushed (no tag in ${releaseRepo}); run --publish again`)
  const required = ['DroneClean-Studio-arm64.dmg', 'DroneClean-Studio-arm64.zip', 'DroneClean-Studio-web.tar.gz', 'DroneClean-Studio-x64.exe']
  const names = release.assets.map((asset) => asset.name)
  const missing = [...required, 'SHA256SUMS.txt'].filter((name) => !names.includes(name))
  if (missing.length > 0) throw new Error(`release-mac: ${tag} is missing ${missing.join(', ')}; upload them first (studio-release skill, step 6)`)
  const listedSums = output('gh', ['release', 'download', tag, '--repo', releaseRepo, '--pattern', 'SHA256SUMS.txt', '--output', '-'])
  const unlisted = required.filter((name) => !listedSums.split('\n').some((line) => line.trim().endsWith(` ${name}`)))
  if (unlisted.length > 0) throw new Error(`release-mac: SHA256SUMS.txt does not list ${unlisted.join(', ')}; regenerate it with all four files`)
  run('gh', ['release', 'edit', tag, '--repo', releaseRepo, '--draft=false', '--latest'])
  console.log(`\npublished https://github.com/${releaseRepo}/releases/tag/${tag}`)
  console.log(`download link for the site: https://github.com/${releaseRepo}/releases/latest/download/DroneClean-Studio-arm64.dmg`)
  process.exit(0)
}

const commit = output('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
// What an earlier run of this version left behind: nothing (a new release), or a draft built from this very commit
// (resumed), or something else (refused, because it could mix two builds).
let resume = false
let sourcePushed = false
if (publish) {
  const dirty = output('git', ['status', '--porcelain', '--', 'studio', 'gyroflow'], { cwd: repoRoot })
  if (dirty) throw new Error(`release-mac: studio/ or gyroflow/ has uncommitted changes; commit them first:\n${dirty}`)
  const existing = releaseOf(tag)
  sourcePushed = tagOnRemote(tag)
  if (existing !== null && !existing.isDraft) {
    throw new Error(`release-mac: ${releaseRepo} already published ${tag}; raise the version in desktop/package.json`)
  }
  if (existing !== null) {
    if (!existing.body.includes(`built from ${commit.slice(0, 12)}`)) {
      throw new Error(`release-mac: the draft ${tag} on ${releaseRepo} was built from another commit; delete the draft (and its tag) or raise the version`)
    }
    resume = true
    console.log(`release-mac: resuming the draft ${tag} (same commit ${commit.slice(0, 12)})`)
  } else if (sourcePushed) {
    throw new Error(`release-mac: ${releaseRepo} has the tag ${tag} but no release; delete the tag, or raise the version in desktop/package.json`)
  }
}

// The build
for (const stale of [dmg, zip, sums, webTarball]) fs.rmSync(stale, { force: true })
run('npm', ['run', 'build'], { cwd: desktopDir })
uploadSourceMaps(path.join(studioDir, 'dist'))
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
uploadSourceMaps(path.join(studioDir, 'dist-web'))
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

// Publishing. Order matters: the files first, as a DRAFT (invisible to users and to `releases/latest`), then the
// source snapshot with the tag; a failure at any point leaves a draft this script resumes, never a half-public
// version. `--go-live` is the step that publishes, once the Windows installer is there too.
const assets = [dmg, zip, webTarball, sums]
if (resume) {
  run('gh', ['release', 'upload', tag, ...assets, '--repo', releaseRepo, '--clobber'])
  run('gh', ['release', 'edit', tag, '--repo', releaseRepo, '--title', `DroneClean Studio ${version}`, '--notes-file', notes])
} else {
  run('gh', ['release', 'create', tag, ...assets, '--repo', releaseRepo, '--draft', '--title', `DroneClean Studio ${version}`, '--notes-file', notes])
}

if (sourcePushed) {
  console.log(`release-mac: ${tag} is already in ${releaseRepo}; the source is not pushed again`)
} else {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-studio-source-'))
  run('gh', ['repo', 'clone', releaseRepo, sourceDir])
  exportEditorSource({ repoRoot, commit, target: sourceDir, version })
  run('git', ['add', '-A'], { cwd: sourceDir })
  // The public commits name the project, not a person's address (docs/publish-audit.md, section 3)
  const author = ['-c', 'user.name=DroneClean Studio', '-c', 'user.email=studio@droneclean.app']
  run('git', [...author, 'commit', '--allow-empty', '-m', `DroneClean Studio ${version}`], { cwd: sourceDir })
  run('git', [...author, 'tag', '-a', tag, '-m', `DroneClean Studio ${version}`], { cwd: sourceDir })
  run('git', ['push', 'origin', 'HEAD', tag], { cwd: sourceDir })
}
console.log(`\ndraft ${tag} is ready at https://github.com/${releaseRepo}/releases (not public yet)`)
console.log('next: upload the Windows installer and a SHA256SUMS.txt of all four files (studio-release skill, step 6),')
console.log('then: node scripts/release-mac.mjs --go-live')
