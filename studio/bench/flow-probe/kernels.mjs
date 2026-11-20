// WGSL for the optical-flow probe (design 11.12). Every kernel works on storage buffers: luma pyramids are
// array<f32>, flows array<vec2f> (pixel units of their own level), colour frames array<u32> (RGBA8, R in the low byte).
// Each kernel is its own module because a pipeline with an auto layout only owns the bindings its entry point uses.

export const KERNELS = {
  // colour frame (W x H) -> luma at flow-scale resolution (w x h), box average of s x s pixels
  luma: /* wgsl */ `
struct U { W: u32, H: u32, w: u32, h: u32, s: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> col: array<u32>;
@group(0) @binding(2) var<storage, read_write> outl: array<f32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  var acc = 0.0;
  for (var j = 0u; j < u.s; j++) {
    for (var i = 0u; i < u.s; i++) {
      let x = min(g.x * u.s + i, u.W - 1u);
      let y = min(g.y * u.s + j, u.H - 1u);
      let c = col[y * u.W + x];
      acc += 0.299 * f32(c & 255u) + 0.587 * f32((c >> 8u) & 255u) + 0.114 * f32((c >> 16u) & 255u);
    }
  }
  outl[g.y * u.w + g.x] = acc / f32(u.s * u.s);
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

  zero: /* wgsl */ `
struct U { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> ff: array<vec2<f32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.n) { return; }
  ff[g.x] = vec2<f32>(0.0, 0.0);
}`,

  // Bidirectional warp to time t with forward/backward consistency (occlusion) weights.
  // f01: flow frame0 -> frame1 in frame-0 coordinates; f10: frame1 -> frame0 in frame-1 coordinates.
  // Flows live at (fw x fh); they are read bilinearly and scaled to full-resolution pixels (rx, ry).
  interp: /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, t: f32, sig: f32, rx: f32, ry: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> c0: array<u32>;
@group(0) @binding(2) var<storage, read> c1: array<u32>;
@group(0) @binding(3) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> outc: array<u32>;

fn flowAt(which: u32, p: vec2<f32>) -> vec2<f32> {
  let px = clamp((p.x + 0.5) / u.rx - 0.5, 0.0, f32(u.fw - 1u));
  let py = clamp((p.y + 0.5) / u.ry - 0.5, 0.0, f32(u.fh - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, u.fw - 1u); let y1 = min(y0 + 1u, u.fh - 1u);
  let fx = px - f32(x0); let fy = py - f32(y0);
  var a: vec2<f32>; var b: vec2<f32>; var c: vec2<f32>; var d: vec2<f32>;
  if (which == 0u) {
    a = f01[y0 * u.fw + x0]; b = f01[y0 * u.fw + x1]; c = f01[y1 * u.fw + x0]; d = f01[y1 * u.fw + x1];
  } else {
    a = f10[y0 * u.fw + x0]; b = f10[y0 * u.fw + x1]; c = f10[y1 * u.fw + x0]; d = f10[y1 * u.fw + x1];
  }
  return mix(mix(a, b, fx), mix(c, d, fx), fy) * vec2<f32>(u.rx, u.ry);
}
fn unpack(c: u32) -> vec3<f32> {
  return vec3<f32>(f32(c & 255u), f32((c >> 8u) & 255u), f32((c >> 16u) & 255u));
}
fn colAt(which: u32, p: vec2<f32>) -> vec3<f32> {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.W - 1u)), clamp(p.y, 0.0, f32(u.H - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.W - 1u); let y1 = min(y0 + 1u, u.H - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  var a: vec3<f32>; var b: vec3<f32>; var c: vec3<f32>; var d: vec3<f32>;
  if (which == 0u) {
    a = unpack(c0[y0 * u.W + x0]); b = unpack(c0[y0 * u.W + x1]); c = unpack(c0[y1 * u.W + x0]); d = unpack(c0[y1 * u.W + x1]);
  } else {
    a = unpack(c1[y0 * u.W + x0]); b = unpack(c1[y0 * u.W + x1]); c = unpack(c1[y1 * u.W + x0]); d = unpack(c1[y1 * u.W + x1]);
  }
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let x = vec2<f32>(f32(g.x), f32(g.y));
  let t = u.t;
  // where, in each frame, the content that sits at x at time t came from / goes to (fixed-point on the flow)
  var y0 = x;
  for (var k = 0; k < 3; k++) { y0 = x - t * flowAt(0u, y0); }
  var y1 = x;
  for (var k = 0; k < 3; k++) { y1 = x - (1.0 - t) * flowAt(1u, y1); }
  let f0 = flowAt(0u, y0);
  let f1 = flowAt(1u, y1);
  // forward/backward consistency: following the flow there and back must land on the start
  let e0 = length(f0 + flowAt(1u, y0 + f0));
  let e1 = length(f1 + flowAt(0u, y1 + f1));
  let s2 = u.sig * u.sig;
  let w0 = (1.0 - t) * exp(-e0 * e0 / s2);
  let w1 = t * exp(-e1 * e1 / s2);
  let ws = w0 + w1;
  let warped = (w0 * colAt(0u, y0) + w1 * colAt(1u, y1)) / max(ws, 1e-6);
  let blend = (1.0 - t) * colAt(0u, x) + t * colAt(1u, x);
  let k = smoothstep(0.02, 0.15, ws);
  let o = clamp(mix(blend, warped, k), vec3<f32>(0.0), vec3<f32>(255.0)) + vec3<f32>(0.5);
  outc[g.y * u.W + g.x] = u32(o.x) | (u32(o.y) << 8u) | (u32(o.z) << 16u) | (255u << 24u);
}`,
}
