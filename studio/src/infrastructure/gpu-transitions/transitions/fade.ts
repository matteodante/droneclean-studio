import type { GpuTransitionDefinition } from '../types'

export const fade: GpuTransitionDefinition = {
  id: 'fade',
  name: 'Fade',
  category: 'basic',
  hasDirection: false,
  entryPoint: 'fadeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct FadeParams {
  progress: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: FadeParams;

@fragment
fn fadeFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);

  // cos²/sin² weights summing to 1, plus a 4% scale drift — mirrors the
  // Canvas2D fade renderer so GPU preview matches CPU export exactly. The
  // outgoing clip grows from 1 to 1.04 (DroneClean, 20 Nov 2026: FreeCut shrank
  // it to 0.96, leaving a dark border where only the incoming clip's weight
  // showed), so both clips always cover the frame and need no mask.
  let c = cos(p * PI / 2.0);
  let wOut = c * c;
  let wIn = 1.0 - c * c;
  let outgoingScale = 1.0 + 0.04 * p;
  let incomingScale = 1.04 - 0.04 * p;

  let outgoingUv = (input.uv - vec2f(0.5)) / outgoingScale + vec2f(0.5);
  let incomingUv = (input.uv - vec2f(0.5)) / incomingScale + vec2f(0.5);
  let left = textureSample(leftTex, texSampler, outgoingUv);
  let right = textureSample(rightTex, texSampler, incomingUv);
  let color = left.rgb * wOut + right.rgb * wIn;
  let alpha = clamp(left.a * wOut + right.a * wIn, 0.0, 1.0);

  return vec4f(color, alpha);
}`,
  packUniforms: (progress, width, height) => {
    return new Float32Array([progress, width, height, 0])
  },
}
