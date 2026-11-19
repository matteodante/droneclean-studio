/**
 * The sound of a native export, end to end through the shell's own pieces and a real FFmpeg: a click track (a flash
 * and a beep every 0.5 s, made by FFmpeg here, never stored) goes through `AudioStage`, `encodeArguments` with a
 * mix, `EncodeJobs` and `spawnEncode` into each master, and the file is measured: the audio stream's codec, the worst
 * beep-to-flash offset and the audio duration against the video's. The page's half (the mix and its pieces) is
 * `src/studio/export/native-audio.test.ts`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { AudioStage } from '../out/main/media/audio-stage.js'
import { EncodeJobs, pipeBodyIntoJob, spawnEncode } from '../out/main/media/encode-stream.js'
import { chooseEncoder, encodeArguments } from '../out/main/media/formats.js'
import { ffmpegCapabilities, ffmpegLocation } from '../out/main/media/ffmpeg.js'
import { preciseOutputFrameBytes } from '../out/shared/native-media.js'

const WIDTH = 640
const HEIGHT = 360
const FPS = 30
const SECONDS = 6
const BEEPS = SECONDS * 2
const TAGS = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }
const PIECE_BYTES = 5 * 48_000 * 8

/** The click track as two raw files: p010le frames and stereo float samples. */
function makeClickTrack(ffmpeg, folder) {
  const video = path.join(folder, 'click.p010')
  const audio = path.join(folder, 'click.f32')
  const beep = '0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.02)'
  execFileSync(ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECONDS},drawbox=x=0:y=0:w=iw:h=ih:t=fill:c=white:enable='lt(mod(t\\,0.5)\\,0.1)'`,
    '-f', 'lavfi', '-i', `aevalsrc=${beep}|${beep}:s=48000:d=${SECONDS}`,
    '-map', '0:v', '-pix_fmt', 'p010le', '-f', 'rawvideo', video,
    '-map', '1:a', '-f', 'f32le', audio,
  ])
  return { video, audio }
}

/** Sends the audio file to the stage as the page would: in pieces, in order, then the end. */
async function stageAudio(stage, jobId, audioFile) {
  const handle = await open(audioFile, 'r')
  try {
    let chunks = 0
    for (let offset = 0; ; offset += PIECE_BYTES) {
      const bytes = new Uint8Array(PIECE_BYTES)
      const { bytesRead } = await handle.read(bytes, 0, PIECE_BYTES, offset)
      if (bytesRead === 0) break
      await stage.append(jobId, chunks, bytes.subarray(0, bytesRead))
      chunks += 1
    }
    return await stage.end(jobId, chunks)
  } finally {
    await handle.close()
  }
}

async function exportMaster({ location, format, encoder, file, clip, stage, jobId, withSound }) {
  if (withSound) await stageAudio(stage, jobId, clip.audio)
  const mix = stage.take(jobId)
  const args = encodeArguments({
    format, encoder, readback: 'p010le', width: WIDTH, height: HEIGHT, fps: { num: FPS, den: 1 },
    bitrate: 20_000_000, tags: TAGS, path: file, ...(mix === null ? {} : { mix: { file: mix.file } }),
  })
  const jobs = new EncodeJobs({ spawn: spawnEncode })
  jobs.start({
    jobId,
    frameBytes: preciseOutputFrameBytes('p010le', WIDTH, HEIGHT),
    ffmpeg: location.ffmpeg,
    args,
    path: file,
    discard: () => stage.remove(jobId),
    commit: () => stage.remove(jobId),
  })
  // `pipeBodyIntoJob` reads a web stream, as the scheme handler hands it a `Request.body`.
  let reply
  try {
    reply = await pipeBodyIntoJob(jobs, jobId, Readable.toWeb(createReadStream(clip.video)))
  } catch (error) {
    jobs.cancel(jobId)
    throw error
  }
  assert.equal(reply.framesWritten, FPS * SECONDS)
  return args
}

function probe(ffprobe, file, selector, entries) {
  return execFileSync(ffprobe, ['-v', 'error', '-select_streams', selector, '-show_entries', entries, '-of', 'default=nw=1', file]).toString().trim()
}

/**
 * Beep onsets and flash onsets, in seconds on the file's own clock. Frame times are the best-effort timestamps: a
 * hardware HEVC encode leaves `pts_time` empty on some frames.
 */
function onsets(location, file) {
  const startOf = (selector) => Number(/start_time=([\d.]+)/.exec(probe(location.ffprobe, file, selector, 'stream=start_time'))?.[1] ?? 0)
  const pts = execFileSync(location.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file])
    .toString().trim().split('\n').map((line) => line.split(',')[0].trim()).filter((line) => /^-?\d/.test(line)).map(Number)
  const luma = execFileSync(location.ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', 'scale=4:4,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 })
  const flashes = []
  for (let frame = 0; frame < pts.length; frame += 1) {
    const mean = luma.subarray(frame * 16, frame * 16 + 16).reduce((a, b) => a + b, 0) / 16
    const before = frame === 0 ? 0 : luma.subarray((frame - 1) * 16, (frame - 1) * 16 + 16).reduce((a, b) => a + b, 0) / 16
    if (mean > 128 && before <= 128) flashes.push(pts[frame])
  }
  const pcm = execFileSync(location.ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))
  const audioStart = startOf('a:0')
  const beeps = []
  let quietUntil = -1
  for (let index = 0; index < samples.length; index += 1) {
    if (index > quietUntil && Math.abs(samples[index]) > 0.3) {
      beeps.push(audioStart + index / 48_000)
      quietUntil = index + 0.25 * 48_000
    }
  }
  return { flashes, beeps }
}

const MASTERS = [
  ['prores-422-hq', 'mov', 'pcm_s24le'],
  ['hevc-main10', 'mp4', 'aac'],
]

for (const [format, extension, codec] of MASTERS) {
  test(`${format}: the click track keeps its sound in sync, the mix file is gone, and no sound means no audio stream`, async (t) => {
    const location = ffmpegLocation()
    if (location === null) return t.skip('no FFmpeg on this machine')
    const capabilities = await ffmpegCapabilities()
    const encoder = chooseEncoder(format, capabilities.encoders, process.platform)
    if (encoder === null) return t.skip(`this FFmpeg has no encoder for ${format}`)

    const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-audio-sync-'))
    try {
      const clip = makeClickTrack(location.ffmpeg, folder)
      const stage = new AudioStage({ folder: path.join(folder, 'stage') })

      const file = path.join(folder, `master.${extension}`)
      const args = await exportMaster({ location, format, encoder, file, clip, stage, jobId: 'sound', withSound: true })
      assert.ok(args.includes(codec) || args.join(' ').includes(`-c:a ${codec === 'aac' ? 'aac' : codec}`))
      assert.equal(existsSync(path.join(folder, 'stage', 'sound.f32')), false, 'the staged mix is removed when the encode commits')

      const streams = execFileSync(location.ffprobe, ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,sample_fmt,sample_rate,channels,bits_per_raw_sample,bit_rate,start_time,duration', '-of', 'compact', file]).toString().trim()
      console.log(`${format} ${encoder} ${statSync(file).size} bytes\n${streams}`)
      const audio = probe(location.ffprobe, file, 'a:0', 'stream=codec_name,sample_rate,channels,duration,start_time')
      assert.match(audio, new RegExp(`codec_name=${codec}\\b`))
      assert.match(audio, /sample_rate=48000/)
      assert.match(audio, /channels=2/)
      const seconds = (selector) => Number(/duration=([\d.]+)/.exec(probe(location.ffprobe, file, selector, 'stream=duration'))?.[1])
      const frame = 1024 / 48_000
      const difference = Math.abs(seconds('a:0') - seconds('v:0'))
      console.log(`${format}: audio ${seconds('a:0')} s, video ${seconds('v:0')} s, difference ${(difference * 1000).toFixed(2)} ms (one audio frame is ${(frame * 1000).toFixed(2)} ms)`)
      assert.ok(difference <= frame, `audio and video durations differ by ${difference} s`)

      const { flashes, beeps } = onsets(location, file)
      assert.equal(flashes.length, BEEPS, `flashes: ${flashes}`)
      assert.equal(beeps.length, BEEPS, `beeps: ${beeps}`)
      const offsets = beeps.map((beep, index) => (beep - flashes[index]) * 1000)
      const worst = Math.max(...offsets.map(Math.abs))
      console.log(`${format}: beep minus flash, ms: ${offsets.map((value) => value.toFixed(2)).join(' ')}; worst ${worst.toFixed(2)} ms`)
      assert.ok(worst < 5, `the worst beep-to-flash offset is ${worst} ms`)

      // The metadata policy holds with sound.
      const tags = execFileSync(location.ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'default=nw=1', file]).toString()
      assert.doesNotMatch(tags, /location|com\.apple\.quicktime|serial|gps/i)

      // No sound: no audio stream, and nothing is staged.
      const silentFile = path.join(folder, `silent.${extension}`)
      await exportMaster({ location, format, encoder, file: silentFile, clip, stage, jobId: 'silent', withSound: false })
      assert.equal(probe(location.ffprobe, silentFile, 'a', 'stream=codec_name'), '')
      assert.equal(stage.has('silent'), false)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
}

test('a cancelled export removes its staged mix', async (t) => {
  const location = ffmpegLocation()
  if (location === null) return t.skip('no FFmpeg on this machine')
  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-audio-cancel-'))
  try {
    const stage = new AudioStage({ folder: path.join(folder, 'stage') })
    await stage.append('cancelled', 0, new Uint8Array(PIECE_BYTES))
    await stage.end('cancelled', 1)
    assert.equal(existsSync(path.join(folder, 'stage', 'cancelled.f32')), true)
    const jobs = new EncodeJobs({ spawn: spawnEncode })
    const capabilities = await ffmpegCapabilities()
    const encoder = chooseEncoder('prores-422-hq', capabilities.encoders, process.platform)
    if (encoder === null) return t.skip('no ProRes encoder')
    const file = path.join(folder, 'never.mov')
    jobs.start({
      jobId: 'cancelled',
      frameBytes: preciseOutputFrameBytes('p010le', WIDTH, HEIGHT),
      ffmpeg: location.ffmpeg,
      args: encodeArguments({
        format: 'prores-422-hq', encoder, readback: 'p010le', width: WIDTH, height: HEIGHT, fps: { num: FPS, den: 1 },
        bitrate: 1, tags: TAGS, path: file, mix: { file: stage.take('cancelled').file },
      }),
      path: file,
      discard: () => stage.remove('cancelled'),
    })
    jobs.cancel('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(existsSync(path.join(folder, 'stage', 'cancelled.f32')), false)
    assert.equal(stage.has('cancelled'), false)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
