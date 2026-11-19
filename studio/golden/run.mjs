// Golden frames: render the fixed cases on the real GPU and compare them with the stored frames.
//
//   node golden/run.mjs                      compare every case; exit 1 on any difference
//   node golden/run.mjs --update             rewrite the stored frames (on purpose, see README)
//   node golden/run.mjs --case a,b           only the cases whose id equals or starts with a name
//   node golden/run.mjs --list               list the cases
//   node golden/run.mjs --expected <dir>     use another folder of stored frames (a local baseline for a machine with a different GPU)
//   node golden/run.mjs --new-machine        with --update: allow the stored frames to move to this machine's GPU
//   node golden/run.mjs --fresh-build       build the app again even if a build of byte-identical sources is cached (checks/build-cache.mjs)
//   node golden/run.mjs --repeat 3           render everything 3 times in this browser and report the spread (diagnostics)
//
// Exit codes: 0 all frames match, 1 a frame differs or is missing, 2 the run could not be made
// (software GPU, build failure, no Chrome).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describeFailure, runToLog, tailOf } from '../headless/lib/build-log.mjs'
import { CASES } from './cases.mjs'
import { blurBoxesFile } from './lib/blur.mjs'
import { describeStats, diffImage, diffStats, isIdentical, triptychPng } from './lib/compare.mjs'
import {
  countLevels,
  describeStats16,
  diffStats16,
  isIdentical16,
  RAW_SUFFIX,
  rampFile,
  shadowPieceFile,
  shadowSourceFile,
  toEightBit,
} from './lib/float.mjs'
import { imagePng, IMAGE_NAMES } from './lib/images.mjs'
import { decodePng, encodePng } from './lib/png.mjs'
import { decodePng16, encodePng16 } from './lib/png16.mjs'
import { mediaUsedBy, imageMediaId, videoMediaId } from './lib/project.mjs'
import { machineKey, openRenderer } from './lib/render.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const GOLDEN = import.meta.dirname
const OUT = path.join(GOLDEN, 'out')
const DIST = path.join(OUT, 'dist')
const FAILURES = path.join(OUT, 'failures')
const DETAILED_FAILURES = 6
const VIDEO_FILES = {
  'h264-high': 'h264-high.mp4',
  'hevc-main10': 'hevc-main10.mp4',
  'shadow-source': 'shadow-source.mp4',
  'shadow-piece': 'shadow-piece.mp4',
}

// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const args = {
    update: false,
    freshBuild: false,
    list: false,
    repeat: 1,
    cases: null,
    expected: path.join(GOLDEN, 'expected'),
  }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--update') args.update = true
    else if (token === '--list') args.list = true
    else if (token === '--expected') args.expected = path.resolve(argv[++i] ?? '')
    else if (token === '--new-machine') args.newMachine = true
    else if (token === '--fresh-build') args.freshBuild = true
    else if (token === '--repeat') args.repeat = Number(argv[++i])
    else if (token === '--case') args.cases = (argv[++i] ?? '').split(',').filter(Boolean)
    else throw new Error(`Unknown argument: ${token}`)
  }
  if (!Number.isInteger(args.repeat) || args.repeat < 1)
    throw new Error('--repeat needs a whole number of 1 or more')
  return args
}

function selectCases(names) {
  if (!names) return CASES
  const chosen = CASES.filter((c) => names.some((name) => c.id === name || c.id.startsWith(name)))
  const unknown = names.filter((name) => !CASES.some((c) => c.id === name || c.id.startsWith(name)))
  if (unknown.length) throw new Error(`No case matches: ${unknown.join(', ')} (use --list)`)
  return chosen
}

/**
 * Build the app under test into golden/out/dist, so the run never uses a stale or foreign build.
 * A build of byte-identical sources (every non-ignored file of studio/, the installed dependencies, Node) is
 * reused from checks/build-cache.mjs, which prints its key; --fresh-build forces a new one.
 */
function buildApp(fresh) {
  const started = Date.now()
  // The build prints a line per emitted asset and the bundle carries about 10,000 font files:
  // over spawnSync's 1 MiB maxBuffer, which used to kill the child (ENOBUFS) and read as
  // "the app did not build". The log goes to a file instead of into this process.
  const logPath = path.join(OUT, 'build.log')
  const result = runToLog(
    process.execPath,
    ['checks/build-cache.mjs', 'studio-dist', '--out', path.relative(ROOT, DIST), ...(fresh ? ['--fresh'] : [])],
    { cwd: ROOT, logPath },
  )
  if (result.status !== 0) {
    process.stderr.write(`${tailOf(logPath)}\n`)
    throw new SetupError(
      `The app did not build (${describeFailure(result)}); the build log is ${path.relative(ROOT, logPath)}`,
    )
  }
  const cacheLine = fs.readFileSync(logPath, 'utf8').split('\n').filter((line) => line.startsWith('[cache]')).join('\n')
  console.log(
    `${cacheLine}\nBuilt the app into golden/out/dist (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  )
}

class SetupError extends Error {}

const cleanup = []

/** Write the generated images and point the committed videos at their media ids. */
function prepareMedia() {
  // A folder of its own per run, so two runs on one machine (say, a benchmark going on) never collide.
  const inputs = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-inputs-'))
  cleanup.push(() => fs.rmSync(inputs, { recursive: true, force: true }))
  const mediaFiles = new Map()
  const images = new Map()
  for (const name of IMAGE_NAMES) {
    const file = path.join(inputs, `${name}.png`)
    const png = imagePng(name)
    fs.writeFileSync(file, png)
    mediaFiles.set(imageMediaId(name), file)
    images.set(name, decodePng(png))
  }
  for (const [name, file] of Object.entries(VIDEO_FILES)) {
    mediaFiles.set(videoMediaId(name), path.join(GOLDEN, 'media', file))
  }
  // The float cases' raw 10-bit files: made in code (lib/float.mjs), never committed
  // (each is also a real, tiny video the renderer can open: the committed hevc clip stands in for it)
  for (const [name, bytes] of Object.entries({
    'raw-ramp': rampFile(),
    'raw-shadow-source': shadowSourceFile(),
    'raw-shadow-piece': shadowPieceFile(),
    'raw-blur-boxes': blurBoxesFile(),
  })) {
    const file = path.join(inputs, `${name}.gbrp10le`)
    fs.writeFileSync(file, bytes)
    mediaFiles.set(`${videoMediaId(name)}${RAW_SUFFIX}`, file)
    mediaFiles.set(videoMediaId(name), path.join(GOLDEN, 'media', VIDEO_FILES['hevc-main10']))
  }
  return { mediaFiles, images }
}

const expectedPath = (dir, caseId, frame) => path.join(dir, caseId, `frame-${frame}.png`)

const machineFile = (dir) => path.join(dir, 'machine.json')

/** A float case's frames are stored as 16-bit PNGs, every other case's as 8-bit ones */
const encodeFor = (image) => (image.float ? encodePng16(image) : encodePng(image))
const decodeFor = (c, bytes) => (c.float ? decodePng16(bytes) : decodePng(bytes))
const statsFor = (c, a, b) => (c.float ? diffStats16(a, b) : diffStats(a, b))
const sameFor = (c, stats) => (c.float ? isIdentical16(stats) : isIdentical(stats))

function readStoredMachine(dir) {
  return fs.existsSync(machineFile(dir))
    ? JSON.parse(fs.readFileSync(machineFile(dir), 'utf8'))
    : null
}

function writeFailure(caseId, frame, rendered, stored, tag) {
  const dir = path.join(FAILURES, caseId)
  fs.mkdirSync(dir, { recursive: true })
  const name = `frame-${frame}`
  if (rendered.float) {
    // A float frame: the 16-bit pictures themselves, and the 8-bit view of both side by side
    fs.writeFileSync(path.join(dir, `${name}.rendered.png`), encodePng16(rendered))
    if (stored) {
      fs.writeFileSync(path.join(dir, `${name}.${tag}.png`), encodePng16(stored))
      fs.writeFileSync(
        path.join(dir, `${name}.side-by-side.png`),
        triptychPng(toEightBit(stored), toEightBit(rendered)),
      )
    }
    return path.relative(ROOT, dir)
  }
  fs.writeFileSync(path.join(dir, `${name}.rendered.png`), encodePng(rendered))
  if (stored) {
    fs.writeFileSync(path.join(dir, `${name}.${tag}.png`), encodePng(stored))
    fs.writeFileSync(
      path.join(dir, `${name}.difference.png`),
      encodePng(diffImage(stored, rendered)),
    )
    fs.writeFileSync(path.join(dir, `${name}.side-by-side.png`), triptychPng(stored, rendered))
  }
  return path.relative(ROOT, dir)
}

/** Render every selected case once; returns Map<"case/frame", RGBA image>. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
async function renderAll(renderer, selected, { logEach }) {
  const rendered = new Map()
  for (const c of selected) {
    // A case that drives the stage directly has no project: its one frame is the stage's output, already RGBA8
    if (c.warp) {
      rendered.set(`${c.id}/${c.frames[0]}`, await renderer.stageWarp({ float: c.float === true }))
      if (logEach) logEach(c)
      continue
    }
    const { images, videos } = mediaUsedBy(c.project)
    const mediaIds = [...images.map(imageMediaId), ...videos.map(videoMediaId)]
    for (const frame of c.frames) {
      if (c.float) {
        const { image, outOfRange, summary } = await renderer.renderFloat(c.project, frame, mediaIds, c.raw)
        if (summary.warnings?.length) {
          throw new Error(
            `${c.id} frame ${frame}: the render reported warnings, so it is not a valid golden frame: ${JSON.stringify(summary.warnings)}`,
          )
        }
        if (outOfRange > 0) {
          throw new Error(
            `${c.id} frame ${frame}: ${outOfRange} accumulator values are outside 0..1; the stored 16-bit frame would clamp them`,
          )
        }
        rendered.set(`${c.id}/${frame}`, image)
        continue
      }
      const { png, summary } = await renderer.renderFrame(c.project, frame, mediaIds)
      if (summary.warnings?.length) {
        throw new Error(
          `${c.id} frame ${frame}: the render reported warnings, so it is not a valid golden frame: ${JSON.stringify(summary.warnings)}`,
        )
      }
      rendered.set(`${c.id}/${frame}`, decodePng(png))
    }
    if (logEach) logEach(c)
  }
  return rendered
}

// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.list) {
    for (const c of CASES)
      console.log(`${c.id.padEnd(30)} frames ${c.frames.join(',').padEnd(6)} ${c.group}`)
    console.log(`${CASES.length} cases, ${CASES.reduce((n, c) => n + c.frames.length, 0)} frames`)
    return 0
  }
  const selected = selectCases(args.cases)
  buildApp(args.freshBuild) // never a stale build: reused only for byte-identical sources (the key), otherwise built

  const { mediaFiles, images } = prepareMedia()
  let renderer
  try {
    renderer = await openRenderer({ distDir: DIST, mediaFiles })
  } catch (error) {
    throw new SetupError(error.message)
  }
  try {
    const machine = renderer.machine
    console.log(
      `GPU: ${machine.gpu.vendor} ${machine.gpu.architecture} ${machine.gpu.description}`.trimEnd(),
    )
    console.log(`Chrome ${machine.chrome}, ${machine.os}, ${machine.cpu}`)

    const started = Date.now()
    const runs = []
    for (let i = 0; i < args.repeat; i++) {
      runs.push(await renderAll(renderer, selected, {}))
    }
    const rendered = runs[0]
    if (renderer.blockedOrigins.size) {
      console.warn(
        `Note: the app tried to reach ${[...renderer.blockedOrigins].join(', ')}; blocked (the golden run is offline).`,
      )
    }
    console.log(
      `Rendered ${rendered.size} frames${args.repeat > 1 ? ` x ${args.repeat}` : ''} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    )

    if (args.repeat > 1) return reportSpread(runs)
    return args.update
      ? update(selected, rendered, machine, args)
      : compare(selected, rendered, machine, images, args)
  } finally {
    await renderer.close()
    for (const fn of cleanup) fn()
  }
}

/** Diagnostics: how much do repeated renders of the same frame differ from each other? */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function reportSpread(runs) {
  let worst = 0
  let differing = 0
  for (const key of runs[0].keys()) {
    for (let i = 1; i < runs.length; i++) {
      const first = runs[0].get(key)
      const float = first.float === true
      const stats = float ? diffStats16(first, runs[i].get(key)) : diffStats(first, runs[i].get(key))
      if (!(float ? isIdentical16(stats) : isIdentical(stats))) {
        differing++
        worst = Math.max(worst, ...(float ? [stats.max / 257] : stats.max.slice(0, 3)))
        console.log(
          `${key}: run ${i + 1} differs from run 1\n${float ? describeStats16(stats) : describeStats(stats)}`,
        )
      }
    }
  }
  console.log(
    `${runs.length} runs: ${differing} frame comparisons differed; largest single-channel difference ${worst} level(s).`,
  )
  return differing === 0 ? 0 : 1
}

// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function update(selected, rendered, machine, args) {
  const stored = readStoredMachine(args.expected)
  const full = !args.cases
  if (stored && machineKey(stored) !== machineKey(machine)) {
    if (!full) {
      throw new SetupError(
        `Refusing a partial update: the stored frames come from another machine (${machineKey(stored)}) and this one is ${machineKey(machine)}. A stored set must come from one machine: update everything, or none.`,
      )
    }
    if (!args.newMachine) {
      throw new SetupError(
        `The stored frames in ${path.relative(ROOT, args.expected)} come from ${machineKey(stored)}; this machine is ${machineKey(machine)}. ` +
          'Overwriting them would move the committed baseline to this GPU. If that is really intended pass --new-machine; to keep a private baseline instead, use --expected golden/out/local.',
      )
    }
  }
  if (full) {
    const known = new Set(CASES.map((c) => c.id))
    if (fs.existsSync(args.expected)) {
      for (const entry of fs.readdirSync(args.expected, { withFileTypes: true })) {
        if (entry.isDirectory() && !known.has(entry.name)) {
          fs.rmSync(path.join(args.expected, entry.name), { recursive: true })
          console.log(`Removed stored frames of a case that no longer exists: ${entry.name}`)
        }
      }
    }
  }
  const changedKeys = []
  let changed = 0
  let created = 0
  for (const c of selected) {
    for (const frame of c.frames) {
      const file = expectedPath(args.expected, c.id, frame)
      const image = rendered.get(`${c.id}/${frame}`)
      const previous = fs.existsSync(file) ? decodeFor(c, fs.readFileSync(file)) : null
      if (!previous) created++
      else if (!sameFor(c, statsFor(c, previous, image))) {
        changed++
        changedKeys.push(`${c.id}/${frame}`)
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, encodeFor(image))
    }
  }
  if (full) {
    fs.writeFileSync(
      machineFile(args.expected),
      `${JSON.stringify({ ...machine, frames: [...rendered.keys()].length, note: 'Machine that produced the stored frames. See golden/README.md.' }, null, 2)}\n`,
    )
  }
  if (changedKeys.length) console.log(`Changed: ${changedKeys.join(', ')}`)
  console.log(
    `Stored ${rendered.size} frames: ${created} new, ${changed} changed, ${rendered.size - created - changed} unchanged.`,
  )
  return 0
}

// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function compare(selected, rendered, machine, images, args) {
  const stored = readStoredMachine(args.expected)
  const foreign = stored && machineKey(stored) !== machineKey(machine)
  if (!stored) console.warn('No machine record next to the stored frames; run --update first.')
  if (foreign) {
    console.warn(
      `Different machine: stored frames come from ${machineKey(stored)}; this is ${machineKey(machine)}.\n` +
        '  An exact match is not expected from another GPU. To check a change on this machine, store a local baseline from the code before the change\n' +
        '  (node golden/run.mjs --update --expected golden/out/local) and compare against it (--expected golden/out/local). See golden/README.md.',
    )
  }
  fs.rmSync(FAILURES, { recursive: true, force: true })
  const failed = []
  let checked = 0
  for (const c of selected) {
    for (const frame of c.frames) {
      checked++
      const key = `${c.id}/${frame}`
      const actual = rendered.get(key)
      const problems = []

      if (c.sameAsSource) {
        const source = images.get(c.sameAsSource)
        const stats = diffStats(source, actual)
        if (!isIdentical(stats)) {
          problems.push({
            text: `is not identical to its source image "${c.sameAsSource}" (an untouched image must come out unchanged)`,
            stats,
            pictures: writeFailure(c.id, frame, actual, source, 'source'),
          })
        }
      }

      const file = expectedPath(args.expected, c.id, frame)
      if (!fs.existsSync(file)) {
        problems.push({
          text: `has no stored frame (${path.relative(ROOT, file)}); add the case with --update --case ${c.id}`,
        })
      } else {
        const storedImage = decodeFor(c, fs.readFileSync(file))
        const stats = statsFor(c, storedImage, actual)
        if (!sameFor(c, stats))
          problems.push({
            text: 'differs from the stored frame',
            stats,
            float: c.float,
            pictures: writeFailure(c.id, frame, actual, storedImage, 'stored'),
          })
      }

      if (c.float && c.minLevels) {
        // What the float path exists for: the ramp's levels survive it
        const levels = countLevels(actual)
        console.log(`        ${key}: ${levels.values} different values in a row, on ${levels.codes} 10-bit codes`)
        if (levels.values < c.minLevels) {
          problems.push({
            text: `keeps only ${levels.values} different values of the ramp's 877 in a row (at least ${c.minLevels} are required): an 8-bit step is in the float path`,
          })
        }
      }

      // A case's own checks on the picture (the blur cases' boxes), and a case that must equal another one exactly
      for (const text of c.check?.(actual, frame) ?? []) problems.push({ text })
      const other = c.sameAsCase ? rendered.get(`${c.sameAsCase}/${frame}`) : undefined
      if (other) {
        const stats = diffStats16(other, actual)
        if (!isIdentical16(stats)) {
          problems.push({ text: `is not identical to the case "${c.sameAsCase}"`, stats, float: true })
        }
      }

      if (problems.length === 0) {
        console.log(`  ok    ${key}`)
        continue
      }
      failed.push(key)
      if (failed.length > DETAILED_FAILURES) {
        const s = problems.find((p) => p.stats && !p.float)?.stats
        console.log(
          `  FAIL  ${key}  ${
            s && !s.sizeMismatch
              ? `mean ${s.mean
                  .slice(0, 3)
                  .map((v) => v.toFixed(2))
                  .join(
                    '/',
                  )}  max ${s.max.slice(0, 3).join('/')}  ${(s.differingShare * 100).toFixed(1)} % of pixels`
              : problems[0].text
          }`,
        )
        continue
      }
      console.log(`  FAIL  ${key}  [${c.group}]`)
      console.log(`        protects: ${c.protects}`)
      if (
        problems.length === 2 &&
        problems[0].stats &&
        problems[1].stats &&
        describeStats(problems[0].stats) === describeStats(problems[1].stats)
      ) {
        // Same numbers against the source image and against the stored frame: say it once.
        problems.splice(0, 2, {
          text: `is not identical to its source image "${c.sameAsSource}" (an untouched image must come out unchanged), and differs from the stored frame the same way`,
          stats: problems[0].stats,
          pictures: problems[1].pictures,
        })
      }
      for (const p of problems) {
        console.log(`        ${p.text}`)
        if (p.stats)
          console.log(
            (p.float ? describeStats16(p.stats) : describeStats(p.stats)).replace(/^/gm, '          '),
          )
        if (p.pictures) console.log(`          pictures: ${p.pictures}`)
      }
    }
  }
  if (failed.length > DETAILED_FAILURES)
    console.log(
      `\n  (details above for the first ${DETAILED_FAILURES} failures only; all pictures are in golden/out/failures/)`,
    )
  console.log(
    failed.length === 0
      ? `\nAll ${checked} golden frames match.`
      : `\n${failed.length} of ${checked} golden frames FAILED: ${failed.join(', ')}`,
  )
  if (failed.length && foreign)
    console.log(
      'This machine differs from the one that stored the frames, so some of this may be GPU differences (see golden/README.md).',
    )
  return failed.length === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(
      `\n${error instanceof SetupError ? 'Cannot run the golden frames' : 'Golden run failed'}: ${error.message}`,
    )
    process.exit(error instanceof SetupError ? 2 : 1)
  })
