// @vitest-environment node

// The eight transforms of the port, each one held: the text they are applied to is Gyroflow's own file, read from
// `gyroflow/` as the wasm module reads it (`include_str!`), so a change in the upstream shader that these transforms do
// not know fails here instead of in a browser.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { FRAGMENT_CENTRE_OFFSET, assembleKernel, type KernelAssets } from './kernel'

/** One of Gyroflow's files, as the wasm module gets it: the same bytes, and the same line endings */
function gyroflow(path: string): string {
  return readFileSync(new URL(`../../../../gyroflow/${path}`, import.meta.url), 'utf8')
}

const KERNEL = gyroflow('src/core/gpu/wgpu_undistort.wgsl')
const PINHOLE_LENS = gyroflow('src/core/stabilization/distortion_models/opencv_fisheye.wgsl')
const POLY3_LENS = gyroflow('src/core/stabilization/distortion_models/poly3.wgsl')
const DIGITAL_LENS =
  'fn digital_undistort_point(uv: vec2<f32>) -> vec2<f32> { return uv; }\n' +
  'fn digital_distort_point  (uv: vec2<f32>) -> vec2<f32> { return uv; }'

function assets(lensWgsl = PINHOLE_LENS): KernelAssets {
  return { kernelWgsl: KERNEL, lensWgsl, digitalLensWgsl: DIGITAL_LENS }
}

describe('assembleKernel', () => {
  it('keeps Gyroflow’s licence header and both entry points', () => {
    const kernel = assembleKernel(assets())
    expect(kernel).toContain('SPDX-License-Identifier: GPL-3.0-or-later')
    expect(kernel).toContain('fn undistort_vertex')
    expect(kernel).toContain('fn undistort_fragment')
  })

  it('1. removes the buffer path and keeps the texture one', () => {
    const kernel = assembleKernel(assets())
    expect(kernel).not.toContain('{buffer_input}')
    expect(kernel).not.toContain('{/buffer_input}')
    expect(kernel).not.toContain('input_buffer')
    expect(kernel).not.toContain('output_buffer')
    expect(kernel).not.toContain('fn undistort_compute')
    expect(kernel).toContain('textureLoad(input_texture')
    expect(kernel).toContain('texture_2d<f32>')
  })

  it('2. puts the lens model’s functions where the placeholder was, and the digital lens after them', () => {
    const kernel = assembleKernel(assets())
    expect(kernel).not.toContain('LENS_MODEL_FUNCTIONS;')
    expect(kernel).toContain(PINHOLE_LENS)
    expect(kernel).toContain(DIGITAL_LENS)
    // The model's own functions, not a name the shader only mentions
    expect(kernel.indexOf('fn distort_point')).toBeGreaterThan(
      kernel.indexOf('struct KernelParams'),
    )
  })

  it('3. replaces every SCALAR with f32', () => {
    const kernel = assembleKernel(assets())
    expect(kernel).not.toContain('SCALAR')
    expect(kernel).toContain('fn undistort(position: vec2<f32>) -> vec4<f32>')
    expect(kernel).toContain('texture_2d<f32>')
  })

  it('4. drops the stage attributes Chrome’s Tint rejects on module-scope bindings', () => {
    const kernel = assembleKernel(assets())
    expect(kernel).not.toContain('@fragment var')
    expect(kernel).not.toContain('@compute var')
    expect(kernel).toContain('@group(0) @binding(0) var<uniform> params: KernelParams;')
    expect(kernel).toContain('@group(0) @binding(5) var input_texture: texture_2d<f32>;')
  })

  it('5. reads the flags from the uniform, so one pipeline serves every frame', () => {
    const kernel = assembleKernel(assets())
    expect(kernel).not.toContain('bool(flags &')
    expect(kernel).not.toContain(', flags)')
    expect(kernel).not.toContain('params.params.flags')
    expect(kernel).toContain('bool(params.flags & 8)') // drawing off
    expect(kernel).toContain('blend_residual(l, u, t, a, params.flags)')
    expect(kernel).toContain('bool(params.flags & 4)') // fill with background, upstream's own read
  })

  it('6. moves the fragment to the pixel the CPU kernel indexes', () => {
    const kernel = assembleKernel(assets())
    expect(FRAGMENT_CENTRE_OFFSET).toBe(-0.5)
    expect(kernel).toContain('return undistort(position.xy + vec2<f32>(-0.5));')
    expect(kernel).not.toContain('return undistort(position.xy);')
  })

  it('assembles every lens model’s functions, not just the default’s', () => {
    const kernel = assembleKernel(assets(POLY3_LENS))
    expect(kernel).toContain(POLY3_LENS)
    expect(kernel).not.toContain(PINHOLE_LENS)
    expect(kernel).toContain('fn distort_point')
  })

  it('fails loudly when the template is not the text it knows', () => {
    expect(() => assembleKernel({ ...assets(), kernelWgsl: 'fn main() {}' })).toThrow(/transform 2/)
    const noCall = KERNEL.replace('return undistort(position.xy);', 'return position;')
    expect(() => assembleKernel({ ...assets(), kernelWgsl: noCall })).toThrow(/transform 6/)
    const noFlags = KERNEL.replaceAll('bool(flags &', 'bool(other &')
    expect(() => assembleKernel({ ...assets(), kernelWgsl: noFlags })).toThrow(/transform 5/)
  })
})
