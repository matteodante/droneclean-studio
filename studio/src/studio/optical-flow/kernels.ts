// The optical-flow kernels (task 11.12), ported from the probe that measured them (`bench/flow-probe/kernels.mjs`,
// design `docs/designs/11.12-optical-flow-slow-motion.md`): a coarse-to-fine Lucas-Kanade flow on luma, both ways, and
// the frame at any phase between the two frames.
//
// Design 11.24 (20 Nov 2026, measured on clip 0020 with the probe's `--retime` runs, `bench/flow-probe/kernels-v2.mjs`)
// replaced the interpolation with a forward warp, Twixtor's "Forward" and the Middlebury method (Baker et al. 2011):
//   splat     every flow pixel of both frames is carried to where it is at the phase; where several land on one pixel
//             the one whose two ends look most alike wins (`atomicMin` of the luma difference, quantized, then its
//             direction and index). The 11.12 interpolation searched backwards from each output pixel instead, and at a
//             motion edge (a thin summit against the sky) it could land on the wrong layer and swirl it;
//   resolve   the winner's vector, as the motion from frame 0 to frame 1 of the content at that pixel at the phase;
//   fill      a pixel nothing landed on takes the mean of its found neighbours (FILL_PASSES times, outside in);
//   the frame each output pixel takes the two frames where that motion puts it, trusting a frame where its own flow
//             there moves with it (the other frame carries what one cannot see); where neither does, it mixes the two
//             moved samples (never the unmoved frames, frame blending's double image); the frames are sampled
//             bicubically, clamped to the four nearest pixels, so a made frame is as sharp as the real ones.
// Measured against the 11.12 interpolation on the same flows: +1.0 to +3.1 dB on three sections of clip 0020 at gaps 2
// and 4 (design 11.24, §5.4).
//
// What changed from the probe, and nothing else:
//   - the frames are the pipeline's `rgba16float` textures of code values 0..1, not RGBA8 buffers: `luma` reads them
//     with `textureLoad` and scales luma to 0..255, so the Lucas-Kanade damping (`reg`) and step limit keep the units
//     the probe was tuned in;
//   - the interpolation is a fragment shader that draws into the pipeline's texture (any 0..1 or wider float value,
//     alpha included, nothing clamped to 8 bits), and rounds what it writes to the nearest half float as the
//     motion-blur gather does (the GPU would truncate);
//   - the flow kernels keep the probe's storage buffers: luma pyramids are array<f32>, flows array<vec2f> in pixels of
//     their own level.
//
// Each compute kernel is its own module, so a pipeline with an automatic layout owns only the bindings its entry point
// uses. `cpu-reference.fixture.ts` is the CPU twin of every kernel here, line for line, for the tests.

/**
 * How the splat packs its key into 32 bits: the luma difference of a vector's two ends, quantized at `errorScale` steps a
 * level of 255 and capped at `errorMax`, above the direction bit (bit `indexBits`) and the flow pixel's index (bits 0 to
 * `indexBits` - 1). A flow of up to 2^21 pixels (the normal-detail flow of every frame up to 8K UHD) gets 10 bits of
 * difference at a quarter level; up to 2^22 (the high-detail flow of a frame up to 16.7 MP, the Avata 2's 3840x2880
 * included) 9 bits at half a level.
 */
export interface SplatPacking {
  readonly indexBits: 21 | 22
  readonly errorScale: number
  readonly errorMax: number
}

/** The most flow pixels the splat addresses (a 22-bit index) */
const SPLAT_MAX_PIXELS = 1 << 22

/**
 * The splat's packing for a flow of `flowPixels` pixels (see `SplatPacking`).
 *
 * @throws RangeError when the flow has more pixels than `SPLAT_MAX_PIXELS`.
 */
export function splatPackingFor(flowPixels: number): SplatPacking {
  if (flowPixels <= 1 << 21) return { indexBits: 21, errorScale: 4, errorMax: 1023 }
  if (flowPixels <= SPLAT_MAX_PIXELS) return { indexBits: 22, errorScale: 2, errorMax: 511 }
  throw new RangeError(`optical flow: a flow of ${flowPixels} pixels is more than the forward warp addresses (${SPLAT_MAX_PIXELS})`)
}

/** The compute kernels, by name: each has `main` as its entry point and one bind group (binding 0 its uniform). */
export const FLOW_KERNELS = {
  // colour frame (W x H, rgba16float) -> luma 0..255 at the flow's size (w x h), box average of s x s pixels
  luma: /* wgsl */ `
struct U { W: u32, H: u32, w: u32, h: u32, s: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var frame: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> outl: array<f32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  var acc = 0.0;
  for (var j = 0u; j < u.s; j++) {
    for (var i = 0u; i < u.s; i++) {
      let x = min(g.x * u.s + i, u.W - 1u);
      let y = min(g.y * u.s + j, u.H - 1u);
      let c = textureLoad(frame, vec2<u32>(x, y), 0).rgb;
      acc += 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    }
  }
  outl[g.y * u.w + g.x] = 255.0 * acc / f32(u.s * u.s);
}`,

  // 2x2 box downsample (w x h) -> (w2 x h2)
  down: /* wgsl */ `
struct U { w: u32, h: u32, w2: u32, h2: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w2 || g.y >= u.h2) { return; }
  let x0 = min(g.x * 2u, u.w - 1u); let x1 = min(g.x * 2u + 1u, u.w - 1u);
  let y0 = min(g.y * 2u, u.h - 1u); let y1 = min(g.y * 2u + 1u, u.h - 1u);
  dst[g.y * u.w2 + g.x] = 0.25 * (src[y0 * u.w + x0] + src[y0 * u.w + x1] + src[y1 * u.w + x0] + src[y1 * u.w + x1]);
}`,

  // central-difference gradient of the first image
  grad: /* wgsl */ `
struct U { w: u32, h: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> img: array<f32>;
@group(0) @binding(2) var<storage, read_write> gr: array<vec2<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let xm = max(g.x, 1u) - 1u; let xp = min(g.x + 1u, u.w - 1u);
  let ym = max(g.y, 1u) - 1u; let yp = min(g.y + 1u, u.h - 1u);
  let gx = 0.5 * (img[g.y * u.w + xp] - img[g.y * u.w + xm]);
  let gy = 0.5 * (img[yp * u.w + g.x] - img[ym * u.w + g.x]);
  gr[g.y * u.w + g.x] = vec2<f32>(gx, gy);
}`,

  // It = B(p + flow) - A(p)
  warpdiff: /* wgsl */ `
struct U { w: u32, h: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read> fl: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> It: array<f32>;
fn sampleB(p: vec2<f32>) -> f32 {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.w - 1u)), clamp(p.y, 0.0, f32(u.h - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.w - 1u); let y1 = min(y0 + 1u, u.h - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  let top = mix(B[y0 * u.w + x0], B[y0 * u.w + x1], fx);
  let bot = mix(B[y1 * u.w + x0], B[y1 * u.w + x1], fx);
  return mix(top, bot, fy);
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let i = g.y * u.w + g.x;
  It[i] = sampleB(vec2<f32>(f32(g.x), f32(g.y)) + fl[i]) - A[i];
}`,

  // one Lucas-Kanade step over a (2R+1)^2 window, damped, step-limited
  lk: /* wgsl */ `
struct U { w: u32, h: u32, R: i32, maxStep: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> gr: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> It: array<f32>;
@group(0) @binding(3) var<storage, read> fin: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> fout: array<vec2<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  var sxx = 0.0; var sxy = 0.0; var syy = 0.0; var bx = 0.0; var by = 0.0;
  let W = i32(u.w); let H = i32(u.h);
  for (var j = -u.R; j <= u.R; j++) {
    let y = clamp(i32(g.y) + j, 0, H - 1);
    for (var i = -u.R; i <= u.R; i++) {
      let x = clamp(i32(g.x) + i, 0, W - 1);
      let k = y * W + x;
      let d = gr[k]; let t = It[k];
      sxx += d.x * d.x; sxy += d.x * d.y; syy += d.y * d.y;
      bx += d.x * t; by += d.y * t;
    }
  }
  let n = f32((2 * u.R + 1) * (2 * u.R + 1));
  let reg = 1.0 * n;
  let a = sxx + reg; let d = syy + reg;
  let det = a * d - sxy * sxy;
  var step = vec2<f32>(-(d * bx - sxy * by) / det, -(-sxy * bx + a * by) / det);
  let len = length(step);
  if (len > u.maxStep) { step = step * (u.maxStep / len); }
  let idx = g.y * u.w + g.x;
  fout[idx] = fin[idx] + step;
}`,

  // 3x3 median of each flow component
  median: /* wgsl */ `
struct U { w: u32, h: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> fin: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> fout: array<vec2<f32>>;
fn med9(v: ptr<function, array<f32, 9>>) -> f32 {
  for (var i = 0; i < 5; i++) {
    var m = i;
    for (var j = i + 1; j < 9; j++) { if ((*v)[j] < (*v)[m]) { m = j; } }
    let t = (*v)[i]; (*v)[i] = (*v)[m]; (*v)[m] = t;
  }
  return (*v)[4];
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  var vx: array<f32, 9>; var vy: array<f32, 9>;
  var n = 0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let x = clamp(i32(g.x) + i, 0, i32(u.w) - 1);
      let y = clamp(i32(g.y) + j, 0, i32(u.h) - 1);
      let f = fin[y * i32(u.w) + x];
      vx[n] = f.x; vy[n] = f.y; n++;
    }
  }
  fout[g.y * u.w + g.x] = vec2<f32>(med9(&vx), med9(&vy));
}`,

  // coarse flow (wc x hc) -> fine flow (w x h), bilinear, values scaled to the fine level's pixels
  up: /* wgsl */ `
struct U { w: u32, h: u32, wc: u32, hc: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> fc: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> ff: array<vec2<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let rx = f32(u.w) / f32(u.wc); let ry = f32(u.h) / f32(u.hc);
  let px = clamp((f32(g.x) + 0.5) / rx - 0.5, 0.0, f32(u.wc - 1u));
  let py = clamp((f32(g.y) + 0.5) / ry - 0.5, 0.0, f32(u.hc - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, u.wc - 1u); let y1 = min(y0 + 1u, u.hc - 1u);
  let fx = px - f32(x0); let fy = py - f32(y0);
  let top = mix(fc[y0 * u.wc + x0], fc[y0 * u.wc + x1], fx);
  let bot = mix(fc[y1 * u.wc + x0], fc[y1 * u.wc + x1], fx);
  ff[g.y * u.w + g.x] = mix(top, bot, fy) * vec2<f32>(rx, ry);
}`,

  // the splat's buffer starts empty
  clear: /* wgsl */ `
struct U { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> z: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.n) { return; }
  z[g.x] = 0xffffffffu;
}`,

  // every flow pixel of both frames carried to where it is at phase t (into the 2 x 2 pixels around that point); where
  // several land on one pixel the one whose two ends differ least in luma wins: the difference, quantized, is the high
  // bits of an atomicMin, below it the direction (bit `bits`) and the flow pixel's index (`splatPackingFor`)
  splat: /* wgsl */ `
struct U { w: u32, h: u32, t: f32, bits: u32, scale: f32, cap: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> la: array<f32>;
@group(0) @binding(2) var<storage, read> lb: array<f32>;
@group(0) @binding(3) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> z: array<atomic<u32>>;
fn lumaAt(which: u32, p: vec2<f32>) -> f32 {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.w - 1u)), clamp(p.y, 0.0, f32(u.h - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.w - 1u); let y1 = min(y0 + 1u, u.h - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  if (which == 0u) {
    return mix(mix(la[y0 * u.w + x0], la[y0 * u.w + x1], fx), mix(la[y1 * u.w + x0], la[y1 * u.w + x1], fx), fy);
  }
  return mix(mix(lb[y0 * u.w + x0], lb[y0 * u.w + x1], fx), mix(lb[y1 * u.w + x0], lb[y1 * u.w + x1], fx), fy);
}
fn key(difference: f32, direction: u32, index: u32) -> u32 {
  return (min(u32(difference * u.scale), u.cap) << (u.bits + 1u)) | (direction << u.bits) | index;
}
fn land(p: vec2<f32>, value: u32) {
  let b = vec2<i32>(floor(p));
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let x = b.x + i; let y = b.y + j;
      if (x >= 0 && y >= 0 && x < i32(u.w) && y < i32(u.h)) { atomicMin(&z[u32(y) * u.w + u32(x)], value); }
    }
  }
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let i = g.y * u.w + g.x;
  let q = vec2<f32>(f32(g.x), f32(g.y));
  let f = f01[i];
  land(q + u.t * f, key(abs(la[i] - lumaAt(1u, q + f)), 0u, i));
  let b = f10[i];
  land(q + (1.0 - u.t) * b, key(abs(lb[i] - lumaAt(0u, q + b)), 1u, i));
}`,

  // the winner's vector as the motion from frame 0 to frame 1 (a frame-1 winner's backward vector, negated); z = 1 found
  resolve: /* wgsl */ `
struct U { n: u32, bits: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> z: array<u32>;
@group(0) @binding(2) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> ft: array<vec4<f32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.n) { return; }
  let v = z[g.x];
  if (v == 0xffffffffu) { ft[g.x] = vec4<f32>(0.0); return; }
  let index = v & ((1u << u.bits) - 1u);
  var f = f01[index];
  if (((v >> u.bits) & 1u) == 1u) { f = -f10[index]; }
  ft[g.x] = vec4<f32>(f, 1.0, 0.0);
}`,

  // a pixel nothing landed on takes the mean of its found 3 x 3 neighbours (one pass; the next pass reaches further)
  fill: /* wgsl */ `
struct U { w: u32, h: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> fin: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fout: array<vec4<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let c = fin[g.y * u.w + g.x];
  if (c.z > 0.0) { fout[g.y * u.w + g.x] = c; return; }
  var sum = vec2<f32>(0.0);
  var n = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let x = i32(g.x) + i; let y = i32(g.y) + j;
      if (x < 0 || y < 0 || x >= i32(u.w) || y >= i32(u.h)) { continue; }
      let o = fin[u32(y) * u.w + u32(x)];
      if (o.z > 0.0) { sum += o.xy; n += 1.0; }
    }
  }
  if (n > 0.0) { fout[g.y * u.w + g.x] = vec4<f32>(sum / n, 1.0, 0.0); } else { fout[g.y * u.w + g.x] = c; }
}`,

  // the coarsest level's flow starts at rest
  zero: /* wgsl */ `
struct U { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> ff: array<vec2<f32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.n) { return; }
  ff[g.x] = vec2<f32>(0.0, 0.0);
}`,
} as const

/** A compute kernel's name. */
export type FlowKernel = keyof typeof FLOW_KERNELS

/**
 * The frame at phase t between two frames (a render pass into the pipeline's texture), from the motion at t that the
 * splat, resolve and fill kernels left in `ft` (frame 0 to frame 1, at the flow's size, z = 1 where something landed):
 * the content at an output pixel moving by f sits at x - t f in frame 0 and x + (1 - t) f in frame 1. A frame is trusted
 * where its own flow there moves with f (`f01` at the frame-0 point, `-f10` at the frame-1 point, within `sig` frame
 * pixels): the other frame carries what one cannot see. Where neither is trusted the two moved samples are mixed by the
 * phase, or (`edges` 1, a clip's "hard edges: nearest frame") the frame more likely to see it is taken. The flows live
 * at (fw x fh) and are read bilinearly, scaled to the frame's pixels by (rx, ry); the frames are sampled bicubically
 * (Catmull-Rom), clamped to the range of the four nearest pixels so an edge never rings.
 */
export const INTERPOLATE_WGSL = /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, t: f32, sig: f32, rx: f32, ry: f32, edges: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var c0: texture_2d<f32>;
@group(0) @binding(2) var c1: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> ft: array<vec4<f32>>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

// A field of the flow's size at a frame position p, bilinearly, in frame pixels: 0 = f01, 1 = f10, 2 = the motion at t
fn fieldAt(which: u32, p: vec2<f32>) -> vec2<f32> {
  let px = clamp((p.x + 0.5) / u.rx - 0.5, 0.0, f32(u.fw - 1u));
  let py = clamp((p.y + 0.5) / u.ry - 0.5, 0.0, f32(u.fh - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, u.fw - 1u); let y1 = min(y0 + 1u, u.fh - 1u);
  let fx = px - f32(x0); let fy = py - f32(y0);
  let i00 = y0 * u.fw + x0; let i10 = y0 * u.fw + x1; let i01 = y1 * u.fw + x0; let i11 = y1 * u.fw + x1;
  var a: vec2<f32>; var b: vec2<f32>; var c: vec2<f32>; var d: vec2<f32>;
  if (which == 0u) {
    a = f01[i00]; b = f01[i10]; c = f01[i01]; d = f01[i11];
  } else if (which == 1u) {
    a = f10[i00]; b = f10[i10]; c = f10[i01]; d = f10[i11];
  } else {
    a = ft[i00].xy; b = ft[i10].xy; c = ft[i01].xy; d = ft[i11].xy;
  }
  return mix(mix(a, b, fx), mix(c, d, fx), fy) * vec2<f32>(u.rx, u.ry);
}

// The Catmull-Rom weights of the four pixels around a fractional position f (they sum to 1; at f = 0 they pick one pixel)
fn catmullRom(f: f32) -> vec4<f32> {
  let f2 = f * f;
  let f3 = f2 * f;
  return vec4<f32>(-0.5 * f3 + f2 - 0.5 * f, 1.5 * f3 - 2.5 * f2 + 1.0, -1.5 * f3 + 2.0 * f2 + 0.5 * f, 0.5 * f3 - 0.5 * f2);
}

fn texel(picture: texture_2d<f32>, x: i32, y: i32) -> vec4<f32> {
  return textureLoad(picture, vec2<i32>(clamp(x, 0, i32(u.W) - 1), clamp(y, 0, i32(u.H) - 1)), 0);
}

// The picture at p, bicubic over the 4 x 4 pixels around it (positions outside the frame read its edge), clamped to the
// range of the 2 x 2 nearest pixels: as sharp as the real frames, and no ringing beside an edge
fn colAt(picture: texture_2d<f32>, p: vec2<f32>) -> vec4<f32> {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.W - 1u)), clamp(p.y, 0.0, f32(u.H - 1u)));
  let base = floor(q);
  let wx = catmullRom(q.x - base.x);
  let wy = catmullRom(q.y - base.y);
  let x = i32(base.x) - 1;
  let y = i32(base.y) - 1;
  var sum = vec4<f32>(0.0);
  for (var j = 0; j < 4; j++) {
    var row = vec4<f32>(0.0);
    for (var i = 0; i < 4; i++) { row += wx[i] * texel(picture, x + i, y + j); }
    sum += wy[j] * row;
  }
  let a = texel(picture, x + 1, y + 1);
  let b = texel(picture, x + 2, y + 1);
  let c = texel(picture, x + 1, y + 2);
  let d = texel(picture, x + 2, y + 2);
  return clamp(sum, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
}

// The GPU truncates the value it stores in a half float: the picture is rounded to the nearest half before it is
// written (as the motion-blur gather does).
fn round_half(value: vec4f) -> vec4f {
  let a = abs(value);
  let step = exp2(floor(log2(max(a, vec4f(6.1035156e-5)))) - 10.0);
  return sign(value) * round(a / step) * step;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  // The fragment's position is the pixel's centre; the kernel works on the pixel's integer coordinates.
  let x = floor(position.xy);
  let t = u.t;
  let f = fieldAt(2u, x);
  let y0 = x - t * f;
  let y1 = x + (1.0 - t) * f;
  // a frame sees this content where its own flow there moves with it
  let e0 = length(fieldAt(0u, y0) - f);
  let e1 = length(fieldAt(1u, y1) + f);
  let s2 = u.sig * u.sig;
  let w0 = (1.0 - t) * exp(-e0 * e0 / s2);
  let w1 = t * exp(-e1 * e1 / s2);
  let ws = w0 + w1;
  let a = colAt(c0, y0);
  let b = colAt(c1, y1);
  let warped = (w0 * a + w1 * b) / max(ws, 1e-6);
  // Where neither frame is trusted, the two moved samples mixed by the phase (the unmoved frames would be a double image
  // of every moving edge), or with "hard edges: nearest frame" (edges = 1) the one of the frame more likely to see it
  var moved = (1.0 - t) * a + t * b;
  if (u.edges == 1u) { moved = select(b, a, w0 >= w1); }
  let k = smoothstep(0.02, 0.15, ws);
  return round_half(mix(moved, warped, k));
}
`
