// 7b. Speed ramp, sound: does the exported sound stay in step with the picture through a 1x -> 4x -> 1x ramp?
//
// The flight clips have no audio (design 7.1, section 2), so the test clip is generated: black frames with a white
// flash on source frames 30k .. 30k+7, and on the same instants a 500 Hz beep of the same length, so that each
// beep starts on its flash's first frame (a click track made by FFmpeg into the cache, never committed). The clip is
// exported through the app (with AAC sound in the source, as a camera's, and again with PCM sound) with the design's ramp, with a slower ramp (150 frames up, 300 held, 150 down: long
// enough that beeps fall inside the ramps), and at a constant 4x. In each export every beep's onset and every
// flash's first frame is found; the two are paired and their offset is compared with what the curve predicts.
//
// What the numbers mean. A picture can change only on a frame, so the first output frame that shows a flash source
// frame comes 0 to 1 frame after the instant the curve puts that source frame at; the audio onset is exact to
// the sample. A correct export therefore shows an offset (flash minus beep) between 0 and one frame, equal to the
// predicted one; `worstOffsetMs` is judged against one frame (16.68 ms at 59.94), and `worstDeviationMs` is the
// distance from the prediction. The source file is measured the same way as a control (its offset is 0 up to one
// frame of the encoder's own priming). Pitch: the mean frequency of each beep (positive-going zero crossings
// between its first and last), against 500 Hz times the speed the curve puts over the beep's span.
import fs from 'node:fs'
import path from 'node:path'
import { openBenchPage } from '../lib/browser.mjs'
import { run, streamFrames } from '../lib/proc.mjs'
import { describeExport } from './describe.mjs'
import { curveArea, exportOnPage, frameAtArea, PROJECT_FPS, shownSourceFrame } from './ramp-support.mjs'

export const name = 'speed-ramp-audio'

const FRAME_SECONDS = 1001 / 60000
const SAMPLE_RATE = 48000
/** The click track: a beep and a flash every 30 frames, each 8 frames long, the beep a 500 Hz sine. */
const PERIOD_FRAMES = 30
const BEEP_FRAMES = 8
const TONE_HZ = 500
const CLIP_SECONDS = 40
const WIDTH = 1280
const HEIGHT = 720

/** The design's ramp (7.1 section 5.2), a slow one, and a constant 4x. The slow ramp consumes 1,950 source frames. */
const CASES = [
  {
    id: 'design-ramp',
    keys: [
      { frame: 0, speed: 1 },
      { frame: 30, speed: 4 },
      { frame: 570, speed: 4 },
      { frame: 600, speed: 1 },
    ],
  },
  {
    id: 'slow-ramp',
    keys: [
      { frame: 0, speed: 1 },
      { frame: 150, speed: 4 },
      { frame: 450, speed: 4 },
      { frame: 600, speed: 1 },
    ],
  },
  { id: 'constant-4x', constant: 4, keys: [{ frame: 0, speed: 4 }, { frame: 480, speed: 4 }] },
  // The same three with PCM sound in the source: no AAC decoder in the way, so what is left is the speed code's own timing
  { id: 'design-ramp-pcm-source', pcm: true, keys: [{ frame: 0, speed: 1 }, { frame: 30, speed: 4 }, { frame: 570, speed: 4 }, { frame: 600, speed: 1 }] },
  { id: 'slow-ramp-pcm-source', pcm: true, keys: [{ frame: 0, speed: 1 }, { frame: 150, speed: 4 }, { frame: 450, speed: 4 }, { frame: 600, speed: 1 }] },
  { id: 'constant-4x-pcm-source', pcm: true, constant: 4, keys: [{ frame: 0, speed: 4 }, { frame: 480, speed: 4 }] },
  // Baselines at speed 1 (the first 600 source frames, no curve): what an export does to the sound's timing with no ramp
  // in it, from a source with AAC sound and from one with PCM sound (no decoder priming on the way in).
  { id: 'baseline-1x-aac-source', window: 600, keys: [{ frame: 0, speed: 1 }, { frame: 600, speed: 1 }] },
  { id: 'baseline-1x-pcm-source', window: 600, pcm: true, keys: [{ frame: 0, speed: 1 }, { frame: 600, speed: 1 }] },
]

const SETTINGS = {
  codec: 'h264',
  quality: 'ultra',
  resolution: { width: WIDTH, height: HEIGHT },
  smartCopy: false,
  mode: 'video',
  videoContainer: 'mp4',
  subtitleMode: 'burn',
  renderWholeProject: false,
  rateControl: 'variable',
  videoBitrate: 20_000_000,
}

// ---- analysis (plain numbers; tested in bench/test/speed-ramp-audio.test.mjs) ----

/**
 * The beeps in a mono signal: the regions where the 2 ms moving maximum of |x| is above `threshold`. Each has its onset
 * (the first sample above the threshold, as seconds), its end (the last), and the mean frequency over it from the
 * positive-going zero crossings between the first and the last.
 *
 * @param {Float32Array} samples
 */
export function detectBeeps(samples, sampleRate = SAMPLE_RATE, { threshold = 0.08 } = {}) {
  const window = Math.round(sampleRate * 0.002)
  const beeps = []
  let current = null
  let lastAbove = -Infinity
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      if (current === null) current = { first: i, last: i, crossings: [] }
      current.last = i
      lastAbove = i
    } else if (current !== null && i - lastAbove > window) {
      beeps.push(current)
      current = null
    }
    if (current !== null && i > 0 && samples[i - 1] <= 0 && samples[i] > 0) current.crossings.push(i)
  }
  if (current !== null) beeps.push(current)
  return beeps
    .filter((beep) => beep.last - beep.first > sampleRate * 0.004)
    .map((beep) => {
      const inside = beep.crossings.filter((c) => c >= beep.first && c <= beep.last)
      const span = inside.length > 1 ? (inside[inside.length - 1] - inside[0]) / sampleRate : 0
      return {
        onset: beep.first / sampleRate,
        end: beep.last / sampleRate,
        hz: span > 0 ? (inside.length - 1) / span : null,
      }
    })
}

/**
 * The first frame of each flash: a frame whose mean grey is above `level` after one at or below it.
 *
 * @param {number[]} means mean grey of each decoded frame, in order
 * @param {number[]} times presentation time of each frame, seconds
 */
export function detectFlashes(means, times, { level = 128 } = {}) {
  const onsets = []
  for (let i = 0; i < means.length; i++) {
    if (means[i] > level && (i === 0 || means[i - 1] <= level)) onsets.push({ frame: i, time: times[i] })
  }
  return onsets
}

/**
 * Pair beeps and flashes in order and compare with the curve. `keys` is the curve (frames at the project rate; source
 * and project rates are equal). Beep k sits at source frame `k * period`; the prediction for the audio is the instant
 * the curve reaches it, for the picture the first output frame that shows a source frame of the flash.
 */
export function judgeSync(beeps, flashes, keys, { period = PERIOD_FRAMES, beepFrames = BEEP_FRAMES, tone = TONE_HZ } = {}) {
  const pairs = Math.min(beeps.length, flashes.length)
  const rows = []
  for (let k = 0; k < pairs; k++) {
    const sourceFrame = k * period
    const audioAt = frameAtArea(keys, sourceFrame) * FRAME_SECONDS
    let frame = Math.ceil(frameAtArea(keys, sourceFrame))
    while (shownSourceFrame(keys, frame) < sourceFrame) frame++
    while (frame > 0 && shownSourceFrame(keys, frame - 1) >= sourceFrame) frame--
    const flashAt = frame * FRAME_SECONDS
    const spanSeconds = (frameAtArea(keys, sourceFrame + beepFrames) - frameAtArea(keys, sourceFrame)) * FRAME_SECONDS
    const expectedHz = (tone * beepFrames * FRAME_SECONDS) / spanSeconds
    const offset = flashes[k].time - beeps[k].onset
    const predictedOffset = flashAt - audioAt
    rows.push({
      beep: k,
      sourceFrame,
      beepAt: beeps[k].onset,
      flashAt: flashes[k].time,
      offsetMs: offset * 1000,
      predictedOffsetMs: predictedOffset * 1000,
      deviationMs: (offset - predictedOffset) * 1000,
      hz: beeps[k].hz,
      expectedHz,
      hzRatio: beeps[k].hz === null ? null : beeps[k].hz / expectedHz,
    })
  }
  const frameMs = FRAME_SECONDS * 1000
  const worst = (pick) => rows.reduce((m, row) => Math.max(m, Math.abs(pick(row))), 0)
  // A constant lag (the encoder's own delay, say) is told from a drift: the median deviation, and how far each beep strays from it
  const sorted = rows.map((row) => row.deviationMs).sort((a, b) => a - b)
  const medianDeviationMs = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
  const jitterMs = worst((row) => row.deviationMs - medianDeviationMs)
  return {
    medianDeviationMs,
    jitterAroundMedianMs: jitterMs,
    beepsFound: beeps.length,
    flashesFound: flashes.length,
    paired: pairs,
    frameMs,
    worstOffsetMs: worst((row) => row.offsetMs),
    worstDeviationMs: worst((row) => row.deviationMs),
    minOffsetMs: Math.min(...rows.map((row) => row.offsetMs)),
    maxOffsetMs: Math.max(...rows.map((row) => row.offsetMs)),
    withinOneFrame: pairs > 0 && worst((row) => row.offsetMs) < frameMs,
    rows,
  }
}

// ---- the click-track clip, and reading an export ----

/** Makes (once, in the cache) the click-track clip; returns its path. */
function ensureClickClip(cache, { pcm = false } = {}) {
  const file = path.join(cache, `click-track_${WIDTH}x${HEIGHT}_${CLIP_SECONDS}s${pcm ? '_pcm.mov' : '.mp4'}`)
  if (fs.existsSync(file)) return file
  fs.mkdirSync(cache, { recursive: true })
  const period = `${PERIOD_FRAMES}*1001/60000`
  const beep = `${BEEP_FRAMES}*1001/60000`
  const tone = `0.8*sin(2*PI*${TONE_HZ}*t)*lt(mod(t,${period}),${beep})`
  run('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=60000/1001:d=${CLIP_SECONDS}`,
    '-f', 'lavfi', '-i', `aevalsrc='${tone}|${tone}':s=${SAMPLE_RATE}:d=${CLIP_SECONDS}`,
    '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(n,${PERIOD_FRAMES}),${BEEP_FRAMES})'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-g', '30', '-pix_fmt', 'yuv420p',
    ...(pcm ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k']),
    '-movflags', '+faststart',
    file,
  ])
  return file
}

/** Mono 48 kHz samples of a file's first audio stream, and the stream's own facts. */
function readAudio(file) {
  const raw = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'])
  const copy = new Uint8Array(raw.byteLength)
  copy.set(raw)
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))
}

/** The mean grey of every frame (a 32x18 picture), with each frame's presentation time. */
async function readFlashes(file) {
  const probe = JSON.parse(
    run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time,pkt_pts_time,best_effort_timestamp_time', '-of', 'json', file]).toString(),
  )
  const times = probe.frames
    .map((f) => Number(f.pts_time ?? f.best_effort_timestamp_time ?? f.pkt_pts_time))
    .sort((a, b) => a - b)
  const means = []
  await streamFrames(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-map', '0:v:0', '-fps_mode', 'passthrough', '-vf', 'scale=32:18:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    32 * 18,
    (buffer) => {
      let sum = 0
      for (let i = 0; i < buffer.length; i++) sum += buffer[i]
      means.push(sum / buffer.length)
    },
  )
  if (means.length !== times.length) throw new Error(`${file}: ${means.length} frames decoded, ${times.length} timestamps`)
  return { means, times }
}

function streamStarts(file) {
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,start_time,duration,sample_rate,channels', '-of', 'json', file]).toString())
  return probe.streams
}

/** Beeps and flashes of a file, judged against `keys` (the source file's own: the identity curve). */
async function judgeFile(file, keys) {
  const beeps = detectBeeps(readAudio(file))
  const { means, times } = await readFlashes(file)
  const flashes = detectFlashes(means, times)
  return { ...judgeSync(beeps, flashes, keys), streams: streamStarts(file), frames: means.length }
}

const round = (value, digits = 2) => (value === null ? null : Number(value.toFixed(digits)))

/** A judgement without its per-beep rows, rounded, for the summary line of a record. */
function summarise(judged) {
  const { rows, ...rest } = judged
  return {
    ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'number' ? round(v, 3) : v])),
    worstPitchRatioError: round(rows.filter((r) => r.hzRatio !== null).reduce((m, r) => Math.max(m, Math.abs(r.hzRatio - 1)), 0), 4),
  }
}

export async function measure(ctx) {
  const { config } = ctx
  const clip = ensureClickClip(config.cache)
  const pcmClip = ensureClickClip(config.cache, { pcm: true })
  const source = await judgeFile(clip, [{ frame: 0, speed: 1 }, { frame: 2400, speed: 1 }])
  const media = { 'bench-clip': clip }
  const cases = []
  const outDir = path.join(config.cache, 'exports')
  let chromeVersion
  let gpu
  for (const spec of CASES) {
    console.log(`   export ${spec.id}`)
    const file = spec.pcm ? pcmClip : clip
    // A page of its own per case: the media of a page is its own, and a case must not inherit another's clip
    const bench = await openBenchPage({ cache: config.cache, media: { ...media, 'bench-clip': file } })
    try {
      chromeVersion = bench.chromeVersion
      gpu = bench.gpu
      const exported = await exportOnPage(
        bench,
        {
          id: `speed-ramp-audio-${spec.id}`,
          mediaFile: file,
          project: { width: WIDTH, height: HEIGHT, fps: PROJECT_FPS },
          settings: SETTINGS,
          ...(spec.constant ? { speed: spec.constant, wholeSpans: true } : {}),
          ...(spec.window ? { sourceWindow: { startFrame: 0, frames: spec.window } } : {}),
          ...(spec.keys.length > 1 && !spec.constant && !spec.window ? { speedCurve: { keys: spec.keys } } : {}),
        },
        outDir,
      )
      const frames = exported.export.frames
      const keys = spec.constant ? [{ frame: 0, speed: spec.constant }, { frame: frames, speed: spec.constant }] : spec.keys
      const judged = await judgeFile(exported.outFile, keys)
      cases.push({
        id: spec.id,
        keys,
        outputFrames: frames,
        audioStream: judged.streams.find((s) => s.codec_type === 'audio') ?? null,
        ...summarise(judged),
        rows: judged.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? round(v, 3) : v]))),
        export: describeExport(exported),
        pageErrors: exported.pageErrors,
      })
    } finally {
      await bench.close()
    }
  }
  const failures = []
  for (const c of cases) {
    if (!c.audioStream) failures.push(`${c.id}: the export has no audio stream`)
    else if (!c.withinOneFrame) failures.push(`${c.id}: the worst offset is ${c.worstOffsetMs.toFixed(1)} ms (a constant ${c.medianDeviationMs.toFixed(1)} ms, then up to ${c.jitterAroundMedianMs.toFixed(1)} ms of drift around it), over one frame`)
  }
  return {
    ...(await ctx.header(name, {})),
    browser: { chromeVersion, webgpuAdapter: gpu },
    parameters: {
      clip: { file: path.basename(clip), seconds: CLIP_SECONDS, size: `${WIDTH}x${HEIGHT}`, beepEveryFrames: PERIOD_FRAMES, beepFrames: BEEP_FRAMES, toneHz: TONE_HZ },
      exportSettings: `H.264 MP4, ${SETTINGS.videoBitrate / 1e6} Mbps, ${WIDTH}x${HEIGHT}, project ${PROJECT_FPS} fps`,
      method: 'onsets of the beeps (2 ms moving maximum above 0.08) paired in order with the first frame of each flash (mean grey above 128); offset = flash time minus beep time; predicted offset from the curve, in plain arithmetic independent of the app (ramp-support.mjs); medianDeviationMs is the constant part of the sound\'s lag, jitterAroundMedianMs the drift around it',
    },
    source: summarise(source),
    result: { cases },
    ...(failures.length > 0 ? { failure: failures.join('; ') } : {}),
  }
}
