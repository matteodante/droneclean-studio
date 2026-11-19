/**
 * Unit tests of the decode ring (`main/media/decode-stream.ts`), driven by a fake
 * FFmpeg: what arrives when, what the pump reads, what the frame URLs answer.
 *
 * The behaviour the design fixes and this file pins:
 * - three frames are held by default; the pump stops reading the pipe while all
 *   of them are unsettled (the backpressure of §4.1), and reads again the moment
 *   one is served;
 * - a frame is answered with its bytes, in order, and stays readable until the
 *   ring slides past it, so a resumed `Range` read works;
 * - frames that will never be there answer 410 — past the requested count, dropped
 *   by the ring, a cancelled job, a crashed decoder (with its stderr tail), a
 *   source that ended early — and an unknown job answers 404.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DecodeJobs,
  MAX_REMEMBERED_CANCELLED_JOBS,
  decodeSlotCount,
  frameBody,
} from '../out/main/media/decode-stream.js'

/** The page's read-ahead rule, as the ring sizes itself for it (`native-protocol.ts` holds the number). */
const NATIVE_FRAME_READ_AHEAD = decodeSlotCount(0) - 1

const REPLY = {
  width: 2,
  height: 1,
  rate: { num: 30, den: 1 },
  colour: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
  frameBytes: 4,
}

/**
 * A stand-in for FFmpeg: chunks are handed out only when the pump asks for them,
 * so how much it has read is observable, and the exit code and stderr are the
 * test's to set.
 */
function createFakeProcess() {
  const chunks = []
  const pendingNext = []
  const state = { pulled: 0, killed: false, stderr: [] }
  let ended = false
  let resolveExit
  const exited = new Promise((resolve) => {
    resolveExit = resolve
  })

  const settle = () => {
    while (pendingNext.length > 0) {
      if (chunks.length > 0) {
        state.pulled += 1
        pendingNext.shift()({ value: chunks.shift(), done: false })
        continue
      }
      if (ended) {
        pendingNext.shift()({ value: undefined, done: true })
        continue
      }
      return
    }
  }

  const process = {
    command: ['ffmpeg', '-stub'],
    stdout: {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise((resolve) => {
              pendingNext.push(resolve)
              settle()
            }),
          return: async () => {
            ended = true
            return { value: undefined, done: true }
          },
        }
      },
    },
    exited,
    kill() {
      state.killed = true
      ended = true
      resolveExit({ code: null, signal: 'SIGKILL' })
      settle()
    },
    stderrTail: () => state.stderr,
  }

  return {
    process,
    state,
    /** Hands the pipe one chunk (one frame's bytes, unless the test says otherwise). */
    push(chunk) {
      chunks.push(chunk)
      settle()
    },
    /** The process leaves, with these bytes of stdout still in the pipe. */
    finish({ code = 0, signal = null } = {}) {
      ended = true
      resolveExit({ code, signal })
      settle()
    },
  }
}

/** Lets the pump's microtasks and stream reads run to quiescence. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

function startJob({ frames = 6, ringSize = 3, frameBytes = 4, onFrame } = {}) {
  const fake = createFakeProcess()
  const jobs = new DecodeJobs({ spawn: () => fake.process, ringSize })
  const reply = jobs.start({
    jobId: 'job-1',
    frames,
    frameBytes,
    ffmpeg: '/usr/bin/ffmpeg',
    args: ['-stub'],
    reply: { ...REPLY, frameBytes },
    onFrame,
  })
  return { fake, jobs, reply }
}

/** Four bytes that say which frame they are. */
function frameOf(index, frameBytes = 4) {
  return new Uint8Array(frameBytes).fill(index)
}

test('decode.start answers the probe’s reply and frames arrive in order', async () => {
  const { fake, jobs, reply } = startJob({ frames: 3 })
  assert.deepEqual(reply, REPLY)

  for (let index = 0; index < 3; index += 1) fake.push(frameOf(index))
  await flush()

  for (let index = 0; index < 3; index += 1) {
    const answer = await jobs.take('job-1', index)
    assert.equal(answer.kind, 'frame')
    assert.deepEqual([...answer.bytes], [index, index, index, index])
  }
})

test('a frame split across chunks is one frame; a second GET of it is served again', async () => {
  const { fake, jobs } = startJob({ frames: 2 })
  fake.push(new Uint8Array([7, 7]))
  fake.push(new Uint8Array([7, 7]))
  await flush()

  const first = await jobs.take('job-1', 0)
  jobs.settle('job-1', 0)
  const again = await jobs.take('job-1', 0)
  assert.deepEqual([...first.bytes], [7, 7, 7, 7])
  assert.deepEqual([...again.bytes], [7, 7, 7, 7])
})

test('while the ring is full the pump stops reading the pipe, and one served frame resumes it', async () => {
  const { fake, jobs } = startJob({ frames: 8, ringSize: 2 })
  for (let index = 0; index < 4; index += 1) fake.push(frameOf(index))
  await flush()

  // Two frames are held and unsettled; the pump pulled one chunk beyond them and
  // is waiting for a place, so nothing more is read however much is in the pipe.
  assert.equal(fake.state.pulled, 3)
  fake.push(frameOf(4))
  await flush()
  assert.equal(fake.state.pulled, 3)

  // Serving frame 0 gives it a place; frame 2 is stored, taking frame 0's place in
  // the two-frame ring, and frame 3 is read next.
  jobs.settle('job-1', 0)
  await flush()
  assert.equal(fake.state.pulled, 4)

  // Frames 1 and 2 are in the ring; frame 0 has slid out of it.
  assert.deepEqual([...(await jobs.take('job-1', 1)).bytes], [1, 1, 1, 1])
  assert.deepEqual([...(await jobs.take('job-1', 2)).bytes], [2, 2, 2, 2])
  assert.match((await jobs.take('job-1', 0)).reason, /dropped/)
})

test('a frame the ring slid past answers 410, with the reason', async () => {
  const { fake, jobs } = startJob({ frames: 6, ringSize: 2 })
  for (let index = 0; index < 4; index += 1) fake.push(frameOf(index))
  await flush()

  jobs.settle('job-1', 0)
  await flush()
  // The ring now holds frames 1 and 2; frame 0's place was taken by frame 2.
  const dropped = await jobs.take('job-1', 0)
  assert.equal(dropped.kind, 'gone')
  assert.match(dropped.reason, /frame 0 was dropped: the ring holds the last 2 frames/)
})

test('a frame past the requested count answers 410 without waiting', async () => {
  const { jobs } = startJob({ frames: 2 })
  const past = await jobs.take('job-1', 2)
  assert.equal(past.kind, 'gone')
  assert.match(past.reason, /frame 2 is past the 2 this job decodes/)
})

test('a job the shell does not know answers 404, and a cancelled one still answers 410', async () => {
  const { fake, jobs } = startJob({ frames: 2 })
  fake.push(frameOf(0))
  await flush()

  assert.equal((await jobs.take('nobody', 0)).kind, 'unknown-job')

  jobs.cancel('job-1')
  assert.equal(jobs.size, 0)
  assert.equal((await jobs.take('job-1', 0)).kind, 'gone')
  assert.match((await jobs.take('job-1', 0)).reason, /decode job-1 was cancelled/)
})

test('cancel kills FFmpeg, frees the frames and answers the GETs that were waiting', async () => {
  const { fake, jobs } = startJob({ frames: 4 })
  fake.push(frameOf(0))
  await flush()

  const waiting = jobs.take('job-1', 3)
  jobs.cancel('job-1')

  assert.equal(fake.state.killed, true)
  const answer = await waiting
  assert.equal(answer.kind, 'gone')
  assert.match(answer.reason, /was cancelled/)
  // The frame it held is gone: cancelling frees the ring, not just the process.
  assert.equal((await jobs.take('job-1', 0)).kind, 'gone')
})

test('a GET for a frame the decoder has not reached waits for it instead of failing', async () => {
  const { fake, jobs } = startJob({ frames: 4 })
  const waiting = jobs.take('job-1', 2)
  await flush()
  fake.push(frameOf(0))
  fake.push(frameOf(1))
  fake.push(frameOf(2))
  await flush()

  const answer = await waiting
  assert.equal(answer.kind, 'frame')
  assert.deepEqual([...answer.bytes], [2, 2, 2, 2])
})

test('a decoder that crashes answers 410 with its exit code and stderr tail, and keeps what it decoded', async () => {
  const { fake, jobs } = startJob({ frames: 5 })
  fake.state.stderr.push("Invalid data found when processing input", "moov atom not found")
  fake.push(frameOf(0))
  fake.push(frameOf(1))
  await flush()

  const waiting = jobs.take('job-1', 4)
  fake.finish({ code: 1 })
  await flush()

  const crashed = await waiting
  assert.equal(crashed.kind, 'gone')
  assert.match(crashed.reason, /the decoder stopped after 2 of 5 frames \(exit code 1\)/)
  assert.match(crashed.reason, /moov atom not found/)

  const held = await jobs.take('job-1', 1)
  assert.equal(held.kind, 'frame')
  assert.deepEqual([...held.bytes], [1, 1, 1, 1])
  assert.match((await jobs.take('job-1', 3)).reason, /the decoder stopped/)
})

test('a source that ends early says so, instead of waiting forever', async () => {
  const { fake, jobs } = startJob({ frames: 5 })
  fake.push(frameOf(0))
  fake.push(frameOf(1))
  await flush()
  fake.finish({ code: 0 })
  await flush()

  const answer = await jobs.take('job-1', 2)
  assert.equal(answer.kind, 'gone')
  assert.match(answer.reason, /the source ended after 2 of the 5 frames this job asked for/)
})

test('a decoder that stops in the middle of a frame fails with the counts', async () => {
  const { fake, jobs } = startJob({ frames: 3 })
  fake.push(new Uint8Array([1, 2]))
  fake.finish({ code: 0 })
  await flush()

  const answer = await jobs.take('job-1', 0)
  assert.equal(answer.kind, 'gone')
  assert.match(answer.reason, /stopped in the middle of frame 0: 2 of 4 bytes/)
})

test('progress is reported once per decoded frame', async () => {
  const reported = []
  const { fake } = startJob({ frames: 3, onFrame: (framesDone) => reported.push(framesDone) })
  fake.push(frameOf(0))
  fake.push(frameOf(1))
  await flush()
  assert.deepEqual(reported, [1, 2])
})

test('a job id can only be started once', async () => {
  const { jobs } = startJob({ frames: 1 })
  assert.throws(
    () =>
      jobs.start({
        jobId: 'job-1',
        frames: 1,
        frameBytes: 4,
        ffmpeg: '/usr/bin/ffmpeg',
        args: [],
        reply: REPLY,
      }),
    /a decode with job id "job-1" is already known/,
  )
})

test('cancelled job ids are remembered, but not forever', async () => {
  const fake = createFakeProcess()
  const jobs = new DecodeJobs({ spawn: () => fake.process })
  for (let index = 0; index < MAX_REMEMBERED_CANCELLED_JOBS + 1; index += 1) {
    jobs.start({
      jobId: `job-${index}`,
      frames: 1,
      frameBytes: 4,
      ffmpeg: '/usr/bin/ffmpeg',
      args: [],
      reply: REPLY,
    })
    jobs.cancel(`job-${index}`)
  }
  assert.equal((await jobs.take('job-0', 0)).kind, 'unknown-job')
  assert.equal((await jobs.take('job-1', 0)).kind, 'gone')
  fake.finish({ code: 0 })
})

test('a decode allocates its frame buffers once: 100 frames read as the page reads them use at most decodeSlotCount', async () => {
  const frames = 100
  const { fake, jobs } = startJob({ frames, ringSize: 3 })
  for (let index = 0; index < frames; index += 1) fake.push(frameOf(index % 256))

  // The page: the read-ahead's GETs in flight, the next one asked once a frame is read whole.
  const answers = new Map()
  const ask = (index) => {
    if (index < frames) answers.set(index, jobs.take('job-1', index))
  }
  for (let index = 0; index < NATIVE_FRAME_READ_AHEAD; index += 1) ask(index)
  for (let index = 0; index < frames; index += 1) {
    const answer = await answers.get(index)
    assert.equal(answer.kind, 'frame', `frame ${index}`)
    jobs.settle('job-1', index)
    // The frame is read whole, as the page reads it, before the next GET goes out.
    assert.deepEqual([...answer.bytes], [index, index, index, index], `frame ${index} arrived intact`)
    ask(index + NATIVE_FRAME_READ_AHEAD)
    await flush()
  }

  assert.equal(NATIVE_FRAME_READ_AHEAD, 3)
  assert.ok(jobs.allocatedSlots('job-1') <= decodeSlotCount(3), `${jobs.allocatedSlots('job-1')} buffers`)
  assert.ok(jobs.allocatedSlots('job-1') >= 3)
})

test('a frame’s buffer is not written again until the page has asked for the frame three after it', async () => {
  const { fake, jobs } = startJob({ frames: 40, ringSize: 2 })
  for (let index = 0; index < 40; index += 1) fake.push(frameOf(index + 1))
  const first = await jobs.take('job-1', 0)
  jobs.settle('job-1', 0)
  // The ring slides past frame 0 as the page serves frames 1 and 2, but it has not asked for frame 3 yet: frame 0
  // may still be streaming, and its bytes stay as they were.
  for (const index of [1, 2]) {
    await jobs.take('job-1', index)
    jobs.settle('job-1', index)
    await flush()
  }
  assert.match((await jobs.take('job-1', 0)).reason, /dropped/)
  assert.deepEqual([...first.bytes], [1, 1, 1, 1])
  // Asking for frame 3 says frame 0 arrived whole; its buffer then carries a later frame.
  for (let index = 3; index < 12; index += 1) {
    await jobs.take('job-1', index)
    jobs.settle('job-1', index)
    await flush()
  }
  assert.notDeepEqual([...first.bytes], [1, 1, 1, 1])
})

test('a frame’s response body is the ring’s buffer itself, handed over once, not a copy', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const reader = frameBody(bytes).getReader()
  const first = await reader.read()
  assert.equal(first.value, bytes)
  assert.equal((await reader.read()).done, true)
})
