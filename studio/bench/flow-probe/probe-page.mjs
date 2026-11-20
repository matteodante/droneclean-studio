// The WebGPU side of the optical-flow probe (design 11.12): a coarse-to-fine Lucas-Kanade flow, a bidirectional
// warp with consistency weights, and the two measurements that drive them (timing, quality). Driven by run.mjs.
import { KERNELS } from './kernels.mjs'
import { KERNELS_V2 } from './kernels-v2.mjs'

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
  for (const [name, code] of Object.entries({ ...KERNELS, ...KERNELS_V2 })) {
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
    size: Math.max(32, Math.ceil((words.length * 4) / 16) * 16),
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
  // Design 11.24: the round-trip confidence of each direction at the flow's size, and the flow brought up to the
  // frame's size by a joint bilateral filter guided by the frame's luma (`kernels-v2.mjs`).
  const conf = [0, 1].map(() => buf(w0 * h0 * 4))
  const full = [0, 1].map(() => buf(W * H * 8))
  const refineOps = []
  for (let d = 0; d < 2; d++) {
    refineOps.push(op('conf', [w0, h0, { f: 1.0 }, 0], [dirs[d].flow0, dirs[1 - d].flow0, conf[d]], w0, h0))
  }
  for (let d = 0; d < 2; d++) {
    refineOps.push(
      op(
        'jbu',
        [W, H, w0, h0, { f: W / w0 }, { f: H / h0 }, { f: 12.0 }, 0],
        [col[d], pyr[d][0], dirs[d].flow0, conf[d], full[d]],
        W,
        H,
      ),
    )
  }
  // ... and the candidate pick on the refined flows (full-size luma of both frames, then one pick per direction)
  const lumFull = [0, 1].map(() => buf(W * H * 4))
  const picked = [0, 1].map(() => buf(W * H * 8))
  const pickOps = [0, 1].map((f) => op('luma', [W, H, W, H, 1, 0, 0, 0], [col[f], lumFull[f]], W, H))
  for (let d = 0; d < 2; d++) {
    pickOps.push(
      op(
        'pick',
        [W, H, w0, h0, { f: W / w0 }, { f: H / h0 }, { f: 0.5 }, 0],
        [lumFull[d], lumFull[1 - d], dirs[d].flow0, full[d], picked[d]],
        W,
        H,
      ),
    )
  }
  // Run 4: the vector choice at the flow's size, and the forward warp's buffers
  const pickedLow = [0, 1].map(() => buf(w0 * h0 * 8))
  const pickLowOps = [0, 1].map((d) =>
    op('pickl', [w0, h0, { i: 3 }, 0], [pyr[d][0], pyr[1 - d][0], dirs[d].flow0, pickedLow[d]], w0, h0),
  )
  if (w0 * h0 > 1 << 21) throw new Error('forward warp: the flow is too large for the splat index')
  const zbuf = buf(w0 * h0 * 4)
  const ft = [buf(w0 * h0 * 16), buf(w0 * h0 * 16)]
  return {
    W, H, scale, w0, h0, levels: lv, col, pyr, pyramidOps, dirs, refineOps, full, pickOps, picked,
    pickedLow, pickLowOps, zbuf, ft, interpOps: new Map(),
  }
}

/** The flows a variant reads: `low` today's, `full` refined, `picked` refined and picked, `picklow` picked at the flow's size */
function flowsOf(plan, which) {
  if (which === 'picked') return plan.picked
  if (which === 'full') return plan.full
  if (which === 'picklow') return plan.pickedLow
  return [plan.dirs[0].flow0, plan.dirs[1].flow0]
}

/** Run 4: the forward warp at phase t from `flows` (at the flow's size), drawn into `out` with interpolation `mode` */
function fwdOps(plan, t, out, { flows: which = 'low', mode = 6, fills = 8 }) {
  const { w0, h0, W, H } = plan
  const flows = flowsOf(plan, which)
  const n = w0 * h0
  const list = [
    op('fclear', [n, 0, 0, 0], [plan.zbuf], n, 1, true),
    op('fsplat', [w0, h0, { f: t }, 0], [plan.pyr[0][0], plan.pyr[1][0], flows[0], flows[1], plan.zbuf], w0, h0),
    op('fresolve', [n, 0, 0, 0], [plan.zbuf, flows[0], flows[1], plan.ft[0]], n, 1, true),
  ]
  for (let k = 0; k < fills; k++) {
    list.push(op('ffill', [w0, h0, 0, 0], [plan.ft[k % 2], plan.ft[(k + 1) % 2]], w0, h0))
  }
  list.push(
    op(
      'fwdinterp',
      [W, H, w0, h0, { f: t }, { f: SIGMA_FULL_RES_PX }, { f: W / w0 }, { f: H / h0 }, mode, 0, 0, 0],
      [plan.col[0], plan.col[1], flows[0], flows[1], plan.ft[fills % 2], out],
      W,
      H,
    ),
  )
  return list
}

/** The design 11.24 interpolation: `full` reads the refined flows, `mode` 1 = borders, 2 = warp fallback, 3 = both */
function interp2Op(plan, t, out, { full, picked = false, flows: which, mode }) {
  const [fw, fh] = full ? [plan.W, plan.H] : [plan.w0, plan.h0]
  const flows = which ? flowsOf(plan, which) : picked ? plan.picked : full ? plan.full : [plan.dirs[0].flow0, plan.dirs[1].flow0]
  return op(
    'interp2',
    [plan.W, plan.H, fw, fh, { f: t }, { f: SIGMA_FULL_RES_PX }, { f: plan.W / fw }, { f: plan.H / fh }, mode, 0, 0, 0],
    [plan.col[0], plan.col[1], flows[0], flows[1], out],
    plan.W,
    plan.H,
  )
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
  const interpBest = interp2Op(plan, 0.5, out, { full: true, picked: true, mode: 7 })
  const interpNew = interp2Op(plan, 0.5, out, { flows: 'low', mode: 6 })
  const forward = fwdOps(plan, 0.5, out, { flows: 'low' })
  const stages = {
    pyramid: [], flowFwd: [], flowBwd: [], interp: [], whole: [], refine: [], pick: [], interpBest: [], wholeBest: [],
    interpNew: [], pickLow: [], forward: [], wholePickForward: [],
  }
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
      refine: await run(plan.refineOps),
      pick: await run(plan.pickOps),
      interpNew: await run([interpNew]),
      pickLow: await run(plan.pickLowOps),
      forward: await run(forward),
      wholePickForward: await run([
        ...plan.pyramidOps,
        ...plan.dirs[0].ops,
        ...plan.dirs[1].ops,
        ...plan.pickLowOps,
        ...fwdOps(plan, 0.5, out, { flows: 'picklow' }),
      ]),
      interpBest: await run([interpBest]),
      wholeBest: await run([
        ...plan.pyramidOps,
        ...plan.dirs[0].ops,
        ...plan.dirs[1].ops,
        ...plan.refineOps,
        ...plan.pickOps,
        interpBest,
      ]),
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

// Run 4: RIFE (the editor's own model, `walterlow/RIFE_fp32_timestep`, downloaded once for this test with Matteo's OK)
// on onnxruntime-web's WebGPU backend, as `src/infrastructure/interpolation/rife-interpolator.ts` runs it: the frame
// padded to a multiple of 64 (edge pixels repeated), planar RGB 0..1, pinned input size.
let ort
const rifeSessions = new Map()
const rifeTimes = []
async function rifeSession(W, H) {
  const key = `${W}x${H}`
  if (rifeSessions.has(key)) return rifeSessions.get(key)
  if (!ort) {
    // a URL of run.mjs's server (onnxruntime-web's dist folder), not a module path
    const served = '/ort/ort.bundle.min.mjs'
    ort = await import(served)
    ort.env.wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.jsep.mjs', wasm: '/ort/ort-wasm-simd-threaded.jsep.wasm' }
    ort.env.wasm.numThreads = 1
  }
  const bytes = new Uint8Array(await (await fetch('/model')).arrayBuffer())
  const PW = Math.ceil(W / 64) * 64
  const PH = Math.ceil(H / 64) * 64
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    freeDimensionOverrides: { dynamic_dim_0: 1, dynamic_dim_1: 6, dynamic_dim_2: PH, dynamic_dim_3: PW },
  })
  const made = { session, PW, PH }
  rifeSessions.set(key, made)
  return made
}
async function rifeFrame(a, c, W, H, t) {
  const { session, PW, PH } = await rifeSession(W, H)
  const plane = PW * PH
  const input = new Float32Array(6 * plane)
  for (let y = 0; y < PH; y++) {
    const sy = Math.min(y, H - 1)
    for (let x = 0; x < PW; x++) {
      const s = (sy * W + Math.min(x, W - 1)) * 4
      const d = y * PW + x
      for (let ch = 0; ch < 3; ch++) {
        input[ch * plane + d] = a[s + ch] / 255
        input[(3 + ch) * plane + d] = c[s + ch] / 255
      }
    }
  }
  const tensor = new ort.Tensor('float32', input, [1, 6, PH, PW])
  const phase = new ort.Tensor('float32', new Float32Array([t]), [])
  const t0 = performance.now()
  const results = await session.run({ input: tensor, timestep: phase })
  rifeTimes.push(performance.now() - t0)
  const data = results.output.data
  const out = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = y * PW + x
      const d = (y * W + x) * 4
      for (let ch = 0; ch < 3; ch++) out[d + ch] = Math.max(0, Math.min(255, Math.round(data[ch * plane + s] * 255)))
      out[d + 3] = 255
    }
  }
  results.output.dispose?.()
  tensor.dispose?.()
  phase.dispose?.()
  return out
}

/** RIFE's time per frame at a size (after `warmup` runs): what `run.mjs` reports beside the GPU timings */
async function rifeTiming({ set, W, H, pairs = 8, warmup = 2 }) {
  const a = await fetchFrame(set, 0)
  const c = await fetchFrame(set, 1)
  const before = rifeTimes.length
  for (let i = 0; i < pairs + warmup; i++) await rifeFrame(a, c, W, H, 0.5)
  return { set, W, H, msPerFrame: summary(rifeTimes.slice(before + warmup)) }
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
async function quality({ set, W, H, nFrames, gap, ts, scales, variants = [], tag }) {
  const plans = scales.map((s) => {
    const p = buildPlan(W, H, s)
    const out = buf(W * H * 4)
    return { scale: s, plan: p, out, interps: ts.map((t) => interpOp(p, t, out)) }
  })
  // Design 11.24's variants: { name, scale, full, mode } on the plan of that scale (mode 0 is the 11.12 kernel)
  const variantOps = variants.map((v) => {
    const owner = plans.find((p) => p.scale === v.scale)
    if (!owner) throw new Error(`variant ${v.name}: no plan at scale ${v.scale}`)
    const out = buf(W * H * 4)
    if (v.kind === 'rife') return { ...v, owner, out, interps: [] }
    const interps = ts.map((t) =>
      v.kind === 'fwd'
        ? fwdOps(owner.plan, t, out, v)
        : v.mode === 0 && !v.full && !v.flows
          ? [interpOp(owner.plan, t, out)]
          : [interp2Op(owner.plan, t, out, v)],
    )
    return { ...v, owner, out, interps }
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
      const mine = variantOps.filter((v) => v.owner.plan === plan)
      const refine = [
        ...(mine.some((v) => v.full) ? plan.refineOps : []),
        ...(mine.some((v) => v.picked) ? plan.pickOps : []),
        ...(mine.some((v) => v.flows === 'picklow') ? plan.pickLowOps : []),
      ]
      await run([...plan.pyramidOps, ...plan.dirs[0].ops, ...plan.dirs[1].ops, ...refine])
      for (let k = 0; k < ts.length; k++) {
        await run([interps[k]])
        const px = new Uint8Array(await readback(out, W * H * 4))
        await post(`${tag}_flow${scale}`, px)
      }
      for (const v of variantOps.filter((v) => v.owner.plan === plan)) {
        for (let k = 0; k < ts.length; k++) {
          if (v.kind === 'rife') {
            await post(`${tag}_${v.name}`, await rifeFrame(a, c, W, H, ts[k]))
            continue
          }
          await run(v.interps[k])
          const px = new Uint8Array(await readback(v.out, W * H * 4))
          await post(`${tag}_${v.name}`, px)
        }
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

window.probe = { init, timing, quality, rifeTiming, rifeTimes: () => summary(rifeTimes) }
window.probeReady = true
