// WGSL for the retiming probe (design 11.24): what the 11.12 probe's flow and interpolation gain from three classic
// steps a Twixtor-class retimer takes. Same conventions as `kernels.mjs` (storage buffers; luma 0..255 as array<f32>,
// flows as array<vec2f> in pixels of their own level, colour as array<u32> RGBA8).
//
//   conf     per flow pixel, how well the flow survives the round trip to the other frame and back (0..1);
//   jbu      the flow brought up to the frame's size by a joint bilateral filter guided by the frame's luma and
//            weighted by `conf`: a motion edge snaps to the picture's edge instead of spreading over the solve's
//            window (the halo around a ridge against the sky);
//   pick     per frame pixel, the candidate flow (the refined one, the flow pixels around it) whose patch matches best;
//   interp2  the 11.12 interpolation with occlusion handling at the frame's border (a point whose content is outside
//            one frame takes the other) and, where neither warp is trusted, the two warps mixed instead of the two
//            unmoved frames (which is a double exposure wherever there is motion); mode 4 samples the frames bicubically;
//            mode 8 is only the in-frame test of mode 1 (no trust for a round trip that leaves the other frame); mode 32
//            leaves the bicubic sample unclamped (run 3; the product clamps it to the 2 x 2 nearest pixels).

export const KERNELS_V2 = {
  conf: /* wgsl */ `
struct U { w: u32, h: u32, sig: f32, a: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> fd: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> fo: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> conf: array<f32>;
fn other(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.w - 1u)), clamp(p.y, 0.0, f32(u.h - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.w - 1u); let y1 = min(y0 + 1u, u.h - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  return mix(mix(fo[y0 * u.w + x0], fo[y0 * u.w + x1], fx), mix(fo[y1 * u.w + x0], fo[y1 * u.w + x1], fx), fy);
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let i = g.y * u.w + g.x;
  let f = fd[i];
  let p = vec2<f32>(f32(g.x), f32(g.y)) + f;
  // content that leaves the other frame cannot be checked there: it is trusted (only this frame has it)
  if (p.x < -0.5 || p.y < -0.5 || p.x > f32(u.w) - 0.5 || p.y > f32(u.h) - 0.5) { conf[i] = 1.0; return; }
  let e = length(f + other(p));
  conf[i] = exp(-e * e / (u.sig * u.sig));
}`,

  jbu: /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, rx: f32, ry: f32, sigR: f32, a: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> col: array<u32>;
@group(0) @binding(2) var<storage, read> lum: array<f32>;
@group(0) @binding(3) var<storage, read> fl: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> conf: array<f32>;
@group(0) @binding(5) var<storage, read_write> outf: array<vec2<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let c = col[g.y * u.W + g.x];
  let L = 0.299 * f32(c & 255u) + 0.587 * f32((c >> 8u) & 255u) + 0.114 * f32((c >> 16u) & 255u);
  let pl = vec2<f32>((f32(g.x) + 0.5) / u.rx - 0.5, (f32(g.y) + 0.5) / u.ry - 0.5);
  let q0 = vec2<i32>(round(pl));
  var acc = vec2<f32>(0.0);
  var sw = 0.0;
  var accS = vec2<f32>(0.0);
  var swS = 0.0;
  let r2 = 2.0 * u.sigR * u.sigR;
  for (var j = -2; j <= 2; j++) {
    let y = clamp(q0.y + j, 0, i32(u.fh) - 1);
    for (var i = -2; i <= 2; i++) {
      let x = clamp(q0.x + i, 0, i32(u.fw) - 1);
      let k = u32(y) * u.fw + u32(x);
      let d = pl - vec2<f32>(f32(x), f32(y));
      let ws = exp(-dot(d, d) / 2.0);
      let dl = L - lum[k];
      let w = ws * exp(-dl * dl / r2) * (conf[k] + 0.02);
      acc += w * fl[k];
      sw += w;
      accS += ws * fl[k];
      swS += ws;
    }
  }
  var f = accS / swS;
  if (sw > 1e-4) { f = acc / sw; }
  outf[g.y * u.W + g.x] = f * vec2<f32>(u.rx, u.ry);
}`,

  // per frame pixel, the flow among the refined one and the 3x3 flow pixels around it whose 3x3 patch matches the other
  // frame best (luma, mean absolute difference), less a pull towards the refined flow: at a motion edge each pixel takes
  // the motion of the side it looks like
  pick: /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, rx: f32, ry: f32, lambda: f32, a: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> ld: array<f32>;
@group(0) @binding(2) var<storage, read> lo: array<f32>;
@group(0) @binding(3) var<storage, read> fl: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> base: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> outf: array<vec2<f32>>;
fn other(p: vec2<f32>) -> f32 {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.W - 1u)), clamp(p.y, 0.0, f32(u.H - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.W - 1u); let y1 = min(y0 + 1u, u.H - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  return mix(mix(lo[y0 * u.W + x0], lo[y0 * u.W + x1], fx), mix(lo[y1 * u.W + x0], lo[y1 * u.W + x1], fx), fy);
}
fn cost(p: vec2<i32>, f: vec2<f32>, b: vec2<f32>) -> f32 {
  var sad = 0.0;
  for (var j = -1; j <= 1; j++) {
    let y = clamp(p.y + j, 0, i32(u.H) - 1);
    for (var i = -1; i <= 1; i++) {
      let x = clamp(p.x + i, 0, i32(u.W) - 1);
      sad += abs(ld[u32(y) * u.W + u32(x)] - other(vec2<f32>(f32(x), f32(y)) + f));
    }
  }
  return sad / 9.0 + u.lambda * length(f - b);
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let p = vec2<i32>(i32(g.x), i32(g.y));
  let b = base[g.y * u.W + g.x];
  var best = b;
  var bestCost = cost(p, b, b);
  let pl = vec2<f32>((f32(g.x) + 0.5) / u.rx - 0.5, (f32(g.y) + 0.5) / u.ry - 0.5);
  let q0 = vec2<i32>(round(pl));
  for (var j = -1; j <= 1; j++) {
    let y = clamp(q0.y + j, 0, i32(u.fh) - 1);
    for (var i = -1; i <= 1; i++) {
      let x = clamp(q0.x + i, 0, i32(u.fw) - 1);
      let f = fl[u32(y) * u.fw + u32(x)] * vec2<f32>(u.rx, u.ry);
      let c = cost(p, f, b);
      if (c < bestCost) { bestCost = c; best = f; }
    }
  }
  outf[g.y * u.W + g.x] = best;
}`,

  // --- Run 4: the forward warp (Twixtor's "Forward", Baker et al.'s method) and a vector choice at the flow's size ---

  // per flow pixel, the vector among its (2R+1)^2 neighbours whose 3x3 luma patch matches the other frame best
  pickl: /* wgsl */ `
struct U { w: u32, h: u32, R: i32, a: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> la: array<f32>;
@group(0) @binding(2) var<storage, read> lb: array<f32>;
@group(0) @binding(3) var<storage, read> fl: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> outf: array<vec2<f32>>;
fn other(p: vec2<f32>) -> f32 {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.w - 1u)), clamp(p.y, 0.0, f32(u.h - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.w - 1u); let y1 = min(y0 + 1u, u.h - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  return mix(mix(lb[y0 * u.w + x0], lb[y0 * u.w + x1], fx), mix(lb[y1 * u.w + x0], lb[y1 * u.w + x1], fx), fy);
}
fn cost(p: vec2<i32>, f: vec2<f32>) -> f32 {
  var s = 0.0;
  for (var j = -1; j <= 1; j++) {
    let y = clamp(p.y + j, 0, i32(u.h) - 1);
    for (var i = -1; i <= 1; i++) {
      let x = clamp(p.x + i, 0, i32(u.w) - 1);
      s += abs(la[u32(y) * u.w + u32(x)] - other(vec2<f32>(f32(x), f32(y)) + f));
    }
  }
  return s;
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let p = vec2<i32>(i32(g.x), i32(g.y));
  var best = fl[g.y * u.w + g.x];
  var bestCost = cost(p, best);
  for (var j = -u.R; j <= u.R; j++) {
    let y = clamp(p.y + j, 0, i32(u.h) - 1);
    for (var i = -u.R; i <= u.R; i++) {
      let x = clamp(p.x + i, 0, i32(u.w) - 1);
      let f = fl[u32(y) * u.w + u32(x)];
      let c = cost(p, f);
      if (c < bestCost) { bestCost = c; best = f; }
    }
  }
  outf[g.y * u.w + g.x] = best;
}`,

  fclear: /* wgsl */ `
struct U { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> z: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.n) { return; }
  z[g.x] = 0xffffffffu;
}`,

  // each flow pixel of both frames goes to where it is at time t; where several land on one pixel the one whose two
  // ends look most alike wins (error in the high bits of an atomicMin, then direction and index; run 4 used 11 bits of
  // error at 1/8 level and a 20-bit index, now the product's packing: 10 bits at 1/4 level, bit 21, a 21-bit index)
  fsplat: /* wgsl */ `
struct U { w: u32, h: u32, t: f32, a: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> la: array<f32>;
@group(0) @binding(2) var<storage, read> lb: array<f32>;
@group(0) @binding(3) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> z: array<atomic<u32>>;
fn bil(which: u32, p: vec2<f32>) -> f32 {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.w - 1u)), clamp(p.y, 0.0, f32(u.h - 1u)));
  let x0 = u32(floor(q.x)); let y0 = u32(floor(q.y));
  let x1 = min(x0 + 1u, u.w - 1u); let y1 = min(y0 + 1u, u.h - 1u);
  let fx = q.x - f32(x0); let fy = q.y - f32(y0);
  if (which == 0u) {
    return mix(mix(la[y0 * u.w + x0], la[y0 * u.w + x1], fx), mix(la[y1 * u.w + x0], la[y1 * u.w + x1], fx), fy);
  }
  return mix(mix(lb[y0 * u.w + x0], lb[y0 * u.w + x1], fx), mix(lb[y1 * u.w + x0], lb[y1 * u.w + x1], fx), fy);
}
fn splat(p: vec2<f32>, v: u32) {
  let b = vec2<i32>(floor(p));
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let x = b.x + i; let y = b.y + j;
      if (x >= 0 && y >= 0 && x < i32(u.w) && y < i32(u.h)) { atomicMin(&z[u32(y) * u.w + u32(x)], v); }
    }
  }
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let i = g.y * u.w + g.x;
  let q = vec2<f32>(f32(g.x), f32(g.y));
  let f = f01[i];
  let e0 = abs(la[i] - bil(1u, q + f));
  splat(q + u.t * f, (min(u32(e0 * 4.0), 1023u) << 22u) | i);
  let b = f10[i];
  let e1 = abs(lb[i] - bil(0u, q + b));
  splat(q + (1.0 - u.t) * b, (min(u32(e1 * 4.0), 1023u) << 22u) | (1u << 21u) | i);
}`,

  // the winner's vector, as the flow from frame 0 to frame 1 of the content at that pixel at time t (z = 1: found)
  fresolve: /* wgsl */ `
struct U { n: u32, a: u32, b: u32, c: u32 }
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
  let idx = v & 0x1fffffu;
  var f = f01[idx];
  if (((v >> 21u) & 1u) == 1u) { f = -f10[idx]; }
  ft[g.x] = vec4<f32>(f, 1.0, 0.0);
}`,

  // a hole takes the mean of its found neighbours (repeated: outside in)
  ffill: /* wgsl */ `
struct U { w: u32, h: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> fin: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fout: array<vec4<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.w || g.y >= u.h) { return; }
  let c = fin[g.y * u.w + g.x];
  if (c.z > 0.0) { fout[g.y * u.w + g.x] = c; return; }
  var s = vec2<f32>(0.0); var n = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let x = i32(g.x) + i; let y = i32(g.y) + j;
      if (x < 0 || y < 0 || x >= i32(u.w) || y >= i32(u.h)) { continue; }
      let o = fin[u32(y) * u.w + u32(x)];
      if (o.z > 0.0) { s += o.xy; n += 1.0; }
    }
  }
  if (n > 0.0) { fout[g.y * u.w + g.x] = vec4<f32>(s / n, 1.0, 0.0); } else { fout[g.y * u.w + g.x] = c; }
}`,

  interp2: /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, t: f32, sig: f32, rx: f32, ry: f32, mode: u32, a: u32, b: u32, c: u32 }
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
// Catmull-Rom (bicubic) sampling: bilinear sampling at a fractional position is a small blur (at half a pixel, the
// mean of two pixels), so every made frame would be softer than the real ones around it
fn cr(t: f32) -> vec4<f32> {
  let t2 = t * t; let t3 = t2 * t;
  return vec4<f32>(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
fn texel(which: u32, x: i32, y: i32) -> vec3<f32> {
  let cx = u32(clamp(x, 0, i32(u.W) - 1)); let cy = u32(clamp(y, 0, i32(u.H) - 1));
  if (which == 0u) { return unpack(c0[cy * u.W + cx]); }
  return unpack(c1[cy * u.W + cx]);
}
fn colCubic(which: u32, p: vec2<f32>) -> vec3<f32> {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.W - 1u)), clamp(p.y, 0.0, f32(u.H - 1u)));
  let b = floor(q); let f = q - b;
  let wx = cr(f.x); let wy = cr(f.y);
  let x = i32(b.x); let y = i32(b.y);
  var acc = vec3<f32>(0.0);
  for (var j = 0; j < 4; j++) {
    var row = vec3<f32>(0.0);
    for (var i = 0; i < 4; i++) { row += wx[i] * texel(which, x - 1 + i, y - 1 + j); }
    acc += wy[j] * row;
  }
  if ((u.mode & 32u) != 0u) { return acc; }
  // clamped to the range of the 2 x 2 nearest pixels (the product's sampler): no ringing beside an edge
  let n00 = texel(which, x, y); let n10 = texel(which, x + 1, y);
  let n01 = texel(which, x, y + 1); let n11 = texel(which, x + 1, y + 1);
  return clamp(acc, min(min(n00, n10), min(n01, n11)), max(max(n00, n10), max(n01, n11)));
}
fn sampleCol(which: u32, p: vec2<f32>) -> vec3<f32> {
  if ((u.mode & 4u) != 0u) { return colCubic(which, p); }
  return colAt(which, p);
}
fn inside(p: vec2<f32>) -> bool {
  return p.x >= -0.5 && p.y >= -0.5 && p.x <= f32(u.W) - 0.5 && p.y <= f32(u.H) - 0.5;
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let x = vec2<f32>(f32(g.x), f32(g.y));
  let t = u.t;
  let borders = (u.mode & 1u) != 0u;
  let warpFallback = (u.mode & 2u) != 0u;
  var y0 = x;
  for (var k = 0; k < 3; k++) { y0 = x - t * flowAt(0u, y0); }
  var y1 = x;
  for (var k = 0; k < 3; k++) { y1 = x - (1.0 - t) * flowAt(1u, y1); }
  let f0 = flowAt(0u, y0);
  let f1 = flowAt(1u, y1);
  var e0 = length(f0 + flowAt(1u, y0 + f0));
  var e1 = length(f1 + flowAt(0u, y1 + f1));
  var in0 = 1.0;
  var in1 = 1.0;
  if (borders) {
    // content whose round trip leaves the other frame cannot be checked there: only this frame has it
    if (!inside(y0 + f0)) { e0 = 0.0; }
    if (!inside(y1 + f1)) { e1 = 0.0; }
  }
  if (borders || (u.mode & 8u) != 0u) {
    // content that is outside one frame at its sample point is not in that frame at all
    if (!inside(y0)) { in0 = 0.0; }
    if (!inside(y1)) { in1 = 0.0; }
  }
  let s2 = u.sig * u.sig;
  let w0 = (1.0 - t) * in0 * exp(-e0 * e0 / s2);
  let w1 = t * in1 * exp(-e1 * e1 / s2);
  let ws = w0 + w1;
  let a = sampleCol(0u, y0);
  let b = sampleCol(1u, y1);
  let warped = (w0 * a + w1 * b) / max(ws, 1e-6);
  var fallback = (1.0 - t) * colAt(0u, x) + t * colAt(1u, x);
  if (warpFallback) {
    var v0 = (1.0 - t) * in0;
    var v1 = t * in1;
    // content outside both frames (a corner both lose): the two clamped samples
    if (v0 + v1 <= 0.0) { v0 = 1.0 - t; v1 = t; }
    fallback = (v0 * a + v1 * b) / (v0 + v1);
  }
  let k = smoothstep(0.02, 0.15, ws);
  let o = clamp(mix(fallback, warped, k), vec3<f32>(0.0), vec3<f32>(255.0)) + vec3<f32>(0.5);
  outc[g.y * u.W + g.x] = u32(o.x) | (u32(o.y) << 8u) | (u32(o.z) << 16u) | (255u << 24u);
}`,

    fwdinterp: /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, t: f32, sig: f32, rx: f32, ry: f32, mode: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> c0: array<u32>;
@group(0) @binding(2) var<storage, read> c1: array<u32>;
@group(0) @binding(3) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> ftf: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> outc: array<u32>;

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
// Catmull-Rom (bicubic) sampling: bilinear sampling at a fractional position is a small blur (at half a pixel, the
// mean of two pixels), so every made frame would be softer than the real ones around it
fn cr(t: f32) -> vec4<f32> {
  let t2 = t * t; let t3 = t2 * t;
  return vec4<f32>(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
fn texel(which: u32, x: i32, y: i32) -> vec3<f32> {
  let cx = u32(clamp(x, 0, i32(u.W) - 1)); let cy = u32(clamp(y, 0, i32(u.H) - 1));
  if (which == 0u) { return unpack(c0[cy * u.W + cx]); }
  return unpack(c1[cy * u.W + cx]);
}
fn colCubic(which: u32, p: vec2<f32>) -> vec3<f32> {
  let q = vec2<f32>(clamp(p.x, 0.0, f32(u.W - 1u)), clamp(p.y, 0.0, f32(u.H - 1u)));
  let b = floor(q); let f = q - b;
  let wx = cr(f.x); let wy = cr(f.y);
  let x = i32(b.x); let y = i32(b.y);
  var acc = vec3<f32>(0.0);
  for (var j = 0; j < 4; j++) {
    var row = vec3<f32>(0.0);
    for (var i = 0; i < 4; i++) { row += wx[i] * texel(which, x - 1 + i, y - 1 + j); }
    acc += wy[j] * row;
  }
  if ((u.mode & 32u) != 0u) { return acc; }
  // clamped to the range of the 2 x 2 nearest pixels (the product's sampler): no ringing beside an edge
  let n00 = texel(which, x, y); let n10 = texel(which, x + 1, y);
  let n01 = texel(which, x, y + 1); let n11 = texel(which, x + 1, y + 1);
  return clamp(acc, min(min(n00, n10), min(n01, n11)), max(max(n00, n10), max(n01, n11)));
}
fn sampleCol(which: u32, p: vec2<f32>) -> vec3<f32> {
  if ((u.mode & 4u) != 0u) { return colCubic(which, p); }
  return colAt(which, p);
}
fn inside(p: vec2<f32>) -> bool {
  return p.x >= -0.5 && p.y >= -0.5 && p.x <= f32(u.W) - 0.5 && p.y <= f32(u.H) - 0.5;
}
fn ftAt(p: vec2<f32>) -> vec2<f32> {
  let px = clamp((p.x + 0.5) / u.rx - 0.5, 0.0, f32(u.fw - 1u));
  let py = clamp((p.y + 0.5) / u.ry - 0.5, 0.0, f32(u.fh - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, u.fw - 1u); let y1 = min(y0 + 1u, u.fh - 1u);
  let fx = px - f32(x0); let fy = py - f32(y0);
  let v = mix(mix(ftf[y0 * u.fw + x0].xy, ftf[y0 * u.fw + x1].xy, fx), mix(ftf[y1 * u.fw + x0].xy, ftf[y1 * u.fw + x1].xy, fx), fy);
  return v * vec2<f32>(u.rx, u.ry);
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let x = vec2<f32>(f32(g.x), f32(g.y));
  let t = u.t;
  // the content at x at time t moves by f from frame 0 to frame 1: it is at y0 in frame 0 and y1 in frame 1
  let f = ftAt(x);
  let y0 = x - t * f;
  let y1 = x + (1.0 - t) * f;
  // visible in a frame where that frame's own flow there moves with it
  let e0 = length(flowAt(0u, y0) - f);
  let e1 = length(flowAt(1u, y1) + f);
  let s2 = u.sig * u.sig;
  let w0 = (1.0 - t) * exp(-e0 * e0 / s2);
  let w1 = t * exp(-e1 * e1 / s2);
  let ws = w0 + w1;
  let a = sampleCol(0u, y0);
  let b = sampleCol(1u, y1);
  let warped = (w0 * a + w1 * b) / max(ws, 1e-6);
  var moved = (1.0 - t) * a + t * b;
  // run 5, "hard edges: nearest frame" (mode 64): where neither frame is trusted, the frame more likely to see it
  if ((u.mode & 64u) != 0u) { moved = select(b, a, w0 >= w1); }
  let k = smoothstep(0.02, 0.15, ws);
  let o = clamp(mix(moved, warped, k), vec3<f32>(0.0), vec3<f32>(255.0)) + vec3<f32>(0.5);
  outc[g.y * u.W + g.x] = u32(o.x) | (u32(o.y) << 8u) | (u32(o.z) << 16u) | (255u << 24u);
}`,
}
