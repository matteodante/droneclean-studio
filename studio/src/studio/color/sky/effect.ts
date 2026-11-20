/**
 * The Sky effect for the GPU effect chain (plan 11.14): a graduated fill from a sky colour at the
 * top to a horizon colour, put only on bright, low-saturation pixels. The maths is in
 * `sky-math.ts` (the CPU reference the tests check); the shader below mirrors it. It is a colour
 * effect, so it sits in the chain wherever the pilot adds it, like the power window, and runs in
 * the chain's float format.
 *
 * The registry picks it up through `registerEffects` in `infrastructure/gpu-effects/registry.ts`:
 * the one hook in FreeCut's files.
 */

import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects/types'
import { LUMA_RAMP, SAT_RAMP, SKY_DEFAULTS } from './sky-math'

const hex = (rgb: readonly [number, number, number]): string =>
  `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`

const SKY_HEX = hex(SKY_DEFAULTS.skyColor)
const HORIZON_HEX = hex(SKY_DEFAULTS.horizonColor)

/** A `#rrggbb` (or `#rgb`) colour as 0..1 floats; anything else gives the fallback. */
export function parseSkyColor(
  value: unknown,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (typeof value !== 'string' || !value.startsWith('#')) return [...fallback]
  const digits = value.slice(1)
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((c) => c + c)
          .join('')
      : digits.length === 6 || digits.length === 8
        ? digits.slice(0, 6)
        : ''
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [...fallback]
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ]
}

function num(params: Record<string, number | boolean | string>, key: string, fallback: number) {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const sky: GpuEffectDefinition = {
  id: 'gpu-sky',
  name: 'Sky',
  category: 'color',
  entryPoint: 'skyFragment',
  uniformSize: 64,
  shader: /* wgsl */ `
struct SkyParams {
  skyR: f32, skyG: f32, skyB: f32, horizon: f32,
  horR: f32, horG: f32, horB: f32, angle: f32,
  softness: f32, strength: f32, density: f32, lumaThreshold: f32,
  satLimit: f32, protection: f32, showMask: f32, aspect: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SkyParams;

fn heightAboveHorizon(uv: vec2f) -> f32 {
  let a = params.angle * PI / 180.0;
  let dx = (uv.x - 0.5) * params.aspect;
  let dy = uv.y - params.horizon;
  return dx * sin(a) - dy * cos(a);
}

@fragment
fn skyFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let height = heightAboveHorizon(input.uv);

  let edge = max(params.softness, 0.001) * 0.5;
  let region = smoothstep(-edge, edge, height);

  let maxC = max(max(color.r, color.g), color.b);
  let minC = min(min(color.r, color.g), color.b);
  let sat = (maxC - minC) / (maxC + 0.001);
  let bright = smoothstep(params.lumaThreshold - ${LUMA_RAMP.toFixed(2)}, params.lumaThreshold + ${LUMA_RAMP.toFixed(2)}, luminance601(color.rgb));
  let plain = 1.0 - smoothstep(params.satLimit, params.satLimit + ${SAT_RAMP.toFixed(2)}, sat);
  let select = 1.0 - params.protection + params.protection * bright * plain;
  let mask = clamp(region * params.strength * select, 0.0, 1.0);

  if (params.showMask > 0.5) {
    return vec4f(vec3f(mask), color.a);
  }

  let span = max(params.horizon, 0.05);
  let s = smoothstep(0.0, 1.0, clamp(height / span, 0.0, 1.0));
  let fill = mix(vec3f(params.horR, params.horG, params.horB), vec3f(params.skyR, params.skyG, params.skyB), s);
  let shift = (luminance601(color.rgb) - luminance601(fill)) * (1.0 - params.density);
  let filled = clamp(fill + vec3f(shift), vec3f(0.0), vec3f(1.0));
  return vec4f(mix(color.rgb, filled, mask), color.a);
}`,
  params: {
    skyColor: { type: 'color', label: 'Sky Color', default: SKY_HEX, animatable: true },
    horizonColor: { type: 'color', label: 'Horizon Color', default: HORIZON_HEX, animatable: true },
    horizon: {
      type: 'number',
      label: 'Horizon',
      default: SKY_DEFAULTS.horizon,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    angle: {
      type: 'number',
      label: 'Angle',
      default: SKY_DEFAULTS.angle,
      min: -45,
      max: 45,
      step: 0.5,
      animatable: true,
    },
    softness: {
      type: 'number',
      label: 'Softness',
      default: SKY_DEFAULTS.softness,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    strength: {
      type: 'number',
      label: 'Strength',
      default: SKY_DEFAULTS.strength,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    density: {
      type: 'number',
      label: 'Density',
      default: SKY_DEFAULTS.density,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    protection: {
      type: 'number',
      label: 'Highlight Protection',
      default: SKY_DEFAULTS.protection,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    lumaThreshold: {
      type: 'number',
      label: 'Sky Brightness',
      default: SKY_DEFAULTS.lumaThreshold,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    satLimit: {
      type: 'number',
      label: 'Max Saturation',
      default: SKY_DEFAULTS.satLimit,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    showMask: { type: 'boolean', label: 'Show Mask', default: false },
  },
  packUniforms: (p, w, h) => {
    const sky = parseSkyColor(p.skyColor, SKY_DEFAULTS.skyColor)
    const horizon = parseSkyColor(p.horizonColor, SKY_DEFAULTS.horizonColor)
    return new Float32Array([
      sky[0],
      sky[1],
      sky[2],
      num(p, 'horizon', SKY_DEFAULTS.horizon),
      horizon[0],
      horizon[1],
      horizon[2],
      num(p, 'angle', SKY_DEFAULTS.angle),
      num(p, 'softness', SKY_DEFAULTS.softness),
      num(p, 'strength', SKY_DEFAULTS.strength),
      num(p, 'density', SKY_DEFAULTS.density),
      num(p, 'lumaThreshold', SKY_DEFAULTS.lumaThreshold),
      num(p, 'satLimit', SKY_DEFAULTS.satLimit),
      num(p, 'protection', SKY_DEFAULTS.protection),
      p.showMask === true ? 1 : 0,
      w / Math.max(h, 1),
    ])
  },
}
