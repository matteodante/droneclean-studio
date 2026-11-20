# The stabilization stage (task 6.3, slice B)

Gyroflow's warp as a WebGPU render pipeline: a source frame and one frame's stabilization data in, the clip's
stabilized picture out, into the caller's command encoder. It is the `source frame -> stabilize -> input colour ->
effects/LUT -> transform -> composite` step of PLAN.md §4. The renderer draws it through the stage pipeline (design 3.6,
`src/studio/render/stages/`): the stabilization stage (`stages/stabilize.ts`) runs the warp on the source frame, before
the input colour pass and the look, and FreeCut's draw takes the staged picture.

The shader is Gyroflow's, not a copy of it. `gyroflow/wasm` reads `gyroflow/src/core/gpu/wgpu_undistort.wgsl` with
`include_str!` and returns it from `Stabilizer.shaderAssets`, with the lens model's functions and the coefficient
table; `kernel.ts` applies the transforms Gyroflow's own WebGPU build applies plus the ones the browser and this stage
need. Nothing here is transcribed WGSL, and the assembled text keeps its SPDX header and copyright.

| File                                            | What                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `kernel.ts`                                     | Gyroflow's kernel template plus the six text transforms; throws when the template is not the text it knows       |
| `stage.ts`                                      | The pipeline, the buffers and `warp(encoder, input, output, frame)`; `prepareFrame` is the frame data's plumbing |
| `kernel.test.ts`                                | Each transform, on Gyroflow's own files (read from `gyroflow/`, as the module reads them)                        |
| `stage.test.ts`                                 | The uniform's two floats, the copies, the bindings against the shader text, the refusals, a source of any size   |
| `client.ts`, `client.test.ts`                   | The engines (one per file and settings), their windows of frames, settings changes, and their lifetime           |
| `seat.ts`, `seat.test.ts`                       | The engine host: the open, the item's settings followed, the timeline's items, frames by source frame            |
| `__fixtures__/fake-gyro-worker.ts`, `worker-contract.test.ts` | The fake worker the tests drive, held to the real worker's message switch (`gyroflow/wasm/js/gyro-messages.js`) |
| `probe.mjs`, `probe-page.html`, `probe-page.ts` | The probe: the stage against the module's CPU warp on clip 0020, in Chromium                                     |

## The interface

```ts
export interface StabilizationFrame {
  matrices: Float32Array
  params: Uint8Array
  mesh: Float32Array
}
export interface StabilizationAssets {
  kernelWgsl: string
  lensWgsl: string
  digitalLensWgsl: string
  coeffs: Float32Array
  interpolation: number
}
export interface StabilizationFormats {
  input: GPUTextureFormat
  output: GPUTextureFormat
}

export function createStabilizationStage(
  device: GPUDevice,
  assets: StabilizationAssets,
  formats: StabilizationFormats,
): Promise<StabilizationStage>

export interface StabilizationStage {
  warp(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    output: GPUTexture,
    frame: StabilizationFrame,
  ): void
}
```

- `assets` is the wasm module's `shaderAssets` reply as it is: `Stabilizer.shaderAssets(profile.distortion_model,
  profile.digital_lens)` through the worker's `shaderAssets` message (`gyroflow/wasm/js/gyro-worker.d.ts`). Its
  `coeffs` arrives transferred. `interpolation` is the pipeline constant the shader's sampling loop is compiled for.
- `formats` are both normalized float formats (`rgba8unorm`, `rgba16float`, `rgba32float`); anything else is refused
  with a message naming the design's reason. `rgba16float` is the precise path's input format (design 6.3 §0.5),
  `rgba8unorm` today's.
- `warp` records one full-screen draw into the caller's encoder and does **not** submit. `input` is the source frame at
  any size (the file's own, or a proxy's), `output` the stabilized picture at the clip's stabilized size
  (`stabilization.output`, from `info()`), which is checked against the frame's kernel parameters, so a caller that
  hands the wrong texture gets an error, not a frame of garbage. The transform, the crop and the effects then work at
  the stabilized size, unchanged.
- A source texture that is not the frame's own size keeps the frame's geometry (`f`, the matrices, the output plane)
  and is read through Gyroflow's source rect (`HAS_SOURCE_RECT`, as Gyroflow reads an input buffer of another size),
  with the lens centre moved by `0.5 - 0.5/s` because the rect maps pixel corners and the kernel indexes pixel centres.
  `stage.test.ts` follows the kernel's own mapping on a half-size source: 41.95 dB against the full-size source's
  picture (31.8 dB without the centre correction).
- The stage is per (input, output) format pair and its pipeline compiles asynchronously: build it when stabilization
  is switched on (1.5–2.0 s cold), never on the first frame.
- `prepareFrame` copies the frame's `params`, `matrices` and `mesh` into fresh arrays (a client may hand the stage a
  cache window's entry), writes 1.0 into `max_pixel_value` and `pixel_value_limit` (bytes 352 and 364) and checks the
  struct's size and the matrix count against the matrices' length.

The eight transforms of design 6.3 §4.1: six are text (`kernel.ts`, items 1–6: the buffer block, the lens functions,
`SCALAR` → `f32`, the module-scope binding's stage attribute, `params.flags`, and the −0.5 px fragment centre); two are
data (`stage.ts`, items 7 and 8: the two floats at 1.0, the coefficient table and the pipeline constant).

## The engine host and the stage (design 3.6)

`seat.ts` is the page's engine host: one engine per (media, settings fingerprint), its open result as data, its frames
by **integer source frame**, its engines let go when no clip uses them (`sync`, `release`): every stabilized clip of
a key counts, not only the one that opened its engine. It never writes the project and never draws.

The renderer reaches it through the stage pipeline (`src/studio/render/stages/`). The stabilization stage
(`stages/stabilize.ts`) prepares a clip outside the render (the engine's open, the warp built for the device, the size
in the session's derived-size store, which the layout reads: `stagedSourceDimensions`), answers whether a frame's data
is there (`ready`), and records the warp with the frame's bytes in the pipeline's arena. A prepared key stays ready only
while the engine and the assets its warp was built on serve it (`lost`, the host's `whenAssetsGone`): a key whose engine
the host closed is prepared again by the next frame that needs it. An export waits for what is missing, a minute at
most per frame, and stops with a `StageError` when the engine cannot answer; a preview holds the clip's last good staged
frame and says why. A staged clip is never drawn from a DOM `<video>` (finding S1): its frames come from the renderer's
source-frame provider, so the warp always gets the frame its data is for. Masks and canvas effects draw on the staged
picture too (finding R1).

## The checks

```sh
npx vp test run src/studio/stabilization                    # the transforms and the plumbing, no GPU, no footage
npm run golden -- --case stage-warp-rotation                # the stage's pixels, exact, on the real GPU (in studio/)
GYRO_CLIP=/path/to/clip0020.MP4 node src/studio/stabilization/probe.mjs   # the 45 dB check, on footage
```

### The golden case (`stage-warp-rotation`, task 6.3 slice C3)

It has no project: the case drives the stage directly (a project needs an engine with motion data, which no golden clip has). A synthetic 320x240
grid (a gradient, white and black lines every 16 px, two marked squares) is warped by the stage with a **2880-row
rotation** — one row matrix per sensor row, each a roll that changes by row — the engine's `opencv_fisheye` functions
with nonzero coefficients, a bilinear coefficient table, and a 320x180 output, and compared **exactly** with the stored
frame like every golden case. `golden/lib/stage-warp.mjs` bundles `golden/lib/warp-page.ts` (this folder's `stage.ts`
and `kernel.ts`) with the app's own bundler (`vite-plus`, the `vp build` the run already uses) and drives it in the
golden run's page; `golden/lib/stage-frame.mjs` builds the frame's picture, its 416 bytes of `KernelParams` and its
2880 row matrices in code, and `golden/lib/kit.test.mjs` pins their bytes. No footage and no wasm package are needed.

What it catches, each shown by making the change once, running the case and reverting it (the stored frame passes
again after each):

| Deliberate change | What the stored frame does |
| ----------------- | -------------------------- |
| `kernel.ts`: `FRAGMENT_CENTRE_OFFSET` `-0.5` → `0` (the −0.5 px correction) | mean 17.2 levels, 76.5 % of the pixels differ |
| the synthetic frame's `flags` 1 → 0 (transform 5: the frame's flags, not the pipeline's) | mean 5.2–8.9 levels, every pixel differs, max 20 |
| `stage.ts`: the `max_pixel_value`/`pixel_value_limit` rewrite removed (transform 7) | mean 128.8–149.5 levels, max 239: the frame turns white |

### The 45 dB check

The probe bundles `probe-page.ts` (and `stage.ts`, `kernel.ts`) with esbuild for the page, hands the clip's path to
Chrome (`setInputFiles`: the browser reads the file), warps frame 1000 of clip 0020 with the stage, and compares it
with the module's own CPU warp — the reference `gyroflow/wasm/test/reference/clip-0020.json` holds. It exits 1 under
**45 dB**, and 0 without `GYRO_CLIP` (the clip is footage, not part of the repository). It writes its record to the
system's temporary folder, never into the repository.

A run on 18 Nov 2026 (Mac M4, Chrome 158.0.8127.36, load average 13.00 / 9.85 / 9.09; `open` 5,002 ms and
1,896,500,750 bytes read; `frameData` 1.2 ms; CPU warp 1,441 ms; output 3840x2160):

| Output format                      | PSNR         | RMS          | max | pixels differing |
| ---------------------------------- | ------------ | ------------ | --- | ---------------- |
| `rgba16float` (the precise path's) | **52.84 dB** | 0.581 levels | 3   | 52.41 %          |
| `rgba8unorm` (today's)             | **52.50 dB** | 0.605        | 4   | 55.03 %          |

Those are the same dB, rms, maximum and share as this stage's record (three runs at load average 7.65 / 9.24 / 6.93,
6.31 / 6.11 / 6.10 and 13.23 / 8.50 / 7.09), on the reference's own frame (`input_sha256 20eaf913ef74cc50…`) and the
reference's own warp (`cbd7755da075c7cf…`), so a wrong decode or a different frame cannot pass quietly. Target 45 dB:
met with 7.8 dB to spare. The prototype that proved the port (`probes/6.3-warp/`) measured the same two numbers.

- The warp costs **3.60 ms** per 3840x2880 → 3840x2160 frame over 20 frames back to back, its 184,320 B of matrices
  uploaded, no readback (slice B measured 3.48, 4.12 and 4.17 ms on a busier machine; the prototype 3.30–3.65 ms).
- One warp and its readback: 17.2 ms for the draw and 18 ms for the readback in `rgba16float`; 16.5 ms and 7 ms in
  `rgba8unorm`.
- `open` took 5,002 ms in this run (slice B: 6,058–8,445 ms; 1,896,500,750 bytes read, 461,674 orientations, the file
  in the OS cache), and the engine's wasm heap went from 2.2 MB to 345.9 MB for the clip.
- A second model's stage (`poly3`) assembled and compiled in 13 ms (267 ms when Chrome had not cached it yet): the
  transforms work for every lens model, not only this clip's pinhole.

Not measured here: only clip 0020 was measured
— its profile is a pinhole (`opencv_fisheye` with zero coefficients), so a real fisheye correction's arithmetic is
exercised by the golden case's coefficients, not measured on footage.
