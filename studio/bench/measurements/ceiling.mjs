// 8. Ceiling: what the hardware does by itself. FFmpeg alone, on the same 10 s cut of the same clip as the other
// measurements: decode only to a null sink with the hardware decoder, then one encode per hardware encoder this
// machine has (decode in hardware, encode in hardware, write a file). The editor's export is compared with these.
// Every run is sampled (CPU per core, GPU) through the bench's shared sampler.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { run } from '../lib/proc.mjs'

export const name = 'ceiling'

const BITRATE = '120M'

/**
 * The encoders to try, per platform: [encoder name, label, ffmpeg arguments after `-c:v <encoder>`].
 * macOS: HEVC Main 10 at 120 Mbps and ProRes HQ. Windows: NVENC HEVC Main 10 and AV1 10-bit, Quick Sync and AMF.
 */
export function encoderPlan(platform = process.platform) {
  const hevc10 = ['-profile:v', 'main10', '-pix_fmt', 'p010le', '-b:v', BITRATE, '-tag:v', 'hvc1']
  if (platform === 'darwin') {
    return [
      ['hevc_videotoolbox', 'HEVC Main 10, 120 Mbps', hevc10, 'mp4'],
      ['prores_videotoolbox', 'ProRes 422 HQ', ['-profile:v', 'hq', '-pix_fmt', 'p210le'], 'mov'],
    ]
  }
  if (platform === 'win32') {
    return [
      ['hevc_nvenc', 'HEVC Main 10, 120 Mbps', hevc10, 'mp4'],
      ['av1_nvenc', 'AV1 10-bit, 120 Mbps', ['-pix_fmt', 'p010le', '-b:v', BITRATE], 'mp4'],
      ['hevc_qsv', 'HEVC Main 10 (Quick Sync), 120 Mbps', hevc10, 'mp4'],
      ['hevc_amf', 'HEVC Main 10 (AMF), 120 Mbps', hevc10, 'mp4'],
    ]
  }
  return []
}

/** The hardware decoder FFmpeg should use, from the output of `ffmpeg -hwaccels`; null: software only. */
export function pickHwaccel(hwaccelsText, platform = process.platform) {
  const have = new Set(
    String(hwaccelsText)
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean),
  )
  const order =
    platform === 'darwin'
      ? ['videotoolbox']
      : platform === 'win32'
        ? ['cuda', 'd3d11va', 'qsv']
        : ['vaapi', 'cuda']
  return order.find((h) => have.has(h)) ?? null
}

/** Names of the encoders in `ffmpeg -encoders` output. */
export function listedEncoders(encodersText) {
  return new Set(
    String(encodersText)
      .split('\n')
      .map((l) => /^\s*V\S*\s+(\S+)/.exec(l)?.[1])
      .filter(Boolean),
  )
}

/** The frame count and fps of the last `key=value` block of `ffmpeg -progress` output. */
export function lastProgress(text) {
  const last = String(text)
    .split(/progress=\w+\r?\n/)
    .filter((block) => block.includes('frame='))
    .at(-1)
  const read = (key) => {
    const n = Number(new RegExp(`(?:^|\\n)${key}=([\\d.]+)`).exec(`\n${last ?? ''}`)?.[1])
    return Number.isFinite(n) ? n : null
  }
  return { frames: read('frame'), fps: read('fps') }
}

/** Run FFmpeg asynchronously (the sampler's timers must keep running); resolves with wall time and the progress. */
function timedFfmpeg(args) {
  return new Promise((resolve) => {
    const started = performance.now()
    const child = spawn(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-v', 'error', '-progress', 'pipe:1', ...args],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    child.on('error', (e) => resolve({ ok: false, error: e.message }))
    child.on('close', (code) => {
      const wallSeconds = (performance.now() - started) / 1000
      resolve(
        code === 0
          ? { ok: true, wallSeconds, progress: lastProgress(out) }
          : { ok: false, error: err.trim().split('\n').slice(-4).join(' | ') || `exit ${code}` },
      )
    })
  })
}

/** One sampled FFmpeg run, written as a record entry: frames per second, or why it did not run. */
async function timedRun(ctx, label, frames, args, extra = {}) {
  const sampler = ctx.sampler
  const since = sampler?.now()
  const result = await timedFfmpeg(args)
  const until = sampler?.now()
  if (!result.ok) return { label, ran: false, error: result.error, ...extra }
  const counted = result.progress.frames ?? frames
  return {
    label,
    ran: true,
    frames: counted,
    wallSeconds: Number(result.wallSeconds.toFixed(2)),
    framesPerSecond: Number((counted / result.wallSeconds).toFixed(1)),
    ffmpegReportedFps: result.progress.fps,
    sampler: sampler ? sampler.summarise({ since, until }) : null,
    ...extra,
  }
}

export async function measure(ctx) {
  const segment = await ctx.segment(ctx.config.segmentSeconds)
  const encoders = listedEncoders(run('ffmpeg', ['-hide_banner', '-encoders']).toString())
  const hwaccel = pickHwaccel(run('ffmpeg', ['-hide_banner', '-hwaccels']).toString())
  const decodeArgs = hwaccel ? ['-hwaccel', hwaccel] : []
  const outDir = path.join(ctx.config.cache, 'ceiling')
  fs.mkdirSync(outDir, { recursive: true })

  console.log(`   decode only (${hwaccel ?? 'software'})`)
  const decode = await timedRun(
    ctx,
    'decode only, null sink',
    segment.frames,
    [...decodeArgs, '-i', segment.file, '-map', '0:v:0', '-f', 'null', '-'],
    { hwaccel },
  )
  const encodes = []
  for (const [encoder, label, args, container] of encoderPlan()) {
    if (!encoders.has(encoder)) {
      encodes.push({ encoder, label, ran: false, error: 'not in this FFmpeg build' })
      continue
    }
    console.log(`   encode ${encoder}`)
    const file = path.join(outDir, `${encoder}.${container}`)
    const entry = await timedRun(
      ctx,
      label,
      segment.frames,
      [
        ...decodeArgs,
        '-i',
        segment.file,
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        encoder,
        ...args,
        '-y',
        file,
      ],
      { encoder, hwaccel, includesHardwareDecode: hwaccel !== null, args },
    )
    if (entry.ran) entry.outputBytes = fs.statSync(file).size
    fs.rmSync(file, { force: true })
    encodes.push(entry)
  }
  return {
    ...(await ctx.header(name, {
      segment: { file: segment.file, frames: segment.frames, sha256: segment.sha256 ?? null },
    })),
    parameters: {
      how: 'FFmpeg alone on the cut the other measurements export; no browser, no editor code',
      decoder: hwaccel ?? 'software (no hardware decoder found)',
      encodeIncludes: 'hardware decode, hardware encode, writing the file',
      bitrate: BITRATE,
    },
    result: { decode, encodes, ran: encodes.filter((e) => e.ran).length },
  }
}
