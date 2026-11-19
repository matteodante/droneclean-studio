// The analysis chain on real FFmpeg files: a source with a known repeated frame, "exported" with a lossy codec.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { alignedSelections, matchFrames, summariseMatches } from '../lib/align.mjs'
import { decodeSmallGrey } from '../lib/frames.mjs'
import { probeVideoFile } from '../lib/probe.mjs'
import { complementOf, measureQuality } from '../lib/quality.mjs'
import { run } from '../lib/proc.mjs'

test('a repeated frame in a real encoded file is found, and quality is measured over the paired frames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'))
  try {
    const source = path.join(dir, 'source.mp4')
    const output = path.join(dir, 'output.mp4')
    // 40 frames of moving test pattern, then the same with frame 12 shown twice and a coarser encode.
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x240:r=30',
      '-frames:v',
      '40',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-crf',
      '12',
      source,
    ])
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      source,
      '-vf',
      'loop=loop=1:size=1:start=12',
      '-c:v',
      'libx264',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      output,
    ])

    assert.equal(probeVideoFile(source).frameCount, 40)
    const probe = probeVideoFile(output)
    assert.equal(probe.frameCount, 41)
    assert.equal(probe.bitDepth, 8)
    assert.equal(probe.timestamps.evenlySpaced, true)

    const small = { source: await decodeSmallGrey(source), output: await decodeSmallGrey(output) }
    const matched = matchFrames(small.source, small.output)
    const summary = summariseMatches(matched.matches, small.source.length)
    assert.equal(summary.repeatedFrames, 1)
    // FFmpeg's loop filter repeats a frame near index 12; the matcher must say which, and it is the one just shown.
    assert.equal(summary.repeated.length, 1)
    assert.equal(summary.repeated[0].outputFrame - summary.repeated[0].sourceFrame, 1)
    assert.ok(Math.abs(summary.repeated[0].sourceFrame - 12) <= 1)
    assert.equal(summary.skippedSourceFrames, 0)

    const { keepOutput, keepSource } = alignedSelections(matched.matches, small.source.length)
    const quality = measureQuality(output, source, {
      dropOutput: complementOf(keepOutput, small.output.length),
      dropSource: complementOf(keepSource, small.source.length),
    })
    assert.equal(keepOutput.length, 40)
    assert.ok(quality.psnrDb.y > 30 && quality.psnrDb.y < 80, `PSNR ${quality.psnrDb.y}`)
    assert.ok(quality.ssim.all > 0.9 && quality.ssim.all <= 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
