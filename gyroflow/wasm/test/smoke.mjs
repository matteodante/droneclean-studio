// Smoke test of the package, without footage and without a browser: loads the ES module build in Node by handing its
// wasm bytes to the init function, and checks the API surface and the smoothing methods the engine describes.
// This is what `gyroflow/scripts/verify.sh` runs before the Chrome worker test.
import { readFile } from 'node:fs/promises'
import init, { FrameData, ShaderAssets, Stabilizer } from '../pkg/gyroflow_wasm.js'

const wasm = await readFile(new URL('../pkg/gyroflow_wasm_bg.wasm', import.meta.url))
await init({ module_or_path: wasm })

const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }
const same = (label, actual, expected) => check(JSON.stringify(actual) === JSON.stringify(expected),
  `${label}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`)

// The API the editor's stabilization stage (task 6.3) and the worker (js/gyro-worker.js) use
for (const name of ['open', 'smoothingMethods', 'shaderAssets']) check(typeof Stabilizer[name] === 'function', `Stabilizer.${name} is missing`)
for (const name of ['info', 'frameData', 'processRgba8', 'recompute', 'outputWidth', 'outputHeight', 'setFov',
  'setAdaptiveZoom', 'setHorizonLock', 'setSmoothing', 'lensProfile', 'setLensProfile']) {
  check(typeof Stabilizer.prototype[name] === 'function', `Stabilizer.prototype.${name} is missing`)
}
check(typeof FrameData === 'function', 'FrameData is not exported')
for (const name of ['matrices', 'matrixStride', 'params', 'mesh', 'fov', 'minimalFov', 'frame']) {
  check(name in FrameData.prototype, `FrameData has no ${name} getter`)
}
check(typeof ShaderAssets === 'function', 'ShaderAssets is not exported')
for (const name of ['lensModel', 'kernelWgsl', 'lensWgsl', 'digitalLensWgsl', 'coeffs', 'interpolation']) {
  check(name in ShaderAssets.prototype, `ShaderAssets has no ${name} getter`)
}

// Gyroflow's own warp shader, as task 6.3's stage fills it in: the kernel template with its placeholders, the lens
// model's functions, the identity digital lens, and the coefficient table Gyroflow's CPU warp interpolates with
const assets = Stabilizer.shaderAssets()
check(assets.lensModel === 'opencv_fisheye', `the default lens model is ${assets.lensModel}, not opencv_fisheye`)
for (const placeholder of ['LENS_MODEL_FUNCTIONS;', '{buffer_input}', '{/buffer_input}', '{texture_input}', 'SCALAR']) {
  check(assets.kernelWgsl.includes(placeholder), `the kernel template has no ${placeholder}`)
}
check(assets.kernelWgsl.includes('SPDX-License-Identifier: GPL-3.0-or-later'), 'the kernel template lost its licence header')
check(assets.kernelWgsl.includes('fn undistort_fragment'), 'the kernel template has no fragment entry point')
check(assets.lensWgsl.includes('fn distort_point'), 'the default lens model has no distort_point')
check(assets.lensWgsl.includes('fn undistort_point'), 'the default lens model has no undistort_point')
check(assets.digitalLensWgsl.includes('fn digital_undistort_point') && assets.digitalLensWgsl.includes('fn digital_distort_point'),
  'the identity digital lens is not there')
check(assets.coeffs.length === 496, `the coefficients table is ${assets.coeffs.length} floats, not 496`)
same('the coefficients table starts with the bilinear pair for 0', Array.from(assets.coeffs.subarray(0, 4)), [1, 0, 0.96875, 0.03125])
same('the coefficients table ends with the alphas', Array.from(assets.coeffs.subarray(492)), [1, 0.75, 0.5, 0.25])
same('the interpolation', assets.interpolation, 2)
const coeffsSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', assets.coeffs)), (b) => b.toString(16).padStart(2, '0')).join('')
const poly3 = Stabilizer.shaderAssets('poly3', null)
same('a named lens model', poly3.lensModel, 'poly3')
check(poly3.lensWgsl !== assets.lensWgsl, 'poly3 has the default model\'s functions')
same('an unknown lens model is the engine\'s default', Stabilizer.shaderAssets('no such model', null).lensModel, 'opencv_fisheye')

// The smoothing methods are gyroflow-core's own, with what each parameter accepts and what a new clip starts with
const methods = Stabilizer.smoothingMethods()
same('the smoothing methods', methods.map((m) => m.name), ['No smoothing', 'Default', 'Optimal path', 'Plain 3D', 'Fixed camera'])
for (const method of methods) {
  check(Array.isArray(method.params), `${method.name}: params is not an array`)
  for (const param of method.params || []) {
    check(typeof param.name === 'string' && typeof param.description === 'string', `${method.name}: a parameter has no name or description`)
  }
}
const parameter = (method, name) => methods.find((m) => m.name === method)?.params.find((p) => p.name === name)
same('No smoothing has no parameters', methods[0].params, [])
const smoothness = parameter('Default', 'smoothness')
check(smoothness !== undefined, 'Default has no smoothness parameter')
if (smoothness) {
  same('Default smoothness: default', smoothness.default, 0.5)
  same('Default smoothness: min', smoothness.min, 0.001)
  same('Default smoothness: max', smoothness.max, 1.0)
}
const timeConstant = parameter('Optimal path', 'max_time_constant')
check(timeConstant !== undefined, 'Optimal path has no max_time_constant parameter')
if (timeConstant) {
  same('Optimal path max_time_constant: default', timeConstant.default, 2.0)
  same('Optimal path max_time_constant: min', timeConstant.min, 0.1)
  same('Optimal path max_time_constant: max', timeConstant.max, 10.0)
  same('Optimal path max_time_constant: unit', timeConstant.unit, 's')
}

if (problems.length) {
  console.log(`${problems.length} problems in the package:`)
  for (const problem of problems) console.log('  ' + problem)
  process.exit(1)
}
console.log(`OK: the package loads in Node, ${methods.length} smoothing methods: ${methods.map((m) => `${m.name} (${m.params.length})`).join(', ')}`)
console.log(`OK: the warp shader's assets: ${assets.lensModel}, kernel ${assets.kernelWgsl.length} chars, lens functions ` +
  `${assets.lensWgsl.length}, ${assets.coeffs.length} coefficients (sha256 ${coeffsSha256})`)
