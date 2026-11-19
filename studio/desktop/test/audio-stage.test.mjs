/**
 * The project's sound on its way to the encoder (`main/media/audio-stage.ts`, `audio-protocol.ts`): the chunks
 * land in order in a temporary file, the end counts them, and a cancel or an unfinished mix leaves no file.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { answerAudioRequest, parseAudioUrl } from '../out/main/media/audio-protocol.js'
import { AudioStage, MAX_STAGED_AUDIO_JOBS, STAGED_AUDIO_IDLE_MS } from '../out/main/media/audio-stage.js'

const SCHEME = 'droneclean-encode'

function stage(now = () => 0) {
  const folder = path.join(mkdtempSync(path.join(tmpdir(), 'audio-stage-test-')), 'stage')
  return { folder, stage: new AudioStage({ folder, now }), done: () => rmSync(path.dirname(folder), { recursive: true, force: true }) }
}

/** `frames` stereo float frames, each sample the frame's number plus `base`. */
function pcm(frames, base = 0) {
  const out = new Float32Array(frames * 2)
  for (let index = 0; index < frames; index += 1) out.fill(base + index, index * 2, index * 2 + 2)
  return new Uint8Array(out.buffer)
}

function post(url, bytes = new Uint8Array(0)) {
  return { url, method: 'POST', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

test('chunks are appended in order and end closes the file with every sample', async () => {
  const { stage: s, done } = stage()
  try {
    await s.append('job-1', 0, pcm(3, 0))
    await s.append('job-1', 1, pcm(2, 3))
    assert.equal(s.has('job-1'), true)
    assert.throws(() => s.take('job-1'), /before the mix ended/)
    const ended = await s.end('job-1', 2)
    assert.equal(ended.samples, 5)
    assert.equal(ended.chunks, 2)
    const bytes = readFileSync(ended.file)
    assert.equal(bytes.byteLength, 5 * 8)
    const floats = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.deepEqual([...floats], [0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
    assert.deepEqual(s.take('job-1'), ended)
  } finally {
    done()
  }
})

test('a chunk out of order, a second 0, a partial sample or a late chunk is refused', async () => {
  const { stage: s, done } = stage()
  try {
    await assert.rejects(s.append('job-2', 1, pcm(1)), /before chunk 0/)
    await s.append('job-2', 0, pcm(1))
    await assert.rejects(s.append('job-2', 0, pcm(1)), /chunk 0 arrived where chunk 1 is next/)
    await assert.rejects(s.append('job-2', 2, pcm(1)), /chunk 2 arrived where chunk 1 is next/)
    await assert.rejects(s.append('job-2', 1, new Uint8Array(7)), /whole stereo float samples/)
    await s.end('job-2', 1)
    await assert.rejects(s.append('job-2', 1, pcm(1)), /has ended/)
  } finally {
    done()
  }
})

test('an end that counts a different number of chunks removes the mix', async () => {
  const { stage: s, folder, done } = stage()
  try {
    await s.append('job-3', 0, pcm(1))
    const file = path.join(folder, 'job-3.f32')
    assert.equal(existsSync(file), true)
    await assert.rejects(s.end('job-3', 2), /sent 2 chunks, the shell took 1/)
    assert.equal(s.has('job-3'), false)
    assert.equal(existsSync(file), false)
  } finally {
    done()
  }
})

test('a project with no sound stages nothing: take is null', () => {
  const { stage: s, done } = stage()
  try {
    assert.equal(s.take('job-4'), null)
  } finally {
    done()
  }
})

test('cancel (remove) deletes the temporary audio, finished or not, and a second remove is a no-op', async () => {
  const { stage: s, folder, done } = stage()
  try {
    await s.append('job-5', 0, pcm(4))
    await s.append('job-6', 0, pcm(4))
    await s.end('job-6', 1)
    const half = path.join(folder, 'job-5.f32')
    const whole = path.join(folder, 'job-6.f32')
    assert.equal(existsSync(half) && existsSync(whole), true)
    await s.remove('job-5')
    await s.remove('job-6')
    await s.remove('job-6')
    assert.equal(existsSync(half) || existsSync(whole), false)
    assert.equal(s.take('job-6'), null)
  } finally {
    done()
  }
})

test('the idle sweep removes a mix nobody took, and only that', async () => {
  let clock = 0
  const { stage: s, folder, done } = stage(() => clock)
  try {
    await s.append('old', 0, pcm(1))
    clock = STAGED_AUDIO_IDLE_MS - 1
    await s.append('fresh', 0, pcm(1))
    clock = STAGED_AUDIO_IDLE_MS
    await s.sweep()
    assert.equal(s.has('old'), false)
    assert.equal(existsSync(path.join(folder, 'old.f32')), false)
    assert.equal(s.has('fresh'), true)
  } finally {
    done()
  }
})

test('the shell stages a few mixes at once, not more', async () => {
  const { stage: s, done } = stage()
  try {
    for (let index = 0; index < MAX_STAGED_AUDIO_JOBS; index += 1) await s.append(`many-${index}`, 0, pcm(1))
    await assert.rejects(s.append('many-over', 0, pcm(1)), /stages 2 mixes at most/)
  } finally {
    done()
  }
})

test('audio URLs: a chunk number or end with a count, for a good job id only', () => {
  assert.deepEqual(parseAudioUrl('droneclean-encode://audio/native-ab/7', SCHEME), { ok: true, jobId: 'native-ab', part: 7, chunks: null })
  assert.deepEqual(parseAudioUrl('droneclean-encode://audio/native-ab/end?chunks=12', SCHEME), {
    ok: true, jobId: 'native-ab', part: 'end', chunks: 12,
  })
  for (const bad of [
    'droneclean-encode://audio/native-ab/end',
    'droneclean-encode://audio/native-ab/-1',
    'droneclean-encode://audio/native-ab/01',
    'droneclean-encode://audio/native-ab',
    'droneclean-encode://audio/a%2fb/1',
    'droneclean-encode://encode/native-ab/1',
    'droneclean-frame://audio/native-ab/1',
  ]) {
    assert.equal(parseAudioUrl(bad, SCHEME).ok, false, bad)
  }
})

test('the audio route: chunks and end are answered, a wrong method or order is a 400 message', async () => {
  const { stage: s, done } = stage()
  try {
    const first = await answerAudioRequest(s, post('droneclean-encode://audio/native-z/0', pcm(10)), SCHEME)
    assert.deepEqual(first, { ok: true, reply: { chunks: 1, samples: 10 } })
    const late = await answerAudioRequest(s, post('droneclean-encode://audio/native-z/5', pcm(10)), SCHEME)
    assert.equal(late.ok, false)
    const end = await answerAudioRequest(s, post('droneclean-encode://audio/native-z/end?chunks=1'), SCHEME)
    assert.deepEqual(end, { ok: true, reply: { chunks: 1, samples: 10 } })
    const get = await answerAudioRequest(s, { ...post('droneclean-encode://audio/native-z/0'), method: 'GET' }, SCHEME)
    assert.equal(get.ok, false)
  } finally {
    done()
  }
})
