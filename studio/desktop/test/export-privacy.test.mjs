/**
 * Export privacy, native path (task 3.4): the FFmpeg command of an export carries nothing of its
 * source's metadata. A tiny source is made with FFmpeg and given what a DJI file gives away (a GPS
 * location, a serial number, a chapter title, a telemetry-like subtitle track, a stream tag); the
 * real command runs with that file as the audio source, and the output must hold none of it.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { encodeArguments } from '../out/main/media/formats.js'
import { ffmpegLocation } from '../out/main/media/ffmpeg.js'

const SERIAL = 'FAKESERIAL0042'
const LATITUDE = '45.1234'
const CHAPTER = 'Home at fake street'
const SECRETS = [SERIAL, LATITUDE, CHAPTER, 'FAKEHANDLER', 'FAKEGPS']

function ffmpegRun(ffmpeg, args, input) {
  const run = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { input, maxBuffer: 1 << 28 })
  assert.equal(run.status, 0, String(run.stderr))
  return run
}

test('the native encode command drops the source’s tags, chapters and telemetry tracks', async (t) => {
  const location = ffmpegLocation()
  if (location === null) return t.skip('no FFmpeg on this machine')
  const encoders = String(execFileSync(location.ffmpeg, ['-hide_banner', '-encoders']))
  if (!/\blibx264\b/.test(encoders)) return t.skip('this FFmpeg has no libx264')

  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-privacy-'))
  try {
    const source = path.join(folder, 'source.mp4')
    const output = path.join(folder, 'output.mp4')
    writeFileSync(path.join(folder, 't.srt'), `1\n00:00:00,000 --> 00:00:01,000\nFAKEGPS ${LATITUDE} 9.5678 ${SERIAL}\n\n`)
    writeFileSync(
      path.join(folder, 'chapters.txt'),
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=${CHAPTER}\n`,
    )
    ffmpegRun(location.ffmpeg, [
      '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30:duration=1',
      '-f', 'lavfi', '-i', 'sine=d=1',
      '-i', path.join(folder, 't.srt'),
      '-i', path.join(folder, 'chapters.txt'),
      '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map_metadata', '3', '-map_chapters', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text',
      '-metadata', `location=+${LATITUDE}+009.5678/`,
      '-metadata', `comment=SN:${SERIAL}`,
      '-metadata:s:a', 'handler_name=FAKEHANDLER',
      source,
    ])
    // The fixture really carries what the test is about.
    const sourceBytes = readFileSync(source)
    for (const secret of [SERIAL, LATITUDE, CHAPTER, 'FAKEHANDLER']) {
      assert.ok(sourceBytes.includes(secret), `the fixture lacks ${secret}`)
    }

    const frames = 10
    const args = encodeArguments({
      format: 'h264-8bit',
      encoder: 'libx264',
      readback: 'p010le',
      width: 64,
      height: 64,
      fps: { num: 30, den: 1 },
      bitrate: 1_000_000,
      tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
      path: output,
      frames,
      audio: { file: source, startSeconds: 0, codec: 'aac' },
    })
    ffmpegRun(location.ffmpeg, args, Buffer.alloc(64 * 64 * 3 * frames))

    const probe = JSON.parse(
      execFileSync(location.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', output]).toString(),
    )
    assert.deepEqual(probe.chapters, [], 'no chapter')
    assert.deepEqual(
      probe.streams.map((stream) => stream.codec_type).sort(),
      ['audio', 'video'],
      'no data or subtitle stream',
    )
    for (const stream of probe.streams) {
      assert.deepEqual(Object.keys(stream.tags ?? {}).filter((key) => !['language', 'handler_name', 'vendor_id', 'encoder'].includes(key)), [])
    }
    // What a player needs and nothing from the source: the container's own brand lines and the muxer name.
    const formatTags = Object.keys(probe.format.tags ?? {}).filter(
      (key) => !['major_brand', 'minor_version', 'compatible_brands', 'encoder'].includes(key),
    )
    assert.deepEqual(formatTags, [], 'no format tag beyond the container brands')

    const outputBytes = readFileSync(output)
    for (const secret of SECRETS) assert.ok(!outputBytes.includes(secret), `the output carries ${secret}`)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
