// AAC sound sync: does an export whose sound goes through the AAC encoder keep the sound with the picture?
//
// Found on 19 Nov 2026: a click track (a flash and a 500 Hz beep every 30 frames) read 0.04 ms between beep and
// flash in its source and 44.0 ms (sound late) after an export that re-encodes the sound, because the file had no
// edit list to skip the encoder's priming. Here the click track is exported through the app at 1x with AAC sound in
// the source (the sound is decoded and re-encoded), at 1x with PCM sound in the source (a control: the same code,
// no AAC decoder in front), and at a constant 4x (the time-stretch path). Each file is read the way FFmpeg reads it:
// the beep onsets in the decoded sound against the first frame of each flash, the audio track's edit list, and the
// durations of the two tracks (reported, not judged). The 4x case needs the bench page to give the linked audio the
// clip's speed (bench/page/main.ts on branch ramp-proof). The clip is generated with FFmpeg into the cache and never committed.
import fs from "node:fs";
import path from "node:path";
import { openBenchPage, startMemorySampler } from "../lib/browser.mjs";
import { run, streamFrames } from "../lib/proc.mjs";
import { describeExport } from "./describe.mjs";

export const name = "aac-sync";

const FRAME_SECONDS = 1001 / 60000;
const PROJECT_FPS = 60000 / 1001;
const SAMPLE_RATE = 48000;
const PERIOD_FRAMES = 30;
const BEEP_FRAMES = 8;
const TONE_HZ = 500;
const CLIP_SECONDS = 12;
const WIDTH = 1280;
const HEIGHT = 720;
/** One AAC frame at 48 kHz: the most the audio and video durations may differ by. */
const AAC_FRAME_SECONDS = 1024 / SAMPLE_RATE;

const CASES = [
  { id: "baseline-1x-pcm-source", pcm: true },
  { id: "baseline-1x-aac-source" },
  { id: "constant-4x-aac-source", speed: 4 },
];

const SETTINGS = {
  codec: "h264",
  quality: "ultra",
  resolution: { width: WIDTH, height: HEIGHT },
  smartCopy: false,
  mode: "video",
  videoContainer: "mp4",
  subtitleMode: "burn",
  renderWholeProject: false,
  rateControl: "variable",
  videoBitrate: 20_000_000,
};

/** Beep onsets (seconds) in a mono signal: the first sample above the threshold after 2 ms of quiet. */
function detectBeeps(samples, sampleRate = SAMPLE_RATE, threshold = 0.08) {
  const quiet = Math.round(sampleRate * 0.002);
  const beeps = [];
  let current = null;
  let lastAbove = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      if (current === null) current = { first: i, last: i };
      current.last = i;
      lastAbove = i;
    } else if (current !== null && i - lastAbove > quiet) {
      beeps.push(current);
      current = null;
    }
  }
  if (current !== null) beeps.push(current);
  return beeps
    .filter((b) => b.last - b.first > sampleRate * 0.004)
    .map((b) => b.first / sampleRate);
}

/** The first frame of each flash: a frame whose mean grey is above `level` after one at or below it. */
function detectFlashes(means, times, level = 128) {
  const onsets = [];
  for (let i = 0; i < means.length; i++) {
    if (means[i] > level && (i === 0 || means[i - 1] <= level))
      onsets.push(times[i]);
  }
  return onsets;
}

/**
 * Pair beeps and flashes in order. At speed s, beep k (source frame 30k) is at output frame 30k/s; a picture changes
 * only on a frame, so the flash shows at the first whole frame at or after it. `offsetMs` is flash minus beep and
 * `deviationMs` the distance from that prediction.
 */
function judge(beeps, flashes, speed) {
  const pairs = Math.min(beeps.length, flashes.length);
  const rows = [];
  for (let k = 0; k < pairs; k++) {
    const audioAt = ((PERIOD_FRAMES * k) / speed) * FRAME_SECONDS;
    const flashAt =
      Math.ceil((PERIOD_FRAMES * k) / speed - 1e-9) * FRAME_SECONDS;
    rows.push({
      beep: k,
      offsetMs: (flashes[k] - beeps[k]) * 1000,
      deviationMs: (flashes[k] - beeps[k] - (flashAt - audioAt)) * 1000,
    });
  }
  const deviations = rows.map((r) => r.deviationMs).sort((a, b) => a - b);
  const median =
    deviations.length === 0 ? 0 : deviations[Math.floor(deviations.length / 2)];
  return {
    paired: pairs,
    beepsFound: beeps.length,
    flashesFound: flashes.length,
    worstDeviationMs: rows.reduce(
      (m, r) => Math.max(m, Math.abs(r.deviationMs)),
      0,
    ),
    medianDeviationMs: median,
    jitterAroundMedianMs: rows.reduce(
      (m, r) => Math.max(m, Math.abs(r.deviationMs - median)),
      0,
    ),
    rows,
  };
}

/** The media_time (in the track's timescale) of the first edit list entry of each track of an MP4, in file order. */
function readEditLists(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lists = [];
  for (let i = 4; i + 28 < bytes.length; i++) {
    if (
      bytes[i] === 0x65 &&
      bytes[i + 1] === 0x6c &&
      bytes[i + 2] === 0x73 &&
      bytes[i + 3] === 0x74
    ) {
      const version = bytes[i + 4];
      const entries = view.getUint32(i + 8);
      const first =
        version === 1
          ? {
              segment: Number(view.getBigUint64(i + 12)),
              mediaTime: Number(view.getBigInt64(i + 20)),
            }
          : {
              segment: view.getUint32(i + 12),
              mediaTime: view.getInt32(i + 16),
            };
      lists.push({ entries, ...first });
    }
  }
  return lists;
}

function ensureClickClip(cache, { pcm = false } = {}) {
  const file = path.join(
    cache,
    `aac-sync-click_${WIDTH}x${HEIGHT}_${CLIP_SECONDS}s${pcm ? "_pcm.mov" : ".mp4"}`,
  );
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(cache, { recursive: true });
  const period = `${PERIOD_FRAMES}*1001/60000`;
  const beep = `${BEEP_FRAMES}*1001/60000`;
  const tone = `0.8*sin(2*PI*${TONE_HZ}*t)*lt(mod(t,${period}),${beep})`;
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${WIDTH}x${HEIGHT}:r=60000/1001:d=${CLIP_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${tone}|${tone}':s=${SAMPLE_RATE}:d=${CLIP_SECONDS}`,
    "-vf",
    `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(n,${PERIOD_FRAMES}),${BEEP_FRAMES})'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "12",
    "-g",
    "30",
    "-pix_fmt",
    "yuv420p",
    ...(pcm ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k"]),
    "-movflags",
    "+faststart",
    file,
  ]);
  return file;
}

function readAudio(file) {
  const raw = run("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-f",
    "f32le",
    "-",
  ]);
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

async function readFlashes(file) {
  const probe = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "json",
      file,
    ]).toString(),
  );
  const times = probe.frames
    .map((f) => Number(f.pts_time))
    .sort((a, b) => a - b);
  const means = [];
  await streamFrames(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:v:0",
      "-vf",
      "scale=32:18",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    32 * 18,
    (buffer) => {
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      means.push(sum / buffer.length);
    },
  );
  return { means, times };
}

function streamFacts(file) {
  const probe = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,start_time,duration,initial_padding,sample_rate",
      "-of",
      "json",
      file,
    ]).toString(),
  );
  return probe.streams;
}

async function judgeFile(file, speed) {
  const beeps = detectBeeps(readAudio(file));
  const { means, times } = await readFlashes(file);
  const flashes = detectFlashes(means, times);
  const streams = streamFacts(file);
  const audio = streams.find((s) => s.codec_type === "audio");
  const video = streams.find((s) => s.codec_type === "video");
  const audioSeconds = Number(audio?.duration);
  const videoSeconds = Number(video?.duration);
  return {
    ...judge(beeps, flashes, speed),
    streams,
    editLists: readEditLists(fs.readFileSync(file)),
    audioMinusVideoSeconds: audioSeconds - videoSeconds,
    durationsWithinOneAacFrame:
      Math.abs(audioSeconds - videoSeconds) <= AAC_FRAME_SECONDS + 1e-6,
  };
}

const round = (value, digits = 2) =>
  typeof value === "number" ? Number(value.toFixed(digits)) : value;

export async function measure(ctx) {
  const { config } = ctx;
  const outDir = path.join(config.cache, "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const cases = [];
  let chromeVersion;
  let gpu;
  for (const spec of CASES) {
    console.log(`   export ${spec.id}`);
    const file = ensureClickClip(config.cache, { pcm: spec.pcm });
    const bench = await openBenchPage({
      cache: config.cache,
      media: { "bench-clip": file },
    });
    try {
      chromeVersion = bench.chromeVersion;
      gpu = bench.gpu;
      await bench.page.evaluate((input) => window.bench.prepare(input), {
        mediaId: "bench-clip",
        mediaUrl: bench.mediaUrl("bench-clip"),
        fileName: path.basename(file),
        project: { width: WIDTH, height: HEIGHT, fps: PROJECT_FPS },
        forceRender: false,
        speed: spec.speed,
        wholeSpans: spec.speed ? true : undefined,
      });
      await bench.page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 1500)),
      );
      const sampler = startMemorySampler(bench.profileDir);
      let record;
      let memory;
      try {
        record = await bench.page.evaluate(
          (settings) => window.bench.runExport(settings),
          SETTINGS,
        );
      } finally {
        memory = sampler.stop();
      }
      const outFile = path.join(outDir, `aac-sync-${spec.id}.mp4`);
      const download = bench.page.waitForEvent("download", {
        timeout: 5 * 60_000,
      });
      await bench.page.evaluate(
        (fileName) => window.bench.download(fileName),
        path.basename(outFile),
      );
      await (await download).saveAs(outFile);
      const judged = await judgeFile(outFile, spec.speed ?? 1);
      const { rows, ...summary } = judged;
      cases.push({
        id: spec.id,
        ...Object.fromEntries(
          Object.entries(summary).map(([k, v]) => [k, round(v, 3)]),
        ),
        rows: rows.map((row) => ({
          ...row,
          offsetMs: round(row.offsetMs),
          deviationMs: round(row.deviationMs),
        })),
        export: describeExport({
          id: spec.id,
          outFile,
          export: record,
          memory,
          pageErrors: [],
        }),
        pageErrors: bench.pageErrors.splice(0).slice(0, 20),
      });
    } finally {
      await bench.close();
    }
  }
  const failures = [];
  for (const c of cases) {
    if (c.id === "baseline-1x-aac-source") {
      if (c.worstDeviationMs >= 5)
        failures.push(
          `${c.id}: worst beep-to-flash deviation ${c.worstDeviationMs} ms, over 5 ms`,
        );
      // Not a failure yet: the audio track still ends 40 ms (two AAC frames) after the video (task report of 19 Nov 2026).
      if (!c.editLists.some((e) => e.mediaTime > 0))
        failures.push(
          `${c.id}: the audio track has no edit list that skips priming`,
        );
    }
  }
  return {
    ...(await ctx.header(name, {})),
    browser: { chromeVersion, webgpuAdapter: gpu },
    parameters: {
      clip: {
        seconds: CLIP_SECONDS,
        size: `${WIDTH}x${HEIGHT}`,
        beepEveryFrames: PERIOD_FRAMES,
        toneHz: TONE_HZ,
      },
    },
    result: { cases },
    ...(failures.length > 0 ? { failure: failures.join("; ") } : {}),
  };
}
