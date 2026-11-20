// The vector motion blur's shaders (design 9.2, section 5): from the optical flow of the gaps around a staged source
// frame to the frame blurred along each pixel's motion over the shutter time it stands for.
//
//   linear     the staged picture (code values of the Rec.709 transfer) to linear light, once, so the blur's taps
//              interpolate and average light (a fragment shader into an rgba16float texture)
//   velocity   per flow pixel, the frame's motion per source frame in frame pixels, both ways: F towards the next
//              frame (the gap after), B towards the previous one (the gap before); where one side's forward/backward
//              round trip fails (that side is hidden in the neighbour frame) the other side, negated, stands in
//   tilemax    the largest mean motion (F - B) / 2 of each tile (about 48 frame pixels)
//   neighbor   the largest of each tile and its eight neighbours
//   blur       per frame pixel: the average along its motion over [-extent/2, extent/2] source frames, the later half
//              along -F, the earlier half along -B; and, where a neighbour moves markedly faster (nearer, by
//              parallax), that neighbour's colour for the share of the shutter its own blur covers the pixel
//              (the reconstruction filter's foreground term, McGuire 2012 / Guertin 2014 / Jimenez 2014)
//
// `vector-cpu.fixture.ts` is the CPU twin of every kernel here, for the tests.

/** The sRGB transfer both ways, sign-preserving (the motion-blur gather's curves, `stage.ts`) */
const TRANSFER = /* wgsl */ `
fn to_linear(code: vec3f) -> vec3f {
  let a = abs(code);
  let low = a / 12.92;
  let high = pow((a + vec3f(0.055)) / 1.055, vec3f(2.4));
  return sign(code) * select(high, low, a <= vec3f(0.04045));
}

fn from_linear(linear: vec3f) -> vec3f {
  let a = abs(linear);
  let low = a * 12.92;
  let high = 1.055 * pow(a, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return sign(linear) * select(high, low, a <= vec3f(0.0031308));
}

// The GPU truncates the value it stores in a half float: the encoded picture is rounded to the nearest half first.
fn round_half(value: vec3f) -> vec3f {
  let a = abs(value);
  let step = exp2(floor(log2(max(a, vec3f(6.1035156e-5)))) - 10.0);
  return sign(value) * round(a / step) * step;
}
`

const FULLSCREEN = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}
`

/** The staged picture to linear light, alpha kept */
export const LINEAR_WGSL = /* wgsl */ `
${FULLSCREEN}
${TRANSFER}
@group(0) @binding(0) var picture: texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let texel = textureLoad(picture, vec2i(position.xy), 0);
  return vec4f(to_linear(texel.rgb), texel.a);
}
`

/** The velocity kernel's uniform: flow size, mode, frame pixels per flow pixel, the round trip's tolerance */
export const VELOCITY_UNIFORM_BYTES = 32

/**
 * The frame's motion both ways, at the flow's size. mode 0: both gaps; 1: the gap after only (B = -F, the file's first
 * frame); 2: the gap before only (F = -B, its last). Out: (F.x, F.y, B.x, B.y) in frame pixels per source frame.
 */
export const VELOCITY_WGSL = /* wgsl */ `
struct U { fw: u32, fh: u32, mode: u32, pad: u32, rx: f32, ry: f32, sigma: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> beforeForward: array<vec2f>;
@group(0) @binding(2) var<storage, read> beforeBackward: array<vec2f>;
@group(0) @binding(3) var<storage, read> afterForward: array<vec2f>;
@group(0) @binding(4) var<storage, read> afterBackward: array<vec2f>;
@group(0) @binding(5) var velocity: texture_storage_2d<rgba16float, write>;

fn bilinear_before_forward(q: vec2f) -> vec2f {
  let p = clamp(q, vec2f(0.0), vec2f(f32(u.fw - 1u), f32(u.fh - 1u)));
  let x0 = u32(floor(p.x)); let y0 = u32(floor(p.y));
  let x1 = min(x0 + 1u, u.fw - 1u); let y1 = min(y0 + 1u, u.fh - 1u);
  let f = p - vec2f(f32(x0), f32(y0));
  let a = beforeForward[y0 * u.fw + x0]; let b = beforeForward[y0 * u.fw + x1];
  let c = beforeForward[y1 * u.fw + x0]; let d = beforeForward[y1 * u.fw + x1];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn bilinear_after_backward(q: vec2f) -> vec2f {
  let p = clamp(q, vec2f(0.0), vec2f(f32(u.fw - 1u), f32(u.fh - 1u)));
  let x0 = u32(floor(p.x)); let y0 = u32(floor(p.y));
  let x1 = min(x0 + 1u, u.fw - 1u); let y1 = min(y0 + 1u, u.fh - 1u);
  let f = p - vec2f(f32(x0), f32(y0));
  let a = afterBackward[y0 * u.fw + x0]; let b = afterBackward[y0 * u.fw + x1];
  let c = afterBackward[y1 * u.fw + x0]; let d = afterBackward[y1 * u.fw + x1];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= u.fw || g.y >= u.fh) { return; }
  let i = g.y * u.fw + g.x;
  let r = vec2f(u.rx, u.ry);
  var out: vec4f;
  if (u.mode == 1u) {
    let F = afterForward[i] * r;
    out = vec4f(F, -F);
  } else if (u.mode == 2u) {
    let B = beforeBackward[i] * r;
    out = vec4f(-B, B);
  } else {
    let p = vec2f(g.xy);
    let F = afterForward[i] * r;
    let B = beforeBackward[i] * r;
    let eF = length(F + bilinear_after_backward(p + afterForward[i]) * r);
    let eB = length(B + bilinear_before_forward(p + beforeBackward[i]) * r);
    let s2 = u.sigma * u.sigma;
    let wF = exp(-eF * eF / s2);
    let wB = exp(-eB * eB / s2);
    let mid = 0.5 * (F - B);
    let dF = wF + (1.0 - wF) * wB;
    let dB = wB + (1.0 - wB) * wF;
    var Fk = mid;
    var Bk = -mid;
    if (dF > 0.02) { Fk = (wF * F - (1.0 - wF) * wB * B) / dF; }
    if (dB > 0.02) { Bk = (wB * B - (1.0 - wB) * wF * F) / dB; }
    out = vec4f(Fk, Bk);
  }
  textureStore(velocity, vec2i(g.xy), out);
}
`

/** The tile kernels' uniform: flow size, tile side in flow pixels, tile grid */
export const TILE_UNIFORM_BYTES = 32

/** The largest mean motion (F - B) / 2 of each T x T block of flow pixels; out (x, y, 0, 0) */
export const TILEMAX_WGSL = /* wgsl */ `
struct U { fw: u32, fh: u32, T: u32, tw: u32, th: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var velocity: texture_2d<f32>;
@group(0) @binding(2) var tiles: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= u.tw || g.y >= u.th) { return; }
  var best = vec2f(0.0);
  var bestLength = 0.0;
  for (var y = g.y * u.T; y < min(g.y * u.T + u.T, u.fh); y++) {
    for (var x = g.x * u.T; x < min(g.x * u.T + u.T, u.fw); x++) {
      let m = textureLoad(velocity, vec2u(x, y), 0);
      let v = 0.5 * (m.xy - m.zw);
      let l = dot(v, v);
      if (l > bestLength) { bestLength = l; best = v; }
    }
  }
  textureStore(tiles, vec2i(g.xy), vec4f(best, 0.0, 0.0));
}
`

/** The largest tile motion among each tile and its eight neighbours */
export const NEIGHBOR_WGSL = /* wgsl */ `
struct U { fw: u32, fh: u32, T: u32, tw: u32, th: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tiles: texture_2d<f32>;
@group(0) @binding(2) var neighbors: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= u.tw || g.y >= u.th) { return; }
  var best = vec2f(0.0);
  var bestLength = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = clamp(i32(g.x) + dx, 0, i32(u.tw) - 1);
      let y = clamp(i32(g.y) + dy, 0, i32(u.th) - 1);
      let v = textureLoad(tiles, vec2i(x, y), 0).xy;
      let l = dot(v, v);
      if (l > bestLength) { bestLength = l; best = v; }
    }
  }
  textureStore(neighbors, vec2i(g.xy), vec4f(best, 0.0, 0.0));
}
`

/** The blur's uniform: sizes, tiles, the shutter's half extent, the limits and the sample's weight (16 words) */
export const BLUR_UNIFORM_BYTES = 64

/**
 * The blur of one sample. Entry points by the gather's step: `onlyMain` (one sample: the result encoded, and a pixel
 * with no motion passed through bit for bit), `sumMain` (first and middle: weight x linear result, added by the
 * blend), `lastMain` (the accumulator plus this sample, encoded).
 */
export const BLUR_WGSL = /* wgsl */ `
${FULLSCREEN}
${TRANSFER}
struct U {
  W: u32, H: u32, fw: u32, fh: u32,
  tw: u32, th: u32, T: u32, pad: u32,
  rx: f32, ry: f32, half: f32, maxR: f32,
  step: f32, maxTaps: f32, weight: f32, pad2: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var light: texture_2d<f32>;
@group(0) @binding(3) var velocity: texture_2d<f32>;
@group(0) @binding(4) var neighbors: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var sum: texture_2d<f32>;

fn uv(p: vec2f) -> vec2f { return p / vec2f(f32(u.W), f32(u.H)); }
fn motion(p: vec2f) -> vec4f { return textureSampleLevel(velocity, linearSampler, uv(p), 0.0); }
fn lightAt(p: vec2f) -> vec3f { return textureSampleLevel(light, linearSampler, uv(p), 0.0).rgb; }
fn limited(h: vec2f) -> vec2f {
  let l = length(h);
  if (l > u.maxR) { return h * (u.maxR / l); }
  return h;
}
// interleaved gradient noise (Jimenez 2014): a fixed offset of each pixel's taps, so the steps between taps become
// fine grain; a function of the pixel alone, so a render is deterministic. Taps 1 px apart or closer show no steps, so
// the offset grows from nothing at 1 px to half the spacing at 2 px (only a blur longer than the taps can cover).
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

struct Blurred { light: vec3f, still: bool }

fn blurred(position: vec4f) -> Blurred {
  let X = floor(position.xy) + 0.5;
  let m = motion(X);
  let hF = limited(m.xy * u.half);
  let hB = limited(m.zw * u.half);
  let hX = limited(0.5 * (m.xy - m.zw) * u.half);
  let lenX = length(hX);
  let reachX = max(length(hF), length(hB));
  let j = ign(floor(position.xy)) - 0.5;
  var own: vec3f;
  var still = reachX < 0.5;
  if (still) {
    own = lightAt(X);
  } else {
    let n1 = clamp(ceil(2.0 * reachX / u.step), 2.0, u.maxTaps);
    let jitter = j * clamp(2.0 * reachX / n1 - 1.0, 0.0, 1.0);
    var total = vec3f(0.0);
    for (var k = 0.0; k < n1; k += 1.0) {
      let s = ((k + 0.5 + jitter) / n1) * 2.0 - 1.0;
      // the content at X a fraction s of the shutter after the frame came from X - s F; before it, from X - |s| B
      total += lightAt(select(X + s * hB, X - s * hF, s >= 0.0));
    }
    own = total / n1;
  }
  var result = own;
  let tileSide = vec2f(u.rx, u.ry) * f32(u.T);
  let tile = min(vec2u(floor(X / tileSide)), vec2u(u.tw - 1u, u.th - 1u));
  let hN = limited(textureLoad(neighbors, tile, 0).xy * u.half);
  let lenN = length(hN);
  if (lenN > lenX * 1.15 + 1.0) {
    let n2 = clamp(ceil(lenN / u.step), 2.0, u.maxTaps);
    let dir = hN / lenN;
    let delta = lenN / n2;
    let jitterN = j * clamp(delta - 1.0, 0.0, 1.0);
    var cover = 0.0;
    var front = vec3f(0.0);
    for (var k = 0.0; k < n2; k += 1.0) {
      let r = (k + 0.5 + jitterN) * delta;
      for (var side = -1.0; side <= 1.0; side += 2.0) {
        let Y = X + dir * (r * side);
        let mY = motion(Y);
        let hY = limited(0.5 * (mY.xy - mY.zw) * u.half);
        let lenY = length(hY);
        // in front only across a jump in speed (a nearer object), not along a smooth change (receding ground)
        let dv = lenY - lenX;
        let ahead = smoothstep(0.25, 0.5, dv / max(lenY, 1.0)) * smoothstep(1.0, 3.0, dv);
        let reach = 1.0 - smoothstep(lenY - 0.5, lenY + 0.5, r);
        let along = smoothstep(0.3, 0.7, abs(dot(dir, hY / max(lenY, 1e-3))));
        let w = ahead * reach * along * delta / (2.0 * max(lenY, 0.5));
        cover += w;
        front += w * lightAt(Y);
      }
    }
    if (cover > 1e-5) {
      result = mix(own, front / cover, min(cover, 1.0));
      still = false;
    }
  }
  return Blurred(result, still);
}

@fragment
fn onlyMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let b = blurred(position);
  let texel = textureLoad(picture, vec2i(position.xy), 0);
  if (b.still) { return texel; }
  return vec4f(round_half(from_linear(b.light)), texel.a);
}

@fragment
fn sumMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let b = blurred(position);
  let alpha = textureLoad(picture, vec2i(position.xy), 0).a;
  return vec4f(b.light, alpha) * u.weight;
}

@fragment
fn lastMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let b = blurred(position);
  let alpha = textureLoad(picture, vec2i(position.xy), 0).a;
  let total = vec4f(b.light, alpha) * u.weight + textureLoad(sum, vec2i(position.xy), 0);
  return vec4f(round_half(from_linear(total.rgb)), total.a);
}
`
