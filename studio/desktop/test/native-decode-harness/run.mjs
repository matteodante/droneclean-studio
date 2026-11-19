#!/usr/bin/env node
/**
 * Runs P4's two measurements (task 3.1): the decoder's rate on clip 0020 and the
 * grey ramp's levels through P3's source pass.
 *
 *   DRONECLEAN_CLIP=/path/to/clip.mp4 node desktop/test/native-decode-harness/run.mjs [clip|ramp|both|transport|protocol|upload]
 *
 * It builds the harness page with the repository's own bundler, then launches
 * Electron with `main.mjs` once per measurement (`transport` and `protocol` are the
 * two diagnostics that attribute the rate; a few seconds or a minute each). The clip is read from
 * `DRONECLEAN_CLIP` (required, except for `ramp` and `upload`; the measurements were made on clip 0020), the ramp is made by the benchmark kit's
 * own `ensureRamp` into the cache folder. Nothing is written inside the
 * repository; the ramp and the built page live in `desktop/test/.cache/`.
 *
 * Prints each `REPORT {json}` line as it arrives. Not part of `npm test`: it needs
 * FFmpeg, a GPU and the maintainer's footage.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const desktopRoot = path.resolve(here, '..', '..')
const studioRoot = path.resolve(desktopRoot, '..')
const cache = path.join(desktopRoot, 'test', '.cache', 'native-decode')
const electron = path.join(desktopRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')

// No default: the footage is the maintainer's own. `clip`, `transport`, `protocol` and `both` need DRONECLEAN_CLIP.
const CLIP = process.env.DRONECLEAN_CLIP ?? ''

const requested = process.argv[2] ?? 'both'
if (!['clip', 'ramp', 'both', 'transport', 'protocol', 'upload'].includes(requested)) {
  throw new Error(`usage: node run.mjs [clip|ramp|both|transport|protocol|upload]; got ${requested}`)
}

/** The page, built by the repository's bundler into `test/.cache/native-decode/page`. */
function buildPage() {
  fs.mkdirSync(cache, { recursive: true })
  const result = spawnSync(
    process.execPath,
    [
      path.join(studioRoot, 'node_modules', 'vite-plus', 'bin', 'vp'),
      'build',
      '-c',
      path.join(here, 'vite.config.mjs'),
      '--logLevel',
      'error',
    ],
    { cwd: studioRoot, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`building the harness page failed:\n${result.stdout}\n${result.stderr}`)
  }
}

/** The benchmark kit's 877-level ramp, made and verified by its own code. */
async function ensureRamp() {
  const inputs = await import(path.join(studioRoot, 'bench', 'lib', 'inputs.mjs'))
  const ramp = await inputs.ensureRamp({ cache })
  return ramp.file
}

/** One harness run; resolves with its report. */
function runHarness(args) {
  const result = spawnSync(electron, [path.join(here, 'main.mjs'), ...args], {
    cwd: desktopRoot,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  })
  const line = result.stdout
    .split('\n')
    .concat(result.stderr.split('\n'))
    .find((candidate) => candidate.startsWith('REPORT '))
  if (line === undefined) {
    throw new Error(
      `the harness printed no report:\n${result.stdout.slice(-4000)}\n${result.stderr.slice(-4000)}`,
    )
  }
  const report = JSON.parse(line.slice('REPORT '.length))
  console.log(JSON.stringify(report, null, 2))
  if (report.error !== undefined) throw new Error(report.error)
  return report
}

if (!CLIP && requested !== 'ramp' && requested !== 'upload') {
  throw new Error(`DRONECLEAN_CLIP is not set: point it at a long HEVC clip (usage: DRONECLEAN_CLIP=/path/to/clip.mp4 node run.mjs ${requested})`)
}

buildPage()

if (requested === 'clip' || requested === 'both') {
  console.log('\n== the decoder, end to end, clip 0020 3840x2880 10 s from 60 s')
  const frames = process.env.DRONECLEAN_FRAMES ?? '600'
  runHarness(['--mode=clip', `--file=${CLIP}`, '--start=60', `--frames=${frames}`])
}

if (requested === 'transport') {
  console.log('\n== the clip path with the upload dropped: the decode and the stream')
  const frames = process.env.DRONECLEAN_FRAMES ?? '600'
  runHarness(['--mode=transport', `--file=${CLIP}`, '--start=60', `--frames=${frames}`])
}

if (requested === 'protocol') {
  console.log('\n== one frame’s URL read again with the decoder idle: the stream and the assembly')
  runHarness(['--mode=protocol', `--file=${CLIP}`, '--start=60', '--repeats=200'])
}

if (requested === 'upload') {
  // 60 uploads each: 600 would queue gigabytes of `writeTexture` staging and the
  // memory guard would stop the run for the tool's sake, not the decoder's.
  console.log('\n== one frame’s bytes into the three planes, `writeTexture` and a buffer blit')
  runHarness(['--mode=upload', '--upload=write', '--repeats=60'])
  runHarness(['--mode=upload', '--upload=buffer', '--repeats=60'])
}

if (requested === 'ramp' || requested === 'both') {
  console.log('\n== the benchmark kit’s grey ramp through the source pass')
  const ramp = await ensureRamp()
  console.log(`ramp: ${ramp}`)
  runHarness(['--mode=ramp', `--file=${ramp}`, '--row=1024', '--frames=10'])
}
