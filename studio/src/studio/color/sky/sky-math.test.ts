// The Sky effect on a CPU reference: a clipped white sky, a dark subject, a bright coloured
// subject, the horizon's edge, a tilted line, and the uniforms the shader reads.

import { describe, expect, it } from 'vite-plus/test'
import { parseSkyColor, sky } from './effect'
import {
  heightAboveHorizon,
  skyFill,
  skyLikelihood,
  skyMask,
  skyPixel,
  SKY_DEFAULTS,
  type SkyParams,
} from './sky-math'

const ASPECT = 16 / 9
const WHITE = [1, 1, 1] as const
const TREE = [0.1, 0.3, 0.1] as const
const ORANGE = [0.9, 0.6, 0.2] as const

describe('Sky maths on a CPU reference', () => {
  it('turns a clipped white sky blue at the top and keeps it in range', () => {
    const [r, g, b] = skyPixel(WHITE, [0.5, 0.1], SKY_DEFAULTS, ASPECT)
    expect(b).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(r)
    expect(r).toBeLessThan(0.85)
    for (const v of [r, g, b]) expect(v).toBeLessThanOrEqual(1)
  })

  it('leaves a dark subject nearly alone where a white sky is recoloured', () => {
    const uv = [0.5, 0.1] as const
    const skyMaskValue = skyMask(WHITE, uv, SKY_DEFAULTS, ASPECT)
    const treeMask = skyMask(TREE, uv, SKY_DEFAULTS, ASPECT)
    expect(skyMaskValue).toBeCloseTo(0.8, 6)
    // protection 0.85: a dark pixel keeps 15 % of the strength, a white one all of it
    expect(treeMask).toBeCloseTo(0.8 * 0.15, 6)
    expect(treeMask).toBeLessThan(skyMaskValue / 5)
  })

  it('does not recolour a bright but colourful pixel as sky', () => {
    expect(skyLikelihood(ORANGE, SKY_DEFAULTS)).toBe(0)
    expect(skyLikelihood(WHITE, SKY_DEFAULTS)).toBe(1)
    expect(skyLikelihood(TREE, SKY_DEFAULTS)).toBe(0)
  })

  it('with protection off, everything above the line is recoloured alike', () => {
    const params: SkyParams = { ...SKY_DEFAULTS, protection: 0, strength: 1 }
    expect(skyMask(TREE, [0.5, 0.05], params, ASPECT)).toBe(1)
    expect(skyMask(ORANGE, [0.5, 0.05], params, ASPECT)).toBe(1)
  })

  it('changes nothing below the horizon', () => {
    const below = skyPixel(WHITE, [0.5, 0.9], SKY_DEFAULTS, ASPECT)
    expect(below).toEqual([1, 1, 1])
  })

  it('is half faded on the horizon line itself, and fills with the horizon colour there', () => {
    const uv = [0.5, SKY_DEFAULTS.horizon] as const
    expect(heightAboveHorizon(uv, SKY_DEFAULTS, ASPECT)).toBeCloseTo(0, 12)
    expect(skyMask(WHITE, uv, SKY_DEFAULTS, ASPECT)).toBeCloseTo(0.4, 6)
    const fill = skyFill(0, SKY_DEFAULTS)
    expect(fill[0]).toBeCloseTo(SKY_DEFAULTS.horizonColor[0], 9)
    expect(fill[2]).toBeCloseTo(SKY_DEFAULTS.horizonColor[2], 9)
  })

  it('reaches the sky colour at the top of the frame', () => {
    const fill = skyFill(SKY_DEFAULTS.horizon, SKY_DEFAULTS)
    expect(fill[0]).toBeCloseTo(SKY_DEFAULTS.skyColor[0], 9)
    expect(fill[1]).toBeCloseTo(SKY_DEFAULTS.skyColor[1], 9)
    expect(fill[2]).toBeCloseTo(SKY_DEFAULTS.skyColor[2], 9)
  })

  it('turns the line by the angle: a clockwise tilt puts the right side above it', () => {
    const tilted: SkyParams = { ...SKY_DEFAULTS, angle: 20 }
    const left = heightAboveHorizon([0.1, 0.5], tilted, ASPECT)
    const right = heightAboveHorizon([0.9, 0.5], tilted, ASPECT)
    expect(right).toBeGreaterThan(0)
    expect(left).toBeLessThan(0)
    expect(right).toBeCloseTo(-left, 12)
    // 0.4 frame widths at 16:9, turned 20 degrees
    expect(right).toBeCloseTo(0.4 * ASPECT * Math.sin((20 * Math.PI) / 180), 12)
  })

  it('keeps cloud detail at low density and flattens it at density 1', () => {
    const uv = [0.5, 0.1] as const
    const params: SkyParams = { ...SKY_DEFAULTS, protection: 0, strength: 1, softness: 0 }
    const gap = skyPixel([0.7, 0.7, 0.7], uv, { ...params, density: 0.3 }, ASPECT)
    const cloud = skyPixel([0.95, 0.95, 0.95], uv, { ...params, density: 0.3 }, ASPECT)
    expect(cloud[1]! - gap[1]!).toBeGreaterThan(0.1)
    const flatGap = skyPixel([0.7, 0.7, 0.7], uv, { ...params, density: 1 }, ASPECT)
    const flatCloud = skyPixel([0.95, 0.95, 0.95], uv, { ...params, density: 1 }, ASPECT)
    flatCloud.forEach((v, i) => expect(v).toBeCloseTo(flatGap[i]!, 12))
  })

  it('is the identity at strength 0', () => {
    const p: SkyParams = { ...SKY_DEFAULTS, strength: 0 }
    expect(skyPixel([0.8, 0.82, 0.85], [0.5, 0.1], p, ASPECT)).toEqual([0.8, 0.82, 0.85])
  })
})

describe('Sky effect definition', () => {
  it('is a colour effect with its id and a 16-float uniform', () => {
    expect(sky.id).toBe('gpu-sky')
    expect(sky.category).toBe('color')
    expect(sky.uniformSize).toBe(64)
  })

  it('packs the colours, the numbers and the aspect in the order the shader declares', () => {
    const uniforms = sky.packUniforms(
      { skyColor: '#ff0000', horizonColor: '#0000ff', horizon: 0.4, angle: 5, showMask: true },
      1920,
      1080,
    )!
    expect(uniforms).toHaveLength(16)
    expect(Array.from(uniforms.slice(0, 4))).toEqual([1, 0, 0, expect.closeTo(0.4, 6)])
    expect(Array.from(uniforms.slice(4, 8))).toEqual([0, 0, 1, 5])
    expect(uniforms[14]).toBe(1)
    expect(uniforms[15]).toBeCloseTo(16 / 9, 6)
    // the shader's struct has exactly these 16 f32 members
    expect(sky.shader.match(/: f32/g)!.length).toBeGreaterThanOrEqual(16)
  })

  it('falls back to the defaults for a bad colour', () => {
    expect(parseSkyColor('blue', SKY_DEFAULTS.skyColor)).toEqual([...SKY_DEFAULTS.skyColor])
    expect(parseSkyColor('#0g0000', SKY_DEFAULTS.skyColor)).toEqual([...SKY_DEFAULTS.skyColor])
    expect(parseSkyColor('#fff', SKY_DEFAULTS.skyColor)).toEqual([1, 1, 1])
  })
})
