/**
 * The export formats' FFmpeg command lines (`main/media/formats.ts`), argument by
 * argument: nothing here starts a process.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chooseEncoder,
  colourArguments,
  encodeArguments,
  isHardwareEncoder,
  outputExtension,
  planAudio,
} from '../out/main/media/formats.js'

const TAGS = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }
const BASE = {
  readback: 'p010le',
  width: 3840,
  height: 2160,
  fps: { num: 60000, den: 1001 },
  bitrate: 120_000_000,
  tags: TAGS,
  path: '/Users/pilot/Movies/cut.mp4',
  platform: 'darwin',
}
const TAG_ARGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']

/** What every command shares before the encoder: the readback input. */
const INPUT = [
  '-hide_banner', '-nostats', '-v', 'error', '-progress', 'pipe:1', '-y',
  '-protocol_whitelist', 'file,pipe',
  '-f', 'rawvideo', '-pix_fmt', 'p010le', '-video_size', '3840x2160', '-framerate', '60000/1001',
  ...TAG_ARGS,
  '-i', 'pipe:0',
  '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
  '-fps_mode', 'passthrough',
]

test('HEVC Main 10 on VideoToolbox: Main 10, hvc1, a bitrate, the exact rate and the BT.709 tags', () => {
  assert.deepEqual(encodeArguments({ ...BASE, format: 'hevc-main10', encoder: 'hevc_videotoolbox' }), [
    ...INPUT,
    '-pix_fmt', 'p010le',
    '-sws_flags', 'accurate_rnd+full_chroma_int',
    '-c:v', 'hevc_videotoolbox', '-profile:v', 'main10', '-tag:v', 'hvc1', '-b:v', '120000000',
    ...TAG_ARGS,
    '-f', 'mp4', 'file:/Users/pilot/Movies/cut.mp4',
  ])
})

test('ProRes 422 HQ on VideoToolbox: the hq profile, 4:2:2 10-bit, no bitrate, a mov', () => {
  assert.deepEqual(
    encodeArguments({ ...BASE, format: 'prores-422-hq', encoder: 'prores_videotoolbox', path: '/m/a.mov' }),
    [
      ...INPUT,
      '-pix_fmt', 'yuv422p10le',
      '-sws_flags', 'accurate_rnd+full_chroma_int',
      '-c:v', 'prores_videotoolbox', '-profile:v', 'hq',
      ...TAG_ARGS,
      '-f', 'mov', 'file:/m/a.mov',
    ],
  )
})

test('ProRes in software is prores_ks with the hq profile and the Apple vendor tag', () => {
  const args = encodeArguments({ ...BASE, format: 'prores-422-hq', encoder: 'prores_ks', path: '/m/a.mov' })
  const at = args.indexOf('-c:v')
  assert.deepEqual(args.slice(at, at + 6), ['-c:v', 'prores_ks', '-profile:v', 'hq', '-vendor', 'apl0'])
  assert.ok(!args.includes('-b:v'))
  assert.equal(args[args.indexOf('-pix_fmt', at - 6) + 1], 'yuv422p10le')
})

test('8-bit H.264 and H.265 convert to yuv420p', () => {
  const h264 = encodeArguments({ ...BASE, format: 'h264-8bit', encoder: 'h264_videotoolbox' })
  assert.deepEqual(h264.slice(h264.indexOf('-pix_fmt', INPUT.length)), [
    '-pix_fmt', 'yuv420p',
    '-sws_flags', 'accurate_rnd+full_chroma_int',
    '-c:v', 'h264_videotoolbox', '-profile:v', 'high', '-b:v', '120000000',
    ...TAG_ARGS,
    '-f', 'mp4', 'file:/Users/pilot/Movies/cut.mp4',
  ])
  const hevc = encodeArguments({ ...BASE, format: 'hevc-8bit', encoder: 'hevc_videotoolbox' })
  assert.deepEqual(hevc.slice(hevc.indexOf('-c:v')).slice(0, 8), [
    '-c:v', 'hevc_videotoolbox', '-profile:v', 'main', '-tag:v', 'hvc1', '-b:v', '120000000',
  ])
  assert.equal(hevc[hevc.indexOf('-pix_fmt', INPUT.length) + 1], 'yuv420p')
})

test('software fallbacks: libx265 Main 10 takes yuv420p10le, libx264 high', () => {
  const x265 = encodeArguments({ ...BASE, format: 'hevc-main10', encoder: 'libx265' })
  assert.deepEqual(x265.slice(x265.indexOf('-pix_fmt', INPUT.length), x265.indexOf('-pix_fmt', INPUT.length) + 2), [
    '-pix_fmt', 'yuv420p10le',
  ])
  assert.deepEqual(x265.slice(x265.indexOf('-c:v'), x265.indexOf('-c:v') + 14), [
    '-c:v', 'libx265', '-profile:v', 'main10', '-tag:v', 'hvc1', '-preset', 'medium',
    '-b:v', '120000000', '-x265-params', 'log-level=error', '-color_range', 'tv',
  ])
  const x264 = encodeArguments({ ...BASE, format: 'h264-8bit', encoder: 'libx264' })
  assert.deepEqual(x264.slice(x264.indexOf('-c:v'), x264.indexOf('-c:v') + 8), [
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-b:v', '120000000',
  ])
})

test('Windows encoders: NVENC, Quick Sync and AMF Main 10 take p010le; AV1 NVENC is 10-bit', () => {
  const part = (encoder, count) => {
    const args = encodeArguments({ ...BASE, platform: 'win32', path: 'C:\\Videos\\cut.mp4', format: 'hevc-main10', encoder })
    assert.equal(args.at(-1), 'file:C:\\Videos\\cut.mp4')
    assert.equal(args[args.indexOf('-pix_fmt', INPUT.length) + 1], 'p010le')
    return args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + count)
  }
  assert.deepEqual(part('hevc_nvenc', 14), [
    '-c:v', 'hevc_nvenc', '-profile:v', 'main10', '-tag:v', 'hvc1', '-preset', 'p5',
    '-tune', 'hq', '-rc', 'vbr', '-b:v', '120000000',
  ])
  assert.deepEqual(part('hevc_qsv', 8), [
    '-c:v', 'hevc_qsv', '-profile:v', 'main10', '-tag:v', 'hvc1', '-b:v', '120000000',
  ])
  assert.deepEqual(part('hevc_amf', 10), [
    '-c:v', 'hevc_amf', '-profile:v', 'main10', '-tag:v', 'hvc1', '-usage', 'high_quality', '-b:v', '120000000',
  ])
  assert.deepEqual(part('av1_nvenc', 10), [
    '-c:v', 'av1_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-b:v', '120000000',
  ])
})

test('the rgba64le fallback converts full-range RGB to limited BT.709 and tags only the output', () => {
  const args = encodeArguments({ ...BASE, readback: 'rgba64le', format: 'hevc-main10', encoder: 'hevc_videotoolbox' })
  const at = args.indexOf('-i')
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'rgba64le')
  assert.ok(!args.slice(0, at).includes('-colorspace'), 'the RGB input is not tagged as YUV')
  const vf = args.indexOf('-vf')
  assert.equal(
    args[vf + 1],
    'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int',
  )
})

test('a known frame count adds -frames:v', () => {
  const args = encodeArguments({ ...BASE, format: 'hevc-main10', encoder: 'hevc_videotoolbox', frames: 600 })
  const at = args.indexOf('-frames:v')
  assert.deepEqual(args.slice(at, at + 4), ['-frames:v', '600', '-fps_mode', 'passthrough'])
})

test('audio is copied when the container takes it, encoded otherwise', () => {
  assert.deepEqual(planAudio('hevc-main10', null), { kind: 'none' })
  assert.deepEqual(planAudio('hevc-main10', 'aac'), { kind: 'copy' })
  assert.deepEqual(planAudio('prores-422-hq', 'aac'), { kind: 'copy' })
  assert.deepEqual(planAudio('hevc-main10', 'pcm_s16le'), { kind: 'aac' })
  assert.deepEqual(planAudio('h264-8bit', 'vorbis'), { kind: 'aac' })
  assert.deepEqual(planAudio('prores-422-hq', 'vorbis'), { kind: 'pcm_s24le' })

  const audio = { file: '/Users/pilot/clip.mp4', startSeconds: 1.5, codec: 'aac' }
  const copy = encodeArguments({ ...BASE, format: 'hevc-main10', encoder: 'hevc_videotoolbox', audio })
  const at = copy.indexOf('-i', copy.indexOf('-i') + 1)
  assert.deepEqual(copy.slice(at - 4, at + 2), ['-protocol_whitelist', 'file', '-ss', '1.5', '-i', '/Users/pilot/clip.mp4'])
  assert.deepEqual(copy.slice(at + 2, at + 9), ['-map', '0:v:0', '-map', '1:a:0', '-c:a', 'copy', '-sn'])
  assert.ok(copy.includes('-shortest'))

  const aac = encodeArguments({ ...BASE, format: 'h264-8bit', encoder: 'libx264', audio: { ...audio, codec: 'vorbis' } })
  assert.deepEqual(aac.slice(aac.indexOf('-c:a'), aac.indexOf('-c:a') + 4), ['-c:a', 'aac', '-b:a', '320k'])
  const pcm = encodeArguments({ ...BASE, format: 'prores-422-hq', encoder: 'prores_ks', audio: { ...audio, codec: 'vorbis' } })
  assert.deepEqual(pcm.slice(pcm.indexOf('-c:a'), pcm.indexOf('-c:a') + 2), ['-c:a', 'pcm_s24le'])
})

test('a project mix is a second input of raw stereo float, encoded as PCM 24-bit in ProRes and AAC 320k in the MP4s', () => {
  const mix = { file: '/tmp/droneclean-export-audio/native-1.f32' }
  const MIX_INPUT = [
    '-protocol_whitelist', 'file', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'file:/tmp/droneclean-export-audio/native-1.f32',
  ]
  for (const [format, encoder, codec] of [
    ['prores-422-hq', 'prores_ks', ['-c:a', 'pcm_s24le']],
    ['hevc-main10', 'hevc_videotoolbox', ['-c:a', 'aac', '-b:a', '320k']],
    ['h264-8bit', 'libx264', ['-c:a', 'aac', '-b:a', '320k']],
  ]) {
    const withSound = encodeArguments({ ...BASE, format, encoder, mix })
    const at = withSound.indexOf('pipe:0')
    assert.deepEqual(withSound.slice(at + 1, at + 1 + MIX_INPUT.length), MIX_INPUT)
    const map = withSound.indexOf('-map')
    assert.deepEqual(withSound.slice(map, map + 6), ['-map', '0:v:0', '-map', '1:a:0', ...codec].slice(0, 6))
    assert.deepEqual(withSound.slice(map + 4, map + 4 + codec.length), codec)
    assert.ok(!withSound.includes('-an'), `${format} keeps its sound`)
    // The mix is the project's length: nothing may end the file early.
    assert.ok(!withSound.includes('-shortest'))
    // The metadata policy is the same with sound.
    const meta = withSound.indexOf('-map_metadata')
    assert.deepEqual(withSound.slice(meta, meta + 4), ['-map_metadata', '-1', '-map_chapters', '-1'])

    const silent = encodeArguments({ ...BASE, format, encoder })
    assert.ok(silent.includes('-an'), `${format} without a mix has no audio stream`)
    assert.ok(!silent.includes('1:a:0'))
    assert.ok(!silent.includes('f32le'))
  }
})

test('a mix and a source audio are not both the sound of one file; a network path is no mix', () => {
  const mix = { file: '/tmp/a.f32' }
  const audio = { file: '/Users/pilot/clip.mp4', startSeconds: 0, codec: 'aac' }
  assert.throws(() => encodeArguments({ ...BASE, format: 'hevc-main10', encoder: 'hevc_videotoolbox', mix, audio }), /cannot both/)
  assert.throws(
    () => encodeArguments({ ...BASE, format: 'hevc-main10', encoder: 'hevc_videotoolbox', mix: { file: '\\\\server\\share\\a.f32' }, platform: 'win32', path: 'C:\\a.mp4' }),
    /UNC/,
  )
})

test('colour arguments follow the tags and drop an unknown field', () => {
  assert.deepEqual(colourArguments(TAGS), TAG_ARGS)
  assert.deepEqual(colourArguments({ matrix: 'unknown', range: 'pc', transfer: 'smpte2084', primaries: 'bt2020' }), [
    '-color_range', 'pc', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084',
  ])
})

test('the encoder is the first of the platform’s list that this FFmpeg has', () => {
  const mac = ['libx265', 'hevc_videotoolbox', 'prores_ks', 'prores_videotoolbox', 'libx264', 'h264_videotoolbox']
  assert.equal(chooseEncoder('hevc-main10', mac, 'darwin'), 'hevc_videotoolbox')
  assert.equal(chooseEncoder('prores-422-hq', mac, 'darwin'), 'prores_videotoolbox')
  assert.equal(chooseEncoder('h264-8bit', mac, 'darwin'), 'h264_videotoolbox')
  assert.equal(chooseEncoder('hevc-main10', ['libx265'], 'darwin'), 'libx265')
  assert.equal(chooseEncoder('prores-422-hq', ['prores_ks', 'prores_videotoolbox'], 'win32'), 'prores_ks')
  assert.equal(chooseEncoder('hevc-main10', ['libx265', 'hevc_amf', 'hevc_qsv', 'hevc_nvenc'], 'win32'), 'hevc_nvenc')
  assert.equal(chooseEncoder('hevc-8bit', ['libx265', 'hevc_amf'], 'win32'), 'hevc_amf')
  assert.equal(chooseEncoder('hevc-main10', [], 'darwin'), null)
  assert.equal(isHardwareEncoder('hevc_nvenc'), true)
  assert.equal(isHardwareEncoder('libx265'), false)
  assert.equal(outputExtension('prores-422-hq'), '.mov')
  assert.equal(outputExtension('hevc-main10'), '.mp4')
})

test('bad input is refused', () => {
  const ok = { ...BASE, format: 'hevc-main10', encoder: 'hevc_videotoolbox' }
  assert.throws(() => encodeArguments({ ...ok, width: 3841 }), /even/)
  assert.throws(() => encodeArguments({ ...ok, height: 0 }), /even/)
  assert.throws(() => encodeArguments({ ...ok, fps: { num: 60000, den: 0 } }), /rate/)
  assert.throws(() => encodeArguments({ ...ok, bitrate: 0 }), /bitrate/)
  assert.throws(() => encodeArguments({ ...ok, frames: 0 }), /frame count/)
  assert.throws(() => encodeArguments({ ...ok, encoder: 'prores_ks' }), /cannot write/)
  assert.throws(() => encodeArguments({ ...ok, format: 'prores-422-hq' }), /cannot write/)
  assert.throws(
    () => encodeArguments({ ...ok, platform: 'win32', path: '\\\\server\\share\\cut.mp4' }),
    /network/,
  )
})
