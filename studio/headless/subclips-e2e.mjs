// Portable Chrome end-to-end test of subclips (task 1.6, design 1.6 S6).
//
// A subclip is a named range of one library file. This follows one through the real page,
// decoder and renderer with a tiny generated clip, and ends on the property that matters: the
// clip a subclip puts on the timeline shows exactly the source frames of its range.
//
//   1. a project file as the editor saves it, with the subclip and the marks it was made from,
//      goes through `normalizeProject` (the schema and the migrations) and `editProject` (the
//      editor's own hydrate and rebuild of the timeline): both subclips and marks come back as
//      they went in, and the SDK lists the subclip as valid ("save, reopen");
//   2. `studio.subclips.create` makes a second one, and `studio.clips.add` with the range of the
//      first puts a clip of the parent on the timeline ("drop"): the clip reads back with the
//      range's `sourceStart`, `sourceEnd` and length;
//   3. frames k = 0..N-1 of that clip are rendered and compared byte for byte with frames
//      start + k of the plain, whole-file clip, and must differ from frame k of it.
//
// What it does not cover (the vitest suites do): creating from marks in the source monitor
// and the real drag and drop, which need the editor's UI; this page has the stores and the SDK
// but no interface. Frame-exactness is shown for one 25 fps clip, not for 29.97 or 23.976 ones.
//
// Usage: node headless/subclips-e2e.mjs   (requires dist/ and ffmpeg)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'
import { withHarnessPage } from './lib/page-session.mjs'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MEDIA_ID = 'subclip-source'
const FPS = 25
const WIDTH = 160
const HEIGHT = 90
/** The project schema's smallest canvas is 320x240. */
const CANVAS = { width: 320, height: 240 }
const SOURCE_FRAMES = 50
const START_FRAME = 12
const END_FRAME = 28
const SAMPLED = [0, 7, END_FRAME - START_FRAME - 1]

/** testsrc2 animates and counts, so every frame of the clip is different. */
async function generateClip(filePath) {
  await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${SOURCE_FRAMES / FPS}`,
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-g',
      '10',
      filePath,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  )
}

function track(id, kind, order) {
  return {
    id,
    name: id,
    kind,
    height: 60,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

/** A project file as the editor writes it, with or without the subclip fields. */
function projectFile(items, subclipFields) {
  return {
    id: 'subclips-e2e',
    name: 'Subclips e2e',
    description: '',
    schemaVersion: 10,
    createdAt: 1_735_689_600_000,
    updatedAt: 1_735_689_600_000,
    duration: 60,
    metadata: { ...CANVAS, fps: FPS, backgroundColor: '#000000' },
    timeline: {
      masterBusDb: 0,
      tracks: [track('video-1', 'video', 0), track('audio-1', 'audio', 1)],
      items,
      ...subclipFields,
    },
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function main() {
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-subclips-e2e-'))
  const clipPath = path.join(tempDir, 'clip.mp4')
  await generateClip(clipPath)

  const server = await createHarnessServer({
    distDir,
    resolveMedia: (mediaId) => (mediaId === MEDIA_ID ? clipPath : null),
  })
  try {
    await withHarnessPage(
      {
        harnessUrl: server.harnessUrl,
        launchArgs: chromeLaunchArgs(),
        acceptDownloads: true,
        ignoreConsoleError: (text) => text.includes('Video load error'),
      },
      (page) => run(page, { server, tempDir }),
    )
  } finally {
    await server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/** The library's record of the file, as the importer probes it. */
async function probeLibraryMedia(page, server) {
  const url = server.mediaUrl(MEDIA_ID)
  const probed = await page.evaluate((input) => window.freecut.probeMedia(input), {
    url,
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
  })
  const metadata = {
    ...probed.metadata,
    id: MEDIA_ID,
    fileName: 'clip.mp4',
    mimeType: probed.mimeType,
  }
  assert.equal(Math.round(metadata.fps), FPS, `probed rate ${metadata.fps}`)
  return [{ mediaId: MEDIA_ID, url, metadata }]
}

/** Save and reopen: the subclip and its marks survive the schema and the editor's stores. */
async function saveAndReopen(page, media) {
  const subclip = {
    id: 'subclip-1',
    mediaId: MEDIA_ID,
    name: 'Gap',
    startFrame: START_FRAME,
    endFrame: END_FRAME,
    sourceFps: FPS,
    createdAt: 1_735_689_600_000,
  }
  const subclipFields = {
    subclips: [subclip],
    sourceMarks: { [MEDIA_ID]: { in: START_FRAME, out: END_FRAME } },
  }
  const reopened = await page.evaluate(
    async ({ project, mediaList }) => {
      const normalized = await window.freecut.normalizeProject(project)
      const edited = await window.freecut.editProject({
        project: normalized,
        ops: [],
        media: mediaList,
      })
      return { timeline: edited.project.timeline, listed: window.studio.subclips.list() }
    },
    { project: projectFile([], subclipFields), mediaList: media },
  )
  assert.deepEqual(reopened.timeline.subclips, [subclip], 'the saved subclip is reopened as saved')
  assert.deepEqual(
    reopened.timeline.sourceMarks,
    subclipFields.sourceMarks,
    'the remembered marks are reopened as saved',
  )
  assert.deepEqual(reopened.listed, [{ ...subclip, valid: true }], 'the SDK lists it as valid')
}

/** Create one more through the SDK, then drop the first on the timeline: a clip of the parent. */
async function dropOnTimeline(page) {
  const dropped = await page.evaluate(
    ({ mediaId, start, end }) => {
      const second = window.studio.subclips.create({
        mediaId,
        startFrame: end,
        endFrame: end + 10,
        name: 'Second',
      })
      const listed = window.studio.subclips.list({ mediaId })
      const clipId = window.studio.clips.add({
        mediaId,
        trackId: 'video-1',
        from: 0,
        sourceStart: start,
        sourceEnd: end,
      })
      const clips = window.studio.clips.list()
      return {
        second,
        names: listed.map((entry) => entry.name),
        clip: clips.find((entry) => entry.id === clipId),
        videoClips: clips.filter((entry) => entry.type === 'video').length,
      }
    },
    { mediaId: MEDIA_ID, start: START_FRAME, end: END_FRAME },
  )
  assert.deepEqual(dropped.names, ['Gap', 'Second'])
  assert.equal(dropped.second.valid, true)
  assert.equal(dropped.videoClips, 1)
  const { clip } = dropped
  assert.deepEqual(
    [clip.type, clip.mediaId, clip.sourceStart, clip.sourceEnd, clip.durationInFrames],
    ['video', MEDIA_ID, START_FRAME, END_FRAME, END_FRAME - START_FRAME],
  )
  assert.equal(clip.speed ?? 1, 1)
  return clip
}

/** Renders one frame of a project and returns its PNG bytes, on a page of its own. */
function frameGrabber(page, { server, tempDir, media }) {
  // A page that has made a few downloads is refused the next ones.
  let grabs = 0
  return async (project, frame) => {
    const outputFileName = `grab-${grabs++}.png`
    const frames = await page.context().newPage()
    try {
      await frames.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
      await frames.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
      const downloadPromise = frames.waitForEvent('download', { timeout: 120_000 })
      downloadPromise.catch(() => {})
      const summary = await frames.evaluate((input) => window.freecut.renderFrame(input), {
        project,
        media,
        frame,
        format: 'image/png',
        outputFileName,
        strict: true,
      })
      assert.equal(summary.ok, true)
      const target = path.join(tempDir, outputFileName)
      await (await downloadPromise).saveAs(target)
      return sha256(fs.readFileSync(target))
    } finally {
      await frames.close()
    }
  }
}

/** The clip's frame k is the file's frame START_FRAME + k, and not its frame k. */
async function compareFrames(grab, clip) {
  const wholeItem = {
    id: 'whole',
    type: 'video',
    trackId: 'video-1',
    from: 0,
    durationInFrames: SOURCE_FRAMES,
    label: 'whole file',
    mediaId: MEDIA_ID,
    sourceFps: FPS,
    sourceStart: 0,
    sourceEnd: SOURCE_FRAMES,
    sourceDuration: SOURCE_FRAMES,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    volume: 0,
    // The placement the editor gave the dropped clip, so both are drawn the same way.
    transform: clip.transform,
  }
  const fromSubclip = projectFile([{ ...clip, volume: 0 }], undefined)
  const wholeFile = projectFile([wholeItem], undefined)
  for (const k of SAMPLED) {
    const shown = await grab(fromSubclip, k)
    const expected = await grab(wholeFile, START_FRAME + k)
    assert.equal(shown, expected, `subclip frame ${k} is not source frame ${START_FRAME + k}`)
    const unshifted = await grab(wholeFile, k)
    assert.notEqual(shown, unshifted, `frame ${k} of the file equals the subclip's: no proof`)
  }
}

async function run(page, { server, tempDir }) {
  const media = await probeLibraryMedia(page, server)
  await saveAndReopen(page, media)
  const clip = await dropOnTimeline(page)
  await compareFrames(frameGrabber(page, { server, tempDir, media }), clip)
  process.stdout.write(
    `Subclips e2e passed (range ${START_FRAME}..${END_FRAME} of ${SOURCE_FRAMES} frames at ${FPS} fps, ` +
      `frames ${SAMPLED.join(', ')} identical to the file's frames ${SAMPLED.map((k) => START_FRAME + k).join(', ')})\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`Subclips e2e failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
