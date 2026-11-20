// The WebGPU side of the vector motion blur probe (design 9.2): the flow probe's Lucas-Kanade flow (design 11.12) on
// real frames, then the blur methods the design compares, timed and written out. Driven by run.mjs.
import { KERNELS } from '../flow-probe/kernels.mjs'
import { BLUR_KERNELS } from './blur-kernels.mjs'

const WG = 16
const SIGMA = 2.0
let device
let pipelines
let sampler

async function init() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('no WebGPU adapter')
  device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 1 << 30),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 1 << 30),
    },
  })
  device.addEventListener('uncapturederror', (e) => console.error('GPU error', e.error?.message))
  pipelines = {}
  for (const [name, code] of Object.entries({ ...KERNELS, ...BLUR_KERNELS })) {
    const module = device.createShaderModule({ code })
    const info = await module.getCompilationInfo()
    for (const m of info.messages)
      if (m.type === 'error') throw new Error(`${name}: ${m.message} @${m.lineNum}`)
    pipelines[name] = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  }
  sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  const info = adapter.info ?? {}
  return { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: Boolean(adapter.isFallbackAdapter) }
}

const STORAGE = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
const buf = (size) => device.createBuffer({ size: Math.max(16, size), usage: STORAGE() })

function uniform(words) {
  const size = Math.max(16, Math.ceil((words.length * 4) / 16) * 16)
  const b = device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
  const dv = new DataView(b.getMappedRange())
  words.forEach((w, i) => {
    if (w.f !== undefined) dv.setFloat32(i * 4, w.f, true)
    else if (w.i !== undefined) dv.setInt32(i * 4, w.i, true)
    else dv.setUint32(i * 4, w, true)
  })
  b.unmap()
  return b
}

/** One dispatch: its kernel, its uniform's words, its other bindings (buffers, textures, the sampler), its grid */
function op(kernel, words, resources, w, h, { oneD = false, wg = WG } = {}) {
  const entries = [{ binding: 0, resource: { buffer: uniform(words) } }]
  resources.forEach((r, i) => {
    const resource = r instanceof GPUBuffer ? { buffer: r } : r instanceof GPUTexture ? r.createView() : r
    entries.push({ binding: i + 1, resource })
  })
  return {
    pipeline: pipelines[kernel],
    group: device.createBindGroup({ layout: pipelines[kernel].getBindGroupLayout(0), entries }),
    x: oneD ? Math.ceil(w / 256) : Math.ceil(w / wg),
    y: oneD ? 1 : Math.ceil(h / wg),
  }
}

async function run(ops) {
  const t0 = performance.now()
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  for (const o of ops) {
    pass.setPipeline(o.pipeline)
    pass.setBindGroup(0, o.group)
    pass.dispatchWorkgroups(o.x, o.y)
  }
  pass.end()
  device.queue.submit([enc.finish()])
  await device.queue.onSubmittedWorkDone()
  return performance.now() - t0
}

async function readback(buffer, size) {
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const enc = device.createCommandEncoder()
  enc.copyBufferToBuffer(buffer, 0, staging, 0, size)
  device.queue.submit([enc.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const out = staging.getMappedRange().slice(0)
  staging.unmap()
  staging.destroy()
  return out
}

async function fetchFrame(set, i) {
  const r = await fetch(`/frame?set=${set}&i=${i}`)
  if (!r.ok) throw new Error(`frame ${set} ${i}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

async function post(name, data) {
  const r = await fetch(`/out?name=${encodeURIComponent(name)}`, { method: 'POST', body: data })
  if (!r.ok) throw new Error(`post ${name}: ${r.status}`)
}

// --- The flow (the flow probe's plan, design 11.12) ----------------------------------------------------------------

function levelsFor(w0, h0) {
  const lv = [[w0, h0]]
  for (;;) {
    const [w, h] = lv[lv.length - 1]
    if (Math.min(w, h) >> 1 < 32) break
    lv.push([w >> 1, h >> 1])
  }
  return lv
}
function levelSettings(l, count) {
  const fromTop = count - 1 - l
  return { iters: fromTop < 3 ? 6 : l >= 2 ? 4 : 3, R: l <= 1 ? 2 : 3 }
}
function flowPlan(W, H, scale) {
  const w0 = Math.floor(W / scale)
  const h0 = Math.floor(H / scale)
  const lv = levelsFor(w0, h0)
  const col = [buf(W * H * 4), buf(W * H * 4)]
  const pyr = [0, 1].map(() => lv.map(([w, h]) => buf(w * h * 4)))
  const pyramidOps = []
  for (let f = 0; f < 2; f++) {
    pyramidOps.push(op('luma', [W, H, w0, h0, scale, 0, 0, 0], [col[f], pyr[f][0]], w0, h0))
    for (let l = 0; l + 1 < lv.length; l++)
      pyramidOps.push(op('down', [lv[l][0], lv[l][1], lv[l + 1][0], lv[l + 1][1]], [pyr[f][l], pyr[f][l + 1]], lv[l + 1][0], lv[l + 1][1]))
  }
  const dirs = [0, 1].map((d) => {
    const A = pyr[d]
    const B = pyr[1 - d]
    const flow = lv.map(([w, h]) => buf(w * h * 8))
    const tmp = lv.map(([w, h]) => buf(w * h * 8))
    const gr = lv.map(([w, h]) => buf(w * h * 8))
    const It = lv.map(([w, h]) => buf(w * h * 4))
    const ops = []
    for (let l = lv.length - 1; l >= 0; l--) {
      const [w, h] = lv[l]
      if (l === lv.length - 1) ops.push(op('zero', [w * h, 0, 0, 0], [flow[l]], w * h, 1, { oneD: true }))
      else ops.push(op('up', [w, h, lv[l + 1][0], lv[l + 1][1]], [flow[l + 1], flow[l]], w, h))
      ops.push(op('grad', [w, h, 0, 0], [A[l], gr[l]], w, h))
      const { iters, R } = levelSettings(l, lv.length)
      for (let k = 0; k < iters; k++) {
        ops.push(op('warpdiff', [w, h, 0, 0], [A[l], B[l], flow[l], It[l]], w, h))
        ops.push(op('lk', [w, h, { i: R }, { f: 1.5 }], [gr[l], It[l], flow[l], tmp[l]], w, h))
        ops.push(op('median', [w, h, 0, 0], [tmp[l], flow[l]], w, h))
      }
    }
    return { ops, flow0: flow[0] }
  })
  return { W, H, scale, w0, h0, rx: W / w0, ry: H / h0, col, pyramidOps, dirs }
}

/** Measures the gap from frame `a` to `b` (RGBA8 arrays) and keeps both flows in new buffers */
async function measureGap(plan, a, b) {
  device.queue.writeBuffer(plan.col[0], 0, a)
  device.queue.writeBuffer(plan.col[1], 0, b)
  const ms = await run([...plan.pyramidOps, ...plan.dirs[0].ops, ...plan.dirs[1].ops])
  const bytes = plan.w0 * plan.h0 * 8
  const fwd = buf(bytes)
  const bwd = buf(bytes)
  const enc = device.createCommandEncoder()
  enc.copyBufferToBuffer(plan.dirs[0].flow0, 0, fwd, 0, bytes)
  enc.copyBufferToBuffer(plan.dirs[1].flow0, 0, bwd, 0, bytes)
  device.queue.submit([enc.finish()])
  return { fwd, bwd, ms }
}

// --- The blur -----------------------------------------------------------------------------------------------------

function frameTexture(W, H) {
  return device.createTexture({
    size: { width: W, height: H },
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  })
}

/** A frame as linear light in its own texture, through the plan's first colour buffer */
async function uploadTexture(plan, rgba) {
  const tex = frameTexture(plan.W, plan.H)
  device.queue.writeBuffer(plan.col[0], 0, rgba)
  await run([op('totex', [plan.W, plan.H, 0, 0], [plan.col[0], tex], plan.W, plan.H)])
  return tex
}

/** Tiles of T flow pixels: the velocity buffers of one frame and its tile maxima */
function velocityBuffers(plan, T) {
  const tw = Math.ceil(plan.w0 / T)
  const th = Math.ceil(plan.h0 / T)
  return { V: buf(plan.w0 * plan.h0 * 16), TM: buf(tw * th * 8), NM: buf(tw * th * 8), tw, th, T }
}

/** The ops that turn the gaps around a frame into its velocity and tile maxima. `before`/`after` may be null. */
function velocityOps(plan, vb, before, after) {
  const mode = before && after ? 0 : after ? 1 : 2
  const fA = before?.fwd ?? after.fwd
  const bA = before?.bwd ?? after.bwd
  const fB = after?.fwd ?? before.fwd
  const bB = after?.bwd ?? before.bwd
  return [
    op('velocity', [plan.w0, plan.h0, mode, 0, { f: plan.rx }, { f: plan.ry }, { f: SIGMA }, { f: 0 }], [fA, bA, fB, bB, vb.V], plan.w0, plan.h0),
    op('tilemax', [plan.w0, plan.h0, vb.T, vb.tw, vb.th, 0, 0, 0], [vb.V, vb.TM], vb.tw, vb.th, { wg: 8 }),
    op('neighbormax', [vb.tw, vb.th, 0, 0], [vb.TM, vb.NM], vb.tw, vb.th, { wg: 8 }),
  ]
}

/**
 * One blur dispatch: the frame `tex` blurred along `vb` over `extent` source frames of motion (the shutter's share
 * of the frame interval this sample stands for), centred on its time, added into `acc` with `weight`.
 */
function blurOp(plan, vb, tex, acc, { extent, mode, weight, first, step, maxTaps, maxR }) {
  return op(
    'blur',
    [
      plan.W, plan.H, plan.w0, plan.h0,
      vb.tw, vb.th, vb.T, mode,
      { f: plan.rx }, { f: plan.ry }, { f: extent / 2 }, { f: maxR },
      { f: step }, { f: maxTaps }, { f: weight }, first ? 1 : 0,
    ],
    [tex, sampler, vb.V, vb.NM, acc],
    plan.W,
    plan.H,
  )
}

function addOp(plan, tex, acc, weight, first) {
  return op('addframe', [plan.W, plan.H, first ? 1 : 0, 0, { f: weight }, { f: 0 }, { f: 0 }, { f: 0 }], [tex, acc], plan.W, plan.H)
}

function warpOp(plan, gap, a, b, acc, t, weight, first) {
  return op(
    'warpacc',
    [plan.W, plan.H, plan.w0, plan.h0, { f: t }, { f: SIGMA }, { f: plan.rx }, { f: plan.ry }, { f: weight }, first ? 1 : 0, 0, 0],
    [a, b, sampler, gap.fwd, gap.bwd, acc],
    plan.W,
    plan.H,
  )
}

/**
 * The reference blur: `perUnit` frames per source frame interval, each the flow interpolation (or the real frame on a
 * whole position), over the window [from, to) in source frames relative to `textures[0]`, averaged in linear light.
 */
function referenceOps(plan, textures, gaps, acc, from, to, perUnit) {
  const count = Math.max(1, Math.round((to - from) * perUnit))
  const ops = []
  for (let k = 0; k < count; k++) {
    const p = from + ((k + 0.5) / count) * (to - from)
    const i = Math.floor(p)
    const t = p - i
    if (t < 1e-6) ops.push(addOp(plan, textures[i], acc, 1 / count, k === 0))
    else ops.push(warpOp(plan, gaps[i], textures[i], textures[i + 1], acc, t, 1 / count, k === 0))
  }
  return ops
}

function resolveOp(plan, acc, out) {
  return op('resolve', [plan.W, plan.H, 0, 0], [acc, out], plan.W, plan.H)
}

function median(a) {
  const s = [...a].sort((x, y) => x - y)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}
const summary = (a) => ({ median: median(a), min: Math.min(...a), max: Math.max(...a), n: a.length })

/** The motion of a velocity buffer: mean, p95 and max length in frame pixels per source frame */
async function motionOf(plan, vb) {
  const v = new Float32Array(await readback(vb.V, plan.w0 * plan.h0 * 16))
  const mags = new Float32Array(plan.w0 * plan.h0)
  for (let k = 0; k < mags.length; k++) mags[k] = Math.hypot(v[4 * k], v[4 * k + 1])
  const mean = mags.reduce((x, y) => x + y, 0) / mags.length
  mags.sort()
  return { meanPx: mean, p95Px: mags[Math.floor(mags.length * 0.95)], maxPx: mags[mags.length - 1] }
}

const QUALITY = { step: 1.0, maxTaps: 96, maxR: 96 }
const PREVIEW = { step: 2.5, maxTaps: 16, maxR: 96 }

/**
 * Timing on `pairs` consecutive frames: the flow of one gap, the velocity and tiles, and every blur variant, each
 * submitted alone and waited for (wall clock, median).
 */
async function timing({ set, W, H, scale, T, pairs, warmup = 2 }) {
  const plan = flowPlan(W, H, scale)
  const vb = velocityBuffers(plan, T)
  const acc = buf(W * H * 16)
  const stages = {}
  const add = (k, ms) => (stages[k] ??= []).push(ms)
  let frames = [await fetchFrame(set, 0), await fetchFrame(set, 1)]
  let before = await measureGap(plan, frames[0], frames[1])
  const textures = []
  const motions = []
  for (let i = 1; i <= pairs + warmup; i++) {
    const next = await fetchFrame(set, i + 1)
    const after = await measureGap(plan, frames[1], next)
    const tex = await uploadTexture(plan, frames[1])
    textures.push(tex)
    const velocity = await run(velocityOps(plan, vb, before, after))
    const variants = {
      'blur one line 180 quality': blurOp(plan, vb, tex, acc, { extent: 0.5, mode: 0, weight: 1, first: true, ...QUALITY }),
      'blur two halves 180 quality': blurOp(plan, vb, tex, acc, { extent: 0.5, mode: 2, weight: 1, first: true, ...QUALITY }),
      'blur two halves + edges 180 quality': blurOp(plan, vb, tex, acc, { extent: 0.5, mode: 3, weight: 1, first: true, ...QUALITY }),
      'blur two halves + edges 360 quality': blurOp(plan, vb, tex, acc, { extent: 1, mode: 3, weight: 1, first: true, ...QUALITY }),
      'blur two halves + edges 180 preview': blurOp(plan, vb, tex, acc, { extent: 0.5, mode: 3, weight: 1, first: true, ...PREVIEW }),
      'blur two halves + edges 360 preview': blurOp(plan, vb, tex, acc, { extent: 1, mode: 3, weight: 1, first: true, ...PREVIEW }),
    }
    const measured = { 'flow, one gap (both ways)': after.ms, 'velocity and tiles': velocity }
    for (const [k, o] of Object.entries(variants)) measured[k] = await run([o])
    if (textures.length >= 4) {
      const four = textures.slice(-4)
      measured['today: blend of 4 frames'] = await run(four.map((t, k) => addOp(plan, t, acc, 0.25, k === 0)))
      measured['4x 360 vector fill (4 blurs, two halves + edges, quality)'] = await run(
        four.map((t, k) => blurOp(plan, vb, t, acc, { extent: 1, mode: 3, weight: 0.25, first: k === 0, ...QUALITY })),
      )
      textures.shift().destroy()
    }
    if (i > warmup) for (const [k, ms] of Object.entries(measured)) add(k, ms)
    motions.push({ frame: i, ...(await motionOf(plan, vb)) })
    before.fwd.destroy()
    before.bwd.destroy()
    before = after
    frames = [frames[1], next]
  }
  for (const t of textures) t.destroy()
  // The light preview: flow at an eighth of the frame (480x360 here), the preview's taps
  const plan8 = flowPlan(W, H, scale * 2)
  const vb8 = velocityBuffers(plan8, Math.max(1, Math.round(T / 2)))
  let a = await fetchFrame(set, 0)
  let b = await fetchFrame(set, 1)
  let gapBefore = await measureGap(plan8, a, b)
  for (let i = 1; i <= Math.min(pairs, 8) + warmup; i++) {
    const c = await fetchFrame(set, i + 1)
    const gapAfter = await measureGap(plan8, b, c)
    const tex = await uploadTexture(plan8, b)
    const velocity = await run(velocityOps(plan8, vb8, gapBefore, gapAfter))
    const light = await run([blurOp(plan8, vb8, tex, acc, { extent: 0.5, mode: 3, weight: 1, first: true, ...PREVIEW })])
    if (i > warmup) {
      add('light preview: flow at 1/8, one gap', gapAfter.ms)
      add('light preview: velocity and tiles', velocity)
      add('light preview: blur 180', light)
    }
    tex.destroy()
    gapBefore.fwd.destroy()
    gapBefore.bwd.destroy()
    gapBefore = gapAfter
    a = b
    b = c
  }
  return { set, W, H, flow: [plan.w0, plan.h0], tile: T, motionPerFrame: motions, stagesMs: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, summary(v)])) }
}

/**
 * The stills of one section: frames 0..7 of the set. 1x at frame 2 (shutters 180 and 360): the frame itself, the
 * blur along one line, along two half lines, with the edges of faster neighbours, its preview settings, and the
 * reference of many interpolated frames; 90 and 270 for the look. 4x 360 over frames 2..5: today's blend, the vector
 * fill (two halves, with edges), and the reference over the same interval. Every picture goes to the server as RGBA8.
 */
async function stills({ set, W, H, scale, T, tag }) {
  const plan = flowPlan(W, H, scale)
  const rgba = []
  for (let i = 0; i < 8; i++) rgba.push(await fetchFrame(set, i))
  const gaps = []
  for (let i = 0; i < 7; i++) gaps.push(await measureGap(plan, rgba[i], rgba[i + 1]))
  const textures = []
  for (let i = 0; i < 8; i++) textures.push(await uploadTexture(plan, rgba[i]))
  const vbs = []
  for (let i = 1; i <= 6; i++) {
    const vb = velocityBuffers(plan, T)
    await run(velocityOps(plan, vb, gaps[i - 1], gaps[i]))
    vbs[i] = vb
  }
  const acc = buf(W * H * 16)
  const out = buf(W * H * 4)
  const emit = async (name, ops) => {
    await run([...ops, resolveOp(plan, acc, out)])
    await post(`${tag}_${name}`, new Uint8Array(await readback(out, W * H * 4)))
  }
  const n = 2
  await emit('frame', [addOp(plan, textures[n], acc, 1, true)])
  for (const [deg, extent] of [[180, 0.5], [360, 1]]) {
    await emit(`line${deg}`, [blurOp(plan, vbs[n], textures[n], acc, { extent, mode: 0, weight: 1, first: true, ...QUALITY })])
    await emit(`two${deg}`, [blurOp(plan, vbs[n], textures[n], acc, { extent, mode: 2, weight: 1, first: true, ...QUALITY })])
    await emit(`recon${deg}`, [blurOp(plan, vbs[n], textures[n], acc, { extent, mode: 3, weight: 1, first: true, ...QUALITY })])
    await emit(`preview${deg}`, [blurOp(plan, vbs[n], textures[n], acc, { extent, mode: 3, weight: 1, first: true, ...PREVIEW })])
    await emit(`ref${deg}`, referenceOps(plan, textures, gaps, acc, n - extent / 2, n + extent / 2, 32))
  }
  for (const [deg, extent] of [[90, 0.25], [270, 0.75]]) {
    await emit(`recon${deg}`, [blurOp(plan, vbs[n], textures[n], acc, { extent, mode: 3, weight: 1, first: true, ...QUALITY })])
  }
  {
    const plan8 = flowPlan(W, H, scale * 2)
    const vb8 = velocityBuffers(plan8, Math.max(1, Math.round(T / 2)))
    const g1 = await measureGap(plan8, rgba[1], rgba[2])
    const g2 = await measureGap(plan8, rgba[2], rgba[3])
    await run(velocityOps(plan8, vb8, g1, g2))
    await emit('light180', [blurOp(plan8, vb8, textures[n], acc, { extent: 0.5, mode: 3, weight: 1, first: true, ...PREVIEW })])
    await emit('light360', [blurOp(plan8, vb8, textures[n], acc, { extent: 1, mode: 3, weight: 1, first: true, ...PREVIEW })])
  }
  // 4x, 360 degrees: samples 2..5 (today's plan), each standing for one source frame interval, centred on it
  await emit('blend4', [2, 3, 4, 5].map((i, k) => addOp(plan, textures[i], acc, 0.25, k === 0)))
  await emit('vfill4two', [2, 3, 4, 5].map((i, k) => blurOp(plan, vbs[i], textures[i], acc, { extent: 1, mode: 2, weight: 0.25, first: k === 0, ...QUALITY })))
  await emit('vfill4recon', [2, 3, 4, 5].map((i, k) => blurOp(plan, vbs[i], textures[i], acc, { extent: 1, mode: 3, weight: 0.25, first: k === 0, ...QUALITY })))
  await emit('ref4', referenceOps(plan, textures, gaps, acc, 1.5, 5.5, 16))
  const motion = await motionOf(plan, vbs[n])
  for (const t of textures) t.destroy()
  return { tag, motion }
}

window.probe = { init, timing, stills }
window.probeReady = true
