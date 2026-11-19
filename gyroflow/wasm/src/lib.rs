//! Gyroflow's stabilization engine (`gyroflow-core`) as a WebAssembly module, for DroneClean Studio's editor - the web
//! build and the desktop shell, both Chromium.
//!
//! The video is streamed in: `Stabilizer.open(size, filename, read)` calls `read(offset, length)` for the bytes the
//! parsers want, 256 KiB at a time, so a 3.7 GB clip costs the module only the 1.9 GB of motion data and the browser
//! never holds the file in memory (in a worker, `read` is `FileReaderSync` on a `File` slice).
//!
//! `open` parses the motion data and the lens profile, smooths the motion and computes the zoom, blocking (about three
//! seconds for a four minute clip); when it is given a progress callback it reports the bytes it read and, once the
//! read is done, the orientations it found. Then:
//!
//! - `frameData(timestampUs)` gives, for one frame, the row matrices and the kernel parameters exactly as Gyroflow's own
//!   wgpu path uploads them, as typed arrays in the JavaScript heap: what the editor's WebGPU warp (task 6.3) draws with.
//! - `shaderAssets(model, digitalLens)` gives Gyroflow's own warp shader - the kernel template, the lens model's
//!   functions and the coefficient table - as text and typed arrays, so the editor's warp is built from Gyroflow's
//!   shader instead of a copy of it (task 6.3).
//! - `processRgba8(timestampUs, input, output)` warps a frame with the engine's own CPU kernel: the reference the GPU
//!   warp is held to (tasks 6.2 and 6.3).
//!
//! The setters (`setFov`, `setSmoothing`, ...) only change settings; `recompute()` applies them. Frame data taken after
//! a setter and before `recompute()` is the data of the previous settings. Everything is synchronous and single
//! threaded (rayon runs in its fallback mode on wasm32): put it in a worker, as `js/gyro-worker.js` does.
//!
//! The engine's own GPU path is not used (`setDevice(-1)`): it blocks on the device, which a browser forbids (D6).

use std::collections::BTreeMap;
use std::io::{ Error, ErrorKind, Read, Seek, SeekFrom };
use std::sync::Arc;

use gyroflow_core::StabilizationManager;
use gyroflow_core::gpu::{ BufferDescription, BufferSource, Buffers };
use gyroflow_core::smoothing::Smoothing;
use gyroflow_core::stabilization::{ ComputeParams, KernelParams, RGBA8, COEFFS, Interpolation };
use gyroflow_core::stabilization::distortion_models::DistortionModel;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

/// The smallest read the video is streamed in with: the parsers ask for a few bytes at a time, the host `read`
/// callback is crossed about 7,500 times for a 4 GB clip instead of millions
const WINDOW: usize = 256 * 1024;

/// How much `open` reads between two progress reports
const PROGRESS_STEP: u64 = 64 * 1024 * 1024;

/// The kernel template the warp shader is built from - `gpu/wgpu_undistort.wgsl`, the file Gyroflow's own wgpu build
/// reads (`gpu/wgpu.rs:358`). It is returned as it is: the editor applies the transforms its WebGPU build applies, and
/// the lens model's functions and the placeholders are filled in from `shaderAssets`
const KERNEL_WGSL: &str = include_str!("../../src/core/gpu/wgpu_undistort.wgsl");

/// The functions a lens model without a digital lens still needs, as `gpu/wgpu.rs:362-366` writes them
const IDENTITY_DIGITAL_LENS_WGSL: &str = "fn digital_undistort_point(uv: vec2<f32>) -> vec2<f32> { return uv; }
fn digital_distort_point  (uv: vec2<f32>) -> vec2<f32> { return uv; }";

// ---------------------------------------------------------------------------------------------------------------------
// The engine

/// A video read through a callback, with a read-ahead window so the parsers' small reads don't each cross to the host
pub struct CallbackReader<F: FnMut(u64, usize) -> Vec<u8>> {
    read_fn: F,
    size: u64,
    pos: u64,
    window: Vec<u8>,
    window_start: u64,
    /// How many bytes were fetched through the callback, for `info().bytesRead`
    pub bytes: u64,
}
impl<F: FnMut(u64, usize) -> Vec<u8>> CallbackReader<F> {
    pub fn new(read_fn: F, size: u64) -> Self {
        Self { read_fn, size, pos: 0, window: Vec::new(), window_start: 0, bytes: 0 }
    }
}
impl<F: FnMut(u64, usize) -> Vec<u8>> Read for CallbackReader<F> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let want = (out.len() as u64).min(self.size.saturating_sub(self.pos)) as usize;
        let mut done = 0;
        while done < want {
            let end = self.window_start + self.window.len() as u64;
            if self.pos >= self.window_start && self.pos < end {
                let from = (self.pos - self.window_start) as usize;
                let n = (want - done).min(self.window.len() - from);
                out[done..done + n].copy_from_slice(&self.window[from..from + n]);
                done += n;
                self.pos += n as u64;
                continue;
            }
            let len = ((want - done).max(WINDOW) as u64).min(self.size - self.pos) as usize;
            let data = (self.read_fn)(self.pos, len);
            if data.is_empty() {
                return Err(Error::new(ErrorKind::UnexpectedEof, format!("the read callback returned no bytes for {len} at {offset}", offset = self.pos)));
            }
            self.bytes += data.len() as u64;
            self.window_start = self.pos;
            self.window = data;
        }
        Ok(done)
    }
}
impl<F: FnMut(u64, usize) -> Vec<u8>> Seek for CallbackReader<F> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let to = match pos {
            SeekFrom::Start(p)   => Some(p),
            SeekFrom::End(d)     => self.size.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        }.ok_or_else(|| Error::new(ErrorKind::InvalidInput, "invalid seek"))?;
        self.pos = to;
        Ok(to)
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The motion trace: what the parsers read, kept so the next open of the same file does not read it again

/// The first bytes of a motion trace: the format and its version
const TRACE_MAGIC: &[u8; 8] = b"DCMTRC01";

/// The bytes the parsers actually consumed from a video, by offset, disjoint and merged. Recording is what makes the
/// next open cheap: a 3.7 GB clip is read in 256 KiB windows (1.9 GB crossed the callback), but the parsers consume
/// only the container's tables and the motion samples, which is all the second open needs to be given
#[derive(Default)]
struct RangeStore {
    ranges: BTreeMap<u64, Vec<u8>>,
}
impl RangeStore {
    /// Adds the bytes at `offset`, merging with what is adjacent or overlapping (the bytes of a file are the same
    /// whenever they are read, so the first copy of an overlap is kept)
    fn add(&mut self, offset: u64, bytes: &[u8]) {
        if bytes.is_empty() { return; }
        let end = offset + bytes.len() as u64;
        let (start, mut data) = match self.ranges.range(..=offset).next_back() {
            Some((&s, v)) if s + v.len() as u64 >= offset => {
                if s + v.len() as u64 >= end { return; }
                let mut v = self.ranges.remove(&s).unwrap();
                v.truncate((offset - s) as usize);
                v.extend_from_slice(bytes);
                (s, v)
            }
            _ => (offset, bytes.to_vec()),
        };
        loop {
            let data_end = start + data.len() as u64;
            let Some((&s, _)) = self.ranges.range(start..).next() else { break };
            if s > data_end { break; }
            let v = self.ranges.remove(&s).unwrap();
            if s + v.len() as u64 > data_end { data.extend_from_slice(&v[(data_end - s) as usize..]); }
        }
        self.ranges.insert(start, data);
    }

    fn total(&self) -> u64 { self.ranges.values().map(|v| v.len() as u64).sum() }

    /// The trace blob: the magic, the video's size, the number of ranges, each range's offset and length, then the bytes
    fn to_blob(&self, file_size: u64) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.total() as usize + 20 + self.ranges.len() * 12);
        out.extend_from_slice(TRACE_MAGIC);
        out.extend_from_slice(&file_size.to_le_bytes());
        out.extend_from_slice(&(self.ranges.len() as u32).to_le_bytes());
        for (offset, data) in &self.ranges {
            out.extend_from_slice(&offset.to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        }
        for data in self.ranges.values() { out.extend_from_slice(data); }
        out
    }

    /// The reverse of `to_blob`, for a video of `file_size` bytes: a trace of another size, or one that is cut short, is an
    /// error
    fn from_blob(blob: &[u8], file_size: u64) -> Result<Vec<(u64, Vec<u8>)>, String> {
        let bad = |what: &str| format!("the motion trace is not usable: {what}");
        if blob.len() < 20 || &blob[..8] != TRACE_MAGIC { return Err(bad("wrong format")); }
        if u64::from_le_bytes(blob[8..16].try_into().unwrap()) != file_size { return Err(bad("it is of a file of another size")); }
        let count = u32::from_le_bytes(blob[16..20].try_into().unwrap()) as usize;
        let table_end = 20usize.checked_add(count.checked_mul(12).ok_or_else(|| bad("table"))?).ok_or_else(|| bad("table"))?;
        if blob.len() < table_end { return Err(bad("cut short")); }
        let mut at = table_end;
        let mut ranges = Vec::with_capacity(count);
        for i in 0..count {
            let e = 20 + i * 12;
            let offset = u64::from_le_bytes(blob[e..e + 8].try_into().unwrap());
            let len = u32::from_le_bytes(blob[e + 8..e + 12].try_into().unwrap()) as usize;
            if at + len > blob.len() || offset + len as u64 > file_size { return Err(bad("cut short")); }
            ranges.push((offset, blob[at..at + len].to_vec()));
            at += len;
        }
        if at != blob.len() { return Err(bad("trailing bytes")); }
        ranges.sort_by_key(|r| r.0);
        Ok(ranges)
    }
}

/// Reads through `R` and keeps every byte the parsers took
struct RecordingReader<R: Read + Seek> {
    inner: R,
    store: RangeStore,
}
impl<R: Read + Seek> Read for RecordingReader<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let pos = self.inner.stream_position()?;
        let n = self.inner.read(out)?;
        self.store.add(pos, &out[..n]);
        Ok(n)
    }
}
impl<R: Read + Seek> Seek for RecordingReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> { self.inner.seek(pos) }
}

/// Serves a video from a recorded trace; what the trace lacks (a parser that now wants other bytes) is read through
/// `fallback`, the real file, so a trace can make an open cheaper but never wrong
struct ReplayReader<R: Read + Seek> {
    ranges: Vec<(u64, Vec<u8>)>,
    size: u64,
    pos: u64,
    fallback: R,
}
impl<R: Read + Seek> Read for ReplayReader<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let want = (out.len() as u64).min(self.size.saturating_sub(self.pos)) as usize;
        if want == 0 { return Ok(0); }
        let i = self.ranges.partition_point(|r| r.0 <= self.pos);
        if i > 0 {
            let (start, data) = &self.ranges[i - 1];
            let end = start + data.len() as u64;
            if self.pos < end {
                let from = (self.pos - start) as usize;
                let n = want.min(data.len() - from);
                out[..n].copy_from_slice(&data[from..from + n]);
                self.pos += n as u64;
                return Ok(n);
            }
        }
        self.fallback.seek(SeekFrom::Start(self.pos))?;
        let n = self.fallback.read(&mut out[..want])?;
        self.pos += n as u64;
        Ok(n)
    }
}
impl<R: Read + Seek> Seek for ReplayReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let to = match pos {
            SeekFrom::Start(p)   => Some(p),
            SeekFrom::End(d)     => self.size.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        }.ok_or_else(|| Error::new(ErrorKind::InvalidInput, "invalid seek"))?;
        self.pos = to;
        Ok(to)
    }
}

/// What `open` reports while it runs: the bytes it has read so far and the file's size, then, once the read is done,
/// the orientations the file carried and that the engine is smoothing them. There is no report during
/// `recompute_blocking`, which has no hook of its own.
struct Progress {
    callback: Option<js_sys::Function>,
    bytes: u64,
    reported: u64,
}

impl Progress {
    fn new(callback: Option<js_sys::Function>) -> Self {
        Self { callback, bytes: 0, reported: 0 }
    }

    /// Counts the bytes a read returned, and reports them when `PROGRESS_STEP` went by since the last report
    fn read(&mut self, bytes: usize, file_size: u64) {
        self.bytes += bytes as u64;
        if self.bytes - self.reported >= PROGRESS_STEP {
            self.reported = self.bytes;
            self.send(serde_json::json!({
                "bytesRead": self.bytes,
                "fileSize": file_size,
                "phase": "reading",
                "orientations": serde_json::Value::Null,
            }));
        }
    }

    /// The read is done: what the engine found in it, and that it is smoothing now
    fn smoothing(&self, file_size: u64, orientations: usize) {
        self.send(serde_json::json!({
            "bytesRead": self.bytes,
            "fileSize": file_size,
            "phase": "smoothing",
            "orientations": orientations,
        }));
    }

    fn send(&self, progress: serde_json::Value) {
        let Some(callback) = &self.callback else { return };
        if let Ok(progress) = to_js(progress) {
            // A progress report the host's callback throws on is not the clip's failure: the open goes on
            let _ = callback.call1(&JsValue::NULL, &progress);
        }
    }
}

/// What a session remembers about the video: the engine, its sizes and frame rate, and what `open` read
pub struct Session {
    pub mgr: Arc<StabilizationManager>,
    pub input: (usize, usize),
    pub output: (usize, usize),
    pub fps: f64,
    pub frames: usize,
    pub bytes_read: u64,
    /// The bytes the parsers consumed, as a trace blob, when this open recorded one (an open given a trace has none)
    pub trace: Option<Vec<u8>>,
    /// Whether the open was served from a given trace
    pub replayed: bool,
}

impl Session {
    /// Opens a video through `read_fn`: parses the motion data and the lens profile, then computes the smoothing and
    /// the zoom, blocking; `progress` hears the bytes read and, once they are, what the file carried
    pub fn open<F: FnMut(u64, usize) -> Vec<u8>>(size: u64, filename: &str, mut read_fn: F, progress: Option<js_sys::Function>, trace: Option<&[u8]>) -> Result<Self, String> {
        let mgr = Arc::new(StabilizationManager::default());
        let mut progress = Progress::new(progress);
        let replay = trace.map(|blob| RangeStore::from_blob(blob, size)).transpose()?;
        let replayed = replay.is_some();
        let callback = CallbackReader::new(|offset, len| {
            let data = read_fn(offset, len);
            progress.read(data.len(), size);
            data
        }, size);
        let (md, bytes_read, trace) = match replay {
            Some(ranges) => {
                let mut reader = ReplayReader { ranges, size, pos: 0, fallback: callback };
                let md = mgr.load_video_file(&mut reader, size, filename, None, true).map_err(|e| format!("{e:?}"))?;
                (md, reader.fallback.bytes, None)
            }
            None => {
                let mut reader = RecordingReader { inner: callback, store: RangeStore::default() };
                let md = mgr.load_video_file(&mut reader, size, filename, None, true).map_err(|e| format!("{e:?}"))?;
                let blob = reader.store.to_blob(size);
                (md, reader.inner.bytes, Some(blob))
            }
        };
        // The readers are gone: their closure's borrow of `progress` ended, which reports the smoothing below
        progress.smoothing(size, mgr.gyro.read().quaternions.len());
        mgr.set_device(-1); // The engine's own GPU path blocks on its device, which a browser can't do: CPU here (D6)
        mgr.recompute_blocking();
        let (input, output, frames) = {
            let p = mgr.params.read();
            (p.size, p.output_size, p.frame_count)
        };
        Ok(Self { mgr, input, output, fps: md.fps, frames, bytes_read, trace, replayed })
    }

    /// The buffers a frame of this video has for the warp: RGBA8, no crop and no rotation
    fn buffers(&self) -> Buffers<'static> {
        Buffers {
            input: BufferDescription { size: (self.input.0, self.input.1, self.input.0 * 4), ..Default::default() },
            output: BufferDescription { size: (self.output.0, self.output.1, self.output.0 * 4), ..Default::default() },
        }
    }

    /// The fields `Stabilizer.info` reports
    pub fn info(&self) -> serde_json::Value {
        let gyro = self.mgr.gyro.read();
        let lens = self.mgr.lens.read();
        let p = self.mgr.params.read();
        serde_json::json!({
            "input": [self.input.0, self.input.1],
            "output": [self.output.0, self.output.1],
            "fps": self.fps,
            "frames": self.frames,
            "orientations": gyro.quaternions.len(),
            "smoothed_orientations": gyro.smoothed_quaternions.len(),
            "lens": lens.get_name(),
            "lens_model": format!("{:?}", lens.distortion_model),
            "frame_readout_time_ms": p.frame_readout_time,
            "min_fov": p.min_fov,
            "fovs": p.fovs.len(),
            "bytes_read": self.bytes_read,
            "motion_trace": if self.replayed { "replayed" } else { "recorded" },
        })
    }
}

/// The kernel parameters as Gyroflow's own GPU path uploads them, byte for byte: `bytemuck::bytes_of(&itm.kernel_params)`
/// in `gpu/wgpu.rs::undistort_image`
fn kernel_params_bytes(params: &KernelParams) -> &[u8] {
    // `KernelParams` is `repr(C, packed(4))` and holds integers, floats and arrays of them: every byte is part of it
    unsafe { std::slice::from_raw_parts(params as *const KernelParams as *const u8, std::mem::size_of::<KernelParams>()) }
}

fn to_js(value: serde_json::Value) -> Result<JsValue, JsValue> {
    js_sys::JSON::parse(&value.to_string()).map_err(|e| JsValue::from_str(&format!("{e:?}")))
}

// ---------------------------------------------------------------------------------------------------------------------
// The module

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(s: &str);
}

/// Installs a panic hook that reports a Rust panic in the console instead of stopping the module with `unreachable`
#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(|info| console_error(&info.to_string())));
}

/// Gyroflow's engine on one video: `Stabilizer.open` loads it, `frameData` and `processRgba8` ask it for frames, the
/// setters change what it computes and `recompute` applies them. Its methods block: use it in a worker.
#[wasm_bindgen]
pub struct Stabilizer {
    session: Session,
}

#[wasm_bindgen]
impl Stabilizer {
    /// Opens a video: `size` is its length in bytes, `filename` its name (the engine reads the camera and the lens
    /// profile out of the extension-less name and the embedded metadata), and `read(offset, length)` must return
    /// those bytes of the video synchronously, as an `Uint8Array`. Parses the motion data and computes the
    /// stabilization, blocking: about three seconds and 1.9 GB read for a four minute 4K clip.
    ///
    /// `onProgress`, when given, is called with `{ bytesRead, fileSize, phase, orientations }` every 64 MiB read
    /// (`phase: 'reading'`, `orientations: null`) and once the read is done (`phase: 'smoothing'`, the orientations
    /// the file carried). The calls happen on this thread, inside this call: a worker can `postMessage` from them
    /// before it posts this call's reply.
    pub fn open(size: f64, filename: &str, read: js_sys::Function, on_progress: Option<js_sys::Function>, motion_trace: Option<Vec<u8>>) -> Result<Stabilizer, JsValue> {
        let read_fn = move |offset: u64, len: usize| -> Vec<u8> {
            read.call2(&JsValue::NULL, &JsValue::from_f64(offset as f64), &JsValue::from_f64(len as f64))
                .ok()
                .map(|v| js_sys::Uint8Array::new(&v).to_vec())
                .unwrap_or_default()
        };
        let session = Session::open(size as u64, filename, read_fn, on_progress, motion_trace.as_deref()).map_err(|e| JsValue::from_str(&e))?;
        Ok(Self { session })
    }

    /// The motion trace this open recorded: the bytes the parsers consumed from the file (the container's tables and the
    /// motion samples, not the 1.9 GB the read callback crossed), as a blob that `open`'s `motionTrace` takes to open the
    /// same file again without reading it. `undefined` for an open that was given a trace. The blob is the file's own
    /// bytes, not a parse of them, so it stays valid when the engine changes; the caller keys it by the file's name, size
    /// and modification time.
    #[wasm_bindgen(js_name = motionTrace)]
    pub fn motion_trace(&self) -> Option<js_sys::Uint8Array> {
        self.session.trace.as_deref().map(js_sys::Uint8Array::from)
    }

    /// The video and what the engine made of it: `{ input: [w, h], output: [w, h], fps, frames, orientations,
    /// smoothed_orientations, lens, lens_model, frame_readout_time_ms, min_fov, fovs, bytes_read }`. `orientations` is
    /// how many motion samples the file carried (DJI records orientations, not raw gyro readings), `lens` the profile
    /// the engine found and `bytes_read` what `open` read through the callback.
    pub fn info(&self) -> Result<JsValue, JsValue> {
        to_js(self.session.info())
    }

    /// The smoothing methods the engine has, with each method's parameters: `[{ name, params: [{ name, description,
    /// default, min, max, unit }] }]`. The same for every clip; `min` and `max` are what the engine accepts for the
    /// parameter, `default` the value a new clip starts with. A method is chosen by name with `setSmoothing`, followed
    /// by `recompute()`.
    #[wasm_bindgen(js_name = smoothingMethods)]
    pub fn smoothing_methods() -> Result<JsValue, JsValue> {
        let names = Smoothing::default().get_names();
        let mut methods = Vec::with_capacity(names.len());
        for (id, name) in names.iter().enumerate() {
            let mut smoothing = Smoothing::default();
            smoothing.set_current(id);
            let params = smoothing.current().get_parameters_json();
            let params = params.as_array().map(|arr| arr.iter().map(|p| serde_json::json!({
                "name":        p.get("name"),
                "description": p.get("description"),
                "default":     p.get("default"),
                "min":         p.get("from"),
                "max":         p.get("to"),
                "unit":        p.get("unit"),
            })).collect::<Vec<_>>()).unwrap_or_default();
            methods.push(serde_json::json!({ "name": name, "params": params }));
        }
        to_js(serde_json::Value::Array(methods))
    }

    /// Gyroflow's warp shader, for the lens model a profile names: the kernel template (`gpu/wgpu_undistort.wgsl`, with
    /// its `LENS_MODEL_FUNCTIONS;`, `SCALAR` and `{buffer_input}` placeholders), the model's own functions, the digital
    /// lens's (the identity when there is none), and the coefficient table (`stabilization/cpu_undistort.rs::COEFFS`).
    /// Task 6.3's stage transforms the template into a WebGPU pipeline, so the editor's warp is Gyroflow's shader
    /// instead of a copy of it.
    ///
    /// `model` and `digitalLens` are the ids a lens profile carries (`"opencv_fisheye"`, `"poly3"`, ...): the
    /// `distortion_model` and `digital_lens` of `lensProfile()`. An absent or unknown id gives the engine's default
    /// (`opencv_fisheye`, as `ComputeParams::from_manager` picks it); `lensModel` says which one was used.
    /// `interpolation` is the pipeline constant the shader's sampling loop is compiled for: the module's own, bilinear.
    #[wasm_bindgen(js_name = shaderAssets)]
    pub fn shader_assets(model: Option<String>, digital_lens: Option<String>) -> ShaderAssets {
        let lens = DistortionModel::from_name(model.as_deref().unwrap_or("opencv_fisheye"));
        let digital_lens_wgsl = digital_lens.as_deref()
            .map(|id| DistortionModel::from_name(id).wgsl_functions())
            .unwrap_or(IDENTITY_DIGITAL_LENS_WGSL);
        ShaderAssets {
            lens_model: lens.id().to_string(),
            kernel_wgsl: KERNEL_WGSL.to_string(),
            lens_wgsl: lens.wgsl_functions().to_string(),
            digital_lens_wgsl: digital_lens_wgsl.to_string(),
            coeffs: js_sys::Float32Array::from(&COEFFS[..]),
            interpolation: Interpolation::Bilinear as u32,
        }
    }

    /// Chooses the smoothing method by the `name` of `smoothingMethods` and sets the parameters given in `params`, an
    /// object of numbers keyed by parameter name (the one's not given keep their value). Changes settings only: call
    /// `recompute()` to compute with them.
    #[wasm_bindgen(js_name = setSmoothing)]
    pub fn set_smoothing(&self, method: &str, params: JsValue) -> Result<(), JsValue> {
        let names = self.session.mgr.smoothing.read().get_names();
        let index = names.iter().position(|n| n == method).ok_or_else(|| JsValue::from_str(
            &format!("there is no smoothing method named {method:?}; the methods are {}", names.join(", "))
        ))?;
        self.session.mgr.set_smoothing_method(index);
        if params.is_undefined() || params.is_null() {
            return Ok(());
        }
        let object: js_sys::Object = params.dyn_into().map_err(|_| JsValue::from_str("the smoothing parameters must be an object of numbers"))?;
        for key in js_sys::Object::keys(&object).iter() {
            let key = key.as_string().ok_or_else(|| JsValue::from_str("a smoothing parameter name must be a string"))?;
            let value = js_sys::Reflect::get(&object, &JsValue::from_str(&key))?;
            let value = value.as_f64().ok_or_else(|| JsValue::from_str(&format!("the smoothing parameter {key:?} must be a number")))?;
            self.session.mgr.set_smoothing_param(&key, value);
        }
        Ok(())
    }

    /// The field of view of the output, as a zoom: 1 keeps the whole frame Gyroflow's zoom fits, more than 1 zooms in
    /// and crops the correction more (it can't leave the frame). Changes settings only: call `recompute()`.
    #[wasm_bindgen(js_name = setFov)]
    pub fn set_fov(&self, fov: f64) {
        self.session.mgr.set_fov(fov);
    }

    /// How far either way, in seconds, the zoom looks to fit the correction in the frame: 0 disables the adaptive
    /// zoom. Changes settings only: call `recompute()` (the zoom is what `recompute` computes; `frameData` then
    /// reports the new `fov`).
    #[wasm_bindgen(js_name = setAdaptiveZoom)]
    pub fn set_adaptive_zoom(&self, window_seconds: f64) {
        self.session.mgr.set_adaptive_zoom(window_seconds);
    }

    /// How much of the horizon to lock, 0 to 100 per cent, and the roll the locked horizon takes, in degrees. The other
    /// horizon-lock settings (pitch lock, automatic lock, turn settings) stay as they are. Changes settings only: call
    /// `recompute()`.
    #[wasm_bindgen(js_name = setHorizonLock)]
    pub fn set_horizon_lock(&self, lock_percent: f64, roll_degrees: f64) {
        let (lock_pitch, pitch, automatic_lock, turn_threshold, turn_smoothing_ms, turn_multiplier, tilt_accel_limit) = {
            let smoothing = self.session.mgr.smoothing.read();
            let h = &smoothing.horizon_lock;
            (h.lock_pitch, h.horizonpitch, h.automatic_lock, h.turn_threshold, h.turn_smoothing_ms, h.turn_multiplier, h.tilt_accel_limit)
        };
        self.session.mgr.set_horizon_lock(lock_percent, roll_degrees, lock_pitch, pitch, automatic_lock,
            turn_threshold, turn_smoothing_ms, turn_multiplier, tilt_accel_limit);
    }

    /// The lens profile the engine loaded, as the object of a Gyroflow profile file (its `name`, calibration size,
    /// camera matrix and distortion coefficients, ...).
    #[wasm_bindgen(js_name = lensProfile)]
    pub fn lens_profile(&self) -> Result<JsValue, JsValue> {
        let lens = serde_json::to_value(&*self.session.mgr.lens.read()).map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        to_js(lens)
    }

    /// Loads a lens profile from the JSON of a Gyroflow profile file (or the `lensProfile()` object as JSON). The
    /// engine adapts it to the video's size and frame rate. Changes settings only: call `recompute()`.
    #[wasm_bindgen(js_name = setLensProfile)]
    pub fn set_lens_profile(&self, json: &str) -> Result<(), JsValue> {
        self.session.mgr.load_lens_profile(json).map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }

    /// Sets the stabilized frame's aspect ratio: the output becomes the largest frame of the aspect `width:height` that
    /// fits inside the video (Gyroflow's own `set_output_size` rule: 3840x2880 asked for 16:9 gives 3840x2160, for 4:3
    /// 3840x2880, for 9:16 1620x2880; both sides stay even). Only the ratio of the two numbers matters. Changes
    /// settings only: call `recompute()`, which computes the zoom for the new frame; `info()` and `outputWidth` /
    /// `outputHeight` report the new size at once.
    #[wasm_bindgen(js_name = setOutputSize)]
    pub fn set_output_size(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        if width == 0 || height == 0 {
            return Err(JsValue::from_str("the output aspect must have a width and a height above 0"));
        }
        self.session.mgr.set_output_size(width as usize, height as usize);
        self.session.output = self.session.mgr.params.read().output_size;
        Ok(())
    }

    /// Recomputes the smoothing, the zoom and the frame data with the settings changed since the last call, blocking
    /// (about a second for a four minute clip). Until it returns, `frameData` and `processRgba8` answer with the
    /// previous settings' data.
    pub fn recompute(&self) {
        self.session.mgr.recompute_blocking();
    }

    /// Everything the warp of one frame needs, as `FrameData`: the row matrices, the kernel parameters, the lens's
    /// undistortion mesh and the zooms. `timestamp_us` is the frame's presentation time; the engine maps it to the
    /// frame itself. All the data are copies in the JavaScript heap, not views into the module's memory.
    #[wasm_bindgen(js_name = frameData)]
    pub fn frame_data(&self, timestamp_us: f64) -> FrameData {
        let timestamp_us = timestamp_us as i64;
        let transform = self.session.mgr.stabilization.read()
            .get_frame_transform_at::<RGBA8>(timestamp_us, None, &self.session.buffers());
        let frame = ComputeParams::from_manager(&self.session.mgr).frame_at_timestamp(timestamp_us as f64 / 1000.0).max(0) as usize;
        let matrices = transform.matrices.iter().flatten().copied().collect::<Vec<f32>>();
        FrameData {
            matrices: js_sys::Float32Array::from(&matrices[..]),
            params: js_sys::Uint8Array::from(kernel_params_bytes(&transform.kernel_params)),
            mesh: js_sys::Float32Array::from(&transform.mesh_data[..]),
            fov: transform.fov,
            minimal_fov: transform.minimal_fov,
            frame,
        }
    }

    /// Warps one frame with the engine's own CPU kernel, the one Gyroflow uses when it has no GPU: `input` is the
    /// source frame as RGBA8, `inputWidth * inputHeight * 4` bytes (straight from the decoder), and `output` receives
    /// the stabilized frame, `outputWidth * outputHeight * 4` bytes. Returns `{ fov, minimal_fov, backend }`. About
    /// 1.5 s for a 4K frame: tasks 6.2 and 6.3 use it as the reference.
    #[wasm_bindgen(js_name = processRgba8)]
    pub fn process_rgba8(&self, timestamp_us: f64, input: &mut [u8], output: &mut [u8]) -> Result<JsValue, JsValue> {
        let (iw, ih) = self.session.input;
        let (ow, oh) = self.session.output;
        if input.len() != iw * ih * 4 {
            return Err(JsValue::from_str(&format!("the source frame is {iw}x{ih} RGBA8, {} bytes, not {}", iw * ih * 4, input.len())));
        }
        if output.len() != ow * oh * 4 {
            return Err(JsValue::from_str(&format!("the stabilized frame is {ow}x{oh} RGBA8, {} bytes, not {}", ow * oh * 4, output.len())));
        }
        let mut buffers = Buffers {
            input: BufferDescription { size: (self.session.input.0, self.session.input.1, self.session.input.0 * 4), data: BufferSource::Cpu { buffer: input }, ..Default::default() },
            output: BufferDescription { size: (self.session.output.0, self.session.output.1, self.session.output.0 * 4), data: BufferSource::Cpu { buffer: output }, ..Default::default() },
        };
        let info = self.session.mgr.process_pixels::<RGBA8>(timestamp_us as i64, None, &mut buffers).map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        to_js(serde_json::json!({
            "backend": info.backend,
            "fov": info.fov,
            "minimal_fov": info.minimal_fov,
        }))
    }

    /// The width of the stabilized frame, in pixels
    #[wasm_bindgen(js_name = outputWidth)]
    pub fn output_width(&self) -> u32 { self.session.output.0 as u32 }

    /// The height of the stabilized frame, in pixels
    #[wasm_bindgen(js_name = outputHeight)]
    pub fn output_height(&self) -> u32 { self.session.output.1 as u32 }
}

/// Gyroflow's warp shader and the data it reads, as `Stabilizer.shaderAssets` returns them: everything task 6.3's
/// WebGPU stage needs, so that none of Gyroflow's WGSL or coefficients is copied into the editor
#[wasm_bindgen]
pub struct ShaderAssets {
    lens_model: String,
    kernel_wgsl: String,
    lens_wgsl: String,
    digital_lens_wgsl: String,
    coeffs: js_sys::Float32Array,
    interpolation: u32,
}

#[wasm_bindgen]
impl ShaderAssets {
    /// The id of the lens model whose functions `lensWgsl` holds (`"opencv_fisheye"`, `"poly3"`, ...), as the engine
    /// resolved it: the model the profile names, or the engine's default when it names none or an unknown one
    #[wasm_bindgen(getter, js_name = lensModel)]
    pub fn lens_model(&self) -> String { self.lens_model.clone() }

    /// The kernel template, as `gpu/wgpu_undistort.wgsl` is, `LENS_MODEL_FUNCTIONS;`, `SCALAR`, `{texture_input}`,
    /// `{buffer_input}` and the SPDX header included. Gyroflow's own build fills the placeholders in; so does task 6.3.
    #[wasm_bindgen(getter, js_name = kernelWgsl)]
    pub fn kernel_wgsl(&self) -> String { self.kernel_wgsl.clone() }

    /// The lens model's functions, where `LENS_MODEL_FUNCTIONS;` goes
    #[wasm_bindgen(getter, js_name = lensWgsl)]
    pub fn lens_wgsl(&self) -> String { self.lens_wgsl.clone() }

    /// The digital lens's functions, where Gyroflow puts them after the lens model's (the identity pair when the
    /// profile has no digital lens)
    #[wasm_bindgen(getter, js_name = digitalLensWgsl)]
    pub fn digital_lens_wgsl(&self) -> String { self.digital_lens_wgsl.clone() }

    /// The `coeffs` storage buffer's contents: Gyroflow's interpolation and drawing-colour table, `COEFFS` of
    /// `stabilization/cpu_undistort.rs`, 496 floats
    #[wasm_bindgen(getter)]
    pub fn coeffs(&self) -> js_sys::Float32Array { self.coeffs.clone() }

    /// The `interpolation` pipeline constant the shader's sampling loop is compiled for (`Interpolation::Bilinear`, 2):
    /// the only interpolation this module's CPU warp can produce
    #[wasm_bindgen(getter)]
    pub fn interpolation(&self) -> u32 { self.interpolation }
}

/// One frame's stabilization data, as `Stabilizer.frameData` returns it
#[wasm_bindgen]
pub struct FrameData {
    matrices: js_sys::Float32Array,
    params: js_sys::Uint8Array,
    mesh: js_sys::Float32Array,
    fov: f64,
    minimal_fov: f64,
    frame: usize,
}

#[wasm_bindgen]
impl FrameData {
    /// Every sensor row's matrix, flattened: `matrixStride` floats per row, sensor row `y` at `y * matrixStride`.
    /// The values are the ones Gyroflow's GPU path writes into its matrix buffer (`gpu/wgpu.rs::undistort_image`): the
    /// 3x3 rotation in the first 9, the sensor shift and rotation in the next 5, the lens breathing scale in the 15th.
    /// 2880 rows for a 4K frame with rolling-shutter correction, one row without it.
    #[wasm_bindgen(getter)]
    pub fn matrices(&self) -> js_sys::Float32Array { self.matrices.clone() }

    /// Floats per row matrix: 16
    #[wasm_bindgen(getter, js_name = matrixStride)]
    pub fn matrix_stride(&self) -> u32 { 16 }

    /// The frame's kernel parameters, the bytes of Gyroflow's `KernelParams` as its GPU path uploads them as a uniform:
    /// sizes, strides, focal length, lens center, distortion coefficients, field of view, flags, ...
    ///
    /// They are the parameters of this module's CPU warp of an 8-bit frame: `max_pixel_value` and `pixel_value_limit`
    /// are 255. Gyroflow's wgpu path writes 1.0 in both for a normalized texture format (`rgba8unorm`), which is what a
    /// WebGPU stage reading a normalized texture wants: set those two floats (byte offsets 352 and 364) to 1.0 there.
    #[wasm_bindgen(getter)]
    pub fn params(&self) -> js_sys::Uint8Array { self.params.clone() }

    /// The frame's undistortion mesh (the camera's own lens correction, when the file carries one), empty when the
    /// frame has none: the kernel flags in `params` say whether it is used.
    #[wasm_bindgen(getter)]
    pub fn mesh(&self) -> js_sys::Float32Array { self.mesh.clone() }

    /// The zoom applied to the frame, the number Gyroflow's UI shows as the field of view (1 is the fitted frame)
    #[wasm_bindgen(getter)]
    pub fn fov(&self) -> f64 { self.fov }

    /// The smallest field of view the zoom could use at this frame without leaving the frame
    #[wasm_bindgen(getter, js_name = minimalFov)]
    pub fn minimal_fov(&self) -> f64 { self.minimal_fov }

    /// The video frame the timestamp lands on
    #[wasm_bindgen(getter)]
    pub fn frame(&self) -> u32 { self.frame as u32 }
}
