# Gyroflow's engine as WebAssembly (task 6.1)

Gyroflow's own stabilization engine (`gyroflow-core`, GPL-3.0-or-later) compiled to WebAssembly, for DroneClean
Studio's editor: the web build and the desktop shell, both Chromium. It reads a clip through a callback, computes the
stabilization, and hands the editor what its GPU stage needs for every frame - the row matrices and the kernel
parameters exactly as Gyroflow's own wgpu path uploads them, and Gyroflow's warp shader itself with its coefficient
table, so the editor's WebGPU pipeline is built from Gyroflow's shader instead of a copy of it. It also warps a frame
on the CPU with Gyroflow's own kernel, which is the reference the editor's GPU warp is held to (tasks 6.2 and 6.3).

It is synchronous and single-threaded (rayon runs in its fallback mode on `wasm32`), so it belongs in a worker:
`js/gyro-worker.js` is that worker.

## What is here

| Path | What |
|---|---|
| `src/lib.rs` | The module: `Stabilizer` (the engine on one clip), `FrameData` (one frame's data), `ShaderAssets` (Gyroflow's warp shader), the file reader |
| `Cargo.toml`, `Cargo.lock` | The crate (`gyroflow-wasm`), on `../src/core` |
| `build.sh` | Builds `pkg/`: wasm-bindgen's ES module, and the `.wasm` after `wasm-opt -O3` |
| `pkg/` | The build's output (git-ignored) |
| `js/gyro-worker.js` | The worker: the package, `self` and a `FileReaderSync` handed to the message switch |
| `js/gyro-messages.js` | The worker's message switch: one message in, one reply out (the editor's contract test drives it with the wasm faked) |
| `js/gyro-worker.d.ts` | The worker's messages and replies, as types |
| `test/smoke.mjs` | Loads the package in Node (wasm bytes handed to `init`), no footage: the API, the smoothing methods, the warp shader's assets |
| `test/chrome-worker.test.mjs` | Runs the package in a Chrome worker on clip 0020 and compares with the reference; also the progress `open` reports and the clip's shader assets |
| `test/page.html` | The page the Chrome test drives: a `<input type="file">`, the worker, the measurements |
| `test/make-reference.cjs` | How the reference was recorded (from the spike, commit `7d34dce63`) |
| `test/reference/clip-0020.json` | What the engine computed for clip 0020 in Node: the numbers the Chrome run must equal |

## Building

Needs the Rust target `wasm32-unknown-unknown`, `wasm-bindgen` 0.2.130 and `wasm-opt` (Binaryen) on `PATH` (or in
`$WASM_BINDGEN` / `$WASM_OPT`).

```sh
gyroflow/wasm/build.sh          # → pkg/gyroflow_wasm.js, pkg/gyroflow_wasm.d.ts, pkg/gyroflow_wasm_bg.wasm
```

## The checks

```sh
gyroflow/scripts/verify.sh                                  # build, Node smoke test, Chrome worker test skipped
GYRO_CLIP=/path/to/clip.MP4 gyroflow/scripts/verify.sh      # also the Chrome worker test on that clip
```

The Chrome test needs `playwright-core` once: `cd gyroflow/wasm/test && npm install`. It hands the clip's *path* to
Chrome (`setInputFiles`), which reads the file itself in slices; the test never reads it.

What the checks hold, beyond the reference's numbers: the smoke test reads `Stabilizer.shaderAssets()` and checks the
kernel template's placeholders and licence header, the default model's functions, the identity digital lens and the
496-float coefficient table (its SHA-256 is printed); the Chrome test checks that `open` reported its progress while it
read, and that the clip's own lens profile gives assets again.

`test/reference/clip-0020.json` was recorded from the node spike of this task, at commit `7d34dce63` (the spike plus
one export, `frame_data_arrays`, and nothing else), on
`DJI_20261115124704_0020_D.MP4` (3.76 GB, 3840x2880, 59.94 fps, Avata 2): the info fields, and for each of the frames
0, 1, 2, 1000, 7200 and 13000 the fov, the minimal fov, the matrix count and stride, the first and last matrix, the
SHA-256 of all the matrices' little-endian float bytes and of the kernel parameters' bytes, plus the SHA-256 of the
RGBA8 output of the CPU warp of frame 1000. `test/make-reference.cjs` says how to record it again.

## The motion trace

`open` records the bytes the parsers consume from the clip (the container's tables and the motion samples: 46.1 MB of
clip 0020's 3.76 GB, 38.9 MB gzipped, where the read callback crosses 1.9 GB) and `motionTrace()` returns them as a blob.
Given back as the fifth argument of `Stabilizer.open` (the worker's `open` message carries it as `motionTrace`), the
same parsers run over those bytes and read the file for nothing: clip 0020 opens in 1.1 s, reading 0 bytes, instead of
3.4 to 6.4 s and 1.9 GB, with the same frame data bit for bit. The blob is the file's own bytes, not a parse of them, so
it stays valid when the engine changes. A blob of another size is refused (the worker then reads the file); bytes the
blob lacks are read from the file. The editor keeps blobs in `studio/src/studio/stabilization/motion-cache.ts`, keyed by
the file's name, size and modification time. `test/motion-trace.test.mjs` runs both opens on a clip in Chrome.

## The API

In JavaScript the names are the camelCase of the Rust ones (wasm-bindgen's `js_name`):

```js
import init, { Stabilizer } from './pkg/gyroflow_wasm.js'
await init()

const stabilizer = Stabilizer.open(file.size, file.name, (offset, length) => {
  // those bytes of the video, synchronously, as a Uint8Array
}, (progress) => {
  // optional: { bytesRead, fileSize, phase, orientations } - see "Progress" below
})
stabilizer.info()        // { input, output, fps, frames, orientations, smoothed_orientations, lens, lens_model,
                         //   frame_readout_time_ms, min_fov, fovs, bytes_read }
Stabilizer.smoothingMethods()  // [{ name, params: [{ name, description, default, min, max, unit }] }] - the same for
                               // every clip; a parameter that is a flag has `min`/`max` null and a boolean default
Stabilizer.shaderAssets(model, digitalLens)  // { lensModel, kernelWgsl, lensWgsl, digitalLensWgsl, coeffs, interpolation }
stabilizer.setSmoothing('Optimal path', { smoothness: 0.7 })   // or 'Default', 'Plain 3D', 'Fixed camera', 'No smoothing'
stabilizer.setFov(1.1)               // the output's field of view, as a zoom: 1 is the frame the engine fits
stabilizer.setAdaptiveZoom(4)         // seconds either way; 0 turns the adaptive zoom off
stabilizer.setHorizonLock(100, 0)    // per cent of the horizon to lock, and the roll it takes in degrees
stabilizer.lensProfile()             // the loaded profile as the object of a Gyroflow profile file
stabilizer.setLensProfile(json)      // loads one; the engine adapts it to the clip's size and frame rate
stabilizer.recompute()               // applies the settings changed since the last call - blocking
stabilizer.frameData(timestampUs)    // { matrices, matrixStride, params, mesh, fov, minimalFov, frame }
stabilizer.processRgba8(timestampUs, input, output)   // { fov, minimal_fov, backend }; the CPU warp
stabilizer.outputWidth(), stabilizer.outputHeight(), stabilizer.free()
```

The setters only change settings: until `recompute()` returns, `frameData` and `processRgba8` answer with the previous
settings' data.

`shaderAssets(model, digitalLens)` is the warp shader the editor's WebGPU stage (task 6.3) is built from, so none of
Gyroflow's WGSL or its coefficients has to be copied into the editor:

- `model` and `digitalLens` are the ids a lens profile names, its `distortion_model` and `digital_lens` (read them from
  `lensProfile()`); `null` gives the engine's defaults, and an unknown id gives its default too, as the engine itself
  does. `lensModel` says which one was used;
- `kernelWgsl` is `src/core/gpu/wgpu_undistort.wgsl` as it is, `LENS_MODEL_FUNCTIONS;`, `SCALAR`, `{texture_input}`,
  `{buffer_input}` and the SPDX header included — the editor applies the same transforms Gyroflow's own wgpu build
  does;
- `lensWgsl` is the model's functions and `digitalLensWgsl` the digital lens's (the identity pair when the profile has
  none);
- `coeffs` is the coefficient table of `stabilization/cpu_undistort.rs::COEFFS`, 496 floats, and `interpolation` is the
  pipeline constant the shader's sampling loop is compiled for (bilinear, 2, the only interpolation this module's CPU
  warp produces).

`frameData(us)` gives, for one frame:

- `matrices`: every sensor row's 4x4 as 16 floats, `2880 × 16` for a 4K frame with rolling-shutter correction, one
  matrix without it - the rotations, sensor shifts, lens-breathing scale that Gyroflow's GPU path writes into its
  matrix buffer;
- `params`: the bytes of Gyroflow's `KernelParams` (416), exactly what its wgpu path uploads as a uniform - sizes,
  strides, `f`, `c`, `k`, fov, flags, ... It is the struct of this module's CPU warp of an 8-bit frame:
  `max_pixel_value` and `pixel_value_limit` (byte offsets 352 and 364) are 255. Gyroflow's wgpu path writes 1.0 in both
  for a normalized texture format, which is what a WebGPU stage reading an `rgba8unorm` texture sets them to;
- `mesh`: the frame's undistortion mesh, empty when it has none;
- `fov`, `minimalFov`, `frame`.

All of them are copies in the JavaScript heap, not views into the module's memory.

## Progress

`open` blocks: it reads the clip, parses it and computes the stabilization (3–6 s and 1.9 GB of reads for the four minute
clip). When it is given a callback as its fourth argument, it calls it with

```js
{ bytesRead, fileSize, phase: 'reading', orientations: null }     // every 64 MiB read
{ bytesRead, fileSize, phase: 'smoothing', orientations }         // once, when the read is done
```

— 29 reports while opening clip 0020: 28 reading, then the smoothing one, whose `bytesRead` is `info().bytes_read`
(1,896,500,750). The read is 1.9 GB of a 3.76 GB file, so `bytesRead / fileSize` is **not** a percentage of the work:
show the bytes read and the phase, not a bar that stops at half. The calls happen on the engine's own thread, inside
`open`, so a worker can `postMessage` from them before it posts the reply (that is what `js/gyro-worker.js` does).
There is no report during the smoothing itself: the engine's smoothing has no progress hook.

## The worker

`js/gyro-worker.js` takes `{ id, type, ... }` and replies `{ id, result }` or `{ id, error }`: `open { file, progress }`
(with `progress: true` it also posts `{ type: 'progress', id, progress }` messages while it reads), `info`,
`lensProfile`, `shaderAssets { model, digitalLens }` (the `coeffs` transferred), `memory` (`{ bytes }`, the engine's wasm
heap), `smoothingMethods` (`Stabilizer.smoothingMethods()`, no `open` needed), `setSmoothing { method, params }`, `setFov { fov }`, `setAdaptiveZoom { windowSeconds }`,
`setHorizonLock { lockPercent, rollDegrees }`, `setLensProfile { json }`, `recompute`,
`frameData { timestampsUs }` (the typed arrays transferred), `processRgba8 { timestampUs, input }` (an ArrayBuffer of the
source frame; the output is transferred), `close`. The types are in `js/gyro-worker.d.ts`.

A `progress` message has no `result` and no `error`: a caller that asked for progress must check its `type` before it
reads a reply.

## Measured (Mac M4, Chrome 158, clip 0020)

- The wasm: 8,337,511 bytes after `wasm-opt -O3` (100,559 more than before task 6.3's assets: 8,236,952), 12,988,793
  before the optimiser in the last build.
- Chrome worker, clip 0020: opened in 3.0–7.3 s (the fastest run had the file in the OS cache), reading 1,896,500,750
  bytes of the 3,764,360,098 in the file, 461,674 orientations, the Avata 2 lens profile embedded in the file, output
  3840x2160. The engine's wasm heap: 2.2 MB before the open, 345.9 MB after it — 343.7 MB for the clip's motion data
  and its smoothing (task 6.3's slice A message, design 6.3 §5.6).
- `frameData`: 0.4–1.2 ms per frame (2880 row matrices + the kernel parameters, copied out); a `recompute()` after a
  settings change, 920–950 ms.
- The CPU warp of a 4K frame: 1.44 s (in Node, 1.49 s).
- `shaderAssets()`: the kernel template 40,658 characters, the default model's functions 3,047, 496 coefficients
  (SHA-256 `b03ec1a86f4833d29fbd5610066d9b57e77329dfe406053d3aa02423b0b0e1c5`).
- Progress: 29 reports while opening clip 0020, monotonic, the last one 1,896,500,750 bytes — `info().bytes_read`.
- Chrome's peak resident memory for the whole run (browser, GPU, renderer and worker processes): 1.68–1.85 GB, for a
  3.76 GB clip - less than half the file, so the browser streamed it; the same `open` in Node peaks at 625 MB, so most
  of it is the browser and the read buffers the worker allocates on the way.
- The six frames and the CPU warp of frame 1000 are identical to the Node reference bit for bit, hashes included, also
  after `wasm-opt`; so are the matrices and kernel parameters after each setting and back.

Not measured or not done: Gyroflow's own GPU path is not used (`setDevice(-1)`: it blocks on the device, which a
browser forbids, D6); the motion data is smoothed on the CPU only; no clip without an embedded lens profile was tried
(the profile database in `src/core/resources` is not bundled in this build, so such a clip needs `setLensProfile`);
the editor does not load the package yet, and Electron serving it from `file://` was not tried.
