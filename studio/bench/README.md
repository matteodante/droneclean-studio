# DroneClean Studio benchmark kit

The instrument for the engine work (16-bit colour, 10-bit export, exact 59.94 fps, stabilization). One command per
measurement, the same inputs every time, one JSON record per measurement. It measures the editor as it is; it does
not change how the editor renders or exports (nothing under `src/` is touched; the kit's page imports the app's own
export modules).

## Run it

Needs Node 22+, `npm ci` done, Google Chrome, FFmpeg and FFprobe on the PATH, and a real GPU (it refuses a software
WebGPU adapter). Run it on the Mac itself, with nothing else heavy running: other browsers or encoders change the
timings (each record says how busy the machine was at the start).

```sh
npm run bench                   # everything, about 8 minutes
npm run bench:export-speed      # 1. export speed and format
npm run bench:frame-fidelity    # 2. frame fidelity
npm run bench:quality           # 3. PSNR and SSIM
npm run bench:colour            # 4. colour against a 16-bit reference
npm run bench:grey-ramp         # 5. grey levels that survive
node bench/run.mjs import       # 6. linking six 18.4 GB clips, no browser UI needed
node bench/run.mjs import-side-work   # 10. what an import leads to (opt-in, tens of minutes; `all` leaves it out)
node bench/run.mjs ceiling      # 8. FFmpeg alone: the hardware's own decode and encode speed
node bench/run.mjs stage-timings # 9. each stage's time per frame, export and preview
node bench/run.mjs long-export --long-seconds 120   # 11. memory over a long export (opt-in; `all` leaves it out)
node bench/report.mjs           # prints 9 next to 8 and names the slowest stage
npm run bench:test              # the kit's own tests (no browser, no GPU)
npm run bench:check             # type check of the benchmark page
```

Records go to `bench/.cache/results/<measurement>.json` (git ignores it). To write them somewhere else, for example
the committed baseline: `npm run bench -- --out bench/baseline`. Other flags: `--seconds N` (length of the segment of
measurements 1, 3, 4, 5; default 10), `--fidelity-seconds N` (length for measurement 2; default 20).

Each export is its own fresh Chrome. `npm run bench` shares the exports between measurements, so it runs six exports,
not eleven; a single command runs the exports it needs.

### Inputs (never committed)

| What                                        | Default                                                                              | Variable                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| Clip                                        | none: required, a long HEVC clip (the baseline used `DJI_20261115124704_0020_D.MP4`) | `BENCH_CLIP`             |
| Import folder (six clips of 15 Nov)         | the folder of the clip above                                                         | `BENCH_IMPORT_DIR`       |
| LUT                                         | generated into the cache, `bench/.cache/bench-grade.cube` (see below)                | `BENCH_LUT`              |
| Cache (the cut, the ramp, exports, results) | `bench/.cache`                                                                       | `BENCH_CACHE`            |
| Start of the segment, seconds               | 60                                                                                   | `BENCH_START_SECONDS`    |
| Segment length, seconds                     | 10                                                                                   | `BENCH_SEGMENT_SECONDS`  |
| Length for frame fidelity, seconds          | 20                                                                                   | `BENCH_FIDELITY_SECONDS` |
| Custom bitrate, bits per second             | 120000000                                                                            | `BENCH_CUSTOM_BITRATE`   |
| Output frame compared for colour            | 300                                                                                  | `BENCH_COLOUR_FRAME`     |

A missing file stops the run with a message that names it and the variable to set.

- **The segment** is cut once with FFmpeg, no re-encode, video stream only, into the cache. It begins on the first
  keyframe at or after 60 s (60.060 s: a copy cut must start on a keyframe to be decodable from its first frame) and
  holds exactly `round(seconds * 59.94)` frames (599 for 10 s). The record carries the hash of the source, the hash of
  the cut, the hash of its packet stream (independent of the container) and the frame count. The whole 3.76 GB file
  cannot be imported into the headless harness's storage, which is why the kit cuts.
- **The grey ramp** is generated with FFmpeg by `bench/lib/inputs.mjs` (3840x2880, 10-bit HEVC, each row
  holds 877 levels) and checked every time by decoding it. Decoded, the hardware encoder's file holds 877 to 883
  levels in rows 64 and below (it adds a few overshoot values) and fewer in its top 32 rows, which it codes more
  coarsely; the ramp measurement therefore scores rows 64 to 2879 only, and says so.
- **The LUT** is generated by `bench/lib/lut.mjs` at run time into the cache (no LUT file is committed, and no
  one's own LUT is used); `BENCH_LUT` can point at another `.cube` file instead. It is a gentle grade, the same bytes
  every run (the test pins its hash; the record carries the sha256 of the file used). For each channel, with `x` in
  0..1 and the gain `g` = 1.03 (R), 1.00 (G), 0.97 (B), a slight warm shift:
  `out = clamp(g * (x - 0.15 * sin(2 * pi * x) / (2 * pi)), 0, 1)`. The bracket is a mild S-curve (slope 0.85 at the
  ends, 1.15 in the middle), so the slope is at most 1.1845. 33 points per axis, red varying fastest. The colour
  measurement applies it in the editor (turned into the editor's `gpu-lut` parameters, rgba8, 33 points, the way the
  LUT panel stores it) and builds its 16-bit FFmpeg reference (`lut3d`, tetrahedral) from the same file. **The colour
  numbers are not comparable with the baseline recorded with the old LUT until the baseline is re-recorded.**

## How the export is driven

`bench/page/main.ts` is a separate page, built by `bench/page/vite.config.mjs` with the repository's own bundler into
`bench/.cache/page-dist` (a couple of seconds, every run). It builds a one-clip project the way the headless edit
operations do (`addClip`, `addEffect`), imports the clip the way the app does (it copies the file into the browser's
storage, probes it with the app's media processor, gives the renderer a blob URL), then makes the calls that
`use-client-render.ts` makes after it has read the stores:

`mapRequestedClientSettings` → smart-copy check → `resolveClientSettings` (codec probe and fallback) →
`convertTimelineToComposition` → `resolveMediaUrls` → `runRender` (`render-pipeline.ts`).

The settings are what the export dialog would hand over for H.265, MP4, "ultra", Automatic bitrate (and, for the
custom runs, a VBR bitrate of 120 Mbps), at the project's full size of 3840x2880. The project runs at **59.94
(60000/1001)**, the clip's own rate exactly: after task 1.5 a project can hold it, and the exporter is given that
fraction, never the decimal `59.94` (which would become a 1/2997 clock).

Chrome is the installed Google Chrome, launched with the headless harness's own flags (`headless/lib/cli.mjs`: Metal
ANGLE backend, WebGPU enabled) in a persistent profile in a temporary folder, as the app has. The kit uses the
headless static server (`headless/server.mjs`) to serve the page and to hand the clip to the page. It does not use
the headless render command's quality presets (10 and 20 Mbps at most).

### Three things the kit found about the app's path (all recorded in the records)

1. **An untouched clip is copied, not rendered.** When the timeline is one unmodified clip in the export's own codec
   and size, starting at source frame 0, the app copies its packets (`packet-remux-plan.ts`). 10 s then "export" in 0.2
   s, 10-bit, with the source's 59.94 fps, and none of the engine is exercised. The record
   `untouchedClipPacketRemux` shows it. To measure the render, the kit gives the clip a gain of +0.01 dB (the clip has
   no audio, so the picture does not change) which turns the shortcut off. **Since task 1.5 smart copy applies too**:
   a 59.94 project of a 59.94 clip is eligible (`smart-copy.ts`), and smart copy returns the original bytes untouched.
   The kit therefore switches smart copy off for the untouched-clip run, so that the packet remux is what runs, and
   the same record carries the assessment with it on (`untouchedClipSmartCopy`).
2. **The render runs on the main thread, not in the worker.** `runRender` starts the export worker, which refuses any
   composition with a video or audio item because workers have no `OfflineAudioContext`
   (`WORKER_REQUIRES_MAIN_THREAD:audio-context`), and the app falls back to the main thread. Every record says
   `renderPath: "main-thread"` and the reason. (A one-off test with the worker forced on gave the same speed but black
   frames: the worker could not open the blob URL of the clip. So there is no worker result to compare with.)
3. **"Automatic" bitrate ignores the source.** The import records a video's bitrate as 0, so the dialog's
   source-aware Automatic mode never has a source to look at; "ultra" H.265 at 3840x2880 and 59.94 fps asks for the
   formula's 49.9 Mbps.

## The measurements

Every record starts with: `measurement`, `schemaVersion`, `date`, `git` (commit, branch, whether the editor's files
are modified), `machine` (model, chip, memory, OS, GPU names, FFmpeg), `machineBusyAtStart` (load and competing
processes), `browser` (Chrome's version and the WebGPU adapter it reported), `inputs` (paths, hashes, frame counts),
then `parameters` (what was done) and `result` (what was measured).

### 1. `export-speed-and-format`

The segment, untouched, as H.265 MP4 at 3840x2880: with the automatic "ultra" bitrate (`ultraAutoBitrate`) and with a
custom 120 Mbps (`custom120Mbps`); plus the untouched clip with smart copy switched off (`untouchedClipPacketRemux`,
finding 1 above) and the assessment of that same clip with smart copy on (`untouchedClipSmartCopy`). Per run:

- `timing`: `wallSeconds` of `runRender`, `framesPerSecond` (frames over wall time), `steadyFramesPerSecond` (between 20% and 90% of the frames),
  `firstFrameSeconds`, `prepSeconds` (settings, codec probe, composition: before the render starts).
- `memory.peakBrowserGiB`: resident memory (RSS from `ps`) summed over every process of the benchmark's Chrome
  (browser, renderer, GPU, utility), polled every 250 ms during the render only; `baselineBeforeExportGiB` is the same
  sum just before it. RSS counts shared pages in every process, so it is an upper bound; it is the number to compare
  between commits, not an absolute truth.
- `file`: what FFprobe says: codec, profile, pixel format, `bitDepth`, real bitrate (file size over duration), size,
  `frameCount`, declared frame rate, duration, colour tags, and `timestamps` (are the frame timestamps evenly spaced:
  every gap equal, give or take one tick of the container's clock).
- `path`: `renderPath`, `workerFallbackReason`, `packetCopyPlanned`, `smartCopy`.

### 2. `frame-fidelity`

Is every source frame present exactly once, in order? The kit's project and the clip are both **59.94 (60000/1001)**,
so output frame *n* must show source frame *n*: the 20 s cut holds 1,199 frames and the export must hold 1,199 too,
with no repeat and no skip. This is the "done when" of task 1.5 (design 1.5, section 4.5): 1,199 source frames →
1,199 output frames, each once, in order, on a 1/60000 clock with 1,001 ticks per frame, declared `60000/1001`.

Method: the source segment and the export are each decoded by FFmpeg without any frame being added or dropped, and
reduced to 192x144 grey pictures. Each output frame is matched to the source frame with the smallest sum of absolute
differences, searched along the sequence (a repeat, a skip or a step back changes the match; if the sequence jumps,
the whole source is searched). The export is made at 120 Mbps so that encoder noise stays well below the difference
between two frames. Result: `repeatedFrames` and where (`repeated`), `skippedSourceFrames`, `outOfOrderFrames`,
`sourceFramesMissingAtStart/End`, `everySourceFrameExactlyOnceInOrder`, `timestamps` (the container's clock: `timeBase`
and `distinctGapsInTicks`, which must be 1,198 gaps of 1,001 ticks), `declaredFrameRate`, and `doneWhen` (`holds` and,
when it does not, every `problem`), which is the design's requirement read off those facts.

Limits: in a still scene (the drone hovering) two neighbouring source frames are nearly the same picture and the match
cannot tell them apart. Those matches are counted in `ambiguousMatches` and each repeat says `matchWasAmbiguous`. A second opinion that needs no source
(`secondOpinionWithoutSource`: output frames that are nearly identical to the frame before them) is only a hint: it
fires on still scenes too; `listedRepeatsAlsoFoundByIt` says how many of the repeats it confirms.

### 3. `quality`

PSNR and SSIM of the two 10 s exports against the source segment. FFmpeg's `psnr` and `ssim` filters at full size
on all three planes, both sides as 10-bit YUV 4:2:0 (an 8-bit file is scaled by four, exactly, so the unit is the
source's own). Frames are paired by the match of measurement 2 (the first showing of each source frame), so a
repeated output frame does not shift the pairing. `psnrDb.average` is FFmpeg's average over the planes; `y` is luma.

### 4. `colour`

The segment with the LUT applied, exported at 120 Mbps. Output frame 300 is decoded (BT.709 limited, from the file's
tags) to 8-bit RGB and compared with a 16-bit reference made by FFmpeg from the same source frame: 10-bit YUV to 16-bit
RGB with accurate rounding, then `lut3d` with tetrahedral interpolation. The source frame is the closest of the four
neighbours (`sourceFramesTried`), because a still scene can pair ambiguously. Error unit: 8-bit levels,
`|output - reference / 257|`, per channel: mean, signed mean, maximum, 99th and 99.9th percentile over all
11 million pixels. `headline` has the numbers to quote. Two more comparisons tell where the error comes from:

- `pngFromRenderPathWithLut`: the same frame straight from the render path as a PNG, no video encoder after it. This
  is the colour error of the picture the engine computes.
- `exportedFileWithoutLut`: an export with no LUT against a reference with no LUT: what decode, 8-bit RGB, encode and
  4:2:0 cost by themselves.

### 5. `grey-ramp`

An identity project (one clip, no effect) of the 10-bit ramp, exported as H.265 120 Mbps. Frame 10 of the file is
decoded as luma at 10-bit scale with no range or colour conversion, and the distinct values per row are counted
(rows 64 to 2879): `distinctLevelsPerRow.min/median/max`. With the pipeline as it is, an 8-bit file in studio range
can hold at most 220 or 221 levels; the engine work must bring this to 800 or more (`meetsTarget`).

### 6. `import`

The six clips of Sunday 15 Nov 2026 (18.4 GB, HEVC Main 10, 3840x2880), dropped on the media library in one go and
imported through the editor's own drop path (`extractValidMediaFileEntriesFromDataTransfer` then
`useMediaLibraryStore.importHandles`). The files are a real OS-style drop dispatched with the DevTools Protocol
(`Input.dispatchDragEvent` with `data.files`), so `DataTransferItem.getAsFileSystemHandle()` returns real handles to
the footage on disk. The page selects an OPFS directory as its workspace (a native folder picker cannot be
automated), so the folder's footprint is read two ways: the OPFS tree's bytes and `navigator.storage.estimate()`,
plus `du` of the Chrome profile before and after.

Result: `allClipsImported`, `totalSeconds` (drop to all six ready), `perClip` (each service call's duration),
`workspace.growthBytes` and `linkDescriptors`. With linking working the workspace gains only metadata, thumbnails and
one `source.link.json` per clip: `copiedSourceFiles` must be empty, and `meetsTimeLimit` / `meetsGrowthLimit` compare
against the plan's 10 s and 50 MB. Bytes read from the files are not measured: the reads happen inside the media
worker's `BlobSource`, out of the page's reach. This measurement needs no GPU.

### 10. `import-side-work`

What the editor does after the six clips of 15 Nov are imported (task 8.7's "today"). Run on its own, never inside
`all`: it decodes about 20 minutes of 4K footage several times. A first browser imports the six clips through the
drop path of measurement 6, then runs each kind of work **alone**, one after another; a second, fresh browser (empty
caches) starts all kinds **at once** (`together`). Each kind goes through the module the editor uses
(`bench/page/side-work.ts`): `filmstripCache.getFilmstrip` (the full 1 fps filmstrip, what the timeline asks for a
visible clip), `proxyService.generateProxy` (960x540 proxy, what the library's action calls),
`createStabilizationClient().open` (the clip's motion data: the gyro engine reads and smooths the file in a worker).
Filmstrips and proxies start every clip at once and the editor's own queues decide the overlap; motion data goes one
clip after another with an engine each (six engines at once hold about 10 GB). Then clip 0020's engine is opened and
three settings changes are timed (`motionRecompute`: the recompute behind a slider, with no file read).
Probing and thumbnails are inside the import call. **Waveforms: the clips have no audio track** (ffprobe of every
clip and the library's `audioCodec` are in the record), so the editor starts no waveform job.

Result: per phase `seconds`, `perClip` (start, end, seconds, what it reports), and `load` from the machine sampler
for that phase only: `busyCoresMean` / `busyCoresPeak` (overall CPU percent times the core count), cores above 50 %,
GPU busy, the browser's peak memory. `summary` has the serial total (import, then each kind alone), the `together`
total, the longest kind and half of the serial total (the plan's bar for 8.7). The motion phases need the built gyro
package (`gyroflow/wasm/build.sh`); without it they say why and the rest runs. `BENCH_SIDE_WORK_CLIPS=N` limits the
side work to the first N clips, `BENCH_SIDE_WORK_SKIP=proxies,together` leaves phases out (quick tries only).
Not measured: probing and thumbnails apart, audio work, a repeat run.

### 8. `ceiling`

What the hardware does by itself: FFmpeg alone, no browser, on the same 10 s cut of the same clip as the other
measurements. `result.decode` is a hardware decode to a null sink (macOS `videotoolbox`; Windows `cuda`, else
`d3d11va`). `result.encodes` has one entry per hardware encoder: macOS `hevc_videotoolbox` (Main 10, 120 Mbps) and
`prores_videotoolbox` (HQ); Windows `hevc_nvenc` (Main 10), `av1_nvenc` (10-bit), `hevc_qsv`, `hevc_amf`. An encode
includes the hardware decode and the file write, so it is the speed of the whole FFmpeg pipeline, the figure the
editor's export is compared with. Per run: `framesPerSecond` (frames over the wall time of the process, startup
included), `ffmpegReportedFps`, `wallSeconds`, and `sampler` (the machine's load during that run only). An encoder
that is not in the build, or fails (no such hardware), has `ran: false` and the reason; it is never a zero. The
Windows arguments (NVENC, AV1, Quick Sync, AMF) are written from FFmpeg's documentation and have not yet run on a PC.

### 9. `stage-timings`

Where the time of a frame goes. The editor's own stages record User Timing measures named `dc.<stage>`
(`src/studio/render/timings.ts`) only while the page sets `globalThis.__DRONECLEAN_STAGE_TIMINGS__ = true`; with it off
each hook is a property read, so normal runs and every other measurement pay nothing. Four runs of the same cut,
flag on: the export of the plain clip and with the D-Log M input colour stage (the stage pipeline then decodes
through the frame provider and runs the colour pass), and the same two as preview playback (`runPreview` in the page:
the preview-mode renderer asked for 180 consecutive frames back to back; no presenting, no preview pump).
Stages: `decode` (the decoder hands over the frame), `upload` (CPU time of the draw or queued GPU copy),
`stabilize` / `input-colour` / `look` (a source stage's GPU time: with the flag on each is submitted alone and timed
to `onSubmittedWorkDone`), `frame.render` (whole `renderFrame`; **effects and composite** is what is left of it after
the stages above), `readback` (pixels into a sample), `encode` (the encoder takes the sample, backpressure
included), `write` (the muxer's file writes). The first 10 frames are left out. Per stage: `meanPerFrameMs`,
`p95PerFrameMs` (frames without a mark count as zero), `meanPerMarkMs`, `marks`; `slowest` is the highest mean.

`node bench/report.mjs [--dir DIR]` prints each run's table next to the `ceiling` record (FFmpeg's ms per frame)
and names the slowest stage. Caveats: stages overlap in an export (encode and write run behind the next render), so
they add up to more than the real time per frame; with the flag on a run is a measurement, not a speed record; the
`write` p95 is zero because writes come in 4 MB chunks, a few frames in a hundred; stage GPU time is attributed to
the stage submitted, from the gap since the previous completion.

### 12. `motion-blur` and 13. `motion-blur-preview`

The two proofs the hidden `motionBlur` switch waits for (design 7.2, slices E and D). The page (`bench/page/main.ts`)
turns the switch on for itself with `setFeatureOverride`, as the golden kit does, and `prepare` takes three options, all
off by default: `speed` (a constant speed for the clip), `motionBlur` (`{ shutterDegrees }`) and `stabilization` (fields
over the engine's defaults, `enabled` true; for a later slice's proof of a stabilized export). In an export spec
(`lib/exports.mjs`) they are `speed`, `motionBlur`, `stabilization`, plus `countDecodes`.

`motion-blur` (clip at 4x, 360 degrees, the `--fidelity-seconds` segment, 20 s by default, H.265 120 Mbps):
- `decodes`: the chunks given to every `VideoDecoder` during the export (`calls`, `distinctTimestamps`); each source
  frame of the span decoded once means both equal the span.
- `arithmetic`: five output frames rendered through the export renderer; the float accumulator is read through the test
  sink (`src/studio/render/test-sink.ts`) and compared with the same renderer's frames of the source frames the plan
  names (a 90 degree shutter: one bare sample per output frame), averaged in linear light on the CPU with the plan's weights. Both sides share the decoder and the
  source path, so this isolates the gather; it does not compare the source path's colour with FFmpeg's. Differences are
  in levels of 1023 over the three colour channels (`maxDiffLevels`, where it is, a histogram in 1/8 levels).
  The exported file is not compared: 8-bit lossy HEVC cannot be held to one level.
- `rate`: frames per second of the 4x/360 export, the same at 4x with no blur, a plain 1x export, and the baseline
  record's 120 Mbps export.

`motion-blur-preview`: the preview-mode renderer (`runPreviewProbe`) at the usual preview size (1664x1248) and at the
full 3840x2880: 180 frames back to back (what playing asks for; mean, p50/p95/p99, frames over 16.68 ms, `keeps5994`),
and a paused frame (first draw after a jump, and redraws), for the 4x clip with blur on and off and a 1x clip with blur
on; `oneXBlurOnVersusOff` compares the canvases byte for byte (same frame expected) and `fourXBlurOnVersusOff` checks the
blur is drawn at all. Not included: presenting, the pump's scheduling, the interface.

Run each with `zsh ../scripts/heavy.sh --max-gb 7 -- node bench/run.mjs motion-blur` once `run.mjs` registers them.

### 14. `stabilized-export` and 15. `stabilization-controls`

Task 6.4: stabilization proved on footage, and its controls switched on. Both copy the 3.76 GB clip into browser storage,
so they need about 12 GB of free disk, and they write PNGs (frames to look at) to `studio/tmp/`. They are opt-in: `all`
leaves them out. Run each with

```sh
zsh ../scripts/heavy.sh --max-gb 9 -- node bench/run.mjs stabilized-export
zsh ../scripts/heavy.sh --max-gb 9 -- node bench/run.mjs stabilization-controls
```

(`npm run bench:stabilized-export` and `npm run bench:stabilization-controls` are the same commands without the wrapper.)

### 11. `long-export`

Task 3.5: does a long export keep its memory flat, and is the output written as it goes? The six clips of 15 Nov
(`BENCH_IMPORT_DIR`, in file-name order, the order they were flown) are laid end to end on one video track of a
3840x2880, 59.94 fps project and exported through the app's own path (H.265, MP4, "ultra", Automatic bitrate, smart
copy off; each clip has the +0.01 dB gain of the other measurements so that no copy shortcut replaces the render).
Its own page (`bench/page/long-export.html`, module `long-export.ts`) copies the clips into the browser's storage
(as the import does), places them one after the other and calls `runRender`. Run it only by name, and on a Mac
with nothing else heavy running (`scripts/heavy.sh --max-gb 7 -- node bench/run.mjs long-export ...`):

- `--long-seconds N` (or `BENCH_LONG_EXPORT_SECONDS`) exports only the first N seconds of the timeline, and copies
  only the clips that second reaches. Without it the whole timeline (about 20 minutes) is exported.
- `BENCH_MEMORY_LIMIT_GIB` (default 6): the plan's limit.
- `BENCH_KEEP_OUTPUT=1` keeps the downloaded output (`bench/.cache/exports/long-export-<N>s.mp4`); otherwise it is
  deleted after FFprobe has read it.
- The run refuses to start without the disk it needs: the clips it copies, the output twice (the temporary file and
  the blob download of it) and 4 GiB spare.

**It stops safely.** Every 250 ms the measurement reads the newest memory sample (`lib/memory-watch.mjs`: the
resident memory of every process of the benchmark browser, every 500 ms, plus the GPU driver's memory in use on a
Mac). When it is over the limit the page's export is aborted (`AbortController`), the browser is closed if the page
does not answer within a minute, the record is written with `failure` set, and `run.mjs` exits with code 1.

**Flat memory** (`lib/memory-curve.mjs`, tested with fixtures in `bench/test/long-export.test.mjs`): over the second
half of the export (the first half is the warm-up in which pools and rings fill), the least-squares slope of the
browser's memory is at most **25 MiB a minute**, and the peak is under the limit. 25 MiB/min is 500 MiB over the
plan's 20 minutes, inside the room a flat run leaves under 6 GB, and far above the noise of RSS over a minute, so
a stable run is not called growing. A run whose second half is under 30 s or 20 samples is `too-short` and not
flat. `result.memory.judgement` has `startBytes`, `peakBytes` (and when), `endBytes`, `slopeMiBPerMinute`,
`slopeRSquared`, and `projectedBytesAtTarget` (the fitted line carried to 20 minutes when it rises);
`result.memory.perMinute` has min, mean and max per minute; `result.memory.series` is the curve (at most 600
points).

**Written as it goes, or held in memory** (`result.output`): the web export writes through a mediabunny
`StreamTarget` into an OPFS temporary file. Chrome keeps a writer's bytes in a swap file that OPFS does not show until
the writer closes, so the measurement reads the browser's profile folder (`du`, every 2 s) and records its growth since
before the export against the frames done (`points`, with `opfsVisibleBytes` beside it). `growth.verdict`: `streamed`
when at least a quarter of the final size is on disk at the half-way frame, `held-until-end` under 5 %, `partial`
between. `outputKind` is `opfs-file` when the result is backed by the temporary file and `memory-buffer` when the
app fell back to a buffer. `download` is the app's Save step: the blob copied out through the browser (time, the
profile's growth, memory peak): the second copy of the output. `file` is FFprobe's reading of the downloaded file.

Not measured: GPU memory of the browser alone (the driver's figure is for the whole machine; Windows is not read
here), the desktop shell, audio, any codec but H.265, and anything that is not the web export path.

## The machine sampler

During every measurement `run.mjs` samples the machine every 500 ms and writes a summary into the record as
`sampler` (`bench/lib/sampler.mjs`): CPU use per core and overall (mean and peak, from `os.cpus()` deltas), GPU busy
percentage and GPU memory, the encoder and decoder engines of the GPU, and the peak resident memory of the benchmark's
browser by process type. Sources: macOS `ioreg -r -d 1 -c IOAccelerator` ("Device Utilization %", and the driver's
"In use system memory"; macOS shows no media-engine counter without sudo, so encoder and decoder say so); Windows
`nvidia-smi` (NVIDIA only; the first GPU). A source the machine lacks is `{ "available": false, "reason": "..." }`,
never zeros. The sampler's own cost is one `ioreg` call (about 15 ms) or one `nvidia-smi` stream per half second.

## What the kit does not measure

- Preview playback as the user sees it (the interface, presenting, the pump; measurement 9 only calls the preview renderer back to back) and scrubbing, memory of a long export in measurements 1 to 9 (only 10 to 20 s are exported; measurement 10 does it),
  audio, and any codec but H.265 in MP4. Import is measured (6) for linking only, on OPFS as the workspace; copy mode
  and the native desktop shell are not timed.
- Colour of anything but one LUT and one frame; a strong grade, other frames or other footage. Gentle LUTs only.
- Speed on a quiet machine unless the machine was quiet (read `machineBusyAtStart`); a single run per figure, so
  differences of a few percent between two commits are noise. Repeat a run before believing a small change.
- Memory is resident memory of the browser's processes (RSS), not GPU memory and not private memory.
- A matching error in a static scene (see measurement 2), and the playback of the output in other players: colour is
  read with the matrix and range the file's tags state.
- Whether the output plays in other software, hardware decoders' limits, or the file's HDR tags.

## Files

```
bench/run.mjs            the command
bench/page/              the benchmark pages (main.ts for exports, import.ts for the import measurement, side-work.ts
                         for the import side work, long-export.ts for the long export), their
                         build config, their tsconfig
bench/lib/               config, inputs, browser and memory sampler, exports, the analyses, the memory curve
                         (memory-watch.mjs, memory-curve.mjs)
bench/measurements/      the measurements
bench/report.mjs         prints stage timings next to the ceiling
bench/lib/timings.mjs    marks into per-stage statistics
bench/test/              the kit's own tests (node --test)
bench/baseline/          the committed records of the commit named inside them
bench/.cache/            git-ignored: the cut, the ramp, exports, results, the built page
```
