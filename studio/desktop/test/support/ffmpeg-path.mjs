// The FFmpeg and FFprobe that the e2e checks themselves run (to make test clips and measure exports), outside the app:
// FFMPEG / FFPROBE override; otherwise Homebrew's on the Mac and, on Windows, the build `npm run package` vendors
// (`vendor/ffmpeg-win`, task 8.1). The PC has no FFmpeg on its PATH, and a Mac path there stopped the flows.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The path of `name` ('ffmpeg' or 'ffprobe') for `platform`, honouring its upper-case environment override. */
export function ffmpegTool(name, platform = process.platform, env = process.env) {
  const override = env[name.toUpperCase()]
  if (override) return override
  return platform === 'win32'
    ? path.join(desktopDir, 'vendor', 'ffmpeg-win', `${name}.exe`)
    : `/opt/homebrew/bin/${name}`
}

export const FFMPEG = ffmpegTool('ffmpeg')
export const FFPROBE = ffmpegTool('ffprobe')

/**
 * Output arguments that encode H.264 for a test clip, BT.709 limited range, `gop` frames between keyframes when given.
 * libx264 where the FFmpeg has it (Homebrew's on the Mac); otherwise Windows' Media Foundation encoder at a bit rate
 * far above what a test clip needs: the vendored build is LGPL, so it has no libx264, and Media Foundation writes no
 * colour tags, which the h264_metadata filter adds to the stream.
 */
export function h264ArgsFor(hasLibx264, { gop } = {}) {
  const keyframes = gop === undefined ? [] : ['-g', String(gop)]
  if (hasLibx264) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', ...keyframes]
  return [
    '-c:v', 'h264_mf', '-b:v', '40M', ...keyframes,
    '-bsf:v', 'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
  ]
}

let libx264 = null

/** `h264ArgsFor` for this machine's `FFMPEG`, asked once. */
export function h264Args(options) {
  libx264 ??= / libx264 /.test(execFileSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' }))
  return h264ArgsFor(libx264, options)
}
