/**
 * The encode ring (`main/media/encode-stream.ts`) against a fake FFmpeg: no
 * allocation per frame, backpressure, exact frame accounting, cancel, crash and
 * cleanup; then one real small run through FFmpeg and `ffprobe`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { EncodeJobs, pipeBodyIntoJob, spawnEncode } from '../out/main/media/encode-stream.js'
import { encodeArguments, chooseEncoder } from '../out/main/media/formats.js'
import { ffmpegLocation, ffmpegCapabilities } from '../out/main/media/ffmpeg.js'
import { preciseOutputFrameBytes } from '../out/shared/native-media.js'

const FRAME = 6

/**
 * A stand-in for FFmpeg. `holdWrites` makes stdin's writes wait until `release()`;
 * `received` is every frame stdin took, copied at the moment it took it.
 */
function createFake({ holdWrites = false } = {}) {
  const state = { received: [], killed: false, ended: false, stderr: [], reported: null, writes: 0, buffers: [] }
  const held = []
  let resolveExit
  const exited = new Promise((resolve) => (resolveExit = resolve))
  const process = {
    command: ['ffmpeg', 'fake'],
    stdin: {
      write(bytes) {
        if (state.killed) return Promise.reject(new Error('gone'))
        state.writes += 1
        state.buffers.push(bytes.buffer)
        return new Promise((resolve) => {
          const take = () => {
            state.received.push(Uint8Array.from(bytes))
            resolve()
          }
          if (holdWrites) held.push(take)
          else take()
        })
      },
      async end() {
        state.ended = true
        resolveExit({ code: state.exitCode ?? 0, signal: null })
      },
    },
    framesReported: () => state.reported ?? state.received.length,
    exited,
    kill() {
      state.killed = true
      resolveExit({ code: null, signal: 'SIGKILL' })
    },
    stderrTail: () => state.stderr,
  }
  return {
    state,
    process,
    release: () => held.splice(0).forEach((take) => take()),
    crash(code, stderr) {
      state.stderr = stderr
      resolveExit({ code, signal: null })
    },
    pending: () => held.length,
  }
}

function start(fake, overrides = {}) {
  const jobs = new EncodeJobs({ spawn: () => fake.process, slots: 3 })
  const discards = []
  jobs.start({
    jobId: 'job1',
    frameBytes: FRAME,
    ffmpeg: 'ffmpeg',
    args: [],
    path: '/tmp/out.mp4',
    discard: async () => {
      discards.push('discarded')
    },
    ...overrides,
  })
  return { jobs, discards }
}

const frame = (n) => Uint8Array.from({ length: FRAME }, (_, i) => n * 10 + i)
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

test('frames reach stdin in order, whatever size the chunks were cut into', async () => {
  const fake = createFake()
  const { jobs } = start(fake)
  const all = Uint8Array.from([...frame(1), ...frame(2), ...frame(3), ...frame(4)])
  // chunks of 5 bytes: every frame straddles a boundary
  for (let at = 0; at < all.length; at += 5) await jobs.write('job1', all.subarray(at, at + 5))
  const reply = await jobs.finish('job1')
  assert.deepEqual(reply, { framesWritten: 4, path: '/tmp/out.mp4' })
  assert.deepEqual(fake.state.received.map((bytes) => [...bytes]), [1, 2, 3, 4].map((n) => [...frame(n)]))
  assert.equal(fake.state.ended, true)
})

test('the ring allocates its slots once: 100 frames use the same three buffers', async () => {
  const fake = createFake()
  const { jobs } = start(fake)
  assert.equal(jobs.allocatedSlots('job1'), 3)
  for (let n = 0; n < 100; n += 1) await jobs.write('job1', frame(n % 20))
  assert.equal(jobs.allocatedSlots('job1'), 3)
  assert.ok(new Set(fake.state.buffers).size <= 3, 'stdin only ever saw the ring’s slot buffers')
  assert.equal(fake.state.writes, 100)
  assert.equal((await jobs.finish('job1')).framesWritten, 100)
})

test('backpressure: with FFmpeg slow the producer stops after the ring is full', async () => {
  const fake = createFake({ holdWrites: true })
  const { jobs } = start(fake)
  let accepted = 0
  const producer = (async () => {
    for (let n = 0; n < 10; n += 1) {
      await jobs.write('job1', frame(n))
      accepted += 1
    }
  })()
  await settle()
  // three slots: one in flight to stdin, two full and waiting; the fourth frame's write waits
  assert.equal(accepted, 3)
  assert.equal(fake.pending(), 1, 'only one write is outstanding on stdin')
  fake.release()
  await settle()
  assert.ok(accepted > 3, 'a frame taken by FFmpeg lets the producer go on')
  for (let guard = 0; guard < 50 && accepted < 10; guard += 1) {
    fake.release()
    await settle()
  }
  await producer
  const finishing = jobs.finish('job1')
  const pump = setInterval(() => fake.release(), 2)
  try {
    assert.equal((await finishing).framesWritten, 10)
  } finally {
    clearInterval(pump)
  }
})

test('a body that ends in the middle of a frame fails and discards the file', async () => {
  const fake = createFake()
  const { jobs, discards } = start(fake)
  await jobs.write('job1', frame(1))
  await jobs.write('job1', frame(2).subarray(0, 4))
  await assert.rejects(jobs.finish('job1'), /middle of frame 1: 4 of 6 bytes/)
  await settle()
  assert.deepEqual(discards, ['discarded'])
  assert.equal(fake.state.killed, true)
})

test('a declared frame count is exact: more frames fail while writing, fewer at the end', async () => {
  const more = createFake()
  const a = start(more, { expectedFrames: 2 })
  await a.jobs.write('job1', frame(1))
  await a.jobs.write('job1', frame(2))
  await assert.rejects(a.jobs.write('job1', frame(3)), /more than the 2 frames declared/)

  const fewer = createFake()
  const b = start(fewer, { expectedFrames: 3 })
  await b.jobs.write('job1', frame(1))
  await assert.rejects(b.jobs.finish('job1'), /had 1 frames, 3 were declared/)
})

test('the file must hold every frame that was fed', async () => {
  const fake = createFake()
  fake.state.reported = 1
  const { jobs, discards } = start(fake)
  await jobs.write('job1', frame(1))
  await jobs.write('job1', frame(2))
  await assert.rejects(jobs.finish('job1'), /wrote 1 of the 2 frames/)
  await settle()
  assert.deepEqual(discards, ['discarded'])
})

test('an empty readback is not an export', async () => {
  const fake = createFake()
  const { jobs } = start(fake)
  await assert.rejects(jobs.finish('job1'), /no frames/)
})

test('cancel kills FFmpeg, discards the file and refuses the rest of the body', async () => {
  const fake = createFake({ holdWrites: true })
  const { jobs, discards } = start(fake)
  const blocked = (async () => {
    for (let n = 0; n < 6; n += 1) await jobs.write('job1', frame(n))
  })()
  await settle()
  jobs.cancel('job1')
  await assert.rejects(blocked, /was cancelled/)
  await settle()
  assert.equal(fake.state.killed, true)
  assert.deepEqual(discards, ['discarded'])
  assert.equal(jobs.size, 0)
  await assert.rejects(jobs.write('job1', frame(1)), /has ended/)
  jobs.cancel('job1')
  assert.deepEqual(discards, ['discarded'], 'a second cancel does nothing')
})

test('FFmpeg dying under the stream fails the write with its log and discards the file', async () => {
  const fake = createFake({ holdWrites: true })
  const { jobs, discards } = start(fake)
  const writing = (async () => {
    for (let n = 0; n < 6; n += 1) await jobs.write('job1', frame(n))
  })()
  await settle()
  fake.crash(1, ['Error initializing the muxer'])
  await assert.rejects(writing, (error) => {
    assert.match(error.message, /the encoder stopped after 0 frames \(exit code 1\)/)
    assert.deepEqual(error.log, ['Error initializing the muxer'])
    assert.equal(error.exitCode, 1)
    return true
  })
  await settle()
  assert.deepEqual(discards, ['discarded'])
})

test('a non-zero exit at the end is a failure', async () => {
  const fake = createFake()
  fake.state.exitCode = 1
  fake.state.stderr = ['Conversion failed!']
  const { jobs } = start(fake)
  await jobs.write('job1', frame(1))
  await assert.rejects(jobs.finish('job1'), /exit code 1/)
})

test('a duplicate job id is refused and an unknown one named', async () => {
  const fake = createFake()
  const { jobs } = start(fake)
  assert.throws(() => jobs.start({ jobId: 'job1', frameBytes: FRAME, ffmpeg: 'f', args: [], path: '/x' }), /already known/)
  await assert.rejects(jobs.write('nope', frame(1)), /no encode job nope/)
})

test('pipeBodyIntoJob reads a web stream into the job and finishes it', async () => {
  const fake = createFake()
  const { jobs } = start(fake)
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([...frame(1), ...frame(2)]).subarray(0, 8))
      controller.enqueue(Uint8Array.from([...frame(1), ...frame(2)]).subarray(8))
      controller.close()
    },
  })
  const events = []
  const reply = await pipeBodyIntoJob(jobs, 'job1', body, {
    started: () => events.push('s'),
    finished: () => events.push('f'),
  })
  assert.equal(reply.framesWritten, 2)
  assert.deepEqual(events, ['s', 'f', 's', 'f'])
})

// ---- the real run -------------------------------------------------------------------------

/** A p010le test pattern: a luma ramp that moves each frame, neutral chroma, 10 bits in the high bits. */
function patternFrame(width, height, index) {
  const bytes = new Uint8Array(preciseOutputFrameBytes('p010le', width, height))
  const view = new DataView(bytes.buffer)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = 64 + (((x * 4 + index * 3) % 876) | 0) // 64..939, the limited 10-bit range
      view.setUint16((y * width + x) * 2, level << 6, true)
    }
  }
  const uvStart = width * height * 2
  for (let at = uvStart; at < bytes.length; at += 2) view.setUint16(at, 512 << 6, true)
  return bytes
}

test('a real run: 120 frames of p010le become HEVC Main 10, 59.94 fps, BT.709, every frame', async (t) => {
  const location = ffmpegLocation()
  if (location === null) return t.skip('no FFmpeg on this machine')
  const capabilities = await ffmpegCapabilities()
  const encoder = chooseEncoder('hevc-main10', capabilities.encoders, process.platform)
  if (encoder === null) return t.skip('this FFmpeg has no HEVC encoder')

  const width = 256
  const height = 144
  const frames = 120
  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-encode-'))
  const file = path.join(folder, 'pattern.mp4')
  try {
    const args = encodeArguments({
      format: 'hevc-main10',
      encoder,
      readback: 'p010le',
      width,
      height,
      fps: { num: 60000, den: 1001 },
      bitrate: 4_000_000,
      tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
      path: file,
    })
    const jobs = new EncodeJobs({ spawn: spawnEncode })
    const frameBytes = preciseOutputFrameBytes('p010le', width, height)
    let progress = 0
    jobs.start({
      jobId: 'real1',
      frameBytes,
      ffmpeg: location.ffmpeg,
      args,
      path: file,
      onFrame: (done) => (progress = done),
    })
    // The body is a stream of frames cut in two, so the ring cuts frames from chunks that do not align.
    let produced = 0
    const source = new ReadableStream({
      pull(controller) {
        if (produced === frames) return controller.close()
        const bytes = patternFrame(width, height, produced)
        produced += 1
        const half = Math.floor(bytes.length / 2)
        controller.enqueue(bytes.subarray(0, half))
        controller.enqueue(bytes.subarray(half))
      },
    })
    const reply = await pipeBodyIntoJob(jobs, 'real1', source)
    assert.deepEqual(reply, { framesWritten: frames, path: file })
    assert.equal(progress, frames)

    const probe = JSON.parse(
      execFileSync(location.ffprobe, [
        '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries',
        'stream=codec_name,profile,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames,color_range,color_space,color_primaries,color_transfer,width,height,codec_tag_string',
        '-of', 'json', file,
      ]).toString(),
    )
    const stream = probe.streams[0]
    console.log(`encoder ${encoder}\n${JSON.stringify(stream)}`)
    assert.equal(stream.codec_name, 'hevc')
    assert.equal(stream.profile, 'Main 10')
    assert.equal(stream.pix_fmt, 'yuv420p10le')
    assert.equal(stream.nb_read_frames, String(frames))
    assert.equal(stream.r_frame_rate, '60000/1001')
    assert.equal(stream.avg_frame_rate, '60000/1001')
    assert.equal(stream.color_range, 'tv')
    assert.equal(stream.color_space, 'bt709')
    assert.equal(stream.color_primaries, 'bt709')
    assert.equal(stream.color_transfer, 'bt709')
    assert.equal(stream.codec_tag_string, 'hvc1')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a real cancel removes the partial file', async (t) => {
  const location = ffmpegLocation()
  if (location === null) return t.skip('no FFmpeg on this machine')
  const capabilities = await ffmpegCapabilities()
  const encoder = chooseEncoder('hevc-main10', capabilities.encoders, process.platform)
  if (encoder === null) return t.skip('this FFmpeg has no HEVC encoder')
  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-encode-'))
  const file = path.join(folder, 'cancelled.mp4')
  try {
    const { discardPartial } = await import('../out/main/media/output-file.js')
    const jobs = new EncodeJobs({ spawn: spawnEncode })
    jobs.start({
      jobId: 'real2',
      frameBytes: preciseOutputFrameBytes('p010le', 256, 144),
      ffmpeg: location.ffmpeg,
      args: encodeArguments({
        format: 'hevc-main10', encoder, readback: 'p010le', width: 256, height: 144,
        fps: { num: 60000, den: 1001 }, bitrate: 4_000_000,
        tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }, path: file,
      }),
      path: file,
      discard: () => discardPartial(file),
    })
    for (let n = 0; n < 40; n += 1) await jobs.write('real2', patternFrame(256, 144, n))
    jobs.cancel('real2')
    await settle()
    await settle()
    assert.equal(existsSync(file), false)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a real run of the other three formats: pixel format, profile, tags and frame count', async (t) => {
  const location = ffmpegLocation()
  if (location === null) return t.skip('no FFmpeg on this machine')
  const capabilities = await ffmpegCapabilities()
  const expected = {
    'prores-422-hq': { codec: 'prores', profile: 'HQ', pix_fmt: 'yuv422p10le', ext: '.mov' },
    'h264-8bit': { codec: 'h264', profile: 'High', pix_fmt: 'yuv420p', ext: '.mp4' },
    'hevc-8bit': { codec: 'hevc', profile: 'Main', pix_fmt: 'yuv420p', ext: '.mp4' },
  }
  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-encode-'))
  try {
    for (const [format, want] of Object.entries(expected)) {
      const encoder = chooseEncoder(format, capabilities.encoders, process.platform)
      if (encoder === null) continue
      const file = path.join(folder, `${format}${want.ext}`)
      const jobs = new EncodeJobs({ spawn: spawnEncode })
      jobs.start({
        jobId: 'fmt1',
        frameBytes: preciseOutputFrameBytes('p010le', 256, 144),
        ffmpeg: location.ffmpeg,
        args: encodeArguments({
          format, encoder, readback: 'p010le', width: 256, height: 144,
          fps: { num: 60000, den: 1001 }, bitrate: 4_000_000,
          tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }, path: file,
        }),
        path: file,
      })
      for (let n = 0; n < 12; n += 1) await jobs.write('fmt1', patternFrame(256, 144, n))
      assert.equal((await jobs.finish('fmt1')).framesWritten, 12, format)
      const stream = JSON.parse(
        execFileSync(location.ffprobe, [
          '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
          'stream=codec_name,profile,pix_fmt,r_frame_rate,nb_read_frames,color_range,color_space,color_primaries,color_transfer',
          '-of', 'json', file,
        ]).toString(),
      ).streams[0]
      console.log(`${format} via ${encoder}: ${JSON.stringify(stream)}`)
      assert.equal(stream.codec_name, want.codec, format)
      assert.equal(stream.profile, want.profile, format)
      assert.equal(stream.pix_fmt, want.pix_fmt, format)
      assert.equal(stream.nb_read_frames, '12', format)
      assert.equal(stream.r_frame_rate, '60000/1001', format)
      assert.equal(stream.color_space, 'bt709', format)
      assert.equal(stream.color_primaries, 'bt709', format)
      assert.equal(stream.color_transfer, 'bt709', format)
      assert.equal(stream.color_range, 'tv', format)
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
