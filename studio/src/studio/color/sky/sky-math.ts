/**
 * The Sky effect's maths on the CPU (plan 11.14): the reference the unit test checks and the
 * shader in `effect.ts` mirrors line by line.
 *
 * What it does to one pixel, in float and in the colour space the chain is in (the clip's display
 * Rec.709 after the input transform, so a colour typed in the panel is a colour on screen):
 *
 * 1. A graduated fill runs from `horizonColor` at the horizon line to `skyColor` at the top of
 *    the frame. The line sits at `horizon` (0 = top edge, 1 = bottom edge of the frame), tilted by
 *    `angle` degrees (positive tilts the right end down, as a clockwise turn does), measured in
 *    frame heights so the angle is a true angle on a 16:9 frame. `softness` is the width of the
 *    fade at the line: below it the fill is gone, above it the fill is full.
 * 2. The fill goes on as a colour blend: the fill's hue and chroma, with the pixel's own
 *    brightness kept by `1 - density` (clouds stay lighter than the gaps between them). At
 *    density 1 the sky is a flat gradient, at 0 only the pixel's brightness variation is
 *    recoloured, so a clipped white sky (brightness 1 everywhere) takes the fill's chroma at full
 *    brightness.
 * 3. The highlight protection: a pixel that is dark (below `lumaThreshold`) or colourful (above
 *    `satLimit`) is not sky, and `protection` is how strictly that is held: 0 recolours everything
 *    above the line, 1 only bright, low-saturation pixels (sky, not the subject or the trees).
 */

/** The parameters, as the effect stores them. Colours are 0..1 floats. */
export interface SkyParams {
  skyColor: readonly [number, number, number]
  horizonColor: readonly [number, number, number]
  /** 0 = top edge, 1 = bottom edge. */
  horizon: number
  /** Degrees, positive turns the line clockwise. */
  angle: number
  /** The fade's width at the line, in frame heights. */
  softness: number
  strength: number
  density: number
  lumaThreshold: number
  satLimit: number
  protection: number
}

export const SKY_DEFAULTS: SkyParams = {
  skyColor: [0x4a / 255, 0x7f / 255, 0xb5 / 255],
  horizonColor: [0xc9 / 255, 0xd6 / 255, 0xe2 / 255],
  horizon: 0.5,
  angle: 0,
  softness: 0.3,
  strength: 0.8,
  density: 0.6,
  lumaThreshold: 0.55,
  satLimit: 0.3,
  protection: 0.85,
}

/** The width of the luma and saturation ramps around their thresholds. */
export const LUMA_RAMP = 0.15
export const SAT_RAMP = 0.15

type Rgb = readonly [number, number, number]

/** WGSL `smoothstep`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Rec.601 luma, the weights the other grade effects use. */
function luma601(c: Rgb): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
}

/** The horizon's signed height of a point: positive above the line, in frame heights. */
export function heightAboveHorizon(
  uv: readonly [number, number],
  params: Pick<SkyParams, 'horizon' | 'angle'>,
  aspect: number,
): number {
  const angle = (params.angle * Math.PI) / 180
  const dx = (uv[0] - 0.5) * aspect
  const dy = uv[1] - params.horizon
  // The direction "up" for a line turned clockwise by `angle`: (sin a, -cos a) in y-down coordinates.
  return dx * Math.sin(angle) - dy * Math.cos(angle)
}

/** Where the fill applies, 0..1: full above the line's fade, gone below it. */
function skyRegion(height: number, softness: number): number {
  const edge = Math.max(softness, 0.001) * 0.5
  return smoothstep(-edge, edge, height)
}

/** The graduated fill's colour at a height: the horizon colour at the line, the sky colour at the top. */
export function skyFill(height: number, params: SkyParams): Rgb {
  const span = Math.max(params.horizon, 0.05)
  const s = smoothstep(0, 1, Math.min(Math.max(height / span, 0), 1))
  return [
    params.horizonColor[0] + (params.skyColor[0] - params.horizonColor[0]) * s,
    params.horizonColor[1] + (params.skyColor[1] - params.horizonColor[1]) * s,
    params.horizonColor[2] + (params.skyColor[2] - params.horizonColor[2]) * s,
  ]
}

/** How much a pixel looks like sky, 0..1: bright and with little colour. */
export function skyLikelihood(c: Rgb, params: SkyParams): number {
  const maxC = Math.max(c[0], c[1], c[2])
  const minC = Math.min(c[0], c[1], c[2])
  const sat = (maxC - minC) / (maxC + 0.001)
  const bright = smoothstep(params.lumaThreshold - LUMA_RAMP, params.lumaThreshold + LUMA_RAMP, luma601(c))
  const plain = 1 - smoothstep(params.satLimit, params.satLimit + SAT_RAMP, sat)
  return bright * plain
}

/** The mask the fill is mixed in with, 0..1 (what "Show mask" draws). */
export function skyMask(
  c: Rgb,
  uv: readonly [number, number],
  params: SkyParams,
  aspect: number,
): number {
  const height = heightAboveHorizon(uv, params, aspect)
  const select = 1 - params.protection + params.protection * skyLikelihood(c, params)
  return Math.min(Math.max(skyRegion(height, params.softness) * params.strength * select, 0), 1)
}

/** One pixel through the effect. `uv` is 0..1 from the top left; `aspect` is width over height. */
export function skyPixel(
  c: Rgb,
  uv: readonly [number, number],
  params: SkyParams,
  aspect: number,
): [number, number, number] {
  const mask = skyMask(c, uv, params, aspect)
  const fill = skyFill(heightAboveHorizon(uv, params, aspect), params)
  const shift = (luma601(c) - luma601(fill)) * (1 - params.density)
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i += 1) {
    const filled = Math.min(Math.max(fill[i]! + shift, 0), 1)
    out[i] = c[i]! + (filled - c[i]!) * mask
  }
  return out
}
