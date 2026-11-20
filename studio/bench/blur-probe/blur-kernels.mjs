// WGSL for the vector motion blur probe (design 9.2). Frames live in linear light in `rgba16float` textures (sampled
// with a clamp-to-edge linear sampler, as the editor's stages would), flows are the flow probe's `array<vec2f>` buffers
// at the flow's size (pixel units of that size), and every result is accumulated, weighted, into an `array<vec4f>` of
// linear light at the frame's size. Each kernel is its own module (an auto layout owns only the bindings it uses).

const SRGB = /* wgsl */ `
fn to_linear(c: f32) -> f32 { if (c <= 0.04045) { return c / 12.92; } return pow((c + 0.055) / 1.055, 2.4); }
fn from_linear(l: f32) -> f32 { if (l <= 0.0031308) { return l * 12.92; } return 1.055 * pow(l, 1.0 / 2.4) - 0.055; }
`

/** Bilinear read of a flow-sized vec2 buffer at a point in flow pixels (clamped to the buffer) */
const FLOW_SAMPLE = (name, fw, fh) => /* wgsl */ `
fn sample_${name}(q: vec2<f32>) -> vec2<f32> {
  let px = clamp(q.x, 0.0, f32(${fw} - 1u));
  let py = clamp(q.y, 0.0, f32(${fh} - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, ${fw} - 1u); let y1 = min(y0 + 1u, ${fh} - 1u);
  let fx = px - f32(x0); let fy = py - f32(y0);
  let a = ${name}[y0 * ${fw} + x0].xy; let b = ${name}[y0 * ${fw} + x1].xy;
  let c = ${name}[y1 * ${fw} + x0].xy; let d = ${name}[y1 * ${fw} + x1].xy;
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}`

export const BLUR_KERNELS = {
  // RGBA8 frame (R in the low byte) -> linear light in an rgba16float texture
  totex: /* wgsl */ `
struct U { W: u32, H: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> col: array<u32>;
@group(0) @binding(2) var outt: texture_storage_2d<rgba16float, write>;
${SRGB}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let c = col[g.y * u.W + g.x];
  let r = to_linear(f32(c & 255u) / 255.0);
  let gg = to_linear(f32((c >> 8u) & 255u) / 255.0);
  let b = to_linear(f32((c >> 16u) & 255u) / 255.0);
  textureStore(outt, vec2<i32>(g.xy), vec4<f32>(r, gg, b, 1.0));
}`,

  // The motion of frame n per source frame, in frame pixels, at the flow's size, both ways: towards the next frame
  // (F, from the gap n -> n+1) and towards the previous one (B, from the gap n-1 -> n), each kept where its
  // forward/backward round trip holds and replaced by the other side, negated, where it does not (an occluded side).
  // Out: (F.xy, B.xy). mode 0: both gaps; 1: the gap after only (B = -F); 2: the gap before only (F = -B).
  velocity: /* wgsl */ `
struct U { fw: u32, fh: u32, mode: u32, p: u32, rx: f32, ry: f32, sig: f32, q: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> fA: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> bA: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> fB: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> bB: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> outv: array<vec4<f32>>;
${FLOW_SAMPLE('fA', 'u.fw', 'u.fh')}
${FLOW_SAMPLE('bB', 'u.fw', 'u.fh')}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.fw || g.y >= u.fh) { return; }
  let i = g.y * u.fw + g.x;
  let p = vec2<f32>(g.xy);
  let r = vec2<f32>(u.rx, u.ry);
  let s2 = u.sig * u.sig;
  if (u.mode == 1u) {
    let F = fB[i] * r;
    outv[i] = vec4<f32>(F, -F);
    return;
  }
  if (u.mode == 2u) {
    let B = bA[i] * r;
    outv[i] = vec4<f32>(-B, B);
    return;
  }
  let F = fB[i] * r;
  let B = bA[i] * r;
  let eF = length(F + sample_bB(p + fB[i]) * r);
  let eB = length(B + sample_fA(p + bA[i]) * r);
  let wF = exp(-eF * eF / s2);
  let wB = exp(-eB * eB / s2);
  let mid = 0.5 * (F - B);
  let dF = wF + (1.0 - wF) * wB;
  let dB = wB + (1.0 - wB) * wF;
  var Fk = mid;
  var Bk = -mid;
  if (dF > 0.02) { Fk = (wF * F - (1.0 - wF) * wB * B) / dF; }
  if (dB > 0.02) { Bk = (wB * B - (1.0 - wB) * wF * F) / dB; }
  outv[i] = vec4<f32>(Fk, Bk);
}`,

  // The largest velocity of each T x T block of flow pixels
  tilemax: /* wgsl */ `
struct U { fw: u32, fh: u32, T: u32, tw: u32, th: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> V: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> TM: array<vec2<f32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.tw || g.y >= u.th) { return; }
  var best = vec2<f32>(0.0);
  var bestLen = 0.0;
  for (var y = g.y * u.T; y < min(g.y * u.T + u.T, u.fh); y++) {
    for (var x = g.x * u.T; x < min(g.x * u.T + u.T, u.fw); x++) {
      let m = V[y * u.fw + x];
      let v = 0.5 * (m.xy - m.zw);
      let l = dot(v, v);
      if (l > bestLen) { bestLen = l; best = v; }
    }
  }
  TM[g.y * u.tw + g.x] = best;
}`,

  // The largest tile velocity among each tile and its eight neighbours
  neighbormax: /* wgsl */ `
struct U { tw: u32, th: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> TM: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> NM: array<vec2<f32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.tw || g.y >= u.th) { return; }
  var best = vec2<f32>(0.0);
  var bestLen = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = clamp(i32(g.x) + dx, 0, i32(u.tw) - 1);
      let y = clamp(i32(g.y) + dy, 0, i32(u.th) - 1);
      let v = TM[u32(y) * u.tw + u32(x)];
      let l = dot(v, v);
      if (l > bestLen) { bestLen = l; best = v; }
    }
  }
  NM[g.y * u.tw + g.x] = best;
}`,

  // The vector blur of one frame, added with a weight into the accumulator, centred on the frame's time. mode bit 1
  // off: every pixel averages the frame along one line, its mean motion (F - B) / 2, half before and half after;
  // on: two half lines, the earlier half along its motion towards the previous frame and the later half along its
  // motion towards the next (a bend where the motion changes). mode bit 0: a pixel that a faster neighbour sweeps
  // over during the shutter (found along the neighbourhood's largest motion) is also covered by it, for the share of
  // the shutter that neighbour spends there (scatter as gather; faster stands for nearer).
  blur: /* wgsl */ `
struct U {
  W: u32, H: u32, fw: u32, fh: u32,
  tw: u32, th: u32, T: u32, mode: u32,
  rx: f32, ry: f32, half: f32, maxR: f32,
  step: f32, maxTaps: f32, weight: f32, first: u32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var<storage, read> V: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> NM: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> acc: array<vec4<f32>>;

fn vel(p: vec2<f32>) -> vec4<f32> {
  let q = p / vec2<f32>(u.rx, u.ry) - 0.5;
  let px = clamp(q.x, 0.0, f32(u.fw - 1u));
  let py = clamp(q.y, 0.0, f32(u.fh - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, u.fw - 1u); let y1 = min(y0 + 1u, u.fh - 1u);
  let fx = px - f32(x0); let fy = py - f32(y0);
  let a = V[y0 * u.fw + x0]; let b = V[y0 * u.fw + x1];
  let c = V[y1 * u.fw + x0]; let d = V[y1 * u.fw + x1];
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
fn limited(h: vec2<f32>) -> vec2<f32> {
  let l = length(h);
  if (l > u.maxR) { return h * (u.maxR / l); }
  return h;
}
fn col(p: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(img, smp, p / vec2<f32>(f32(u.W), f32(u.H)), 0.0).rgb;
}
// interleaved gradient noise: a fixed per-pixel offset of the taps, so steps between taps turn into fine grain
fn ign(p: vec2<f32>) -> f32 { return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715)))); }

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let X = vec2<f32>(g.xy) + 0.5;
  let m = vel(X);
  let two = (u.mode & 2u) != 0u;
  let hF = limited(m.xy * u.half);
  let hB = limited(m.zw * u.half);
  let hX = limited(0.5 * (m.xy - m.zw) * u.half);
  let lenX = length(hX);
  let reachX = select(lenX, max(length(hF), length(hB)), two);
  let j = ign(vec2<f32>(g.xy)) - 0.5;
  var bg: vec3<f32>;
  if (reachX < 0.5) {
    bg = col(X);
  } else {
    let n1 = clamp(ceil(2.0 * reachX / u.step), 2.0, u.maxTaps);
    var sum = vec3<f32>(0.0);
    for (var k = 0.0; k < n1; k += 1.0) {
      let s = ((k + 0.5 + j) / n1) * 2.0 - 1.0;
      if (two) {
        // later half: the content at X at time +s came from X - s F; earlier half: from X - |s| B
        sum += col(select(X + s * hB, X - s * hF, s >= 0.0));
      } else {
        sum += col(X + hX * s);
      }
    }
    bg = sum / n1;
  }
  var result = bg;
  if ((u.mode & 1u) != 0u) {
    let tile = min(vec2<u32>(floor(X / vec2<f32>(u.rx, u.ry) / f32(u.T))), vec2<u32>(u.tw - 1u, u.th - 1u));
    let hN = limited(NM[tile.y * u.tw + tile.x] * u.half);
    let lenN = length(hN);
    if (lenN > lenX * 1.15 + 1.0) {
      let n2 = clamp(ceil(lenN / u.step), 2.0, u.maxTaps);
      let dir = hN / lenN;
      let delta = lenN / n2;
      var fgW = 0.0;
      var fgS = vec3<f32>(0.0);
      for (var k = 0.0; k < n2; k += 1.0) {
        let r = (k + 0.5 + j) * delta;
        for (var side = -1.0; side <= 1.0; side += 2.0) {
          let Y = X + dir * (r * side);
          let mY = vel(Y);
          let hY = limited(0.5 * (mY.xy - mY.zw) * u.half);
          let lenY = length(hY);
          // in front only across a jump in speed (a nearer object), not along a smooth change (receding ground)
          let dv = lenY - lenX;
          let front = smoothstep(0.25, 0.5, dv / max(lenY, 1.0)) * smoothstep(1.0, 3.0, dv);
          let reach = 1.0 - smoothstep(lenY - 0.5, lenY + 0.5, r);
          let align = smoothstep(0.3, 0.7, abs(dot(dir, hY / max(lenY, 1e-3))));
          let w = front * reach * align * delta / (2.0 * max(lenY, 0.5));
          fgW += w;
          fgS += w * col(Y);
        }
      }
      if (fgW > 1e-5) { result = mix(bg, fgS / fgW, min(fgW, 1.0)); }
    }
  }
  let i = g.y * u.W + g.x;
  if (u.first == 1u) { acc[i] = vec4<f32>(result * u.weight, 1.0); } else { acc[i] = acc[i] + vec4<f32>(result * u.weight, 0.0); }
}`,

  // One frame added with a weight (today's frame blend)
  addframe: /* wgsl */ `
struct U { W: u32, H: u32, first: u32, a: u32, weight: f32, b: f32, c: f32, d: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> acc: array<vec4<f32>>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let c = textureLoad(img, vec2<i32>(g.xy), 0).rgb * u.weight;
  let i = g.y * u.W + g.x;
  if (u.first == 1u) { acc[i] = vec4<f32>(c, 1.0); } else { acc[i] = acc[i] + vec4<f32>(c, 0.0); }
}`,

  // The frame at phase t between two frames, warped both ways with consistency weights (the editor's optical-flow
  // interpolation, on linear textures), added with a weight: many of them over the shutter are the reference blur.
  warpacc: /* wgsl */ `
struct U { W: u32, H: u32, fw: u32, fh: u32, t: f32, sig: f32, rx: f32, ry: f32, weight: f32, first: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var imgA: texture_2d<f32>;
@group(0) @binding(2) var imgB: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var<storage, read> f01: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> f10: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> acc: array<vec4<f32>>;
${FLOW_SAMPLE('f01', 'u.fw', 'u.fh')}
${FLOW_SAMPLE('f10', 'u.fw', 'u.fh')}
fn flowAt(which: u32, p: vec2<f32>) -> vec2<f32> {
  let q = (p + 0.5) / vec2<f32>(u.rx, u.ry) - 0.5;
  if (which == 0u) { return sample_f01(q) * vec2<f32>(u.rx, u.ry); }
  return sample_f10(q) * vec2<f32>(u.rx, u.ry);
}
fn colA(p: vec2<f32>) -> vec3<f32> { return textureSampleLevel(imgA, smp, (p + 0.5) / vec2<f32>(f32(u.W), f32(u.H)), 0.0).rgb; }
fn colB(p: vec2<f32>) -> vec3<f32> { return textureSampleLevel(imgB, smp, (p + 0.5) / vec2<f32>(f32(u.W), f32(u.H)), 0.0).rgb; }
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let x = vec2<f32>(g.xy);
  let t = u.t;
  var y0 = x;
  for (var k = 0; k < 3; k++) { y0 = x - t * flowAt(0u, y0); }
  var y1 = x;
  for (var k = 0; k < 3; k++) { y1 = x - (1.0 - t) * flowAt(1u, y1); }
  let fa = flowAt(0u, y0);
  let fb = flowAt(1u, y1);
  let e0 = length(fa + flowAt(1u, y0 + fa));
  let e1 = length(fb + flowAt(0u, y1 + fb));
  let s2 = u.sig * u.sig;
  let w0 = (1.0 - t) * exp(-e0 * e0 / s2);
  let w1 = t * exp(-e1 * e1 / s2);
  let ws = w0 + w1;
  let warped = (w0 * colA(y0) + w1 * colB(y1)) / max(ws, 1e-6);
  let blend = (1.0 - t) * colA(x) + t * colB(x);
  let c = mix(blend, warped, smoothstep(0.02, 0.15, ws)) * u.weight;
  let i = g.y * u.W + g.x;
  if (u.first == 1u) { acc[i] = vec4<f32>(c, 1.0); } else { acc[i] = acc[i] + vec4<f32>(c, 0.0); }
}`,

  // The accumulator (linear light) back to sRGB code values, as RGBA8 for the stills
  resolve: /* wgsl */ `
struct U { W: u32, H: u32, a: u32, b: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> acc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outc: array<u32>;
${SRGB}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u.W || g.y >= u.H) { return; }
  let i = g.y * u.W + g.x;
  let l = acc[i].rgb;
  let r = u32(round(clamp(from_linear(l.r), 0.0, 1.0) * 255.0));
  let gg = u32(round(clamp(from_linear(l.g), 0.0, 1.0) * 255.0));
  let b = u32(round(clamp(from_linear(l.b), 0.0, 1.0) * 255.0));
  outc[i] = r | (gg << 8u) | (b << 16u) | (255u << 24u);
}`,
}
