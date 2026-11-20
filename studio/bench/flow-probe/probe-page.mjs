// The WebGPU side of the optical-flow probe (design 11.12): a coarse-to-fine Lucas-Kanade flow, a bidirectional
// warp with consistency weights, and the two measurements that drive them (timing, quality). Driven by run.mjs.
import { KERNELS } from './kernels.mjs'

const WG = 16
let device
let pipelines
const SIGMA_FULL_RES_PX = 2.0

async function init() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('no WebGPU adapter')
  const info = adapter.info ?? {}
  device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 1 << 30),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 1 << 30),
    },
  })
  device.addEventListener('uncapturederror', (e) => console.error('GPU error', e.error?.message))
  pipelines = {}
  for (const [name, code] of Object.entries(KERNELS)) {
    const module = device.createShaderModule({ code })
    const info2 = await module.getCompilationInfo()
    for (const m of info2.messages)
      if (m.type === 'error') throw new Error(`${name}: ${m.message} @${m.lineNum}`)
    pipelines[name] = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    })
  }
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    description: info.description,
    isFallbackAdapter: Boolean(adapter.isFallbackAdapter),
    features: [...adapter.features].filter((f) => f.includes('timestamp')),
  }
}

function buf(
  size,
  usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
) {
  return device.createBuffer({ size: Math.max(16, size), usage })
}

function uniform(words) {
  const b = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM,
    mappedAtCreation: true,
  })
  const dv = new DataView(b.getMappedRange())
  words.forEach((w, i) => {
    if (w.f !== undefined) dv.setFloat32(i * 4, w.f, true)
    else if (w.i !== undefined) dv.setInt32(i * 4, w.i, true)
    else dv.setUint32(i * 4, w, true)
  })
  b.unmap()
  return b
}

function op(kernel, words, buffers, w, h, oneD = false) {
  const entries = [{ binding: 0, resource: { buffer: uniform(words) } }]
  buffers.forEach((b, i) => entries.push({ binding: i + 1, resource: { buffer: b } }))
  return {
    pipeline: pipelines[kernel],
    group: device.createBindGroup({ layout: pipelines[kernel].getBindGroupLayout(0), entries }),
    x: oneD ? Math.ceil(w / 256) : Math.ceil(w / WG),
    y: oneD ? 1 : Math.ceil(h / WG),
  }
}

function levelsFor(w0, h0) {
  const lv = [[w0, h0]]
  for (;;) {
    const [w, h] = lv[lv.length - 1]
    if (Math.min(w, h) >> 1 < 32) break
    lv.push([w >> 1, h >> 1])
  }
  return lv
}

/** Iterations and window radius per level (0 = finest). Coarse levels get more work: they are cheap. */
function levelSettings(l, count) {
  const fromTop = count - 1 - l
  return { iters: fromTop < 3 ? 6 : l >= 2 ? 4 : 3, R: l <= 1 ? 2 : 3 }
}

/** Everything one frame size and one flow scale needs, allocated once and reused for every pair. */
function buildPlan(W, H, scale) {
  const w0 = Math.floor(W / scale)
  const h0 = Math.floor(H / scale)
  const lv = levelsFor(w0, h0)
  const col = [buf(W * H * 4), buf(W * H * 4)]
  const pyr = [0, 1].map(() => lv.map(([w, h]) => buf(w * h * 4)))
  const pyramidOps = []
  for (let f = 0; f < 2; f++) {
    pyramidOps.push(op('luma', [W, H, w0, h0, scale, 0, 0, 0], [col[f], pyr[f][0]], w0, h0))
    for (let l = 0; l + 1 < lv.length; l++) {
      pyramidOps.push(
        op(
          'down',
          [lv[l][0], lv[l][1], lv[l + 1][0], lv[l + 1][1]],
          [pyr[f][l], pyr[f][l + 1]],
          lv[l + 1][0],
          lv[l + 1][1],
        ),
      )
    }
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
      if (l === lv.length - 1) ops.push(op('zero', [w * h, 0, 0, 0], [flow[l]], w * h, 1, true))
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
  return { W, H, scale, w0, h0, levels: lv, col, pyramidOps, dirs, interpOps: new Map() }
}

function interpOp(plan, t, out) {
  const rxy = [plan.W / plan.w0, plan.H / plan.h0]
  return op(
    'interp',
    [
      plan.W,
      plan.H,
      plan.w0,
      plan.h0,
      { f: t },
      { f: SIGMA_FULL_RES_PX },
      { f: rxy[0] },
      { f: rxy[1] },
    ],
    [plan.col[0], plan.col[1], plan.dirs[0].flow0, plan.dirs[1].flow0, out],
    plan.W,
    plan.H,
  )
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
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
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

function median(a) {
  const s = [...a].sort((x, y) => x - y)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}
const summary = (a) => ({
  median: median(a),
  min: Math.min(...a),
  max: Math.max(...a),
  mean: a.reduce((x, y) => x + y, 0) / a.length,
  n: a.length,
})

/** Timing: `pairs` consecutive pairs of a frame set, per stage and for the whole pair in one submission. */
async function timing({ set, W, H, scale, pairs, warmup = 2 }) {
  const plan = buildPlan(W, H, scale)
  const out = buf(W * H * 4)
  const interp = interpOp(plan, 0.5, out)
  const stages = { pyramid: [], flowFwd: [], flowBwd: [], interp: [], whole: [] }
  let prev = await fetchFrame(set, 0)
  for (let i = 0; i < pairs + warmup; i++) {
    const next = await fetchFrame(set, i + 1)
    device.queue.writeBuffer(plan.col[0], 0, prev)
    device.queue.writeBuffer(plan.col[1], 0, next)
    await device.queue.onSubmittedWorkDone()
    const s = {
      pyramid: await run(plan.pyramidOps),
      flowFwd: await run(plan.dirs[0].ops),
      flowBwd: await run(plan.dirs[1].ops),
      interp: await run([interp]),
      whole: await run([...plan.pyramidOps, ...plan.dirs[0].ops, ...plan.dirs[1].ops, interp]),
    }
    if (i >= warmup) for (const k of Object.keys(s)) stages[k].push(s[k])
    prev = next
  }
  return {
    set,
    W,
    H,
    scale,
    flowSize: [plan.w0, plan.h0],
    levels: plan.levels.length,
    dispatchesPerDirection: plan.dirs[0].ops.length,
    stagesMs: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, summary(v)])),
  }
}

async function post(name, data) {
  const r = await fetch(`/out?name=${encodeURIComponent(name)}`, { method: 'POST', body: data })
  if (!r.ok) throw new Error(`post ${name}: ${r.status}`)
}

/**
 * Quality: from `nFrames` consecutive frames, rebuild the frames between every `gap`-th pair at phases `ts` by
 * (nearest, blend, flow at each scale in `scales`); the predicted frames go to the server in order (pair, phase),
 * and the page returns the flow statistics.
 */
async function quality({ set, W, H, nFrames, gap, ts, scales, tag }) {
  const plans = scales.map((s) => {
    const p = buildPlan(W, H, s)
    const out = buf(W * H * 4)
    return { scale: s, plan: p, out, interps: ts.map((t) => interpOp(p, t, out)) }
  })
  const motion = []
  for (let i = 0; i + gap < nFrames; i += gap) {
    const a = await fetchFrame(set, i)
    const c = await fetchFrame(set, i + gap)
    const nearestBuf = []
    const blendBuf = []
    for (const t of ts) {
      nearestBuf.push(t < 0.5 || t === 0.5 ? a : c)
      const o = new Uint8Array(a.length)
      for (let k = 0; k < a.length; k++) o[k] = Math.round((1 - t) * a[k] + t * c[k])
      for (let k = 3; k < a.length; k += 4) o[k] = 255
      blendBuf.push(o)
    }
    for (let k = 0; k < ts.length; k++) {
      await post(`${tag}_nearest`, nearestBuf[k])
      await post(`${tag}_blend`, blendBuf[k])
    }
    for (const { scale, plan, out, interps } of plans) {
      device.queue.writeBuffer(plan.col[0], 0, a)
      device.queue.writeBuffer(plan.col[1], 0, c)
      await run([...plan.pyramidOps, ...plan.dirs[0].ops, ...plan.dirs[1].ops])
      for (let k = 0; k < ts.length; k++) {
        await run([interps[k]])
        const px = new Uint8Array(await readback(out, W * H * 4))
        await post(`${tag}_flow${scale}`, px)
      }
      if (scale === scales[0]) {
        const fl = new Float32Array(await readback(plan.dirs[0].flow0, plan.w0 * plan.h0 * 8))
        const mags = new Float32Array(plan.w0 * plan.h0)
        for (let k = 0; k < mags.length; k++) mags[k] = Math.hypot(fl[2 * k], fl[2 * k + 1]) * scale
        mags.sort()
        motion.push({
          i,
          meanPx: mags.reduce((x, y) => x + y, 0) / mags.length,
          p95Px: mags[Math.floor(mags.length * 0.95)],
          maxPx: mags[mags.length - 1],
        })
      }
    }
  }
  return { tag, motion }
}

window.probe = { init, timing, quality }
window.probeReady = true
