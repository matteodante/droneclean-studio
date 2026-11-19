// Task 6.2: five frames of a clip rendered by the installed Gyroflow application, compared with the CPU warp of the
// WebAssembly module (gyroflow/wasm). The installed Gyroflow renders with its own default project (the settings its command
// line reads from settings.json), the module is given the same settings, and each frame must agree at 38 dB or more
// (PLAN.md 6.2).
//
//   gyroflow/wasm/build.sh                                   # once: pkg/ is not in git
//   GYRO_CLIP=/path/to/clip.MP4 node gyroflow/wasm/test/agreement/run.mjs
//
// Writes gyroflow/wasm/test/agreement/results.json and, in the work folder (the temp folder, or `GYRO_WORK`), the
// rendered frame, the module's warp of it and their amplified difference. Needs ffmpeg on PATH, Node 22.18+, and the
// Gyroflow application (`GYROFLOW`; the Mac app by default).
//
// Why the render is trimmed: Gyroflow's command line renders a video from beginning to end, or the trim ranges of the
// project it loads. Five frames of a 3.8 GB clip would need a 20-minute render of 13,839 4K PNGs, so the project is
// trimmed around each frame. Trimming changes what the engine computes (the adaptive zoom fits the trim range, and the
// Default smoothing by default smooths only the trim: `trim_range_only`), so for every frame:
//
//  - the trim is wide enough either side that Gyroflow's own camera data (`--export-metadata 3`) is identical at that
//    frame to the whole clip's: field of view, minimal field of view and smoothed quaternion. Until it is, a wider
//    trim is tried (60, 120, 180, 240, 300 frames either side);
//  - `trim_range_only` is set to 0, so the smoothed motion stays the whole clip's (the module has no trims: it always
//    smooths the whole clip);
//  - the trim starts half a frame before a frame, so the first rendered frame is a frame and not a rounding.
//
// The rendered frame is then checked for alignment against the module's warp of N-1, N and N+1: the middle one must be
// the best. The render is a PNG sequence (8-bit, lossless) so no encoder stands between Gyroflow's warp and the
// comparison.
//
// The user's Gyroflow settings are not touched: both files the app reads are copied to the work folder first and compared
// with `cmp` at the end; if the app wrote to one, it is restored from the copy and the run says so. The app appends to
// `gyroflow.log` on every run: it is kept in the work folder as evidence and restored.

import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat, cp } from 'node:fs/promises'
import { existsSync, openSync, readSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '../..')
const resultsPath = join(here, 'results.json')

const clip = process.env.GYRO_CLIP
const gyroflow = process.env.GYROFLOW
const work = process.env.GYRO_WORK || join(tmpdir(), 'gyro-agreement')
const frames = (process.env.GYRO_FRAMES || '1000,3000,6000,9000,12000').split(',').map(Number)
const trimHalfWidths = [60, 120, 180, 240, 300]

if (!clip || !gyroflow) {
  console.error('usage: GYRO_CLIP=/path/to/clip.MP4 GYROFLOW=/path/to/gyroflow [GYRO_WORK=/path] node run.mjs')
  console.error('The clip is footage, never part of the repository; GYROFLOW is the installed application\'s executable (on a Mac, Gyroflow.app/Contents/MacOS/gyroflow). This script has nothing to compare without them.')
  process.exit(2)
}
if (!existsSync(clip)) throw new Error(`the clip ${clip} doesn't exist`)
if (!existsSync(gyroflow)) throw new Error(`the Gyroflow application ${gyroflow} doesn't exist (set GYROFLOW)`)
if (!existsSync(join(packageRoot, 'pkg/gyroflow_wasm.js'))) {
  throw new Error(`the package isn't built: run ${join(packageRoot, 'build.sh')} first (it writes ${join(packageRoot, 'pkg')})`)
}

const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }
const note = (message) => console.log(message)
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// ---------------------------------------------------------------------------------------------------------------------
// Processes

/// Runs a command that must succeed and returns its stdout and stderr as text
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 30 * 60 * 1000, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}:\n${output}`)
  }
  return `${result.stdout || ''}${result.stderr || ''}`
}

/// Runs a command that must succeed and returns its stdout as bytes
const runBytes = (command, args, options = {}) => {
  const result = spawnSync(command, args, { maxBuffer: 1024 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}:\n${result.stderr?.toString() || ''}`)
  }
  return result.stdout
}

const sameFile = (a, b) => {
  const result = spawnSync('cmp', ['-s', a, b])
  return !result.error && result.status === 0
}

// ---------------------------------------------------------------------------------------------------------------------
// The user's Gyroflow settings: copied before the first run, compared and restored after the last one

const gyroflowState = [
  { path: join(homedir(), 'Library/Preferences/xyz.gyroflow.plist'), kind: 'file' },
  { path: join(homedir(), 'Library/Application Support/Gyroflow'), kind: 'folder' },
]

const copyState = async (to) => {
  await mkdir(to, { recursive: true })
  for (const entry of gyroflowState) {
    if (!existsSync(entry.path)) continue
    await cp(entry.path, join(to, basename(entry.path)), entry.kind === 'folder'
      ? { recursive: true, preserveTimestamps: true, force: true }
      : { preserveTimestamps: true, force: true })
  }
}

/// Every file under `folder`, relative to it
const listFiles = async (folder, prefix = '') => {
  const out = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = join(prefix, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(join(folder, entry.name), name))
    else out.push(name)
  }
  return out.sort()
}

/// Compares what the app reads now with the copy made before the first run, restoring the files that changed (the log
/// is handled by the caller: it is evidence of the runs)
const compareAndRestore = async (backup) => {
  const differences = []
  for (const entry of gyroflowState) {
    const copy = join(backup, basename(entry.path))
    if (!existsSync(copy)) continue
    if (entry.kind === 'file') {
      if (existsSync(entry.path) && sameFile(entry.path, copy)) continue
      differences.push(basename(entry.path))
      await copyFile(copy, entry.path)
      continue
    }
    const now = existsSync(entry.path) ? await listFiles(entry.path) : []
    const then = await listFiles(copy)
    for (const file of new Set([...now, ...then])) {
      if (file === 'gyroflow.log') continue
      const a = join(entry.path, file)
      const b = join(copy, file)
      if (existsSync(a) && existsSync(b) && sameFile(a, b)) continue
      differences.push(`${basename(entry.path)}/${file}`)
      if (existsSync(b)) {
        await mkdir(dirname(a), { recursive: true })
        await copyFile(b, a)
      } else {
        await rm(a, { force: true })
      }
    }
  }
  return differences
}

// ---------------------------------------------------------------------------------------------------------------------
// Gyroflow: the project its command line makes for the clip, its camera data, and a trimmed copy that renders one frame

const gyroflowProject = async (folder) => {
  await mkdir(folder, { recursive: true })
  run(gyroflow, ['--export-project', '1', '-p', `{'output_folder': '${folder}', 'output_filename': 'default-project.mp4'}`, clip])
  const path = join(folder, 'default-project.gyroflow')
  if (!existsSync(path)) throw new Error(`Gyroflow didn't write the project ${path}`)
  return JSON.parse(await readFile(path, 'utf8'))
}

/// Gyroflow's per-frame camera data of a project or video: the stabilized quaternion, the field of view and the minimal
/// field of view of every frame (`--export-metadata 3`, what `gyro_export::export_gyro_data` writes)
const cameraData = async (input, path) => {
  run(gyroflow, ['--export-metadata', `3:${path}`, input])
  return JSON.parse(await readFile(path, 'utf8'))
}

/// A copy of the default project that renders `frame` only, from a trim `k` frames either side. The trim's ends fall
/// half a frame away from the frames, so its first rendered frame is `frame - k`
const trimmedProject = (project, frame, k, folder) => {
  const fps = project.video_info.fps
  const durationMs = project.video_info.duration_ms
  const variant = JSON.parse(JSON.stringify(project))
  variant.trim_ranges_ms = [[
    Math.max(0, (frame - k - 0.5) / fps * 1000),
    Math.min(durationMs, (frame + k + 0.5) / fps * 1000),
  ]]
  // The module always smooths the whole clip (it has no trims), so the trimmed render must too: with a trim range, the
  // Default and Optimal path smoothing otherwise smooth only the range (`trim_range_only`)
  for (const p of variant.stabilization.smoothing_params) if (p.name === 'trim_range_only') p.value = 0
  variant.output = {
    ...variant.output,
    codec: 'PNG Sequence',
    codec_options: '',
    output_folder: folder,
    // A `%` in the output name reaches FFmpeg percent-encoded by Gyroflow's own url encoding on macOS, which FFmpeg
    // reads as a 25-digit frame number: the frames are named `clip-0020_0000000000000000000000001.png` and so on
    output_filename: 'clip-0020_%d.png',
    output_width: project.output.output_width,
    output_height: project.output.output_height,
    use_gpu: false,
    pixel_format: '',
    encoder_options: '',
    audio: false,
    interpolation: project.output.interpolation,
    metadata: { comment: '' },
    output_folder_bookmark: '',
  }
  return variant
}

// ---------------------------------------------------------------------------------------------------------------------
// The module

const openModule = async () => {
  const initModule = await import(pathToFileURL(join(packageRoot, 'pkg/gyroflow_wasm.js')).href)
  await initModule.default({ module_or_path: await readFile(join(packageRoot, 'pkg/gyroflow_wasm_bg.wasm')) })
  const { Stabilizer } = initModule
  const fd = openSync(clip, 'r')
  const size = (await stat(clip)).size
  const read = (offset, length) => {
    const buffer = Buffer.allocUnsafe(length)
    const n = readSync(fd, buffer, 0, length, offset)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, n)
  }
  const started = performance.now()
  const stabilizer = Stabilizer.open(size, basename(clip), read)
  const openMs = performance.now() - started
  return { stabilizer, size, openMs }
}

/// Gives the module the settings of Gyroflow's default project. Everything the module exposes is set - smoothing and its
/// parameters, field of view, adaptive zoom, horizon lock - and recomputed; the rest it reads from the clip itself (lens
/// profile, frame readout time) or has no setting for (its warp's interpolation, named in `not_expressed` below)
const configureModule = (stabilizer, project) => {
  const s = project.stabilization
  const params = Object.fromEntries(s.smoothing_params.map((p) => [p.name, p.value]))
  stabilizer.setSmoothing(s.method, params)
  stabilizer.setFov(s.fov)
  stabilizer.setAdaptiveZoom(s.adaptive_zoom_window)
  stabilizer.setHorizonLock(s.horizon_lock_amount, s.horizon_lock_roll)
  stabilizer.recompute()
  return { method: s.method, params, fov: s.fov, adaptive_zoom_window: s.adaptive_zoom_window,
    horizon_lock_amount: s.horizon_lock_amount, horizon_lock_roll: s.horizon_lock_roll }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pictures

const bytes = (w, h, channels = 4) => w * h * channels

/// The source frames `from`..`to` as ffmpeg decodes them (RGBA8), seeking near them: the same bytes as a full decode,
/// checked against `select=between(n,..)` for frame 1000
const sourceFrames = (info, from, to) => {
  const fps = info.fps
  const seek = (from - 3) / fps
  const t0 = (from - 0.5) / fps
  const t1 = (to + 0.5) / fps
  const count = to - from + 1
  const raw = runBytes('ffmpeg', ['-v', 'error', '-ss', seek.toFixed(6), '-i', clip, '-copyts', '-vf',
    `select='gte(t\\,${t0.toFixed(6)})*lte(t\\,${t1.toFixed(6)})'`, '-fps_mode', 'passthrough',
    '-frames:v', String(count), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
  { maxBuffer: count * bytes(info.input[0], info.input[1]) + 1024 * 1024 })
  const expected = count * bytes(info.input[0], info.input[1])
  if (raw.length !== expected) throw new Error(`expected ${expected} bytes of frames ${from}..${to}, got ${raw.length}`)
  return [...Array(count)].map((_, i) => new Uint8Array(raw.buffer, raw.byteOffset + i * bytes(info.input[0], info.input[1]), bytes(info.input[0], info.input[1])))
}

/// A PNG (the render) as RGB24
const pngToRgb = (path, width, height) => runBytes('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: bytes(width, height, 3) + 1024 * 1024 })

/// FFmpeg's own PSNR of a module warp (RGBA8) and a rendered PNG: overall and per channel
const psnr = (moduleRgba, renderedPng, width, height) => {
  const text = run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', moduleRgba,
    '-i', renderedPng, '-lavfi', '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]psnr', '-f', 'null', '-'])
  const m = text.match(/PSNR r:([\d.]+) g:([\d.]+) b:([\d.]+) average:([\d.]+)/)
  if (!m) throw new Error(`could not read ffmpeg's PSNR:\n${text}`)
  return { r: +m[1], g: +m[2], b: +m[3], overall: +m[4] }
}

/// FFmpeg's own SSIM (8x8 windows) of the same two pictures
const ssim = (moduleRgba, renderedPng, width, height) => {
  const text = run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', moduleRgba,
    '-i', renderedPng, '-lavfi', '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]ssim', '-f', 'null', '-'])
  const m = text.match(/SSIM R:([\d.]+) \(([\d.]+)\) G:([\d.]+) \(([\d.]+)\) B:([\d.]+) \(([\d.]+)\) All:([\d.]+) \(([\d.]+)\)/)
  if (!m) throw new Error(`could not read ffmpeg's SSIM:\n${text}`)
  return { r: +m[1], g: +m[3], b: +m[5], all: +m[7], db: +m[8] }
}

const rawToPng = (rgb, width, height, path) => {
  run('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', '-',
    '-frames:v', '1', '-y', path], { input: rgb, encoding: 'buffer' })
}

/// The difference of the two pictures, amplified 8 times, as a PNG
const differencePng = (moduleRgba, renderedRgb, width, height, path) => {
  const diff = Buffer.alloc(bytes(width, height, 3))
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    for (let c = 0; c < 3; c++) diff[i * 3 + c] = Math.min(255, Math.abs(moduleRgba[j + c] - renderedRgb[i * 3 + c]) * 8)
  }
  rawToPng(diff, width, height, path)
}

// ---------------------------------------------------------------------------------------------------------------------
// One frame: the trim that keeps the whole clip's numbers, the render, the alignment check, the metrics

const renderedFrames = async (folder) => {
  const files = (await readdir(folder)).filter((f) => /^clip-0020_\d+\.png$/.test(f))
  return files.sort().map((f) => join(folder, f))
}

const compareFrame = async (context, frame) => {
  const { stabilizer, project, defaults, info, pictures, scratch } = context
  const fps = project.video_info.fps
  const timestampUs = Math.round(frame / fps * 1e6)

  // 1. The trim whose render computes the whole clip's numbers at this frame, checked against Gyroflow's camera data
  let k = 0
  let folder = null
  let fov = null
  let minimalFov = null
  const attempts = []
  for (const candidate of trimHalfWidths) {
    const candidateFolder = join(work, `render-${frame}-${candidate}`)
    await rm(candidateFolder, { recursive: true, force: true })
    await mkdir(candidateFolder, { recursive: true })
    const variant = trimmedProject(project, frame, candidate, candidateFolder)
    const path = join(work, 'projects', `frame-${frame}-k${candidate}.gyroflow`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(variant, null, 1))
    const data = await cameraData(path, join(work, 'meta', `frame-${frame}-k${candidate}.json`))
    const trimmed = data[frame]
    const same = trimmed.fov_scale === defaults[frame].fov_scale
      && trimmed.minimal_fov_scale === defaults[frame].minimal_fov_scale
      && trimmed.stab_quat.every((v, i) => Math.abs(v - defaults[frame].stab_quat[i]) <= 1e-6)
    attempts.push({ trim_half_width: candidate, fov: trimmed.fov_scale, whole_clip_fov: defaults[frame].fov_scale, equal: same })
    if (same) { k = candidate; folder = candidateFolder; fov = trimmed.fov_scale; minimalFov = trimmed.minimal_fov_scale; break }
    await rm(candidateFolder, { recursive: true, force: true })
  }
  if (!folder) throw new Error(`no trim reproduced the whole clip's camera data at frame ${frame}: ${JSON.stringify(attempts)}`)
  note(`frame ${frame}: a trim of ${k} frames either side reproduces Gyroflow's whole-clip fov ${fov} and minimal fov ${minimalFov}`)

  // 2. The render
  const renderedStarted = performance.now()
  const log = run(gyroflow, ['-f', join(work, 'projects', `frame-${frame}-k${k}.gyroflow`)])
  const renderSeconds = (performance.now() - renderedStarted) / 1000
  check(!/Rendering failed/.test(log), `frame ${frame}: Gyroflow reported a failed render:\n${log}`)
  const files = await renderedFrames(folder)
  note(`frame ${frame}: ${files.length} PNGs in ${round(renderSeconds, 1)} s (the trim is ${2 * k + 1} frames)`)

  // 3. The source frames, and the module's warp of N-1, N and N+1
  const [width, height] = info.input
  const [outWidth, outHeight] = info.output
  const sources = sourceFrames(info, frame - 1, frame + 1)
  const warps = sources.map((source, i) => {
    const output = new Uint8Array(bytes(outWidth, outHeight))
    const ts = Math.round((frame - 1 + i) / fps * 1e6)
    const result = stabilizer.processRgba8(ts, source, output)
    return { frame: frame - 1 + i, timestampUs: ts, output, result }
  })
  const modulePath = join(scratch, `module-${frame}.rgba`)
  await writeFile(modulePath, warps[1].output)
  await writeFile(join(scratch, `module-${frame - 1}.rgba`), warps[0].output)
  await writeFile(join(scratch, `module-${frame + 1}.rgba`), warps[2].output)

  // 4. Alignment: the module's frame N must be the best match among the rendered frames around it. The trim's first
  // frame is N-k, so it is at index k; a window around that index absorbs an off-by-one in the first frame
  const matches = []
  for (let i = Math.max(0, k - 2); i <= Math.min(files.length - 1, k + 2); i++) {
    matches.push({ index: i, frame: frame - k + i, psnr: psnr(modulePath, files[i], outWidth, outHeight) })
  }
  const best = matches.reduce((a, b) => (b.psnr.overall > a.psnr.overall ? b : a))
  const at = (index) => matches.find((m) => m.index === index)?.psnr.overall ?? null
  const alignment = { previous: at(best.index - 1), best: at(best.index), next: at(best.index + 1) }
  check(best.frame === frame, `frame ${frame}: the module's frame ${frame} matches the rendered frame ${best.frame} best, not itself`)
  check(alignment.previous !== null && alignment.next !== null && alignment.best > alignment.previous && alignment.best > alignment.next,
    `frame ${frame}: the alignment isn't clear: ${JSON.stringify(alignment)}`)
  note(`frame ${frame}: against the rendered frames ${frame - 1}, ${frame}, ${frame + 1} the module's frame ${frame} gives ` +
    `${[alignment.previous, alignment.best, alignment.next].map((x) => x === null ? '-' : x.toFixed(2)).join(', ')} dB`)

  // 5. The metrics of the aligned pair, and its pictures
  const renderedPng = files[best.index]
  const renderedCopy = join(pictures, `gyroflow-${frame}.png`)
  await copyFile(renderedPng, renderedCopy)
  const renderedRgb = pngToRgb(renderedPng, outWidth, outHeight)
  const moduleRgb = Buffer.alloc(bytes(outWidth, outHeight, 3))
  for (let i = 0, j = 0; i < outWidth * outHeight; i++, j += 4) {
    moduleRgb[i * 3] = warps[1].output[j]; moduleRgb[i * 3 + 1] = warps[1].output[j + 1]; moduleRgb[i * 3 + 2] = warps[1].output[j + 2]
  }
  rawToPng(moduleRgb, outWidth, outHeight, join(pictures, `module-${frame}.png`))
  const differencePath = join(pictures, `difference-${frame}.png`)
  differencePng(warps[1].output, renderedRgb, outWidth, outHeight, differencePath)
  const p = psnr(modulePath, renderedPng, outWidth, outHeight)
  const s = ssim(modulePath, renderedPng, outWidth, outHeight)
  note(`frame ${frame}: PSNR ${p.overall.toFixed(3)} dB (r ${p.r.toFixed(2)}, g ${p.g.toFixed(2)}, b ${p.b.toFixed(2)}), SSIM ${s.all.toFixed(6)} (${s.db.toFixed(2)} dB)`)

  // The module's own field of view against Gyroflow's for this frame, and the frame it landed on
  const frameData = stabilizer.frameData(timestampUs)
  const fovDifference = Math.abs(frameData.fov - fov)
  check(frameData.frame === frame, `frame ${frame}: the module's frame for ${timestampUs} us is ${frameData.frame}`)
  check(fovDifference <= 1e-6, `frame ${frame}: the module's fov ${frameData.fov} is not Gyroflow's ${fov}`)

  // 6. Free the frames at once: a 4K PNG is 11 MB and a render is up to 601 of them
  await rm(folder, { recursive: true, force: true })

  return {
    frame,
    timestamp_us: timestampUs,
    trim_half_width: k,
    trim_attempts: attempts,
    render_frames: files.length,
    render_seconds: round(renderSeconds, 1),
    gyroflow_frame_index: best.index,
    gyroflow: { fov, minimal_fov: minimalFov },
    module: {
      frame: frameData.frame,
      fov: frameData.fov,
      minimal_fov: frameData.minimalFov,
      fov_difference: fovDifference,
      matrices_sha256: sha256(Buffer.from(frameData.matrices.buffer)),
    },
    alignment: { previous_psnr: alignment.previous, psnr: alignment.best, next_psnr: alignment.next },
    psnr: p,
    ssim: s,
    pictures: { module: join(pictures, `module-${frame}.png`), gyroflow: renderedCopy, difference: differencePath },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Main

const main = async () => {
  await mkdir(join(work, 'pictures'), { recursive: true })
  await mkdir(join(work, 'meta'), { recursive: true })
  await mkdir(join(work, 'scratch'), { recursive: true })
  await mkdir(join(work, 'projects'), { recursive: true })

  const backup = join(work, 'backup')
  await rm(backup, { recursive: true, force: true })
  await copyState(backup)
  note(`The user's Gyroflow settings copied to ${backup} before the first run`)

  const versionText = run(gyroflow, ['--version'])
  const version = versionText.match(/Gyroflow v?([\d.]+)/)?.[1] || versionText.trim()
  note(`Gyroflow ${version}`)

  const project = await gyroflowProject(join(work, 'project'))
  const info = project.video_info
  const s = project.stabilization
  note(`default project: ${project.output.output_width}x${project.output.output_height}, ${info.num_frames} frames at ${info.fps} fps, ` +
    `smoothing ${s.method} (${s.smoothing_params.map((p) => `${p.name} ${p.value}`).join(', ')}), fov ${s.fov}, ` +
    `adaptive zoom ${s.adaptive_zoom_window} s, horizon lock ${s.horizon_lock_amount} %, interpolation ${project.output.interpolation}`)
  check(project.trim_ranges_ms.length === 0, 'the default project is trimmed')

  // The whole clip's numbers, which every trimmed render must reproduce at its frame
  const defaults = await cameraData(clip, join(work, 'meta', 'whole-clip.json'))
  check(defaults.length === info.num_frames, `the camera data has ${defaults.length} frames, the project ${info.num_frames}`)
  check(defaults[frames[frames.length - 1]]?.frame === frames[frames.length - 1], 'the camera data is not in frame order')

  const { stabilizer, size, openMs } = await openModule()
  note(`the module opened the clip (${size} bytes) in ${round(openMs / 1000, 1)} s`)
  const moduleInfo = stabilizer.info()
  const applied = configureModule(stabilizer, project)
  note(`the module was given the same settings: ${JSON.stringify(applied)}`)
  check(moduleInfo.input[0] === info.width && moduleInfo.input[1] === info.height,
    `the module's input is ${moduleInfo.input.join('x')}, Gyroflow's ${info.width}x${info.height}`)
  check(moduleInfo.output[0] === project.output.output_width && moduleInfo.output[1] === project.output.output_height,
    `the module's output is ${moduleInfo.output.join('x')}, Gyroflow's ${project.output.output_width}x${project.output.output_height}`)
  check(Math.abs(moduleInfo.fps - info.fps) < 1e-9, `the module's frame rate is ${moduleInfo.fps}, Gyroflow's ${info.fps}`)
  check(Math.abs(moduleInfo.frame_readout_time_ms - s.frame_readout_time) < 1e-9,
    `the module's frame readout time is ${moduleInfo.frame_readout_time_ms}, Gyroflow's ${s.frame_readout_time}`)
  check(moduleInfo.frames === info.num_frames, `the module sees ${moduleInfo.frames} frames, Gyroflow ${info.num_frames}`)

  const context = { stabilizer, project, defaults, info: moduleInfo, pictures: join(work, 'pictures'), scratch: join(work, 'scratch') }
  const results = []
  for (const frame of frames) results.push(await compareFrame(context, frame))
  stabilizer.free()

  // What reaches Gyroflow's picture but not the module's API: named so the difference is explained, not hidden
  const notExpressed = {
    interpolation: {
      gyroflow: project.output.interpolation,
      module: 'Bilinear (its CPU warp has no setter; that is Stabilization::default())',
      note: 'Gyroflow\'s render uses its export interpolation setting in the warp shader',
    },
    trim_range_only: {
      gyroflow: '0 for the render, so the trim only selects frames and the smoothing covers the whole clip',
      module: 'no trims: the module always smooths the whole clip',
    },
    frame_readout_time: { both: s.frame_readout_time, from: 'the lens profile in the clip' },
  }

  const summary = {
    note: 'Task 6.2 of PLAN.md: five frames of clip 0020 rendered by the installed Gyroflow with its default settings, ' +
      'against the CPU warp of gyroflow/wasm. Written by run.mjs; the pictures are in the work folder.',
    clip: basename(clip),
    clip_bytes: size,
    gyroflow: { path: gyroflow, version },
    project: {
      input: [info.width, info.height],
      output: [project.output.output_width, project.output.output_height],
      fps: info.fps,
      frames: info.num_frames,
      duration_ms: info.duration_ms,
      stabilization: s,
      output: { codec: project.output.codec, interpolation: project.output.interpolation,
        output_width: project.output.output_width, output_height: project.output.output_height },
      lens: {
        name: [project.calibration_data.camera_brand, project.calibration_data.camera_model].filter(Boolean).join(' '),
        calib_dimension: project.calibration_data.calib_dimension,
        output_dimension: project.calibration_data.output_dimension,
        camera_matrix: project.calibration_data.fisheye_params.camera_matrix,
        distortion_coeffs: project.calibration_data.fisheye_params.distortion_coeffs,
        frame_readout_time: project.calibration_data.frame_readout_time,
      },
    },
    module: { info: moduleInfo, settings: applied, open_seconds: round(openMs / 1000, 1) },
    not_expressed: notExpressed,
    frames: results,
  }
  await writeFile(resultsPath, JSON.stringify(summary, null, 2) + '\n')

  // The user's settings: compared with the copy, restored if the app wrote to them; the log is kept as evidence
  const differences = await compareAndRestore(backup)
  const log = join(homedir(), 'Library/Application Support/Gyroflow/gyroflow.log')
  const logCopy = join(backup, 'Gyroflow/gyroflow.log')
  if (existsSync(log)) await copyFile(log, join(work, 'gyroflow-run.log')).catch(() => {})
  if (existsSync(logCopy)) await copyFile(logCopy, log).catch(() => {})
  if (differences.length) {
    note(`\nThe user's Gyroflow settings had been written to and were restored from ${backup}: ${differences.join(', ')}`)
  } else {
    note(`\nThe user's Gyroflow settings are unchanged (cmp): ${gyroflowState.map((e) => e.path).join(' and ')}`)
  }

  console.log('\nframe  trim  PSNR dB      r      g      b      SSIM      alignment N-1, N, N+1 (dB)')
  for (const r of results) {
    console.log(`${String(r.frame).padEnd(6)} ${String(r.trim_half_width).padEnd(5)} ${r.psnr.overall.toFixed(3).padStart(7)}  ` +
      `${r.psnr.r.toFixed(2).padStart(6)} ${r.psnr.g.toFixed(2).padStart(6)} ${r.psnr.b.toFixed(2).padStart(6)}  ` +
      `${r.ssim.all.toFixed(6)}  ${[r.alignment.previous_psnr, r.alignment.psnr, r.alignment.next_psnr].map((x) => x === null ? ' -  ' : x.toFixed(2)).join(', ')}`)
  }
  console.log(`\nwrote ${resultsPath}`)
  console.log(`pictures in ${join(work, 'pictures')}`)

  const below = results.filter((r) => r.psnr.overall < 38)
  if (problems.length) {
    console.log(`\n${problems.length} problems:`)
    for (const problem of problems) console.log('  ' + problem)
    process.exit(1)
  }
  if (below.length) {
    console.log(`\n${below.length} of the ${results.length} frames are below 38 dB: ${below.map((r) => `${r.frame} (${r.psnr.overall.toFixed(2)} dB)`).join(', ')}`)
    process.exit(1)
  }
  console.log(`\nOK: ${results.length} frames agree with Gyroflow's render at ${Math.min(...results.map((r) => r.psnr.overall)).toFixed(2)} dB or more (38 dB is the task's line)`)
}

await main()
