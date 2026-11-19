/**
 * Unit tests of the FFmpeg side of the native media engine (`main/media/ffmpeg.ts`).
 *
 * The command lines are asserted argument by argument: the design fixes them
 * (§4.1 the decode line and its frame count and pixel format, §4.4 the colour
 * conversion), so a change to one of them is a change to the contract with the
 * encoder that must be made on purpose. The probes are parsed from output
 * captured on this Mac (`ffmpeg` 9.0.2, Homebrew).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  binaryName,
  colourMatrix,
  colourPrimaries,
  colourRange,
  colourTransfer,
  decodeArguments,
  deliveredDecodeFormat,
  listedHwaccels,
  listedNames,
  parseCapabilities,
  parseRate,
  parseSourceInfo,
  preferredHardware,
  probeArguments,
  resolveFfmpegLocation,
  stderrTail,
} from '../out/main/media/ffmpeg.js'

const TAGS = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }

/** The conversion design §4.4 fixes: the source's matrix and range, out to full-range BT.709 RGB. */
const CONVERSION =
  'scale=in_range=tv:in_color_matrix=bt709:out_range=pc:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int'

test('the decode line is the design’s, argument for argument', () => {
  assert.deepEqual(
    decodeArguments({
      file: '/Volumes/Media/clip 0020.mp4',
      startSeconds: 60,
      frames: 300,
      format: 'gbrp10le',
      tags: TAGS,
      hardware: 'videotoolbox',
    }),
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-hwaccel',
      'videotoolbox',
      '-protocol_whitelist',
      'file',
      '-ss',
      '60',
      '-i',
      '/Volumes/Media/clip 0020.mp4',
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-frames:v',
      '300',
      '-fps_mode',
      'passthrough',
      '-vf',
      CONVERSION,
      '-pix_fmt',
      'gbrp10le',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
  )
})

test('without hardware, the software decoder and the fallback format still produce a full line', () => {
  assert.deepEqual(
    decodeArguments({
      file: '/media/ramp10.mp4',
      startSeconds: 0,
      frames: 1,
      format: 'rgba64le',
      tags: { matrix: 'smpte170m', range: 'pc', transfer: 'smpte170m', primaries: 'smpte170m' },
      hardware: null,
    }),
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-ss',
      '0',
      '-i',
      '/media/ramp10.mp4',
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-frames:v',
      '1',
      '-fps_mode',
      'passthrough',
      '-vf',
      'scale=in_range=pc:in_color_matrix=smpte170m:out_range=pc:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int',
      '-pix_fmt',
      'rgba64le',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
  )
})

test('p010le is the decoder’s own planes: no filter at all, the GPU converts them (design 3.6 section 2.16)', () => {
  const line = decodeArguments({
    file: '/Volumes/Media/clip 0020.mp4',
    startSeconds: 60,
    frames: 300,
    format: 'p010le',
    tags: TAGS,
    hardware: 'videotoolbox',
  })
  assert.equal(line.includes('-vf'), false)
  assert.deepEqual(line.slice(-7), ['-fps_mode', 'passthrough', '-pix_fmt', 'p010le', '-f', 'rawvideo', 'pipe:1'])
})

test('a decode delivers p010le only for a source it carries whole, and gbrp10le otherwise', () => {
  const source = (pixelFormat, colour = {}) => ({ pixelFormat, colour: { ...TAGS, ...colour } })
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p10le')), 'p010le')
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p')), 'p010le')
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p10le', { matrix: 'unknown', range: 'unknown' })), 'p010le')
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p10le', { matrix: 'smpte170m' })), 'p010le')
  // 4:2:2 would lose chroma, 12 bits would lose bits, an unknown format is not guessed.
  assert.equal(deliveredDecodeFormat('p010le', source('yuv422p10le')), 'gbrp10le')
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p12le')), 'gbrp10le')
  assert.equal(deliveredDecodeFormat('p010le', source('')), 'gbrp10le')
  // Full range and BT.2020 are FFmpeg's to convert.
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p10le', { range: 'pc' })), 'gbrp10le')
  assert.equal(deliveredDecodeFormat('p010le', source('yuv420p10le', { matrix: 'bt2020nc' })), 'gbrp10le')
  // A page that asks for gbrp10le gets it.
  assert.equal(deliveredDecodeFormat('gbrp10le', source('yuv420p10le')), 'gbrp10le')
})

test('the decode refuses a start or a frame count it cannot mean', () => {
  const decode = (overrides) =>
    decodeArguments({
      file: '/media/clip.mp4',
      startSeconds: 0,
      frames: 1,
      format: 'gbrp10le',
      tags: TAGS,
      hardware: null,
      ...overrides,
    })
  assert.throws(() => decode({ startSeconds: -1 }), /the start must be a time in seconds, got -1/)
  assert.throws(() => decode({ startSeconds: Number.NaN }), /the start must be a time/)
  assert.throws(() => decode({ frames: 0 }), /the frame count must be a positive integer, got 0/)
  assert.throws(() => decode({ frames: 1.5 }), /the frame count must be a positive integer/)
})

test('ffprobe is asked for exactly one video stream’s size, rate and colour', () => {
  assert.deepEqual(probeArguments('/media/clip.mp4'), [
    '-v',
    'error',
    '-protocol_whitelist',
    'file',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,pix_fmt,avg_frame_rate,r_frame_rate,color_range,color_space,color_transfer,color_primaries',
    '-of',
    'json',
    '/media/clip.mp4',
  ])
})

test('clip 0020’s probe is the reply’s size, exact rate and colour', () => {
  // Captured from `ffprobe` on DJI_20261115124704_0020_D.MP4 (HEVC Main 10, 3840x2880, 59.94).
  const info = parseSourceInfo(
    JSON.stringify({
      programs: [],
      stream_groups: [],
      streams: [
        {
          width: 3840,
          height: 2880,
          pix_fmt: 'yuv420p10le',
          color_range: 'tv',
          color_space: 'bt709',
          color_transfer: 'bt709',
          color_primaries: 'bt709',
          r_frame_rate: '60000/1001',
          avg_frame_rate: '60000/1001',
        },
      ],
    }),
  )
  assert.deepEqual(info, {
    width: 3840,
    height: 2880,
    pixelFormat: 'yuv420p10le',
    rate: { num: 60000, den: 1001 },
    colour: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
  })
})

test('a source without colour tags reports unknown, which the contract reads as BT.709', () => {
  const info = parseSourceInfo(
    JSON.stringify({ streams: [{ width: 1920, height: 1080, r_frame_rate: '30/1' }] }),
  )
  assert.deepEqual(info.colour, {
    matrix: 'unknown',
    range: 'unknown',
    transfer: 'unknown',
    primaries: 'unknown',
  })
  assert.deepEqual(info.rate, { num: 30, den: 1 })
})

test('the rate falls back to r_frame_rate, and a stream without one is refused', () => {
  const info = parseSourceInfo(
    JSON.stringify({
      streams: [{ width: 4, height: 4, avg_frame_rate: '0/0', r_frame_rate: '25/1' }],
    }),
  )
  assert.deepEqual(info.rate, { num: 25, den: 1 })
  assert.throws(
    () => parseSourceInfo(JSON.stringify({ streams: [{ width: 4, height: 4 }] })),
    /no usable frame rate/,
  )
  assert.throws(() => parseSourceInfo(JSON.stringify({ streams: [] })), /no video stream/)
  assert.throws(() => parseSourceInfo('not json'), /not JSON/)
  assert.throws(
    () => parseSourceInfo(JSON.stringify({ streams: [{ width: 0, height: 4 }] })),
    /without a size/,
  )
})

test('an exact rate is a reduced ratio, never a decimal', () => {
  assert.deepEqual(parseRate('60000/1001'), { num: 60000, den: 1001 })
  assert.deepEqual(parseRate('120000/2002'), { num: 60000, den: 1001 })
  assert.deepEqual(parseRate('30/1'), { num: 30, den: 1 })
  assert.equal(parseRate('0/0'), null)
  assert.equal(parseRate('29.97'), null)
  assert.equal(parseRate(''), null)
})

test('FFmpeg’s colour names become the contract’s, and anything else is unknown', () => {
  assert.equal(colourMatrix('bt709'), 'bt709')
  assert.equal(colourMatrix('bt2020nc'), 'bt2020nc')
  assert.equal(colourMatrix('bt470bg'), 'bt470bg')
  assert.equal(colourMatrix('smpte432'), 'unknown')
  assert.equal(colourRange('tv'), 'tv')
  assert.equal(colourRange('pc'), 'pc')
  assert.equal(colourRange('unknown'), 'unknown')
  assert.equal(colourTransfer('smpte2084'), 'smpte2084')
  assert.equal(colourTransfer('bt2020-10'), 'bt2020-10')
  assert.equal(colourTransfer('iec61966-2-1'), 'unknown')
  assert.equal(colourPrimaries('bt2020'), 'bt2020')
  assert.equal(colourPrimaries('film'), 'unknown')
})

test('hardware decode is VideoToolbox on macOS and D3D11VA elsewhere', () => {
  assert.equal(preferredHardware(['videotoolbox', 'd3d11va'], 'darwin'), 'videotoolbox')
  assert.equal(preferredHardware(['videotoolbox'], 'win32'), null)
  assert.equal(preferredHardware(['d3d11va'], 'win32'), 'd3d11va')
  assert.equal(preferredHardware([], 'darwin'), null)
})

test('the capability lists are read by their flags column', () => {
  assert.deepEqual(
    listedNames(
      [
        ' V....D av1                  Alliance for Open Media AV1',
        ' VFS..D h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
        ' VFS..D hevc                 HEVC (High Efficiency Video Coding)',
        ' VF..BD mpeg4                MPEG-4 part 2',
        ' VFS..D prores               Apple ProRes (iCodec Pro)',
        ' VFS..D vp9                  Google VP9',
      ].join('\n'),
    ),
    ['av1', 'h264', 'hevc', 'mpeg4', 'prores', 'vp9'],
  )
  assert.deepEqual(
    listedHwaccels(['Hardware acceleration methods:', 'videotoolbox', ''].join('\n')),
    ['videotoolbox'],
  )
})

test('this Mac’s FFmpeg lists the four formats and the decoder the design needs', () => {
  // Captured from `ffmpeg -hide_banner -version/-decoders/-encoders/-hwaccels` on 9.0.2.
  const capabilities = parseCapabilities({
    version:
      'ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with Apple clang version 21.0.0 (clang-2100.3.34.2)',
    decoders: [
      ' V....D av1                  Alliance for Open Media AV1',
      ' VFS..D h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
      ' VFS..D hevc                 HEVC (High Efficiency Video Coding)',
      ' VF..BD mpeg4                MPEG-4 part 2',
      ' VFS..D prores               Apple ProRes (iCodec Pro)',
    ].join('\n'),
    encoders: [
      ' V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)',
      ' V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)',
      ' V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)',
      ' V....D libx265              libx265 H.265 / HEVC (codec hevc)',
      ' V....D hevc_videotoolbox    VideoToolbox H.265 Encoder (codec hevc)',
      ' VFS... prores_ks            Apple ProRes (iCodec Pro) (codec prores)',
      ' V....D prores_videotoolbox  VideoToolbox ProRes Encoder (codec prores)',
    ].join('\n'),
    hwaccels: 'Hardware acceleration methods:\nvideotoolbox\n',
  })

  assert.equal(capabilities.available, true)
  assert.equal(capabilities.version, 'ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers')
  assert.deepEqual(capabilities.decoders, ['av1', 'h264', 'hevc', 'prores'])
  assert.deepEqual(capabilities.encoders, [
    'libx264',
    'h264_videotoolbox',
    'libx265',
    'hevc_videotoolbox',
    'prores_ks',
    'prores_videotoolbox',
  ])
  assert.deepEqual(capabilities.hardware, ['videotoolbox'])
  assert.deepEqual(capabilities.inputFormats, ['p010le', 'gbrp10le', 'rgba64le'])
  assert.deepEqual(capabilities.outputFormats, ['p010le', 'rgba64le'])
  assert.deepEqual(capabilities.exportFormats, [
    'hevc-main10',
    'prores-422-hq',
    'h264-8bit',
    'hevc-8bit',
  ])
  assert.equal(capabilities.message, null)
})

test('a build without a 10-bit HEVC decoder says so rather than offering the formats', () => {
  const capabilities = parseCapabilities({
    version: 'ffmpeg version 7.1',
    decoders: [' VFS..D h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10'].join('\n'),
    encoders: [
      ' V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)',
    ].join('\n'),
    hwaccels: 'Hardware acceleration methods:\n',
  })
  assert.deepEqual(capabilities.exportFormats, ['h264-8bit'])
  assert.deepEqual(capabilities.hardware, [])
  assert.equal(capabilities.message, 'the decoder lacks hevc, prores, av1')
})

test('the binary is DRONECLEAN_FFMPEG, then the bundle, then PATH', () => {
  const resolve = (env, resourcesPath, executable) =>
    resolveFfmpegLocation({
      env,
      resourcesPath,
      platform: 'darwin',
      isExecutable: (candidate) => executable.includes(candidate),
    })

  // The env var wins over everything, and its ffprobe must sit beside it.
  assert.deepEqual(
    resolve(
      { DRONECLEAN_FFMPEG: '/opt/homebrew/bin/ffmpeg', PATH: '/usr/bin' },
      '/Applications/DroneClean Studio.app/Contents/Resources',
      ['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'],
    ),
    { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' },
  )

  // A packaged app's own build, when the env var is not set.
  assert.deepEqual(
    resolve(
      { PATH: '/usr/bin' },
      '/Applications/DroneClean Studio.app/Contents/Resources',
      [
        '/Applications/DroneClean Studio.app/Contents/Resources/ffmpeg/ffmpeg',
        '/Applications/DroneClean Studio.app/Contents/Resources/ffmpeg/ffprobe',
      ],
    ),
    {
      ffmpeg: '/Applications/DroneClean Studio.app/Contents/Resources/ffmpeg/ffmpeg',
      ffprobe: '/Applications/DroneClean Studio.app/Contents/Resources/ffmpeg/ffprobe',
    },
  )

  // A development run: the PATH entry, which is /opt/homebrew/bin on this Mac.
  assert.deepEqual(
    resolve(
      { PATH: '/usr/bin:/opt/homebrew/bin' },
      '/Users/me/src/studio/desktop/node_modules/electron/dist/Electron.app/Contents/Resources',
      ['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'],
    ),
    { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' },
  )

  // Nothing there, or an ffmpeg without its ffprobe: not available, never a guess.
  assert.equal(resolve({ PATH: '/usr/bin' }, undefined, []), null)
  assert.equal(resolve({ DRONECLEAN_FFMPEG: '/opt/homebrew/bin/ffmpeg' }, undefined, []), null)
  assert.equal(binaryName('ffmpeg', 'win32'), 'ffmpeg.exe')
  assert.equal(binaryName('ffprobe', 'darwin'), 'ffprobe')
})

test('an error keeps the last twenty log lines and no empties', () => {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`)
  const tail = stderrTail([...lines, '', '  '].join('\n'))
  assert.equal(tail.length, 20)
  assert.equal(tail.at(0), 'line 10')
  assert.equal(tail.at(-1), 'line 29')
})

test('R7: FFmpeg and ffprobe may read only files, never a URL or a protocol', () => {
  const args = decodeArguments({
    file: '/media/a.mp4',
    startSeconds: 0,
    frames: 1,
    format: 'gbrp10le',
    tags: TAGS,
    hardware: null,
  })
  assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file')
  assert.ok(args.indexOf('-protocol_whitelist') < args.indexOf('-i'))
  const probe = probeArguments('/media/a.mp4')
  assert.equal(probe[probe.indexOf('-protocol_whitelist') + 1], 'file')
})

test('D9: a Windows UNC or device path never reaches FFmpeg', () => {
  const decode = (file) =>
    decodeArguments({
      file,
      startSeconds: 0,
      frames: 1,
      format: 'gbrp10le',
      tags: TAGS,
      hardware: null,
      platform: 'win32',
    })
  for (const file of ['\\\\server\\share\\a.mp4', '//server/share/a.mp4', '\\\\?\\UNC\\server\\share\\a.mp4', '\\\\.\\pipe\\x']) {
    assert.throws(() => decode(file), /network|UNC|device path/i, file)
    assert.throws(() => probeArguments(file, 'win32'), /network|UNC|device path/i, file)
  }
  assert.doesNotThrow(() => decode('C:\\Footage\\a.mp4'))
})

test('D5: a packaged app does not take its FFmpeg from DRONECLEAN_FFMPEG', () => {
  const executable = ['/tmp/evil/ffmpeg', '/tmp/evil/ffprobe', '/res/ffmpeg/ffmpeg', '/res/ffmpeg/ffprobe']
  const resolve = (allowEnvOverride) =>
    resolveFfmpegLocation({
      env: { DRONECLEAN_FFMPEG: '/tmp/evil/ffmpeg', PATH: '' },
      resourcesPath: '/res',
      platform: 'darwin',
      isExecutable: (candidate) => executable.includes(candidate),
      allowEnvOverride,
    })
  assert.deepEqual(resolve(true), { ffmpeg: '/tmp/evil/ffmpeg', ffprobe: '/tmp/evil/ffprobe' })
  assert.deepEqual(resolve(false), { ffmpeg: '/res/ffmpeg/ffmpeg', ffprobe: '/res/ffmpeg/ffprobe' })
})
