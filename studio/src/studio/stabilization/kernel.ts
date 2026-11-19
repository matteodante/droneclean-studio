// Gyroflow's warp kernel, assembled for WebGPU. The shader is Gyroflow's, not a copy of it: `@/studio/stabilization`
// gets the text from the wasm module (`Stabilizer.shaderAssets`), which reads the upstream file with `include_str!`, and
// this file applies the transforms that Gyroflow's own WebGPU build applies plus the ones a browser's Tint and this
// stage need. Nothing below is transcribed WGSL.
//
// SPDX-License-Identifier: GPL-3.0-or-later - the kernel and the lens functions it is assembled with are Gyroflow's
// (`gyroflow/src/core/gpu/wgpu_undistort.wgsl`, `gyroflow/src/core/stabilization/distortion_models/*.wgsl`, Copyright
// © Gyroflow's authors), and the assembled text keeps their headers.
//
// The transforms, in the order they are applied - the first three are what `gyroflow/src/core/gpu/wgpu.rs:359-386`
// does for its own texture binding, the rest are this stage's (design 6.3 §4.1):
//
//   1. the `{buffer_input}` block goes: the stage draws into a texture, not a compute shader writing a buffer;
//   2. `LENS_MODEL_FUNCTIONS;` becomes the lens model's functions and then the digital lens's;
//   3. `SCALAR` becomes `f32`: the stage reads a normalized texture (`rgba8unorm`, `rgba16float`, `rgba32float`);
//   4. a stage attribute on a module-scope binding goes (`@fragment var` -> `var`): naga accepts it, Chrome's Tint
//      rejects it ("'@fragment' is not valid for module-scope 'var'"), and the bind group layout carries the stage;
//   5. every read of the `flags` override becomes `params.flags`, the value that override was compiled from: one
//      pipeline then serves every frame, whatever its flags;
//   6. the fragment's pixel position moves from the pixel's centre to the integer pixel the CPU kernel indexes:
//      `@builtin(position)` is (x + 0.5, y + 0.5), and without the -0.5 px the port is 13 dB worse (design 6.3 §5.2).
//
// The two data transforms of the port are in `stage.ts`: `max_pixel_value` and `pixel_value_limit` set to 1.0 in the
// kernel parameters (bytes 352 and 364), and Gyroflow's coefficient table in the `coeffs` storage buffer.

/** The fragment's pixel position is the pixel's centre; the CPU kernel indexes whole pixels: this is the difference */
export const FRAGMENT_CENTRE_OFFSET = -0.5

/** The warp shader's text, as `Stabilizer.shaderAssets` gives it (the wasm module's `ShaderAssets`) */
export interface KernelAssets {
  /** The kernel template, `gpu/wgpu_undistort.wgsl` as it is, `LENS_MODEL_FUNCTIONS;` and `SCALAR` included */
  kernelWgsl: string
  /** The lens model's functions, where `LENS_MODEL_FUNCTIONS;` goes */
  lensWgsl: string
  /** The digital lens's functions, placed after the lens model's (the identity pair when there is no digital lens) */
  digitalLensWgsl: string
}

const BUFFER_INPUT = '{buffer_input}'
const BUFFER_INPUT_END = '{/buffer_input}'
const LENS_MODEL_FUNCTIONS = 'LENS_MODEL_FUNCTIONS;'
const SCALAR = 'SCALAR'
const FRAGMENT_VAR = '@fragment var'
const COMPUTE_VAR = '@compute var'
const FLAGS_READ = 'bool(flags &'
const FLAGS_ARGUMENT = ', flags)'
const UNDISTORT_CALL = 'undistort(position.xy)'

function replaceOnce(kernel: string, from: string, to: string, transform: string): string {
  if (!kernel.includes(from)) {
    throw new Error(
      `kernel.ts transform ${transform} did not apply: the template has no ${JSON.stringify(from)}. ` +
        "Gyroflow's kernel text changed: see gyroflow/src/core/gpu/wgpu_undistort.wgsl.",
    )
  }
  return kernel.replace(from, to)
}

/**
 * Gyroflow's kernel template with the six text transforms above applied, ready for
 * `GPUDevice.createShaderModule`. Throws when the template is not the text these transforms know: a silent
 * half-transformed kernel would compile (naga) or not (Tint) for reasons nobody could read from the error.
 */
export function assembleKernel(assets: KernelAssets): string {
  const { kernelWgsl, lensWgsl, digitalLensWgsl } = assets
  let kernel = kernelWgsl

  // 1. The buffer path: from its marker to the end of its block, as wgpu.rs removes it when the buffers are textures.
  //    The `// {texture_input}` comments next to it stay: they are comments, and the text a reader compares with
  //    Gyroflow's file keeps its markers.
  while (kernel.includes(BUFFER_INPUT)) {
    const start = kernel.indexOf(BUFFER_INPUT)
    const end = kernel.indexOf(BUFFER_INPUT_END)
    if (end < 0)
      throw new Error(
        `kernel.ts transform 1 did not apply: ${BUFFER_INPUT} has no ${BUFFER_INPUT_END}`,
      )
    kernel = kernel.slice(0, start) + kernel.slice(end + BUFFER_INPUT_END.length)
  }

  // 2. The lens model's functions, then the digital lens's, as wgpu.rs:362-366 puts them
  kernel = replaceOnce(kernel, LENS_MODEL_FUNCTIONS, `${lensWgsl}\n${digitalLensWgsl}\n`, '2')

  // 3. A f32 texture: the stage's input is normalized (design 6.3 §0.5), so the shader's scalar type is f32
  if (!kernel.includes(SCALAR))
    throw new Error(`kernel.ts transform 3 did not apply: the template has no ${SCALAR}`)
  kernel = kernel.replaceAll(SCALAR, 'f32')

  // 4. Tint rejects a stage attribute on a module-scope binding; the bind group layout has the visibility
  if (!kernel.includes(FRAGMENT_VAR))
    throw new Error(`kernel.ts transform 4 did not apply: the template has no ${FRAGMENT_VAR}`)
  kernel = kernel.replaceAll(FRAGMENT_VAR, 'var').replaceAll(COMPUTE_VAR, 'var')

  // 5. The frame's flags come from the uniform, not from a pipeline constant, so one pipeline serves every frame.
  //    `flags` is also a parameter name in `blend_residual`, which reads the same value: both uses move to `params`.
  if (!kernel.includes(FLAGS_READ))
    throw new Error(`kernel.ts transform 5 did not apply: the template has no ${FLAGS_READ}`)
  kernel = kernel
    .replaceAll(FLAGS_READ, 'bool(params.flags &')
    .replaceAll(FLAGS_ARGUMENT, ', params.flags)')

  // 6. The half pixel of design 6.3 §2 note 1
  kernel = replaceOnce(
    kernel,
    UNDISTORT_CALL,
    `undistort(position.xy + vec2<f32>(${FRAGMENT_CENTRE_OFFSET}))`,
    '6',
  )

  // The whole port, held to what a reader can check without a GPU: nothing of the old text is left, and the entries and
  // the licence are there
  const leftovers = [
    [BUFFER_INPUT, 'the buffer path'],
    [BUFFER_INPUT_END, 'the buffer path'],
    [LENS_MODEL_FUNCTIONS, 'the lens functions placeholder'],
    [SCALAR, 'the scalar type placeholder'],
    [FRAGMENT_VAR, 'a fragment stage attribute on a module-scope binding'],
    [COMPUTE_VAR, 'a compute stage attribute on a module-scope binding'],
    [FLAGS_READ, 'a read of the flags override'],
    [FLAGS_ARGUMENT, 'the flags argument of blend_residual'],
    ['params.params.flags', 'a doubled params.flags'],
  ] as const
  for (const [text, what] of leftovers) {
    if (kernel.includes(text))
      throw new Error(`the assembled kernel still has ${what} (${JSON.stringify(text)})`)
  }
  for (const entry of ['fn undistort_vertex', 'fn undistort_fragment']) {
    if (!kernel.includes(entry)) throw new Error(`the assembled kernel has lost ${entry}`)
  }
  if (!kernel.includes('SPDX-License-Identifier: GPL-3.0-or-later')) {
    throw new Error('the assembled kernel has lost its licence header')
  }
  return kernel
}
