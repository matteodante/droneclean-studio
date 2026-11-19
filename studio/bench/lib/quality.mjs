// PSNR and SSIM of an export against its source, with FFmpeg's own filters, frame by frame after the two have been
// lined up (the project and the clip are both 59.94, so the pairing is one to one; the code stays correct if a frame is repeated).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** An FFmpeg `select` expression that drops the listed frame numbers, or null when nothing is dropped. */
export function dropExpression(dropped) {
  if (dropped.length === 0) return null
  return `not(${dropped.map((n) => `eq(n\\,${n})`).join('+')})`
}

/** Numbers in [0, count) that are not in `keep`. */
export function complementOf(keep, count) {
  const kept = new Set(keep)
  const dropped = []
  for (let n = 0; n < count; n++) if (!kept.has(n)) dropped.push(n)
  return dropped
}

export function parsePsnr(stderr) {
  const line = stderr
    .split('\n')
    .reverse()
    .find((l) => l.includes('PSNR y:'))
  if (!line) return null
  const get = (key) => {
    const text = new RegExp(`${key}:([\\d.]+|inf)`).exec(line)?.[1]
    return text === 'inf' ? Infinity : Number(text)
  }
  return {
    y: get('y'),
    u: get('u'),
    v: get('v'),
    average: get('average'),
    min: get('min'),
    max: get('max'),
  }
}

export function parseSsim(stderr) {
  const line = stderr
    .split('\n')
    .reverse()
    .find((l) => l.includes('SSIM Y:'))
  if (!line) return null
  const get = (key) => Number(new RegExp(`${key}:([\\d.]+)`).exec(line)?.[1])
  return { y: get('Y'), u: get('U'), v: get('V'), all: get('All') }
}

/**
 * @param {string} outputFile the export
 * @param {string} sourceFile the source segment
 * @param {{ dropOutput: number[], dropSource: number[] }} alignment frame numbers to leave out of each side
 */
export function measureQuality(outputFile, sourceFile, { dropOutput, dropSource }) {
  const side = (index, dropped, label) => {
    const filters = []
    const expression = dropExpression(dropped)
    if (expression) filters.push(`select='${expression}'`)
    // Same synthetic clock on both sides (frame n at n/60 s): pairing is by position, not by the files' own rates.
    filters.push('setpts=N/(60*TB)')
    // Both sides are compared as 10-bit YUV 4:2:0 without a change of range: an 8-bit file is scaled by four, exactly.
    filters.push('format=yuv420p10le', 'split')
    return `[${index}:v]${filters.join(',')}[${label}1][${label}2]`
  }
  const graph = [
    side(0, dropOutput, 'a'),
    side(1, dropSource, 'b'),
    '[a1][b1]psnr[p]',
    '[a2][b2]ssim[s]',
  ].join(';')
  const scriptPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bench-quality-')),
    'graph.txt',
  )
  fs.writeFileSync(scriptPath, graph)
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      outputFile,
      '-i',
      sourceFile,
      '-/filter_complex',
      scriptPath,
      '-map',
      '[p]',
      '-f',
      'null',
      '-',
      '-map',
      '[s]',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  )
  fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true })
  if (result.status !== 0)
    throw new Error(`ffmpeg psnr/ssim failed:\n${result.stderr.slice(-2000)}`)
  return { psnrDb: parsePsnr(result.stderr), ssim: parseSsim(result.stderr) }
}
