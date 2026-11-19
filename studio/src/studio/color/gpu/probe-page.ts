// The page `probe.mjs` drives: the two colour passes on this Mac's GPU against the CPU references of
// `src/studio/color` — `transform()` for the input pass, `sampleTetrahedral()` and
// `sampleTetrahedralFloat32()` for the look pass. Everything it returns is plain JSON; the buffers
// stay here, where the comparisons happen.

import type { CubeLut1D, CubeLut3D, ParsedCube } from '../cube'
import { transform } from '../display'
import { floatToHalfBits, halfBitsToFloat } from '../lut-texture'
import { sampleTetrahedral, sampleTetrahedralFloat32 } from '../tetrahedral'
import type { ColorProfileId, InputColorPass } from '../types'
import { createInputColorPass } from './input-color-pass'
import { createLookPass, type LookStage } from './look-pass'

/** How one pass's output differs from its reference, in levels of 1023. */
interface Statistics {
  mean: number
  max: number
  /** The sample the largest difference is at. */
  at: number
}

interface GpuErrorReport {
  errors: string[]
}

const BYTES_PER_TEXEL = 8
const TEXTURE_USAGE =
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_DST |
  GPUTextureUsage.COPY_SRC

let device: GPUDevice | null = null
let adapterDescription: Record<string, string> = {}
const gpuErrors: string[] = []

async function gpu(): Promise<GPUDevice> {
  if (device !== null) return device
  if (!navigator.gpu) throw new Error('navigator.gpu is missing: this Chrome has no WebGPU')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('no WebGPU adapter in this Chrome')
  device = await adapter.requestDevice()
  device.onuncapturederror = (event) => {
    gpuErrors.push(event.error.message)
  }
  void device.lost.then((info) => {
    gpuErrors.push(`the device was lost: ${info.message}`)
  })
  const info = adapter.info
  adapterDescription = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  }
  return device
}

function createTexture(
  gpuDevice: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
): GPUTexture {
  return gpuDevice.createTexture({
    label: `${format} ${width}x${height}`,
    size: { width, height },
    format,
    usage: TEXTURE_USAGE,
  })
}

/** A row pitch a buffer copy accepts: 256 bytes, as `copyTextureToBuffer` requires. */
function rowStride(width: number): number {
  return Math.ceil((width * BYTES_PER_TEXEL) / 256) * 256
}

/** Uploads `width × height` rgba16float texels, four half-floats each, into `texture`. */
function uploadHalves(
  gpuDevice: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  halves: Uint16Array,
): void {
  const stride = rowStride(width)
  const bytes = new Uint8Array(stride * height)
  const rowLength = width * 4
  for (let row = 0; row < height; row++) {
    for (let index = 0; index < rowLength; index++) {
      const bits = halves[row * rowLength + index] as number
      bytes[row * stride + index * 2] = bits & 0xff
      bytes[row * stride + index * 2 + 1] = bits >>> 8
    }
  }
  gpuDevice.queue.writeTexture(
    { texture },
    bytes,
    { bytesPerRow: stride, rowsPerImage: height },
    { width, height },
  )
}

/** Reads `width × height` rgba16float texels back as their half-float bit patterns. */
async function downloadHalves(
  gpuDevice: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Uint16Array> {
  const stride = rowStride(width)
  const buffer = gpuDevice.createBuffer({
    label: 'colour probe readback',
    size: stride * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = gpuDevice.createCommandEncoder({ label: 'colour probe readback' })
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow: stride, rowsPerImage: height },
    { width, height },
  )
  gpuDevice.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
  buffer.unmap()
  buffer.destroy()
  const halves = new Uint16Array(width * height * 4)
  const rowLength = width * 4
  for (let row = 0; row < height; row++) {
    for (let index = 0; index < rowLength; index++) {
      halves[row * rowLength + index] =
        (bytes[row * stride + index * 2] as number) |
        ((bytes[row * stride + index * 2 + 1] as number) << 8)
    }
  }
  return halves
}

/** An rgba16float texture of `width × height` texels read from `pixel(index)` as four half-floats. */
function writePixels(
  gpuDevice: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  pixel: (index: number) => readonly [number, number, number, number],
): void {
  const halves = new Uint16Array(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    const values = pixel(index)
    for (let channel = 0; channel < 4; channel++) {
      halves[index * 4 + channel] = floatToHalfBits(values[channel] as number)
    }
  }
  uploadHalves(gpuDevice, texture, width, height, halves)
}

const inputPasses = new Map<GPUTextureFormat, InputColorPass>()

async function inputPass(target: GPUTextureFormat): Promise<InputColorPass> {
  const cached = inputPasses.get(target)
  if (cached) return cached
  const pass = await createInputColorPass(await gpu(), { input: target, output: target })
  inputPasses.set(target, pass)
  return pass
}

const lookStages = new Map<GPUTextureFormat, LookStage>()

async function lookStage(target: GPUTextureFormat): Promise<LookStage> {
  const cached = lookStages.get(target)
  if (cached) return cached
  const stage = await createLookPass(await gpu(), { input: target, output: target })
  lookStages.set(target, stage)
  return stage
}

/** The codes of the design's bench ramp (`bench/lib/inputs.mjs`: 64 + mod(X, 877)). */
function benchCodes(): number[] {
  const codes: number[] = []
  for (let code = 64; code <= 940; code++) codes.push(code)
  return codes
}

/**
 * The input pass on a list of 10-bit codes, each written as `code/1023` in rgba16float, against
 * `transform()`: once on the exact code and once on the code the half-float input actually stored.
 */
async function runCodes(
  profile: ColorProfileId,
  codes: readonly number[],
): Promise<{
  profile: ColorProfileId
  codes: number
  stored: Statistics
  exact: Statistics
  /** The sign of the differences: a store that truncates never goes above the reference. */
  signed: { min: number; max: number; positive: number; samples: number }
  inputStorageMax: number
  values: Float32Array
}> {
  const gpuDevice = await gpu()
  const pixel = (index: number): readonly [number, number, number, number] => {
    const value = (codes[index] as number) / 1023
    return [value, value, value, 1]
  }
  const input = createTexture(gpuDevice, codes.length, 1, 'rgba16float')
  writePixels(gpuDevice, input, codes.length, 1, pixel)
  const output = createTexture(gpuDevice, codes.length, 1, 'rgba16float')
  const pass = await inputPass('rgba16float')
  const encoder = gpuDevice.createCommandEncoder({ label: 'input colour ramp' })
  pass.encode(encoder, input.createView(), output.createView(), profile, {
    width: codes.length,
    height: 1,
  })
  gpuDevice.queue.submit([encoder.finish()])
  const halves = await downloadHalves(gpuDevice, output, codes.length, 1)

  const values = new Float32Array(codes.length * 3)
  let storedSum = 0
  let storedMax = 0
  let storedAt = 0
  let exactSum = 0
  let exactMax = 0
  let exactAt = 0
  let inputStorageMax = 0
  let signedMin = 0
  let signedMax = 0
  let positive = 0
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index] as number
    const exactCode = code / 1023
    const storedCode = halfBitsToFloat(floatToHalfBits(exactCode))
    inputStorageMax = Math.max(inputStorageMax, Math.abs(storedCode - exactCode) * 1023)
    const onExact = transform([exactCode, exactCode, exactCode], profile)
    const onStored = transform([storedCode, storedCode, storedCode], profile)
    for (let channel = 0; channel < 3; channel++) {
      const actual = halfBitsToFloat(halves[index * 4 + channel] as number)
      values[index * 3 + channel] = actual
      const signed = (actual - (onStored[channel] as number)) * 1023
      const versusStored = Math.abs(signed)
      const versusExact = Math.abs(actual - (onExact[channel] as number)) * 1023
      if (signed < signedMin) signedMin = signed
      if (signed > signedMax) signedMax = signed
      if (signed > 0) positive++
      storedSum += versusStored
      if (versusStored > storedMax) {
        storedMax = versusStored
        storedAt = index
      }
      exactSum += versusExact
      if (versusExact > exactMax) {
        exactMax = versusExact
        exactAt = index
      }
    }
  }
  const samples = codes.length * 3
  return {
    profile,
    codes: codes.length,
    stored: { mean: storedSum / samples, max: storedMax, at: storedAt },
    exact: { mean: exactSum / samples, max: exactMax, at: exactAt },
    signed: { min: signedMin, max: signedMax, positive, samples },
    inputStorageMax,
    values,
  }
}

/** The bench ramp's distinct levels, monotonicity and largest step, GPU and CPU transform. */
function rampShape(profile: ColorProfileId, codes: readonly number[], values: Float32Array) {
  const levels = codes.map((_code, index) => Math.round((values[index * 3] as number) * 1023))
  const reference = codes.map((code) => {
    const decoded = transform([code / 1023, code / 1023, code / 1023], profile)
    return Math.round((decoded[0] as number) * 1023)
  })
  const steps = (series: readonly number[]) => {
    let nonMonotone = 0
    let maxStep = 0
    for (let index = 1; index < series.length; index++) {
      const step = (series[index] as number) - (series[index - 1] as number)
      if (step < 0) nonMonotone++
      maxStep = Math.max(maxStep, step)
    }
    return { nonMonotone, maxStep }
  }
  const gpu = steps(levels)
  const cpu = steps(reference)
  return {
    codes: codes.length,
    distinct: new Set(levels).size,
    distinctCpu: new Set(reference).size,
    nonMonotone: gpu.nonMonotone,
    nonMonotoneCpu: cpu.nonMonotone,
    maxStep: gpu.maxStep,
    maxStepCpu: cpu.maxStep,
  }
}

/** The input pass's writes in 8-bit: the same maths, the target today's preview renders into. */
async function inputEightBit(profile: ColorProfileId) {
  const gpuDevice = await gpu()
  const codes = Array.from({ length: 1024 }, (_unused, code) => code)
  const inputBytes = new Uint8Array(codes.length * 4)
  codes.forEach((code, index) => {
    const value = Math.round((code / 1023) * 255)
    inputBytes[index * 4] = value
    inputBytes[index * 4 + 1] = value
    inputBytes[index * 4 + 2] = value
    inputBytes[index * 4 + 3] = 255
  })
  const input = createTexture(gpuDevice, codes.length, 1, 'rgba8unorm')
  gpuDevice.queue.writeTexture(
    { texture: input },
    inputBytes,
    { bytesPerRow: codes.length * 4 },
    { width: codes.length, height: 1 },
  )
  const output = createTexture(gpuDevice, codes.length, 1, 'rgba8unorm')
  const pass = await inputPass('rgba8unorm')
  const encoder = gpuDevice.createCommandEncoder({ label: 'input colour 8-bit ramp' })
  pass.encode(encoder, input.createView(), output.createView(), profile, {
    width: codes.length,
    height: 1,
  })
  gpuDevice.queue.submit([encoder.finish()])
  const stride = Math.ceil((codes.length * 4) / 256) * 256
  const buffer = gpuDevice.createBuffer({
    label: 'colour probe 8-bit readback',
    size: stride,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const copy = gpuDevice.createCommandEncoder({ label: 'colour probe 8-bit readback' })
  copy.copyTextureToBuffer(
    { texture: output },
    { buffer, bytesPerRow: stride },
    { width: codes.length, height: 1 },
  )
  gpuDevice.queue.submit([copy.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
  buffer.unmap()
  buffer.destroy()

  let differing = 0
  let maxDifference = 0
  let sum = 0
  for (let index = 0; index < codes.length; index++) {
    const stored = halfBitsToFloat(floatToHalfBits((inputBytes[index * 4] as number) / 255))
    const expected = transform([stored, stored, stored], profile)[0] as number
    const actual = (bytes[index * 4] as number) / 255
    const difference = Math.abs(actual - expected) * 255
    sum += difference
    maxDifference = Math.max(maxDifference, difference)
    if (difference > 0.5) differing++
  }
  return {
    profile,
    codes: codes.length,
    meanByteDifference: sum / codes.length,
    maxByteDifference: maxDifference,
    codesOffByMoreThanHalf: differing,
  }
}

/** The f16 value toward zero for `value` (a probe-only comparison of the store's rounding). */
function truncateHalf(value: number): number {
  const buffer = new ArrayBuffer(4)
  const floats = new Float32Array(buffer)
  const words = new Uint32Array(buffer)
  floats[0] = value
  const bits = words[0] as number
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15
  if (exponent <= 0 || exponent >= 0x1f) return halfBitsToFloat(floatToHalfBits(value))
  return halfBitsToFloat(sign | (exponent << 10) | ((bits & 0x7fffff) >>> 13))
}

/** A deterministic pseudo-random generator, so two runs compare the same samples. */
function randomSequence(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** A 3D table of `size` points per side sampled from the input transform. */
function generatedTable(size: number): CubeLut3D {
  const data = new Float32Array(size ** 3 * 3)
  for (let blue = 0; blue < size; blue++) {
    for (let green = 0; green < size; green++) {
      for (let red = 0; red < size; red++) {
        const rgb = transform([red / (size - 1), green / (size - 1), blue / (size - 1)], 'dlog-m')
        const entry = (red + green * size + blue * size * size) * 3
        data[entry] = rgb[0]
        data[entry + 1] = rgb[1]
        data[entry + 2] = rgb[2]
      }
    }
  }
  return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}

/** The table as the `rgba16float` texture holds it: every entry rounded to a half-float. */
function throughHalf(table: CubeLut3D): CubeLut3D {
  const data = new Float32Array(table.data.length)
  for (let index = 0; index < table.data.length; index++) {
    data[index] = halfBitsToFloat(floatToHalfBits(table.data[index] as number))
  }
  return { size: table.size, domainMin: table.domainMin, domainMax: table.domainMax, data }
}

/** A running mean and max of differences in levels of 1023, and where the largest one is. */
function statistics() {
  let sum = 0
  let count = 0
  let max = 0
  let at = 0
  return {
    add(value: number, index: number): void {
      sum += value
      count++
      if (value > max) {
        max = value
        at = index
      }
    },
    result(): Statistics {
      return { mean: count === 0 ? 0 : sum / count, max, at }
    },
  }
}

interface LookSample {
  readonly input: readonly [number, number, number]
}

/** Random colours plus the 1024-step grey ramp, the sample set design 5.1 §5 M6 used. */
function lookSamples(): LookSample[] {
  const random = randomSequence(7)
  const samples: LookSample[] = []
  for (let index = 0; index < 30_000; index++) {
    samples.push({ input: [random(), random(), random()] })
  }
  for (let code = 0; code < 1024; code++) {
    samples.push({ input: [code / 1023, code / 1023, code / 1023] })
  }
  return samples
}

const LOOK_WIDTH = 512

/** The look pass on one table, its samples against `sampleTetrahedral` and its float32 twin. */
async function runLook(
  cube: ParsedCube,
  samples: readonly LookSample[],
): Promise<{
  total: Statistics
  versusTwin: Statistics
  store: { rounded: number; truncated: number; neither: number; signedMean: number }
  cpu: { texels: Statistics; tableOnly: Statistics; tableAndOutput: Statistics }
  uploadMs: number
  readbackMs: number
}> {
  const gpuDevice = await gpu()
  const table = cube.lut3d
  if (table === null) throw new Error('the generated look has no table')
  const height = Math.ceil(samples.length / LOOK_WIDTH)
  const input = createTexture(gpuDevice, LOOK_WIDTH, height, 'rgba16float')
  writePixels(gpuDevice, input, LOOK_WIDTH, height, (index) => {
    const sample = samples[index]
    return sample === undefined
      ? [0, 0, 0, 1]
      : [sample.input[0], sample.input[1], sample.input[2], 1]
  })
  const output = createTexture(gpuDevice, LOOK_WIDTH, height, 'rgba16float')
  const stage = await lookStage('rgba16float')
  const look = `probe-${table.size}`
  const uploadStarted = performance.now()
  stage.setLook(look, cube)
  const uploadMs = performance.now() - uploadStarted
  const encoder = gpuDevice.createCommandEncoder({ label: 'look probe' })
  stage.encode(encoder, input.createView(), output.createView(), look, 1, {
    width: LOOK_WIDTH,
    height,
  })
  gpuDevice.queue.submit([encoder.finish()])
  const readStarted = performance.now()
  const halves = await downloadHalves(gpuDevice, output, LOOK_WIDTH, height)
  const readbackMs = performance.now() - readStarted

  const half = throughHalf(table)
  // The input texture is rgba16float, so the shader reads every sample rounded to a half-float; the
  // references are given the same values. `total` is the stage's own difference from the float64
  // reference; `versusTwin` is that plus the output's half-float store, which is the shader's
  // arithmetic against the CPU's float32 twin from the same half-float table.
  const stored = samples.map((sample) => ({
    input: sample.input.map((value) => halfBitsToFloat(floatToHalfBits(value))) as [
      number,
      number,
      number,
    ],
  }))
  const counters = {
    total: statistics(),
    versusTwin: statistics(),
    tableOnly: statistics(),
    tableAndOutput: statistics(),
    rounded: 0,
    truncated: 0,
    neither: 0,
    signedSum: 0,
    signedCount: 0,
  }
  stored.forEach((sample, index) => {
    const reference = sampleTetrahedral(table, sample.input, cube.shaper)
    const twin = sampleTetrahedralFloat32(half, sample.input, cube.shaper)
    for (let channel = 0; channel < 3; channel++) {
      const actual = halfBitsToFloat(halves[index * 4 + channel] as number)
      const twinValue = twin[channel] as number
      const difference = (actual - twinValue) * 1023
      counters.total.add(Math.abs(actual - (reference[channel] as number)) * 1023, index)
      counters.versusTwin.add(Math.abs(difference), index)
      counters.tableOnly.add(Math.abs(twinValue - (reference[channel] as number)) * 1023, index)
      counters.tableAndOutput.add(
        Math.abs(halfBitsToFloat(floatToHalfBits(twinValue)) - (reference[channel] as number)) *
          1023,
        index,
      )
      counters.signedSum += difference
      counters.signedCount++
      if (actual === halfBitsToFloat(floatToHalfBits(twinValue))) counters.rounded++
      else if (actual === truncateHalf(twinValue)) counters.truncated++
      else counters.neither++
    }
  })
  return {
    total: counters.total.result(),
    versusTwin: counters.versusTwin.result(),
    store: {
      rounded: counters.rounded,
      truncated: counters.truncated,
      neither: counters.neither,
      signedMean: counters.signedSum / counters.signedCount,
    },
    cpu: {
      texels: texelStorage(table),
      tableOnly: counters.tableOnly.result(),
      tableAndOutput: counters.tableAndOutput.result(),
    },
    uploadMs,
    readbackMs,
  }
}

/** The half-float storage of the table's own entries, in levels of 1023: design 5.1 §5 M6. */
function texelStorage(table: CubeLut3D): Statistics {
  const counter = statistics()
  for (let index = 0; index < table.data.length; index++) {
    const value = table.data[index] as number
    counter.add(Math.abs(halfBitsToFloat(floatToHalfBits(value)) - value) * 1023, index)
  }
  return counter.result()
}

/** A 17-entry gamma shaper, the way a combined `.cube` pairs `LUT_1D_SIZE` with its grid. */
function gammaShaper(): CubeLut1D {
  const entries = 17
  const data = new Float32Array(entries * 3)
  for (let entry = 0; entry < entries; entry++) {
    const value = (entry / (entries - 1)) ** 2.2
    data[entry * 3] = value
    data[entry * 3 + 1] = value
    data[entry * 3 + 2] = value
  }
  return { size: entries, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
}

/** The 65³ table of D-Log M the look checks and the timing share. */
let probeTable: CubeLut3D | null = null

function probeCube(): ParsedCube {
  if (probeTable === null) throw new Error('the probe table has not been generated yet')
  return { title: null, lut3d: probeTable, shaper: null }
}

/** How long one draw of a pass takes, over `frames` draws with no readback. */
async function timeDraw(draw: () => void, frames = 20): Promise<number> {
  const gpuDevice = await gpu()
  draw()
  await gpuDevice.queue.onSubmittedWorkDone()
  const started = performance.now()
  for (let frame = 0; frame < frames; frame++) draw()
  await gpuDevice.queue.onSubmittedWorkDone()
  return (performance.now() - started) / frames
}

const TIMED_WIDTH = 3840
const TIMED_HEIGHT = 2160

async function timeInput(target: GPUTextureFormat): Promise<number> {
  const gpuDevice = await gpu()
  const pass = await inputPass(target)
  const input = createTexture(gpuDevice, TIMED_WIDTH, TIMED_HEIGHT, target)
  const output = createTexture(gpuDevice, TIMED_WIDTH, TIMED_HEIGHT, target)
  const inputView = input.createView()
  const outputView = output.createView()
  const size = { width: TIMED_WIDTH, height: TIMED_HEIGHT }
  const milliseconds = await timeDraw(() => {
    const encoder = gpuDevice.createCommandEncoder()
    pass.encode(encoder, inputView, outputView, 'dlog-m', size)
    gpuDevice.queue.submit([encoder.finish()])
  })
  input.destroy()
  output.destroy()
  return milliseconds
}

async function timeLook(target: GPUTextureFormat): Promise<number> {
  const gpuDevice = await gpu()
  const stage = await lookStage(target)
  const cube = probeCube()
  const table = cube.lut3d
  if (table === null) throw new Error('the probe table has no 3D grid')
  const look = `probe-${table.size}`
  stage.setLook(look, cube)
  const input = createTexture(gpuDevice, TIMED_WIDTH, TIMED_HEIGHT, target)
  const output = createTexture(gpuDevice, TIMED_WIDTH, TIMED_HEIGHT, target)
  const inputView = input.createView()
  const outputView = output.createView()
  const size = { width: TIMED_WIDTH, height: TIMED_HEIGHT }
  const milliseconds = await timeDraw(() => {
    const encoder = gpuDevice.createCommandEncoder()
    stage.encode(encoder, inputView, outputView, look, 1, size)
    gpuDevice.queue.submit([encoder.finish()])
  })
  input.destroy()
  output.destroy()
  return milliseconds
}

const probe = {
  async info() {
    const gpuDevice = await gpu()
    return {
      adapter: adapterDescription,
      limits: {
        maxTextureDimension2D: gpuDevice.limits.maxTextureDimension2D,
        maxTextureDimension3D: gpuDevice.limits.maxTextureDimension3D,
      },
    }
  },

  /** (a) All 1024 codes through the input pass, against transform(), for one profile. */
  async inputRamp(profile: ColorProfileId) {
    const codes = Array.from({ length: 1024 }, (_unused, code) => code)
    const result = await runCodes(profile, codes)
    return {
      profile: result.profile,
      codes: result.codes,
      stored: result.stored,
      exact: result.exact,
      signed: result.signed,
      inputStorageMax: result.inputStorageMax,
    }
  },

  /** (a) The bench ramp's shape: distinct levels, monotonicity, largest step. */
  async benchRamp(profile: ColorProfileId) {
    const codes = benchCodes()
    const result = await runCodes(profile, codes)
    return {
      profile: result.profile,
      difference: { stored: result.stored, exact: result.exact },
      ...rampShape(profile, codes, result.values),
    }
  },

  /** (a) The 8-bit target: the same maths, within one 8-bit code. */
  inputEightBit,

  /** (c) The identity: every texel through the 'none' profile, bit for bit. */
  async identity() {
    const gpuDevice = await gpu()
    const width = 1024
    const height = 2
    const random = randomSequence(11)
    const halves = new Uint16Array(width * height * 4)
    for (let index = 0; index < width; index++) {
      const value = index / 1023
      for (let channel = 0; channel < 4; channel++) {
        halves[index * 4 + channel] = floatToHalfBits(channel === 3 ? 1 : value)
      }
    }
    // A second row of values a frame can hold: the ends, a subnormal, negative zero, fractions
    for (let index = 0; index < width; index++) {
      const offset = (width + index) * 4
      halves[offset] = floatToHalfBits(index === 0 ? 0 : random())
      halves[offset + 1] = floatToHalfBits(index === 1 ? 1 : random())
      halves[offset + 2] = floatToHalfBits(index === 2 ? 5.960464477539063e-8 : random())
      halves[offset + 3] = floatToHalfBits(index === 3 ? -0 : random())
    }
    const input = createTexture(gpuDevice, width, height, 'rgba16float')
    uploadHalves(gpuDevice, input, width, height, halves)
    const output = createTexture(gpuDevice, width, height, 'rgba16float')
    const pass = await inputPass('rgba16float')
    const encoder = gpuDevice.createCommandEncoder({ label: 'identity' })
    pass.encode(encoder, input.createView(), output.createView(), 'none', { width, height })
    gpuDevice.queue.submit([encoder.finish()])
    const result = await downloadHalves(gpuDevice, output, width, height)
    let differing = 0
    let firstDiffering = -1
    for (let index = 0; index < halves.length; index++) {
      if (result[index] !== halves[index]) {
        differing++
        if (firstDiffering < 0) firstDiffering = index
      }
    }
    return { texels: width * height, channels: halves.length, differing, firstDiffering }
  },

  /** (b) A generated 65³ table against sampleTetrahedral, and against its float32 twin. */
  async look() {
    const generatedStarted = performance.now()
    probeTable = generatedTable(65)
    const tableMs = performance.now() - generatedStarted
    const samples = lookSamples()
    const result = await runLook(probeCube(), samples)
    return {
      size: 65,
      tableMs,
      tableBytes: 65 ** 3 * 8,
      samples: samples.length,
      ...result,
    }
  },

  /** A combined .cube: a 33³ table behind a 17-entry shaper, against sampleTetrahedral. */
  async shapedLook() {
    const cube: ParsedCube = {
      title: null,
      lut3d: generatedTable(33),
      shaper: gammaShaper(),
    }
    const samples = lookSamples().slice(0, 5_000)
    const result = await runLook(cube, samples)
    return { tableSize: 33, shaperSize: 17, samples: samples.length, ...result }
  },

  /** What every pass costs a 4K frame: 20 draws back to back, the readback left out. */
  async timing() {
    if (probeTable === null) probeTable = generatedTable(65)
    return {
      width: TIMED_WIDTH,
      height: TIMED_HEIGHT,
      frames: 20,
      input: {
        rgba16float: await timeInput('rgba16float'),
        rgba8unorm: await timeInput('rgba8unorm'),
      },
      look: {
        rgba16float: await timeLook('rgba16float'),
        rgba8unorm: await timeLook('rgba8unorm'),
      },
    }
  },

  /** A look's lifetime on a stage of its own: set, encode, remove, and the stage's textures freed. */
  async lookLifecycle() {
    const gpuDevice = await gpu()
    const stage = await createLookPass(gpuDevice, { input: 'rgba16float', output: 'rgba16float' })
    const size = 2
    const data = new Float32Array(size ** 3 * 3).fill(0.25)
    const table: CubeLut3D = { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
    const input = createTexture(gpuDevice, 1, 1, 'rgba16float')
    const output = createTexture(gpuDevice, 1, 1, 'rgba16float')
    const view = { input: input.createView(), output: output.createView() }
    const encode = (look: string): string => {
      try {
        const encoder = gpuDevice.createCommandEncoder()
        stage.encode(encoder, view.input, view.output, look, 0.5, { width: 1, height: 1 })
        gpuDevice.queue.submit([encoder.finish()])
        return 'drawn'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    stage.setLook('lifecycle', { title: null, lut3d: table, shaper: null })
    const first = encode('lifecycle')
    stage.removeLook('lifecycle')
    const removed = encode('lifecycle')
    // Removing a look that is not there is not an error, the way a library drops a file twice
    stage.removeLook('lifecycle')
    stage.setLook('lifecycle', { title: null, lut3d: table, shaper: null })
    const second = encode('lifecycle')
    stage.destroy()
    return { first, removed, second, freed: true }
  },

  /** The refusals a running pass must make, on the real device. */
  async rejects() {
    const gpuDevice = await gpu()
    const stage = await lookStage('rgba16float')
    const size = { width: 1, height: 1 }
    const view = createTexture(gpuDevice, 1, 1, 'rgba16float').createView()
    const messages: Record<string, string> = {}
    const capture = (name: string, call: () => void): void => {
      try {
        call()
        messages[name] = 'no error'
      } catch (error) {
        messages[name] = error instanceof Error ? error.message : String(error)
      }
    }
    capture('unknownLook', () => {
      stage.encode(gpuDevice.createCommandEncoder(), view, view, 'not-loaded', 1, size)
    })
    capture('shaperOnlyFile', () => {
      stage.setLook('shaper-only', { title: null, lut3d: null, shaper: gammaShaper() })
    })
    if (probeTable === null) probeTable = generatedTable(65)
    stage.setLook(`probe-${probeTable.size}`, probeCube())
    capture('intensityAboveOne', () => {
      stage.encode(
        gpuDevice.createCommandEncoder(),
        view,
        view,
        `probe-${probeTable === null ? 0 : probeTable.size}`,
        1.5,
        size,
      )
    })
    return messages
  },

  errors(): GpuErrorReport {
    return { errors: [...gpuErrors] }
  },
}

;(window as unknown as { colourProbe: typeof probe }).colourProbe = probe
;(window as unknown as { colourProbeReady: boolean }).colourProbeReady = true
