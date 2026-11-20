/**
 * End-to-end check of the MCP in the packaged app (task 2.2 and the agent fixes of waves 22-24, N1).
 *
 * An MCP client talks to the packaged test variant through the app's own stdio launcher (`resources/mcp/`), the way
 * Claude Code does once the MCP is installed, and checks in the running app: the tools and `search`; a project made
 * by `run` and saved after the call (`saved`, N1); an overlapping clip refused with CONFLICT (11.4); `frame` showing
 * the timeline, and keeping every full-size render as a new file (11.21); the Sky effect turning an overcast sky blue
 * and leaving the ground (11.14); beat markers on a kick track (11.9); a subclip (1.6); a script stuck on a promise
 * answering TIMEOUT, a script stuck in a loop getting the editor reloaded, and every edit still there afterwards
 * (11.2, N1); an export with the Instagram preset laid out as Meta asks, moov first, no edit list, AAC at most
 * 150 kbps (11.19); with `DRONECLEAN_E2E_CLIP` set, stabilization and framing keys from top to bottom on that clip
 * (a DJI clip with gyro data: the picture moves and no black border shows; a clip without motion data: UNSUPPORTED,
 * saying why); `project.delete` (11.20); and the agent log. The 10-minute idle quit (11.15) is left to
 * `test/agent-idle-quit.test.mjs`.
 *
 * The media are made here by FFmpeg (`support/mcp-media.mjs`); the e2e clip, when given, is linked, never copied. The app runs twice
 * under Playwright: once with its window, to seed a throwaway workspace the way `e2e.mjs` does, and once started
 * for an agent (`--mcp`, the window hidden), which the client reaches through the launcher. The profile is the test
 * variant's (`testProfileDir`, never the real one), emptied before and after; the workspace lives under `dist/`.
 *
 * On Windows the MCP listens on a pipe named after the user, not the profile, so a real DroneClean Studio with
 * agent access on would answer it too: the run refuses to start while anything answers there.
 *
 * Usage, in `studio/desktop` after `npm run package:test`: `npm run e2e:mcp`, or
 * `DRONECLEAN_E2E_CLIP=/path/to/a/DJI/clip.mp4 npm run e2e:mcp` for the stabilization checks. Prints one JSON result
 * and exits non-zero if any check fails.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { _electron } from 'playwright-core'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedWorkspaceFromDrop } from './support/drop-files.mjs'
import { createChecks, fatal } from './support/e2e-checks.mjs'
import { e2ePackagedLaunch, testProfileDir } from './support/e2e-profile.mjs'
import { colourWithin, maxChannelDifference, probeVideo } from './support/flow-media.mjs'
import {
  beatsFollowKicks,
  GROUND_RGB,
  looksBlue,
  makeKickTrack,
  makeSkyClip,
  mp4Layout,
  nonEmptyFile,
  probeAudio,
  psnrBetween,
  regionColour,
  SKY_RGB,
} from './support/mcp-media.mjs'
import { isTemporaryFolder } from '../out/main/workspace-lock.js'
import { agentLogDir, socketPathFor } from '../out/main/mcp/protocol.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(here, '..')
const isWindows = process.platform === 'win32'
const testApp = isWindows
  ? path.join(desktopDir, 'dist', 'test-app', 'win-unpacked', 'DroneClean Studio Test.exe')
  : path.join(desktopDir, 'dist', 'test-app', 'mac-arm64', 'DroneClean Studio Test.app', 'Contents', 'MacOS', 'DroneClean Studio Test')
const launcher = isWindows
  ? path.join(path.dirname(testApp), 'resources', 'mcp', 'droneclean-mcp.cmd')
  : path.join(path.dirname(testApp), '..', 'Resources', 'mcp', 'droneclean-mcp')
const PROJECT = 'E2E MCP'
const FPS = 30
/** Where the frame checks look: the middle of the sky (top half) and of the ground (bottom half). */
const SKY_REGION = { x: 0.25, y: 0.1, w: 0.5, h: 0.3 }
const GROUND_REGION = { x: 0.25, y: 0.6, w: 0.5, h: 0.3 }

const { results, check } = createChecks()
const observations = {}
let work = null
let profile = null
let artifacts = null
let app = null
let client = null
/** What the launcher printed on stderr: its own messages and the reason it stopped. */
const launcherErrors = []

/** Whether something answers on the MCP socket or pipe right now. */
function answers(socketPath, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath)
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(timeoutMs, () => done(false))
  })
}

async function waitForSocket(socketPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await answers(socketPath)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/** One tool call: its text parsed as JSON when it is JSON, its image, and whether the tool called it an error. */
async function call(name, args, timeoutMs = 300000) {
  const startedAt = Date.now()
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, resetTimeoutOnProgress: true })
  const text = (result.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  const image = (result.content ?? []).find((part) => part.type === 'image') ?? null
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON: a plain message
  }
  return { isError: result.isError === true, text, json, image, ms: Date.now() - startedAt }
}

/** `run` with a label; the script is a function expression called with the SDK. */
function run(label, script, timeoutMs = 120000) {
  return call('run', { label, script, timeoutMs }, timeoutMs + 60000)
}

/** Render one timeline frame at 640 px and write the PNG into the artifacts folder. */
async function framePng(label, frame) {
  const result = await call('frame', { frame, width: 640 })
  if (result.isError || !result.image) fatal(`frame ${frame} failed: ${result.text.slice(0, 400)}`)
  const file = path.join(artifacts, `${label}.png`)
  fs.writeFileSync(file, Buffer.from(result.image.data, 'base64'))
  return file
}

async function launchApp(args) {
  const options = e2ePackagedLaunch({ appBinary: testApp })
  const launched = await _electron.launch({ ...options, args: [...options.args, ...args] })
  app = launched
  return launched
}

async function seedWorkspace(workspaceDir) {
  const seeding = await launchApp([])
  const page = await seeding.firstWindow()
  await page.waitForURL(/^droneclean:\/\/app\//, { timeout: 60000 })
  await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 120000 })
  const userData = await seeding.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  if (path.resolve(userData) !== path.resolve(profile)) fatal(`the app is not running in the test profile: ${userData}`)
  const name = await seedWorkspaceFromDrop(page, {
    workspaceDir,
    probeId: 'droneclean-e2e-folder',
    windowKey: '__e2eDrop',
    workspaceId: 'droneclean-e2e-mcp',
    timeout: 30000,
  })
  check('a throwaway workspace is seeded in the test profile', name === 'workspace', { userData, name })
  await seeding.close()
  app = null
}

async function main() {
  if (!fs.existsSync(testApp)) fatal(`the packaged test app is missing: ${testApp}\nRun "npm run package:test" first.`)
  if (!fs.existsSync(launcher)) fatal(`the app's MCP launcher is missing: ${launcher}`)
  profile = testProfileDir()
  const socketPath = socketPathFor(profile)
  if (await answers(socketPath)) {
    fatal(
      `something already answers on ${socketPath}: close DroneClean Studio (and DroneClean Studio Test) first` +
        (isWindows ? '; on Windows the pipe is per user, so the real app would get this run\'s scripts' : ''),
    )
  }
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  // "Allow AI agents" on, in the test profile only (studio/mcp/protocol.d.ts, AgentAccessSettings)
  fs.writeFileSync(path.join(profile, 'agent-access.json'), `${JSON.stringify({ version: 1, enabled: true })}\n`)

  artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-e2e-mcp-artifacts-'))
  fs.mkdirSync(path.join(desktopDir, 'dist'), { recursive: true })
  work = fs.mkdtempSync(path.join(desktopDir, 'dist', 'e2e-mcp-work-'))
  const workspaceDir = path.join(work, 'workspace')
  const mediaDir = path.join(work, 'media')
  fs.mkdirSync(workspaceDir)
  fs.mkdirSync(mediaDir)
  if (isTemporaryFolder(workspaceDir)) fatal(`the throwaway workspace is in a temporary folder: ${workspaceDir}`)
  const skyClip = makeSkyClip(path.join(mediaDir, 'sky-over-ground.mp4'))
  const kicks = makeKickTrack(path.join(mediaDir, 'kicks-120bpm.wav'))

  await seedWorkspace(workspaceDir)

  // ── the app started for an agent, and the client the way Claude Code starts it ──
  await launchApp(['--mcp'])
  if (!(await waitForSocket(socketPath, 60000))) fatal(`the app started with --mcp did not open ${socketPath} within 60 s`)
  const transport = new StdioClientTransport({
    command: isWindows ? 'cmd.exe' : launcher,
    args: isWindows ? ['/c', launcher] : [],
    env: { ...process.env, DRONECLEAN_APP_BINARY: testApp, DRONECLEAN_USER_DATA: profile },
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => launcherErrors.push(chunk.toString()))
  client = new Client({ name: 'droneclean-e2e-mcp', version: '1' })
  await client.connect(transport)

  {
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name).sort()
    check('the MCP lists run, search, frame and export', ['export', 'frame', 'run', 'search'].every((name) => names.includes(name)), { names })
    const hit = await call('search', { query: 'markers.addBeats' })
    check('search finds markers.addBeats', !hit.isError && hit.text.includes('addBeats'), { text: hit.text.slice(0, 200) })
  }

  // ── a project made by run, saved after the call ──
  const setup = await run(
    'e2e: project, media, clips',
    `async s => {
      const project = await s.project.create({ name: ${JSON.stringify(PROJECT)}, width: 1280, height: 720, fps: { num: ${FPS}, den: 1 } })
      const [video, audio] = await s.media.import([${JSON.stringify(skyClip)}, ${JSON.stringify(kicks)}])
      const tracks = s.tracks.list()
      const videoTrack = tracks.find((t) => t.kind === 'video').id
      const audioTrack = tracks.find((t) => t.kind === 'audio').id
      const videoClip = s.clips.add({ mediaId: video.id, trackId: videoTrack, from: 0, sourceStart: 0, sourceEnd: 90 })
      const audioClip = s.clips.add({ mediaId: audio.id, trackId: audioTrack, from: 0, sourceStart: 0, sourceEnd: 300 })
      return { project: project.id, videoMedia: video.id, videoTrack, videoClip, audioClip }
    }`,
    300000,
  )
  const ids = setup.json?.value ?? {}
  observations.setup = { ids, saved: setup.json?.saved, undoSteps: setup.json?.undoSteps, ms: setup.ms }
  if (!check('run makes a project with a clip and a song', !setup.isError && ids.project && ids.videoClip && ids.audioClip, setup.isError ? setup.text.slice(0, 600) : ids)) {
    fatal('the project could not be made; the other checks need it')
  }
  check('run saves the project after a call that changed it (saved: true)', setup.json?.saved === true, { saved: setup.json?.saved })

  {
    const overlap = await run(
      'e2e: overlap',
      `s => {
        try {
          s.clips.add({ mediaId: ${JSON.stringify(ids.videoMedia)}, trackId: ${JSON.stringify(ids.videoTrack)}, from: 30, sourceStart: 0, sourceEnd: 30 })
          return { code: 'none', clips: s.clips.list().length }
        } catch (error) {
          return { code: error.code, message: error.message, clips: s.clips.list().length }
        }
      }`,
    )
    const value = overlap.json?.value ?? {}
    check('a clip that would overlap another is refused with CONFLICT, and nothing is added', value.code === 'CONFLICT' && value.clips === 2, value)
  }

  // ── frame, before and after the Sky effect ──
  {
    const before = await framePng('frame-before-sky', 45)
    const sky = regionColour(before, SKY_REGION)
    const ground = regionColour(before, GROUND_REGION)
    observations.beforeSky = { sky, ground }
    check('frame shows the timeline: a white sky over green ground', colourWithin(sky, SKY_RGB, 12) && colourWithin(ground, GROUND_RGB, 12), { sky, ground })

    const added = await run('e2e: Sky effect', `s => s.effects.add(${JSON.stringify(ids.videoClip)}, 'gpu-sky')`)
    if (!check('run adds the Sky effect', !added.isError, added.isError ? added.text.slice(0, 400) : added.json?.value)) return
    const after = await framePng('frame-after-sky', 45)
    const skyAfter = regionColour(after, SKY_REGION)
    const groundAfter = regionColour(after, GROUND_REGION)
    observations.afterSky = { sky: skyAfter, ground: groundAfter }
    check('the Sky effect turns the overcast sky blue', looksBlue(skyAfter), { before: sky, after: skyAfter })
    check('the Sky effect leaves the ground as it was', maxChannelDifference(groundAfter, ground) <= 12, { before: ground, after: groundAfter })
  }

  {
    const first = await call('frame', { frame: 45, full: true })
    const second = await call('frame', { frame: 45, full: true })
    const paths = [first.json?.path, second.json?.path]
    // Workspace-relative; Windows may write it with backslashes
    const named = paths.every((rel) => typeof rel === 'string' && /(^|[\\/])frame-45-[0-9a-z]+-\d+\.png$/.test(rel))
    const onDisk = paths.every((rel) => typeof rel === 'string' && nonEmptyFile(path.join(workspaceDir, rel)))
    check('frame keeps every full-size render as a new file in the project', named && onDisk && paths[0] !== paths[1], { paths, onDisk })
  }

  // ── beats and a subclip ──
  {
    const beats = await run(
      'e2e: beats',
      `async s => ({ frames: await s.markers.addBeats(${JSON.stringify(ids.audioClip)}, { strength: 0.5 }) })`,
      180000,
    )
    const frames = beats.json?.value?.frames ?? []
    observations.beats = { count: frames.length, first: frames.slice(0, 8), ms: beats.ms }
    check(
      'markers.addBeats marks the kick track at its tempo',
      !beats.isError && frames.length >= 8 && frames.length <= 45 && beatsFollowKicks(frames, FPS),
      beats.isError ? beats.text.slice(0, 400) : observations.beats,
    )
  }
  {
    const sub = await run(
      'e2e: subclip',
      `async s => {
        await s.subclips.create({ mediaId: ${JSON.stringify(ids.videoMedia)}, startFrame: 30, endFrame: 60, name: 'e2e 30-60' })
        return s.subclips.list({ mediaId: ${JSON.stringify(ids.videoMedia)} }).map((x) => ({ name: x.name, startFrame: x.startFrame, endFrame: x.endFrame }))
      }`,
    )
    const listed = sub.json?.value ?? []
    check('subclips.create makes a subclip the library lists', listed.some((x) => x.startFrame === 30 && x.endFrame === 60), sub.isError ? sub.text.slice(0, 400) : listed)
  }

  // ── a stuck editor: TIMEOUT, then a reload, and the edits are still there ──
  {
    const promise = await run('e2e: never settles', 'async s => { await new Promise(() => {}) }', 5000)
    check('a script stuck on a promise answers TIMEOUT', promise.isError && promise.json?.code === 'TIMEOUT', { text: promise.text.slice(0, 300), ms: promise.ms })
    const loop = await run('e2e: never yields', 's => { const end = Date.now() + 600000; while (Date.now() < end) {} }', 5000)
    check(
      'a script stuck in a loop gets the editor reloaded, and the answer says the project was reopened',
      loop.isError && loop.json?.code === 'TIMEOUT' && /reopened the project/.test(loop.json?.message ?? ''),
      { text: loop.text.slice(0, 400), ms: loop.ms },
    )
    let state = null
    const errors = []
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const answer = await run(
        'e2e: after the reload',
        `s => {
          const project = s.project.current()
          return project === null
            ? { project: null }
            : { project: project.id, clips: s.clips.list().length, effects: s.effects.list(${JSON.stringify(ids.videoClip)}).map((e) => e.type) }
        }`,
        30000,
      )
      if (!answer.isError && answer.json?.value?.project) {
        state = answer.json.value
        break
      }
      errors.push(answer.isError ? answer.text.slice(0, 200) : JSON.stringify(answer.json?.value))
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const urls = await Promise.all((app?.windows() ?? []).map((page) => page.evaluate(() => location.href).catch(() => 'not reachable')))
    observations.afterReload = { state, urls, answers: errors.slice(0, 3), lastAnswer: errors.at(-1) ?? null, attempts: errors.length + (state ? 1 : 0) }
    check(
      'after the reload the editor answers, with the project open and every edit kept',
      state?.project === ids.project && state?.clips === 2 && state?.effects?.includes('gpu-sky'),
      observations.afterReload,
    )
  }

  // ── export with the Instagram preset ──
  {
    const preset = await run('e2e: preset', `s => s.export.presets().find((p) => p.id === 'instagram-reel')?.settings ?? null`)
    const settings = preset.json?.value
    if (!check('the Instagram preset is there', settings && typeof settings === 'object', preset.text.slice(0, 300))) return
    let job = (await call('export', { start: { settings, name: 'E2E MCP reel', inPoint: 0, outPoint: 90 }, waitMs: 240000 }, 300000)).json
    const deadline = Date.now() + 600000
    while (job?.id && !['completed', 'failed', 'cancelled'].includes(job.status) && Date.now() < deadline) {
      job = (await call('export', { jobId: job.id, waitMs: 240000 }, 300000)).json
    }
    observations.export = job
    const file = job?.savedPath ? path.join(workspaceDir, job.savedPath) : null
    if (!check('the export finishes and its file is in the workspace', job?.status === 'completed' && file && nonEmptyFile(file), job)) return
    const layout = mp4Layout(fs.readFileSync(file))
    const audio = probeAudio(file)
    const video = probeVideo(file)
    observations.exportFile = { layout, audio, video }
    check('the export is laid out as Meta asks: moov before mdat, no edit list', layout.moovFirst && !layout.edts, layout)
    check('the export carries AAC at most 150 kbps and H.264 video', audio.codec === 'aac' && audio.bitRate > 0 && audio.bitRate <= 150000 && video.codec === 'h264', { audio, video: { codec: video.codec, width: video.width, height: video.height, frames: video.frames } })
  }

  // ── stabilization and moving framing on the e2e clip, through run: the path of an agent's drone edit ──
  const clip = process.env.DRONECLEAN_E2E_CLIP
  if (clip && fs.existsSync(clip)) {
    const dji = /^DJI_/i.test(path.basename(clip))
    const stabilized = await run(
      'e2e: stabilize',
      `async s => {
        const [media] = await s.media.import([${JSON.stringify(clip)}])
        const second = Math.round(media.fps)
        const id = s.clips.add({ mediaId: media.id, trackId: ${JSON.stringify(ids.videoTrack)}, from: 90, sourceStart: 20 * second, sourceEnd: 25 * second })
        try {
          await s.clips.setStabilization(id, {})
        } catch (error) {
          return { id, code: error.code, message: error.message }
        }
        const length = s.clips.get(id).durationInFrames
        s.keyframes.add(id, 'framingY', 0, -1, 'linear')
        s.keyframes.add(id, 'framingY', length - 1, 1, 'linear')
        return { id, enabled: s.clips.getStabilization(id)?.enabled === true, length, keyframes: s.keyframes.list(id, 'framingY').length }
      }`,
      300000,
    )
    const value = stabilized.json?.value ?? {}
    observations.stabilization = { dji, value, saved: stabilized.json?.saved, ms: stabilized.ms }
    if (dji) {
      const ok = check(
        'run stabilizes a DJI clip and keys its framing from top to bottom',
        !stabilized.isError && value.enabled === true && value.keyframes === 2,
        stabilized.isError ? stabilized.text.slice(0, 400) : observations.stabilization,
      )
      if (ok) {
        const top = await framePng('frame-framing-top', 90 + 5)
        const bottom = await framePng('frame-framing-bottom', 90 + value.length - 6)
        const psnr = psnrBetween(top, bottom)
        const corners = [
          { x: 0, y: 0, w: 0.04, h: 0.04 },
          { x: 0.96, y: 0, w: 0.04, h: 0.04 },
          { x: 0, y: 0.96, w: 0.04, h: 0.04 },
          { x: 0.96, y: 0.96, w: 0.04, h: 0.04 },
        ].flatMap((corner) => [top, bottom].map((file) => regionColour(file, corner)))
        const black = corners.filter((rgb) => Math.max(...rgb) < 8).length
        observations.framing = { psnr, blackCorners: black }
        check(
          'the framing keys move the stabilized picture (start and end differ) without black borders',
          psnr !== null && psnr < 35 && black === 0,
          observations.framing,
        )
      }
    } else {
      check(
        'on a clip without motion data setStabilization answers UNSUPPORTED and says why',
        value.code === 'UNSUPPORTED' && /motion data/i.test(value.message ?? ''),
        observations.stabilization,
      )
    }
  }

  // ── project.delete ──
  {
    const deleted = await run(
      'e2e: delete',
      `async s => {
        let refused = 'no error'
        try { await s.project.delete(${JSON.stringify(ids.project)}) } catch (error) { refused = error.code }
        await s.project.create({ name: 'E2E MCP other', width: 640, height: 360, fps: { num: 30, den: 1 } })
        const result = await s.project.delete(${JSON.stringify(ids.project)})
        return { refused, deleted: result?.name ?? null, names: (await s.project.list()).map((p) => p.name) }
      }`,
    )
    const value = deleted.json?.value ?? {}
    check(
      'project.delete refuses the open project and deletes another',
      value.refused === 'CONFLICT' && value.deleted === PROJECT && !value.names?.includes(PROJECT) && value.names?.includes('E2E MCP other'),
      deleted.isError ? deleted.text.slice(0, 400) : value,
    )
  }

  // ── the agent log ──
  {
    const dir = agentLogDir(profile)
    const lines = fs.existsSync(dir)
      ? fs.readdirSync(dir).flatMap((name) => fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
      : []
    const codes = lines.map((line) => line.code)
    observations.agentLog = { lines: lines.length, codes: [...new Set(codes)] }
    check('the agent log records the calls, the TIMEOUT among them', lines.length >= 10 && codes.includes('TIMEOUT'), observations.agentLog)
  }
}

let failure = null
try {
  await main()
} catch (error) {
  failure = error
  results.push({ name: 'run completed', ok: false, details: String(error) })
  console.error(error)
} finally {
  try {
    await client?.close()
  } catch {
    // already closed
  }
  try {
    await app?.close()
  } catch {
    // already gone
  }
}

observations.launcherStderr = launcherErrors.join('').slice(0, 2000)
const failures = results.filter((result) => !result.ok)
const output = {
  ok: failures.length === 0 && failure === null,
  app: testApp,
  failed: failures.map((result) => result.name),
  checks: results,
  observations,
}
console.log('\nE2E MCP RESULT\n' + JSON.stringify(output, null, 2))

// The profile and the workspace always go; the rendered frames stay on a failure.
if (work) fs.rmSync(work, { recursive: true, force: true })
if (profile) fs.rmSync(profile, { recursive: true, force: true })
if (artifacts) {
  if (output.ok) fs.rmSync(artifacts, { recursive: true, force: true })
  else console.error(`artifacts kept in ${artifacts}`)
}
process.exit(output.ok ? 0 : 1)
