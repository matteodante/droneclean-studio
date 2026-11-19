# The module's picture against desktop Gyroflow (task 6.2)

Gyroflow's engine as WebAssembly (task 6.1) computes each frame's stabilization and can warp a frame on the CPU. This
check holds that warp to what the Gyroflow application renders: five frames of clip 0020, the app's default settings
on both sides, 8-bit lossless PNGs from the app against the module's warp of the same source frames.

**They agree at 47.41 dB or more, on every frame** (the task's line is 38 dB), with a structural similarity (SSIM) of
0.9944 or more. The module's frame for each timestamp is the app's frame, and moving either picture by half a pixel
makes the agreement worse, so the two are aligned.

| Frame | Trim (frames either side) | PSNR, overall | PSNR r / g / b | SSIM | The module's frame against the app's N−1, N, N+1 |
|---|---|---|---|---|---|
| 1000 | 60 | **48.115 dB** | 48.05 / 48.28 / 48.02 | 0.994653 | 26.55 / **48.12** / 26.63 dB |
| 3000 | 300 | **47.407 dB** | 47.36 / 47.57 / 47.30 | 0.994371 | 34.52 / **47.41** / 34.72 dB |
| 6000 | 120 | **48.052 dB** | 47.96 / 48.19 / 48.01 | 0.995155 | 21.67 / **48.05** / 21.75 dB |
| 9000 | 300 | **49.368 dB** | 49.25 / 49.73 / 49.15 | 0.994578 | 30.92 / **49.37** / 31.18 dB |
| 12000 | 120 | **50.328 dB** | 50.16 / 50.71 / 50.13 | 0.994853 | 25.53 / **50.33** / 25.49 dB |

PSNR and SSIM are ffmpeg's own `psnr` and `ssim` filters on the 8-bit RGB pictures, overall and per channel. The
alignment columns are the PSNR of the module's warp of frame N against the app's renders of frames N−1, N and N+1: the
middle one must be the best, and it is on every frame, by 12.7 dB or more. At 3840x2160 one frame's motion changes the
picture enough that a one-frame error costs 12.7 to 26.3 dB, so the alignment is not in doubt.

The module's field of view for each frame equals the app's to within 3.6·10⁻⁸ (a float32's last digits), and its
matrices for frame 1000 are bit for bit the ones task 6.1 recorded from the Node spike.

## How to run it

```sh
gyroflow/wasm/build.sh                                       # once: pkg/ is not in git
GYRO_CLIP=/path/to/clip.MP4 GYROFLOW=/path/to/Gyroflow.app/Contents/MacOS/gyroflow node gyroflow/wasm/test/agreement/run.mjs
```

`GYROFLOW` is the application's executable (required, no default; on a Mac `Gyroflow.app/Contents/MacOS/gyroflow`), `GYRO_WORK` the folder for the pictures
(defaults to the temp folder), `GYRO_FRAMES` the frames (defaults to `1000,3000,6000,9000,12000`). Needs ffmpeg on
`PATH`. The run takes about 20 minutes on this Mac, most of it in the app's PNG encoders.

It writes `results.json` next to itself, and in the work folder: the app's render of each frame
(`gyroflow-<N>.png`), the module's warp of it (`module-<N>.png`), their difference amplified 8 times
(`difference-<N>.png`), the projects it asked the app to render, and the app's own log of the last run. Footage and
pictures stay out of git.

The half-pixel check below can be repeated on those pictures:

```sh
node gyroflow/wasm/test/agreement/halfpixel.mjs <the work folder>/pictures
```

## Gyroflow's default settings, as applied

The app's command line renders a video with a project it makes for it: the settings its `settings.json` holds, over the
engine's defaults (`gyroflow/src/cli.rs`, `setup_defaults`). `run.mjs` has the app export that project
(`--export-project 1`) and reads it, so what is applied is what is written down, not a guess:

| Setting | Value |
|---|---|
| Video | 3840x2880, 13,839 frames, 59.94005994005994 fps, 230,880.65 ms, HEVC Main 10, tv / bt709 |
| Output | 3840x2160 (the lens profile's output size) |
| Smoothing | **Default**, smoothness 0.5, pitch/yaw/roll 0.5, per axis off, `trim_range_only` on, max smoothness 1.0, `alpha_0_1s` 0.1 |
| Field of view | 1.0 (the fitted frame) |
| Adaptive zoom | 4 s either way, Gaussian filter |
| Horizon lock | 0 % (off) |
| Lens profile | the DJI Avata 2 4K 4:3 profile embedded in the clip: 3840x2880 in, 3840x2160 out, focal 1457.07, centre (1920, 1440), fisheye k1–k4 = 0.15513, 0.13714, −0.09386, 0.00417 |
| Lens correction | 1.0, rectilinear output |
| Frame readout | 10.517525 ms, top to bottom (from the file) |
| Zoom limit | 130 %, 5 iterations, not fixed, per clip not whole clip |
| Video speed | 1.0, frame offset 0 |
| Interpolation | **Lanczos4** (the export setting, which the render uses in its warp shader) |
| Encoder | H.265/HEVC at 123.87 Mbps (not used here: the comparison renders PNGs) |

The app's `settings.json` at the time of the run held `smoothingMethod: 1` (Default), `adaptiveZoom: 4.0`,
`croppingMode: 1` (adaptive zoom), `correctionAmount: 1.0`, `interpolationMethod: 2` (Lanczos4), `maxZoom: 130`,
`maxZoomIterations: 5`, `defaultCodec: 1` (H.265) — the values above, which its command line read.

The module was given the same settings through its API: `setSmoothing('Default', { smoothness: 0.5, … })`, `setFov(1)`,
`setAdaptiveZoom(4)`, `setHorizonLock(0, 0)`, then `recompute()`. It opened the clip in 3.0 s: 461,674 orientations,
1,896,500,750 bytes read, output 3840x2160, frame readout 10.517525 ms — the same as the project's.

### What the module cannot express

- **The warp's interpolation.** The app's render uses Lanczos4 (its export setting) in the warp shader; the module's
  CPU warp uses Bilinear, which is its engine default and has no setter. The numbers above are with that difference in
  place, so it is part of their explanation, not hidden. `results.json`'s `not_expressed` names it with the values.
- **Trims.** The module has no trim ranges: it always smooths the whole clip. The app's render is trimmed (below) and
  its `trim_range_only` is turned off so that its smoothing is the whole clip's too.
- **The frame readout time, lens profile and frame rate** are read from the clip by both, and compared equal.

## Why the render is trimmed, and why that changes no numbers

The app's command line renders a whole video (13,839 4K frames, about two hours and 150 GB of PNGs at this size) or
the trim ranges of the project it loads. `run.mjs` therefore gives it a project trimmed around each frame of interest.

A trim is not neutral to the engine: the adaptive zoom fits the field of view to the frames inside the trim range, and
the Default smoothing, with `trim_range_only` (its default), smooths only the trimmed part. Both would make the app
compute different numbers from the module's whole-clip ones. So, for every frame, the run asks the app to export its
own camera data (`--export-metadata 3`) for the whole clip and for the trimmed project, and compares the field of view,
the minimal field of view and the smoothed quaternion **at that frame**: the trim is widened (60, 120, 180, 240, 300
frames either side) until they are identical, and only then is the render made. `trim_range_only` is set to 0 in the
trimmed project.

The widths that were needed, from `results.json`:

| Frame | Trims tried, and whether the camera data matched |
|---|---|
| 1000 | 60 ✓ |
| 3000 | 60 ✗, 120 ✗, 180 ✗, 240 ✗, 300 ✓ |
| 6000 | 60 ✗, 120 ✓ |
| 9000 | 60 ✗, 120 ✗, 180 ✗, 240 ✗, 300 ✓ |
| 12000 | 60 ✗, 120 ✓ |

At frame 6000 a 60-frame trim puts the field of view 0.129 out (12 % of the zoom); at 3000 the narrower trims leave it
0.015 out and at 9000 0.0059, and neither comes back to the whole clip's until 300. The rendered PNGs of those projects
would look right and be wrong; this gate is what catches it. The largest trim is 601 frames (about 10 s of the clip).

The trim's ends fall half a frame away from a frame (`(N − k − 0.5)/fps` to `(N + k + 0.5)/fps`), so the first frame the
app renders is frame N−k and not a rounding. An earlier attempt with the ends exactly on frame times started the
render one frame late: the app's row below the trim start was frame 701 for a trim starting at frame 700, which showed
up as a 1-frame misalignment (32 dB instead of 48 dB). The alignment check above now proves it: the module's frame N
matches the app's Nth render, at index k of the sequence, and its neighbours are 12.7 to 26.3 dB worse.

The comparison is made on the app's **PNG Sequence** output at 3840x2160: 8 bits, lossless, no encoder between the app's
warp and the comparison. The app wrote the frames with 25-digit names (`clip-0020_0000000000000000000000001.png`): a
`%` in the output name reaches FFmpeg percent-encoded by the app's own URL encoding on macOS, and FFmpeg reads `%25d`
as a 25-digit frame number. `run.mjs` sorts the files and uses the index; the names themselves don't matter.

## Where the remaining difference is

The mean absolute difference between the two pictures is 0.42–0.55 of 255 (per frame), its 99th percentile 2.3–4.0 and
its maximum 22–35; fewer than 0.2 % of the pixels differ by more than 8. The amplified difference pictures show it: a
faint outline on the sharpest ridges and trees, nothing else — the signature of two resamplers, not a misalignment.

- **The two resamplers.** The app warps the clip's 10-bit 4:2:0 planes (P010) with Lanczos4 on the GPU (its log says
  `Initialized OpenCL … Lanczos4`), then converts to 8-bit RGB for the PNG. The module starts from ffmpeg's 8-bit RGBA
  of the same frame and warps it with its CPU kernel in Bilinear. The 10-bit vs 8-bit input, 4:2:0 chroma upsampled
  before the warp vs after it, and the two kernels' sampling are the remaining difference. This was not separated
  further; the task only asks whether they agree, and they do.
- **No half-pixel offset.** The design of the GPU stage (task 6.3) found that Gyroflow's WGSL shader samples half a
  pixel away from its CPU kernel. The application's render on this Mac does not: moving one picture half a pixel in
  any direction makes the agreement worse on every frame.

| Frame | Unmoved | Render moved 0.5 px in x | in y | in both |
|---|---|---|---|---|
| 1000 | **48.11 dB** | 40.88 | 41.95 | 40.01 |
| 3000 | **47.40 dB** | 39.03 | 40.48 | 37.99 |
| 6000 | **48.05 dB** | 39.59 | 41.89 | 40.13 |
| 9000 | **49.37 dB** | 41.61 | 42.57 | 39.51 |
| 12000 | **50.33 dB** | 44.22 | 45.34 | 43.88 |

## What was not measured

- Only the default settings. Other smoothing methods and parameters, other fields of view, horizon lock, a custom lens
  profile and clips without embedded motion data are not part of this check.
- Five frames of one clip. The numbers hold for those; a systematic difference that only shows on other footage (night,
  large flat areas) would not be seen here.
- The app's GPU warp against its CPU warp. The app rendered on the GPU (OpenCL); the module is a CPU warp, so the
  agreement is between two different implementations of the same sampling, not between one implementation and itself.
- The app's encoder path. The comparison uses PNGs on purpose; an H.265 or ProRes render would add the encoder's loss
  (a ProRes 422 HQ render of one of these frames measured about 6 dB below the PNG path while setting this up).
- The module's speed here: the CPU warp is about 2–5 s per 4K frame (it was 1.5 s in task 6.1's measurements on a
  quieter machine; these runs shared the Mac with other work).

## The user's Gyroflow settings

Before the first run `run.mjs` copies `~/Library/Preferences/xyz.gyroflow.plist` and
`~/Library/Application Support/Gyroflow/` to the work folder, and after the last one compares every file with `cmp`,
restoring anything that changed. The app wrote only to `gyroflow.log` (its own log, 2 KB, the run's evidence is kept in
the work folder and the file was put back); the plist and `settings.json` were unchanged on every run, including the
whole-clip export, the camera-data exports and the five renders of the final run.

## The files

| Path | What |
|---|---|
| `run.mjs` | The check: project, camera-data gate, renders, module warps, alignment, PSNR/SSIM, pictures, `results.json` |
| `halfpixel.mjs` | The alignment check on the pictures the run leaves: PSNR with one of them moved half a pixel |
| `results.json` | What the last run measured: every setting, every frame's numbers, the trims tried, the paths of the pictures |
