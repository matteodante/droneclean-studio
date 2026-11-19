/** The export's destination (`output-file.ts`) and the `encode.start` request (`encode-request.ts`). */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseEncodeStartRequest } from '../out/main/media/encode-request.js'
import { OutputGrants, checkOutputPath, discardPartial } from '../out/main/media/output-file.js'

const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-output-'))
test.after(() => rmSync(folder, { recursive: true, force: true }))

test('a grant is for one path and one export', () => {
  const grants = new OutputGrants('linux')
  const file = path.join(folder, 'cut.mp4')
  assert.equal(grants.has(file), false)
  grants.grant(file)
  assert.equal(grants.has(path.join(folder, '.', 'cut.mp4')), true, 'another spelling of the same path')
  assert.equal(grants.has(path.join(folder, 'other.mp4')), false)
  assert.equal(grants.claim(file), true)
  assert.equal(grants.claim(file), false, 'used up')
})

test('a path outside what a format writes is refused with its reason', async () => {
  const good = path.join(folder, 'cut.mp4')
  await checkOutputPath(good, 'hevc-main10')
  await checkOutputPath(path.join(folder, 'master.MOV'), 'prores-422-hq')
  await assert.rejects(checkOutputPath('cut.mp4', 'hevc-main10'), /absolute/)
  await assert.rejects(checkOutputPath(path.join(folder, 'cut.mov'), 'hevc-main10'), /\.mp4 file/)
  await assert.rejects(checkOutputPath(path.join(folder, 'nope', 'cut.mp4'), 'h264-8bit'), /does not exist/)
  mkdirSync(path.join(folder, 'dir.mp4'))
  await assert.rejects(checkOutputPath(path.join(folder, 'dir.mp4'), 'h264-8bit'), /not a file/)
  await assert.rejects(checkOutputPath('\\\\server\\share\\cut.mp4', 'hevc-main10', 'win32'), /network/)
})

test('a partial file is removed, and a missing one is not an error', async () => {
  const file = path.join(folder, 'partial.mp4')
  writeFileSync(file, 'half a file')
  await discardPartial(file)
  assert.equal(existsSync(file), false)
  await discardPartial(file)
})

const GOOD = {
  jobId: 'enc-1',
  path: path.join(folder, 'cut.mp4'),
  format: 'hevc-main10',
  readback: 'p010le',
  bitrate: 120_000_000,
  fps: { num: 60000, den: 1001 },
  tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
  width: 3840,
  height: 2160,
}

test('the request is accepted whole or refused with a sentence', () => {
  assert.deepEqual(parseEncodeStartRequest(GOOD), GOOD)
  for (const [patch, pattern] of [
    [{ jobId: 'a b' }, /job id/],
    [{ path: 'relative.mp4' }, /absolute/],
    [{ format: 'avi' }, /export format/],
    [{ readback: 'rgb24' }, /readback format/],
    [{ bitrate: 1.5 }, /bitrate/],
    [{ bitrate: 0 }, /bitrate/],
    [{ fps: { num: 60, den: 0 } }, /rate/],
    [{ tags: { matrix: 'x', range: 'tv', transfer: 'bt709', primaries: 'bt709' } }, /tags/],
    [{ width: '3840' }, /numbers/],
  ]) {
    assert.throws(() => parseEncodeStartRequest({ ...GOOD, ...patch }), pattern)
  }
  assert.throws(() => parseEncodeStartRequest(null), /object/)
})

// ---- a file the user already had is never lost ------------------------------------------

import { readFileSync } from 'node:fs'
import { EncodeJobs, spawnEncode } from '../out/main/media/encode-stream.js'
import { commitOutput, partialPathFor } from '../out/main/media/output-file.js'
import { encodeArguments, chooseEncoder } from '../out/main/media/formats.js'
import { ffmpegCapabilities, ffmpegLocation } from '../out/main/media/ffmpeg.js'
import { preciseOutputFrameBytes } from '../out/shared/native-media.js'

test('the partial file sits beside the final one under a hidden name', () => {
  assert.equal(partialPathFor('/m/cut.mp4'), path.join('/m', '.cut.mp4.droneclean-partial'))
})

/** A fake FFmpeg that only counts frames; `fail` makes it exit 1. */
function fakeProcess({ fail = false } = {}) {
  let resolveExit
  const exited = new Promise((resolve) => (resolveExit = resolve))
  let frames = 0
  return {
    command: ['ffmpeg'],
    stdin: {
      write: async () => void (frames += 1),
      end: async () => resolveExit({ code: fail ? 1 : 0, signal: null }),
    },
    framesReported: () => frames,
    exited,
    kill: () => resolveExit({ code: null, signal: 'SIGKILL' }),
    stderrTail: () => [],
  }
}

function jobFor(final, process) {
  const partial = partialPathFor(final)
  const jobs = new EncodeJobs({ spawn: () => process, slots: 2 })
  jobs.start({
    jobId: 'keep1',
    frameBytes: 4,
    ffmpeg: 'ffmpeg',
    args: [],
    path: final,
    discard: () => discardPartial(partial),
    commit: () => commitOutput(partial, final),
  })
  writeFileSync(partial, 'partial bytes')
  return { jobs, partial }
}

test('an existing file survives a failed encode, a cancel and a short body byte for byte', async () => {
  const final = path.join(folder, 'keep.mp4')
  const original = Buffer.from([0, 1, 2, 3, 250, 251, 252])
  writeFileSync(final, original)

  const failing = jobFor(final, fakeProcess({ fail: true }))
  await failing.jobs.write('keep1', Uint8Array.of(1, 2, 3, 4))
  await assert.rejects(failing.jobs.finish('keep1'), /exit code 1/)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(readFileSync(final), original)
  assert.equal(existsSync(failing.partial), false, 'the temporary file is gone')

  const cancelled = jobFor(final, fakeProcess())
  await cancelled.jobs.write('keep1', Uint8Array.of(1, 2, 3, 4))
  cancelled.jobs.cancel('keep1')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(readFileSync(final), original)
  assert.equal(existsSync(cancelled.partial), false)

  const short = jobFor(final, fakeProcess())
  await short.jobs.write('keep1', Uint8Array.of(1, 2))
  await assert.rejects(short.jobs.finish('keep1'), /middle of frame/)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(readFileSync(final), original)
  assert.equal(existsSync(short.partial), false)
})

test('a successful encode replaces the file, and the temporary one is gone', async () => {
  const final = path.join(folder, 'replace.mp4')
  writeFileSync(final, 'the old file')
  const { jobs, partial } = jobFor(final, fakeProcess())
  await jobs.write('keep1', Uint8Array.of(1, 2, 3, 4))
  assert.equal(readFileSync(final, 'utf8'), 'the old file', 'untouched until FFmpeg is done')
  assert.deepEqual(await jobs.finish('keep1'), { framesWritten: 1, path: final })
  assert.equal(readFileSync(final, 'utf8'), 'partial bytes')
  assert.equal(existsSync(partial), false)
})

test('a failed rename is a failure and leaves the old file', async () => {
  const final = path.join(folder, 'norename.mp4')
  writeFileSync(final, 'old')
  const partial = partialPathFor(final)
  const jobs = new EncodeJobs({ spawn: () => fakeProcess(), slots: 2 })
  jobs.start({
    jobId: 'keep2', frameBytes: 4, ffmpeg: 'f', args: [], path: final,
    discard: () => discardPartial(partial),
    commit: () => commitOutput(path.join(folder, 'missing-partial'), final),
  })
  await jobs.write('keep2', Uint8Array.of(1, 2, 3, 4))
  await assert.rejects(jobs.finish('keep2'), /could not move/)
  assert.equal(readFileSync(final, 'utf8'), 'old')
})

test('a real run into a path that already holds a file: kept on cancel, replaced on success', async (t) => {
  const location = ffmpegLocation()
  if (location === null) return t.skip('no FFmpeg on this machine')
  const encoder = chooseEncoder('hevc-main10', (await ffmpegCapabilities()).encoders, process.platform)
  if (encoder === null) return t.skip('no HEVC encoder')
  const final = path.join(folder, 'real.mp4')
  const original = Buffer.from('my precious old export')
  writeFileSync(final, original)
  const partial = partialPathFor(final)
  const frameBytes = preciseOutputFrameBytes('p010le', 256, 144)
  const frame = new Uint8Array(frameBytes).fill(0x20)
  const run = () => {
    const jobs = new EncodeJobs({ spawn: spawnEncode })
    jobs.start({
      jobId: 'real3', frameBytes, ffmpeg: location.ffmpeg, path: final,
      args: encodeArguments({
        format: 'hevc-main10', encoder, readback: 'p010le', width: 256, height: 144,
        fps: { num: 60000, den: 1001 }, bitrate: 2_000_000,
        tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }, path: partial,
      }),
      discard: () => discardPartial(partial),
      commit: () => commitOutput(partial, final),
    })
    return jobs
  }
  const cancelled = run()
  for (let n = 0; n < 20; n += 1) await cancelled.write('real3', frame)
  cancelled.cancel('real3')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(readFileSync(final), original)
  assert.equal(existsSync(partial), false)

  const done = run()
  for (let n = 0; n < 20; n += 1) await done.write('real3', frame)
  assert.equal((await done.finish('real3')).framesWritten, 20)
  assert.notDeepEqual(readFileSync(final), original)
  assert.ok(readFileSync(final).length > 100)
  assert.equal(existsSync(partial), false)
})
