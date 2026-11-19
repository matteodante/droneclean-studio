// Records what Gyroflow's engine computes for clip 0020: the numbers the node spike of task 6.1 printed, so that the
// WebAssembly package built later can be held to them bit for bit (gyroflow/wasm/test/chrome-worker.test.mjs).
//
// Run it against commit 7d34dce63 (the spike, with one export added: `frame_data_arrays`) - the spike is gone from the
// tree after task 6.1. The spike's Node bindings are built there, and this script is pointed at them:
//
//   git worktree add --detach /tmp/gyro-ref 7d34dce63
//   /tmp/gyro-ref/gyroflow/spike/build.sh                     # needs wasm-bindgen on PATH or $WASM_BINDGEN
//   GYRO_SPIKE_PKG=/tmp/gyro-ref/gyroflow/spike/gf-pkg/gyroflow_web.js node make-reference.cjs "$GYRO_CLIP" out.json
//   git worktree remove /tmp/gyro-ref
//
// Usage: node make-reference.cjs <video> [out.json]
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const spikePkg = path.resolve(process.env.GYRO_SPIKE_PKG || path.join(__dirname, '../../spike/gf-pkg/gyroflow_web.js'))
const { Stabilizer } = require(spikePkg)

const frames = [0, 1, 2, 1000, 7200, 13000]
const warpFrame = 1000

const file = process.argv[2] || process.env.GYRO_CLIP
if (!file) {
  console.error('usage: node make-reference.cjs <video> [out.json]   (or set GYRO_CLIP)')
  process.exit(2)
}
const out = process.argv[3] || path.join(__dirname, 'reference', 'clip-0020.json')

// The hashes are of the little-endian bytes of the floats; on a big-endian machine they would be of big-endian ones
const probe = new Float32Array([1])
if (!(new Uint8Array(probe.buffer)[3] === 0x3f)) throw new Error('this script assumes a little-endian host')

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const f32Bytes = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)

const fd = fs.openSync(file, 'r')
const size = fs.fstatSync(fd).size
const read = (offset, length) => {
  const buf = Buffer.allocUnsafe(length)
  const n = fs.readSync(fd, buf, 0, length, offset)
  return new Uint8Array(buf.buffer, buf.byteOffset, n)
}

const cpu0 = process.cpuUsage()
let t = performance.now()
const stab = Stabilizer.open(size, path.basename(file), read)
const openMs = performance.now() - t
const openCpu = process.cpuUsage(cpu0)
const info = JSON.parse(stab.info())
console.log('opened in', Math.round(openMs), 'ms,', info.bytes_read, 'bytes read,', info.orientations, 'orientations,',
  'cpu/wall', ((openCpu.user + openCpu.system) / 1000 / openMs).toFixed(2))
if (!(info.frames > frames[frames.length - 1])) throw new Error(`frame ${frames[frames.length - 1]} is not inside the clip (${info.frames} frames)`)

const frameEntries = frames.map((frame) => {
  const timestampUs = Math.round((frame / info.fps) * 1000 * 1000)
  t = performance.now()
  const d = stab.frame_data_arrays(timestampUs)
  const ms = performance.now() - t
  const matrices = d.matrices
  const first = Array.from(matrices.slice(0, 16))
  const last = Array.from(matrices.slice(matrices.length - 16))
  console.log(`frame ${frame} (${timestampUs} us): fov ${d.fov.toFixed(9)}, minimal_fov ${d.minimal_fov.toFixed(9)}, ` +
    `${d.matrix_count} matrices of 16 floats, ${d.params.length} param bytes, ${ms.toFixed(1)} ms, engine frame ${d.frame}`)
  if (d.frame !== frame) throw new Error(`the engine's frame for ${timestampUs} us is ${d.frame}, not ${frame}`)
  return {
    frame,
    timestamp_us: timestampUs,
    fov: d.fov,
    minimal_fov: d.minimal_fov,
    matrix_count: d.matrix_count,
    matrix_stride: 16,
    first_matrix: first,
    last_matrix: last,
    matrices_sha256: sha256(f32Bytes(matrices)),
    kernel_params_bytes: d.params.length,
    kernel_params_sha256: sha256(d.params),
  }
})

// The CPU warp of one frame, on the frame as ffmpeg decodes it (as the spike did)
const [w, h] = info.input
const [ow, oh] = [stab.output_width(), stab.output_height()]
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${warpFrame})`, '-frames:v', '1',
  '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: w * h * 4 + 1024 })
if (raw.length !== w * h * 4) throw new Error(`expected ${w * h * 4} bytes of frame, got ${raw.length}`)
const input = new Uint8Array(raw)
const output = new Uint8Array(ow * oh * 4)
const warpTimestampUs = Math.round((warpFrame / info.fps) * 1000 * 1000)
t = performance.now()
const warp = JSON.parse(stab.process_rgba8(warpTimestampUs, input, output))
const warpMs = performance.now() - t
console.log(`warped frame ${warpFrame} (${warpTimestampUs} us) on the CPU in ${Math.round(warpMs)} ms:`, JSON.stringify(warp))

const reference = {
  note: 'Recorded from the node spike of task 6.1 (commit 7d34dce63, the spike with only `frame_data_arrays` added). ' +
    'The hashes are of the little-endian float bytes of the matrices and of the KernelParams bytes as the GPU path uploads them.',
  clip: path.basename(file),
  clip_bytes: size,
  info,
  open_ms: Math.round(openMs),
  frames: frameEntries,
  warp: {
    frame: warpFrame,
    timestamp_us: warpTimestampUs,
    width: ow,
    height: oh,
    input_sha256: sha256(input),
    output_sha256: sha256(output),
    ...warp,
  },
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(reference, null, 2) + '\n')
console.log('wrote', out)
