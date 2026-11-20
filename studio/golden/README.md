# Golden frames

A fixed set of small projects whose rendered frames are stored in git and compared again on every run, on the real
GPU. They are the safety net for the render path: FreeCut's own unit tests run in jsdom with a mocked GPU
("the WebGPU path is not exercised by the jsdom test suite"), so nothing else notices when a refactor shifts every
colour by one level or breaks an effect. The kit is only worth something if it is **stable when nothing changed** and
**fails when something did**; both are measured below.

```sh
npm run golden                 # build the app, render every case, compare; exit 1 on any difference
npm run golden:update          # rewrite the stored frames (only on purpose: see "When to update")
npm run golden:test            # tests of the kit itself (no GPU needed)

node golden/run.mjs --list                 # the cases
node golden/run.mjs --case color-,blur-    # only cases whose id equals or starts with a name
node golden/run.mjs --repeat 10            # render everything 10 times and report any spread (diagnostics)
node golden/run.mjs --expected <dir>       # compare against another folder of stored frames (see "The machine")
```

A run takes about 5 seconds on this Mac (a 4 s build of the app under test, then 58 frames in about 1.5 s). It always
builds the app first, into `golden/out/dist`, so it never tests a stale build. Exit codes: `0` all frames match, `1` a
frame differs or has no stored frame, `2` the run could not be made (software GPU, build failure, no Chrome).

On a failure the run prints the case, what it protects, and for each differing frame the mean and maximum difference
per channel (in 8-bit levels), the signed mean (a uniform shift shows there) and the share of pixels that differ. It
writes four pictures to `golden/out/failures/<case>/` (git ignores `golden/out/`): `frame-N.rendered.png`,
`frame-N.stored.png`, `frame-N.difference.png` (black where equal; any difference is drawn at least 96 bright, so a one-level
change is visible) and `frame-N.side-by-side.png` (stored, rendered, difference).

## How it renders

`golden/lib/render.mjs` reuses the headless machinery: `headless/server.mjs` serves the built app and the media,
`headless/lib/cli.mjs` gives the Chrome flags (installed Google Chrome, `--enable-unsafe-webgpu`, ANGLE on Metal), and
each frame is `window.freecut.renderFrame` from `src/headless/main.ts`, which calls `renderSingleFrame` and so
`createCompositionRenderer`: the same renderer factory the export uses, per frame. Nothing in `src/` was changed. The
frame is returned as a lossless PNG of the canvas, so what is **not** covered is everything after the canvas: the
encoder, the muxer, scaling to an export resolution, and the live preview path.

The exceptions are the float cases (see **Float path** below) and `stage-warp-rotation`, which has no project: the runner calls `renderer.stageWarp()`, which injects a
small page script (the stage plus Gyroflow's shader, bundled by `golden/lib/stage-warp.mjs`) into the same page and
reads the stage's own texture back as RGBA8. It is the one case whose frame does not come from the canvas.

- **A software GPU is refused**, not used: the run reads the WebGPU adapter and stops with exit code 2 if it is a
  fallback adapter or its name says SwiftShader, llvmpipe, Lavapipe or similar. This matters: on SwiftShader (tried
  here as an experiment) every frame with an effect came out as an empty background, with no error. Frames from it
  would have looked like a valid baseline.
- **Offline**: requests to anything but the local server are aborted and counted. The only one seen is the Google
  Fonts stylesheet that the font loader asks for when a text title uses Arial (it is blocked; Arial comes from the
  system). That request is the editor's, not the kit's; task 1.4 (no third-party request on load) should remove it.
- `GOLDEN_CONSOLE=1 node golden/run.mjs ...` prints every console message of the page. A WebGPU validation error
  reaches the console as a warning, not an error, and its frame comes out as the empty canvas: this is where it shows.
- A render that reports **any warning** (a missing media file, a font that fell back, a project validation warning:
  `strict` is on) is a failed run, not a frame.
- The text case needs the system to have **Arial** (macOS and Windows do). If a font falls back, the render reports
  a warning and the run fails instead of storing a frame in the wrong font (not verified on a machine without Arial).
- Inputs are procedural and deterministic (`golden/lib/images.mjs`, integer arithmetic only, generated into a
  temporary folder at run time) or four tiny committed videos (`golden/media/`, 4–10 KB each, made once by
  `make-videos.sh`). `npm run golden:test` pins the bytes of every input, so a changed input cannot pass as a
  render regression.
- Every project is 320x180 at 24 fps (the stage case's output is too, its input is 320x240). The whole folder is about
  1 MB of stored frames.

## The comparison rule: exact

A frame passes only if **every channel of every pixel is identical** to the stored frame. There is no tolerance.

Why: on this machine the output is bit-exact from run to run, so the narrowest rule that tolerates the jitter is no
tolerance at all, and that is the only rule that fails a uniform shift of one 8-bit level (the kit's own test pins
that; the deliberate one-level change below was caught at a mean difference of 0.83 levels).

How the jitter was measured (44 frames, 18 Nov 2026, Apple M4, Chrome 158.0.8127.36, macOS 27.2):

| Measurement                                                                                                                              | Result                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Same browser, every frame rendered 10 times                                                                                              | 0 differences                   |
| 4 browsers at once, each rendering every frame 25 times (100 renders per frame, on a GPU shared by all four and by another agent's work) | 0 differences                   |
| Fresh browser, compared with the stored frames: 3 runs in a row, 4 more at once                                                          | 44 of 44 match every time       |
| One case alone, or a subset, against the same case inside the full run                                                                   | identical (no order dependence) |

So the measured run-to-run jitter on this machine is **0 levels**. If it ever stops being 0 on the same machine, treat
that as a bug in the kit or in the app (non-determinism in the render) and find it; do not loosen the rule.

## Proof that it fails when something changes

Each of these was made in `src/`, run with `npm run golden`, observed, and reverted (the tree was clean again
afterwards and the next run passed 44 of 44). Output shortened to what matters.

1. **One level in a colour shader**: `gpu-brightness` returns `color.rgb + params.amount + 1.0 / 255.0`.

   ```
   FAIL  color-brightness/0  [colour]
         mean difference per channel (levels of 255): R 0.8281  G 0.8835  B 0.8847
         signed mean (actual - stored):               R 0.8281  G 0.8835  B 0.8847
         maximum difference per channel:              R 1  G 1  B 1
         pixels that differ: 90.69 % (52240 of 57600); by more than 8 levels: 0.00 %
   1 of 44 golden frames FAILED: color-brightness/0
   ```

2. **One pixel of offset in the transform**: `render-item.ts` adds 1 to the resolved `x` of every item. Every frame
   with a clip fails (44 of 44), the untouched-image cases with `is not identical to its source image "card"`, `transform-scale-position`
   at mean 9.55 levels, `transform-flip` at mean 21.30 levels (max 255, 31.3 % of pixels).

3. **A change in how effects are chained**, twice:
   - The 8-bit rounding in the batched colour shader removed (`color = clamp(color, ...)` instead of `round(...)`).
     Fails `chain-roundtrip-ramp` (mean 0.50, max 2, 75 % of pixels), `chain-grade-batch`, `chain-grade-batch-rest`,
     `chain-blur-then-grade`: 4 of 44, and nothing else.
   - The effect list reversed before planning the passes. Fails exactly the five `chain-*` cases: 5 of 44.

4. **The LUT sampled half a texel off** (`+ 0.6` instead of `+ 0.5` in `lut.ts`). Fails `color-lut` only: mean 6.2 / 5.8 / 2.8
   levels, max 8.

And the other direction, a change that must **not** be flagged: switching off the colour batching altogether
(`planEffectPasses(effects, false)`, each effect its own 8-bit pass) leaves all 44 frames identical, as designed: the
batched shader exists to be bit-exact with separate passes.

## The machine

`golden/expected/machine.json` records the machine that stored the frames: GPU (vendor, architecture), Chrome version,
OS, CPU, model, ANGLE backend. Today: Apple M4 (`apple`, `metal-3`), Chrome 158.0.8127.36, macOS 27.2, Mac16,10.

Stored frames are exact for **that** GPU, driver and Chrome. What happens elsewhere:

- On another machine the run compares exactly anyway, prints which machine the stored frames come from, and, if
  frames differ, says that this may be GPU differences rather than a regression. No second GPU was available, so
  nothing is measured or promised about how large a cross-GPU difference is, and no looser rule is offered that
  could not be justified.
- A different Chrome major version or OS update can also change pixels (the 2D canvas, the video decoder, the PNG
  encoder). The machine key printed in the run is `GPU architecture | OS | Chrome major`.
- To use the kit on another machine, make a **private baseline from the code before your change** and compare
  against that. This is the same before/after use, with that machine's own frames:

  ```sh
  git stash                                           # or check out the commit before your change
  node golden/run.mjs --update --expected golden/out/local
  git stash pop
  node golden/run.mjs --expected golden/out/local
  ```

- **The Windows PC has its own committed set** (task 8.1): on Windows the run reads and writes `golden/expected-pc/`
  (NVIDIA GeForce RTX 5070 Ti), so neither machine's frames are ever rewritten by the other. `--expected` still
  overrides the folder. Run it from the PC's desktop: over SSH the GPU drew only the empty canvas, and the first set
  stored that way (20 Nov 2026) held 28 flat grey frames that compared equal to themselves. Since then a frame of one
  flat colour fails the comparison and is never stored (`flatColour`, `lib/compare.mjs`); the set stored from the
  desktop on 20 Nov 2026 matches the Mac's pictures.
- `--update` refuses to overwrite the committed frames from a different machine unless you pass `--new-machine`
  (and then the whole set moves to that GPU: do it only when the baseline is meant to move), and refuses a partial
  `--update --case` across machines, so a stored set always comes from one machine.

## What phase 3 will change on purpose

The frames store **today's 8-bit behaviour**. Phase 3 (a 16-bit float render path) is meant to change exactly these,
and a reviewer should expect them, and only them, in the diff of stored frames. Measured on the stored frames:

| Case                                                                                              | What it shows today                                                                                                                                                                                                                                                 | What phase 3 should do                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `video-hevc-main10` (frames 7, 11)                                                                | A 10-bit HEVC Main 10 file whose top half is a 128-step luma ramp. Chrome decodes it and the 2D canvas flattens it to 8 bits before anything else sees it: the ramp row of the frame has **38 distinct levels**. The 8-bit H.264 file of the same picture gives 33. | Keep more than 8 bits of the source through grading. At 8-bit output the plain frame should hardly change; the stretched one below should. |
| `video-hevc-main10-stretched` (frame 7)                                                           | The same ramp after contrast 3 around mid grey: **38 bands**, each 3 or more levels above the last; the 10-bit detail is already gone. `video-h264-high-stretched` is the 8-bit twin (33 bands).                                                                    | Many more distinct levels in the stretched ramp (up to the 128 steps of the source): smoother, with less banding.                          |
| `passthrough-ramp`                                                                                | A 64-level ramp (grey, red, green, blue) through nothing at all comes out bit-identical.                                                                                                                                                                            | Must stay bit-identical: an untouched image must not change.                                                                               |
| `chain-roundtrip-ramp`                                                                            | Exposure -2 EV then +2 EV, which should be the identity. The batched colour pass rounds to 8 bits after the first step, so the 64-level ramp comes back with **17 distinct levels** (mean error 1 level, maximum 2).                                                | Come back whole, with 64 levels.                                                                                                           |
| `chain-grade-batch`, `chain-grade-batch-rest`, `chain-batch-then-single`, `chain-blur-then-grade` | Where each pass ends the 8-bit texture rounds (the batched shader in `effects-pipeline.ts` rounds explicitly after every step to match separate 8-bit passes).                                                                                                      | Differences of a level or two, in the dark and smooth areas first.                                                                         |
| Every single-effect and transition frame                                                          | One effect, one rounding at the end.                                                                                                                                                                                                                                | Most should stay identical or move by at most a level. A large change here is a bug, not a goal.                                           |

When phase 3 lands, update the stored frames **in a separate commit from the render change**, with this table
re-measured, so the review can see what moved.

## Cases

Every case is a small project in `golden/cases.mjs` (the file is the source of truth; `npm run golden:test` fails if
the stored frames and the case list disagree). Track 0 is the top layer. "Card", "ramp", "detail", "scene" and
"overlay" are the procedural images of `golden/lib/images.mjs`.

**Untouched image**

| Case                 | Frames | What it protects                                                                                                                                                                                                            |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passthrough-card`   | 0      | an image placed at 100 % with nothing on it comes out exactly as it went in (colour bars, grey ramp and stairs, hue sweep, 1-pixel detail, four corner squares). The frame must equal the source bit for bit.               |
| `passthrough-ramp`   | 0      | an image placed at 100 % with nothing on it comes out exactly as it went in (a slow 64-level ramp (grey, red, green, blue): a step added or removed anywhere shows as a band). The frame must equal the source bit for bit. |
| `passthrough-detail` | 0      | an image placed at 100 % with nothing on it comes out exactly as it went in (a zone plate, noise, grid and diagonals: any resampling of the image shows). The frame must equal the source bit for bit.                      |
| `passthrough-scene`  | 0      | an image placed at 100 % with nothing on it comes out exactly as it went in (a dusk sky with a sun, hills and a field). The frame must equal the source bit for bit.                                                        |

**Clip transform**

| Case                       | Frames | What it protects                                                                                               |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `transform-scale-position` | 0      | size and position of a clip: 75 % size, moved 20 px right and 10 px up, over the dark background.              |
| `transform-rotate`         | 0      | rotation about the centre: 12 degrees clockwise at 70 % size; edges must be anti-aliased the same way.         |
| `transform-flip`           | 0      | horizontal and vertical flip (the corner squares swap places).                                                 |
| `transform-crop`           | 0      | cropping each edge by a different amount: left 10 %, right 20 %, top 15 %, bottom 5 %.                         |
| `transform-crop-soft`      | 0      | a cropped clip with a soft edge (softness 0.1).                                                                |
| `transform-opacity`        | 0      | opacity 50 % of one image over another: the mix is (a + b) / 2 per channel, rounded the same way every time.   |
| `transform-combined`       | 0      | scale, position, rotation, rounded corners and opacity together over a second image (the usual everyday clip). |

**Colour**

| Case                | Frames | What it protects                                                                                                                                                                       |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color-brightness`  | 0      | brightness +0.15 (single effect on the "card" test image).                                                                                                                             |
| `color-contrast`    | 0      | contrast 1.4 around mid grey (single effect on the "card" test image).                                                                                                                 |
| `color-exposure`    | 0      | exposure +0.7 EV with a small offset and gamma (single effect on the "card" test image).                                                                                               |
| `color-saturation`  | 0      | saturation 1.6 (single effect on the "card" test image).                                                                                                                               |
| `color-sky`         | 0      | the sky tool on an overcast frame: the white sky takes the steel-blue gradient (horizon 0.58, protection 0.85), the hills and the orange kite stay as they were.                       |
| `color-vibrance`    | 0      | vibrance +0.6 (single effect on the "card" test image).                                                                                                                                |
| `color-temperature` | 0      | temperature +0.4 (warmer) with tint -0.2 (single effect on the "card" test image).                                                                                                     |
| `color-hue-shift`   | 0      | hue shift by 0.25 of the wheel (single effect on the "card" test image).                                                                                                               |
| `color-levels`      | 0      | levels: input black 0.1, input white 0.9, gamma 1.2, output 0.05 to 0.95 (single effect on the "card" test image).                                                                     |
| `color-curves`      | 0      | curves: a lifted-shadow, pulled-highlight master curve and a boosted red channel (single effect on the "card" test image). The curve is baked into an 8-bit table.                     |
| `color-wheels`      | 0      | colour wheels: cool shadows, warm highlights, plus saturation, contrast and exposure (single effect on the "card" test image).                                                         |
| `color-lut`         | 0      | the .cube LUT effect with a synthetic 5x5x5 teal-and-orange table at full strength (single effect on the "card" test image). Protects the 3-D texture path and its trilinear sampling. |
| `color-input-dlog-m` | 7     | the input colour stage through the stage pipeline (design 3.6): a 10-bit-like HEVC ramp clip with D-Log M set on the item goes source frame (decoded to 8 bits, widened to `rgba16float`) → input colour pass in float → FreeCut's draw. The ramp makes a wrong curve, a wrong profile uniform or a missing pass visible, and an untouched clip would be the source frame. Re-stored on 19 Nov 2026 when the stage's intermediates became float (design 3.6 §2.6): 36.1 % of the pixels moved by one level, none by more (the colour pass's output is no longer rounded to 8 bits before FreeCut's draw rounds it). |
| `color-input-dlog-m-masked` | 7 | the same clip under a clip mask (a centred box half the frame wide and high): a masked clip is drawn on the canvas path, which draws the staged picture too (review finding R1). Inside the box it equals `color-input-dlog-m` pixel for pixel; flat log under the mask changes it. |

**Blur and distortion**

| Case               | Frames | What it protects                                                                                         |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `blur-gaussian`    | 0      | gaussian blur, radius 8, on the "detail" image (fine detail makes sampling differences visible).         |
| `stylize-sharpen`  | 0      | sharpen, amount 1.5, on the "detail" image.                                                              |
| `stylize-vignette` | 0      | vignette on the "scene" image (a smooth radial falloff: banding shows).                                  |
| `distort-twirl`    | 0      | twirl (amount 1.2, radius 0.5) on the "card" image: the shader samples the source at computed positions. |

**Stacked effects**

| Case                      | Frames | What it protects                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chain-roundtrip-ramp`    | 0      | exposure -2 EV then +2 EV on the slow ramp. Two colour effects run in ONE shader pass that rounds to 8 bits after each step, so the dark half-way value loses levels: the 64-level source ramp comes back with only 17 distinct levels. A 16-bit pipeline brings it back whole (phase 3 changes this on purpose). |
| `chain-grade-batch`       | 0      | a typical grade of five colour effects in a row (exposure, contrast, saturation, temperature, vibrance): all run in the one batched pass.                                                                                                                                                                         |
| `chain-grade-batch-rest`  | 0      | the other colour effects that share the batched pass: brightness, levels, hue shift, sepia, grayscale and invert in a row (each has its own branch in the batch shader).                                                                                                                                          |
| `chain-batch-then-single` | 0      | saturation (batched), then curves (its own pass), then contrast: where one pass ends and the next starts, the 8-bit texture between them rounds.                                                                                                                                                                  |
| `chain-blur-then-grade`   | 0      | gaussian blur followed by exposure -1.2 EV then +1.2 EV: the order of two effects and the rounding of the dark middle value.                                                                                                                                                                                      |

**Transition**

| Case                   | Frames | What it protects                                                                                                                                     |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transition-fade`      | 15     | fade transition between two images at its midpoint (a cross-fade: (a + b) / 2). Clip A overlaps clip B for 10 frames; frame 15 is the middle.        |
| `transition-wipe`      | 15     | wipe transition between two images at its midpoint (a hard wipe edge half-way across). Clip A overlaps clip B for 10 frames; frame 15 is the middle. |
| `transition-clockWipe` | 15     | clockWipe transition between two images at its midpoint (a clock wipe at half a turn). Clip A overlaps clip B for 10 frames; frame 15 is the middle. |

**Blend mode**

| Case               | Frames | What it protects                                                              |
| ------------------ | ------ | ----------------------------------------------------------------------------- |
| `blend-multiply`   | 0      | blend mode "multiply" of the stripes-and-disc image over the "scene" image.   |
| `blend-overlay`    | 0      | blend mode "overlay" of the stripes-and-disc image over the "scene" image.    |
| `blend-difference` | 0      | blend mode "difference" of the stripes-and-disc image over the "scene" image. |

**Text**

| Case              | Frames | What it protects                                                                                                                                       |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text-over-image` | 0      | a bold white title (Arial 40) over the "scene" image: text layout, anti-aliasing and compositing. Depends on the machine having Arial; see the README. |

**Video**

| Case                          | Frames | What it protects                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `video-h264-high`             | 7, 11  | 8-bit H.264 High clip, source frames 7 and 11 (the white box is 20 px further right on each frame, so a frame early or late shows). It shows the 8-bit decode path.                                                                                                                                                                                                                                                |
| `video-h264-high-stretched`   | 7      | 8-bit H.264 High clip with contrast 3 around mid grey, frame 7: stretches the slow luma ramp so that banding is plainly visible. The ramp has 128 steps in the 10-bit file and about 38 in the 8-bit one; today both are flattened to 8 bits before the effect, so each shows at most 38 distinct levels in the frame (33 for the H.264 file, 38 for the HEVC file). Phase 3 changes the 10-bit one on purpose.    |
| `video-hevc-main10`           | 7, 11  | 10-bit HEVC Main 10 clip, source frames 7 and 11 (the white box is 20 px further right on each frame, so a frame early or late shows). It shows what 10-bit footage looks like today: decoded and flattened to 8 bits before anything else touches it.                                                                                                                                                             |
| `video-hevc-main10-stretched` | 7      | 10-bit HEVC Main 10 clip with contrast 3 around mid grey, frame 7: stretches the slow luma ramp so that banding is plainly visible. The ramp has 128 steps in the 10-bit file and about 38 in the 8-bit one; today both are flattened to 8 bits before the effect, so each shows at most 38 distinct levels in the frame (33 for the H.264 file, 38 for the HEVC file). Phase 3 changes the 10-bit one on purpose. |

**Shadow removal**

| Case                     | Frames      | What it protects                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shadow-piece-boundary`  | 29, 30, 59, 60 | a clip whose cleaned piece covers source frames 30 to 59 is read from two files: frames 29 and 60 must be the source, frames 30 and 59 the piece at its own frames 0 and 29. The piece is a different picture on purpose, so a frame from the wrong file, or the right file one frame early or late, changes the image. It protects the resolver's frame boundary and its per-file offset. |

**Stabilization stage**

The one case with no project: nothing in the renderer draws the stage yet (slice C2 seats it), so it drives it directly.
`golden/lib/stage-warp.mjs` bundles `golden/lib/warp-page.ts` (the stage and Gyroflow's shader) with the app's own
bundler, injects it into the same harness page and warps a synthetic frame on the real GPU;
`golden/lib/stage-frame.mjs` builds that frame's picture, its 416 bytes of Gyroflow kernel parameters and its 2880 row
matrices in code, pinning their bytes in `kit.test.mjs`. No footage and no wasm package are needed.

| Case                   | Frames | What it protects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stage-warp-rotation`  | 0      | Gyroflow's warp shader through the shipped stage: a 320x240 grid warped with a roll that changes by row (2880 row matrices, as a 4K sensor frame has), the engine's fisheye lens functions, a bilinear coefficient table and the frame's own limited-range flag, into a 320x180 picture. A difference means the kernel's assembly (the eight transforms of design 6.3 §4.1), the bindings, the −0.5 px fragment correction or the coefficients changed the pixels. The frame's `max_pixel_value` is 255 as the module's `frameData` reports it, so a stage that stopped rewriting it to 1.0 turns the corners white; its `flags` is 1, so a shader that read the pipeline's constant flags instead of the uniform's loses the colour remap. |

**Float path**

The first check that runs the float path on a GPU (design 3.6 section 2.13, review finding R2). A float case renders
through the precise path: `window.freecutPrecise.begin()` (installed by `src/studio/render/test-sink.ts`, one line in
`src/headless/main.ts`) registers a `PreciseOutputSink` and switches on the raw 10-bit backend
(`src/studio/render/frames/backends/raw-test.ts`), the runner renders the frame with `window.freecut.renderFrame`, and
`end()` returns what the sink read: the compositor's `rgba16float` accumulator as 16-bit values (each half float
decoded exactly, clamped to 0..1; a value outside it fails the run). The frame is stored as a **16-bit RGBA PNG** and
compared exactly like every other frame (`lib/png16.mjs`, `lib/float.mjs`); a failure writes the 16-bit pictures and an
8-bit side-by-side view. The clips' pictures are headerless `gbrp10le` files made in code by `lib/float.mjs` (never
committed) and decoded by the raw backend through the precise path's own source pass; each clip's own file is the
committed tiny HEVC video, because the renderer opens every clip's file with its decoder first, and its raw frames are
served beside it under the same id with `-raw`. These projects are 1024x16 (the ramp's size), so nothing is resampled.

The ramp has 877 grey levels (codes 64 to 940) in every row. A float path keeps them as 877 different values; one
8-bit step anywhere leaves 219 (codes 64 to 940 at 8 bits). The ramp cases also assert it (`minLevels`, 800): the run
prints the count and fails below it, apart from the stored frame.

| Case                    | Frames     | What it protects                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `float-ramp-identity`   | 0          | the ramp through the source frame provider, the stage pipeline with no stage, FreeCut's draw and the float composite: 877 different values come out. An 8-bit intermediate anywhere in that path (shown on 19 Nov 2026 with a one-line quantisation in the provider's blit: 219 values, 6 of the 7 frames fail) loses them.                                                            |
| `float-ramp-dlog-m`     | 0          | the same ramp with D-Log M set on the clip: the input colour pass in float. The 877 codes stay 877 values (on 856 distinct 10-bit codes after the curve).                                                                                                                                                                                                                              |
| `float-ramp-curves`     | 0          | the curves effect keeps the 10-bit ramp in the float chain: the 877 grey levels through a smooth rising master curve stay at least 700 different values (754 measured); an 8-bit curve table cut them to at most 256. |
| `float-look-linear`     | 0          | a 65-point look on the raw grey ramp with no input transform: each pixel is the look of its source value within 2 levels of 1023. A look stage that is not drawn, reads a channel or a row order wrong, or rounds to 8 bits before the look gives a different ramp. |
| `float-look-dlog-m`     | 0          | the same look after the D-Log M input transform: the look is given what the transform gave, never the file's codes (the middle of the ramp moves more than 10 levels of 1023). |
| `float-shadow-boundary` | 2, 3, 5, 6 | a cleaned piece over source frames 3 to 5, as raw pictures through the provider: frames 2 and 6 from the source file, 3 and 5 from the piece at its frames 0 and 2. A wrong file or a frame early or late is a different ramp.                                                                                                                                                         |
| `float-stage-warp`      | 0          | the synthetic frame of `stage-warp-rotation` through the stabilization stage with `rgba16float` input and output, read back as 16 bits (it drives the stage directly, like the 8-bit case: no engine is open in a golden run). The warp's bilinear values between the 255 levels are kept, which the 8-bit case rounds away.                                                            |
| `blur-vector-1x-180` | 3, 6 | the vector motion blur (design 9.2) at 1x, 180 degrees (RSMB 0.5), on a raw clip of the smooth grey texture moving 6 px right and 2 px down a frame (`lib/flow.mjs`, 12 frames): every pixel is blurred along its motion, measured by optical flow between the frames around it, over half the frame interval, centred on the frame. Checked against the texture integrated over [n - 0.25, n + 0.25] in linear light: within 1.5 levels of 1023 on average over the frame less a 24 px border, and under half the sharp frame's error. The golden run turns the motion blur switch on through the feature module's override while it renders these cases. |
| `blur-vector-1x-360` | 4 | the same at 360 degrees: the texture integrated over the whole interval [n - 0.5, n + 0.5]. |
| `blur-vector-4x-360` | 1 | the same clip at 4x, 360 degrees: source frames 4 to 7 each blurred over its own interval and averaged, one smear over [3.5, 7.5], under half the error of the frame blend (four copies) the blur replaced. |
| `blur-still-off` | 2 | a still clip of the texture (six identical frames) with no blur: the reference of the next case. |
| `blur-still-on` | 2 | the same still clip with a 180 degree blur on: nothing moves, so every pixel passes through and the frame equals `blur-still-off` bit for bit. |
| `flow-half-speed` | 1, 2, 3 | optical-flow slow motion (task 11.12) at 0.5x on a raw clip of a smooth grey texture moving 6 px right and 2 px down a frame (`lib/flow.mjs`): frames 1 and 3 lie halfway between two source frames and are interpolated on the GPU from the flow measured both ways at half size, so each is the texture moved halfway, checked within 1.5 levels of 1023 on average over the frame less a 16 px border, and under a tenth of the plain blend's error there (stored on 20 Nov 2026: 0.30 levels against the blend's 28.4); frame 2 is source frame 1 within a level. Its shutter is 1 degree, so the vector blur (design 9.2) passes every pixel through and the frames are the interpolation's alone. The flow kernels' arithmetic is also tested on the CPU twin (`src/studio/optical-flow/cpu-reference.test.ts`); this case is the GPU's. |
| `flow-occlusion` | 1, 2, 3 | optical-flow slow motion over an occlusion (design 11.24) at 0.5x, with an Amount of 0 (no vector blur, design 9.2, so the interpolation alone; the stored frames are unchanged by it) on a raw clip of a textured square moving 8 px right a frame over a background moving 4 px left (`lib/flow.mjs`): frames 1 and 3 lie halfway and are made by the forward warp (the flow pixels splatted to the phase, the layer whose two ends match winning, the holes filled, each frame trusted where its own flow moves with that motion), so the square's covered and uncovered edges come from the frame that shows them; checked against the scene at that moment (a formula) over the frame less a 16 px border, the mean error under 0.52 of the plain blend's (stored on 20 Nov 2026: 6.8 and 7.0 levels against the blend's 14.5, 0.47 and 0.48 of it; the CPU twin measures 0.47, and 0.56 for the 11.12 backward search); frame 2 is source frame 1 within a level. |
| `flow-occlusion-tuned` | 1, 2, 3 | the clip's optical-flow settings (design 11.24) on the `flow-occlusion` clip at 0.5x with no blur (Amount 0): "Motion detail: high" measures the flow at the frame's size (256 x 128 instead of 128 x 64) and "Hard edges: nearest frame" takes, where neither frame is trusted, the one more likely to show the content; checked against the scene, the mean error under 0.46 of the plain blend's (stored on 20 Nov 2026: 6.0 and 6.3 levels against the blend's 14.5, 0.42 and 0.44 of it; the CPU twin measures 0.42, and 0.47 at the defaults); frame 2 is source frame 1 within a level. |

Not covered by these: the accumulator is read at the project's size before the canvas conversion, so the canvas and
the encoder are not; a clip under a mask is 8-bit after its stages in a precise export (design 3.6 section 2.11);
the raw clip's `VideoFrameExtractor` fails to open the raw container, which is why its file is a real video; the
stabilization case is the stage alone, not an open engine on a clip.

## What is not covered, and why

The registry has 54 GPU effects. The cases cover 18 of them directly (`brightness, contrast, exposure, saturation,
vibrance, temperature, hue-shift, levels, curves, color-wheels, lut, gaussian-blur, sharpen, vignette, twirl`, and
`grayscale, sepia, invert` inside the batched pass), chosen for what a drone pilot grades with plus one of each
shader family: a one-pass colour shader, the batched colour pass, a data-texture effect (curves, LUT, 3-D texture), a
sampling effect (blur, sharpen), a geometric warp (twirl) and a radial one (vignette).

Left out: the other blurs (box, motion, radial, zoom), the other distortions (pixelate, rgb-split, wave, trigger-wave,
bulge, kaleidoscope, mirror, the glass effects, blocks, droste), most stylize effects (grain, posterize, glow,
edge-detect, scanlines, glitches, crt, halftone, dither, ascii, threshold, vhs, ink, both pixel-sorts), the secondary
qualifier, power window, gradient map and chroma key. Reason: a drone pilot rarely uses them, and the part of the render
path that a rewrite changes (pass chaining, texture format, sampling, the compositor) is already exercised by the
cases above. The compute path (`gpu-pixel-sort-hq`) is not exercised at all. Adding any of them is one `graded(...)`
line in `cases.mjs` plus `--update --case <id>`.

Also not covered: animated (keyframed) parameters, masks, adjustment layers, corner pin, shapes, compound clips, speed
changes and reverse, the handle-based transition model (the transitions here use the older overlap model, which
needs no source handles), more than two layers, project sizes other than 320x180 (blur radii and a few effects are in
pixels), a video longer than one GOP (the clips have 12 frames), and audio. Video frames are checked at frame 7 and 11 of
a 12-frame clip: decoding the wrong frame shows because the white box moves 20 px per frame.

## How to add a case

1. Add it to `golden/cases.mjs`: `graded(id, group, protects, [effect(...)], image)` for one image with effects, or
   `add({ id, group, protects, items, transitions, frames })` for anything else. `protects` is a sentence saying what a
   difference would mean. Use new ids; ids name the stored folders.
2. If it needs a new picture, add a generator to `golden/lib/images.mjs` (integer arithmetic only) and its hash to
   `golden/lib/kit.test.mjs`. If it needs a video, change `golden/media/make-videos.sh`; the committed bytes are the
   input, so regenerate once, commit the video and the new hash together.
3. `node golden/run.mjs --update --case <id>`, then **look at** `golden/expected/<id>/frame-N.png`. A stored frame
   that is black, empty or just the background is a broken case (an effect asked for a parameter that does not exist,
   a clip with the wrong track order), not a golden.
4. Run `npm run golden` and `npm run golden:test`; commit the case and its frames together.

## When to update the stored frames

`npm run golden:update` rewrites every frame and lists the ones that changed. Do it only when the change in pixels is
**the point of the change**, never to make a red run green:

- The render path was changed on purpose and you can say what each changed frame should look like (for example the
  phase 3 table above). Open the differing pictures in `golden/out/failures/` first.
- A case was added, removed or edited.
- The machine baseline moves on purpose (new Mac, new Chrome major): pass `--new-machine`, update everything, and say so
  in the commit.

Put the update in its own commit, separate from the code change, and put the list of changed cases in the message.
If a refactor was meant to change nothing and a frame moved, that is a regression: fix the code.
