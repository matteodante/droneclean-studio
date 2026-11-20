// Tests of the golden-frame kit itself. They need no GPU: they check that the comparison cannot miss a
// one-level change, that the inputs are exactly the inputs the stored frames were made from, and that
// the case list and the stored frames agree. Run: npm run golden:test
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { CASES } from '../cases.mjs'
import { diffImage, diffStats, isIdentical } from './compare.mjs'
import { HEIGHT, IMAGE_NAMES, WIDTH, imagePng } from './images.mjs'
import {
  RAMP_LEVELS,
  RAW_HEIGHT,
  RAW_WIDTH,
  SHADOW_PIECE_FRAMES,
  SHADOW_SOURCE_FRAMES,
  countLevels,
  describeStats16,
  diffStats16,
  isIdentical16,
  rampFile,
  shadowPieceFile,
  shadowSourceFile,
} from './float.mjs'
import { checkFlowHalfway, FLOW_HEIGHT, FLOW_SOURCE_FRAMES, FLOW_WIDTH, flowPatternFile } from './flow.mjs'
import { decodePng, encodePng } from './png.mjs'
import { decodePng16, encodePng16 } from './png16.mjs'
import { assertHardwareGpu } from './render.mjs'
import {
  COEFFS_FLOATS,
  FLAGS,
  INPUT_HEIGHT,
  INPUT_WIDTH,
  MATRIX_COUNT,
  MATRIX_STRIDE,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  PARAMS_BYTES,
  coefficients,
  gridFrame,
  kernelParams,
  rowMatrices,
} from './stage-frame.mjs'

const GOLDEN = path.resolve(import.meta.dirname, '..')
const EXPECTED = path.join(GOLDEN, 'expected')
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

// If one of these changes, every stored frame made from the image is void: regenerate them on purpose.
const IMAGE_HASHES = {
  card: '9e3cb3f54d521363064ea0ca06c8750a6fd9349dd9eac34831dde3b1bbf91f71',
  ramp: '2f1178de8d639591dd5ee47331cc083ecc5124c98a9ed75ea6c109d468494f11',
  detail: 'd86130bcfe2649667d52049ba2f58e6c0bef2ed3f331ff62f160bb17917b4625',
  scene: 'adac2b7de43e9ec40dfd46e896eadf6007d145b3a77b1f2dce6b7ba979e0f08e',
  overlay: '1d6e550abc1f02c39f26d45a111c41ac8006acb8da6f6247ec6fd6721860fe86',
  overcast: 'd4c88c38ac3b3afb5d5db7a47e1e6aad9e4d2af60fef2da4bb27031fc783ec1e',
}
const VIDEO_HASHES = {
  'h264-high.mp4': '2c71e28cfe45186bacee58cd2b874db19c7ddc5b7dd11ffa703d304ed9630e11',
  'hevc-main10.mp4': 'c6e4829eb57798e207efc164e5f06d8aa2afbaa9896ac5886244d79aa5c1619d',
  'shadow-source.mp4': '02617e8f305177285f00800db505d974b6a9999a79e12ac87ab55537a4314975',
  'shadow-piece.mp4': '5747554cb9a29ca4db01a83a7cd1f466b8d8c4fd6a7b75159f1c224b85ca39d7',
}

const solid = (value) => ({
  width: 8,
  height: 4,
  data: new Uint8Array(8 * 4 * 4).map((_, i) => (i % 4 === 3 ? 255 : value)),
})

test('PNG codec round-trips', () => {
  const image = decodePng(imagePng('card'))
  assert.equal(image.width, WIDTH)
  assert.equal(image.height, HEIGHT)
  const again = decodePng(encodePng(image))
  assert.deepEqual(again.data, image.data)
})

test('every stored frame is a readable PNG of the project size', () => {
  for (const c of CASES) {
    // A case that drives the stabilization stage has no project: its stored frame is the stage's output size
    const size = c.warp ? c.warp.output : c.float ? [c.raw.width, c.raw.height] : [WIDTH, HEIGHT]
    for (const frame of c.frames) {
      const bytes = fs.readFileSync(path.join(EXPECTED, c.id, `frame-${frame}.png`))
      // A float case's frame is a 16-bit PNG
      const image = c.float ? decodePng16(bytes) : decodePng(bytes)
      assert.deepEqual([image.width, image.height], size, `${c.id}/${frame}`)
    }
  }
})

test('identical frames are identical, and any one-level difference is not', () => {
  const base = solid(100)
  assert.ok(isIdentical(diffStats(base, solid(100))))

  const everywhere = solid(101) // a uniform shift of one level across the frame
  const stats = diffStats(base, everywhere)
  assert.ok(!isIdentical(stats))
  assert.deepEqual(stats.max.slice(0, 3), [1, 1, 1])
  assert.equal(stats.differingShare, 1)
  assert.ok(Math.abs(stats.signedMean[0] - 1) < 1e-9)

  const oneChannelOnePixel = solid(100)
  oneChannelOnePixel.data[5 * 4 + 2] += 1
  assert.ok(!isIdentical(diffStats(base, oneChannelOnePixel)))

  const alphaOnly = solid(100)
  alphaOnly.data[3] = 254
  assert.ok(!isIdentical(diffStats(base, alphaOnly)), 'alpha counts')
})

test('a one-level difference is visible in the amplified difference picture', () => {
  const picture = diffImage(solid(100), solid(101))
  assert.ok(picture.data[0] >= 96, 'a one-level difference must not be drawn near black')
  const none = diffImage(solid(100), solid(100))
  assert.equal(none.data[0], 0)
})

test('different sizes never compare equal', () => {
  const a = solid(10)
  const b = { ...solid(10), width: 4, height: 8 }
  assert.ok(!isIdentical(diffStats(a, b)))
})

test('the generated test images are the images the stored frames were made from', () => {
  assert.deepEqual(Object.keys(IMAGE_HASHES).sort(), [...IMAGE_NAMES].sort())
  for (const name of IMAGE_NAMES)
    assert.equal(sha256(decodePng(imagePng(name)).data), IMAGE_HASHES[name], name)
})

test('the committed videos are the videos the stored frames were made from', () => {
  for (const [file, hash] of Object.entries(VIDEO_HASHES)) {
    const bytes = fs.readFileSync(path.join(GOLDEN, 'media', file))
    assert.ok(bytes.length < 50_000, `${file} must stay tiny`)
    assert.equal(sha256(bytes), hash, file)
  }
})

test('case ids are unique, frames are in range, and every case has stored frames', () => {
  const ids = CASES.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of CASES) {
    assert.match(c.id, /^[A-Za-z0-9-]+$/, c.id)
    assert.ok(
      c.frames.length > 0 && c.protects.length > 20,
      `${c.id} needs frames and a "protects" sentence`,
    )
    const duration = c.project?.duration ?? Number.POSITIVE_INFINITY
    for (const frame of c.frames)
      assert.ok(frame >= 0 && frame < duration, `${c.id}: frame ${frame} outside 0..${duration}`)
    if (!c.project) assert.ok(c.warp, `${c.id} has neither a project nor a stage warp, so it cannot render`)
    if (c.sameAsSource) assert.ok(IMAGE_NAMES.includes(c.sameAsSource), c.id)
  }
  const stored = fs
    .readdirSync(EXPECTED, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  assert.deepEqual(
    stored.sort(),
    [...ids].sort(),
    'stored folders and cases must match exactly (run --update after adding or removing a case)',
  )
  for (const c of CASES) {
    const files = fs.readdirSync(path.join(EXPECTED, c.id)).sort()
    assert.deepEqual(files, c.frames.map((f) => `frame-${f}.png`).sort(), c.id)
  }
})

test('the stage warp case is the synthetic frame and rotation the stored frame was made from', () => {
  const warpCase = CASES.find((c) => c.warp)
  assert.ok(warpCase, 'the stabilization stage has no golden case')
  assert.deepEqual(
    warpCase.frames,
    [0],
    'a stage case renders one frame: the stage takes no time and no project',
  )
  assert.deepEqual(warpCase.warp.input, [INPUT_WIDTH, INPUT_HEIGHT])
  assert.deepEqual(warpCase.warp.output, [OUTPUT_WIDTH, OUTPUT_HEIGHT])
  assert.equal(warpCase.warp.matrices, MATRIX_COUNT)
  assert.equal(warpCase.warp.matrixStride, MATRIX_STRIDE)
  assert.equal(warpCase.warp.paramsBytes, PARAMS_BYTES)
  assert.equal(warpCase.warp.coeffsFloats, COEFFS_FLOATS)
  assert.equal(warpCase.warp.flags, FLAGS)

  const frame = gridFrame()
  assert.deepEqual([frame.width, frame.height], [INPUT_WIDTH, INPUT_HEIGHT])
  assert.equal(
    sha256(frame.data),
    '981855c122ecd5703de3cacdb7ece0201c578540edc16b371d50b10183b59bf4',
  )

  const params = kernelParams()
  assert.equal(params.length, PARAMS_BYTES)
  const view = new DataView(params.buffer)
  assert.equal(view.getInt32(24, true), MATRIX_COUNT)
  assert.equal(view.getFloat32(352, true), 255, 'the module reports 255; the stage rewrites it to 1.0')
  assert.equal(view.getFloat32(364, true), 255)
  assert.equal(
    sha256(params),
    '589b5df6ed86727e88c9e76fc96358d60a73def47228aa9bbc0ff5009160ab06',
  )

  const matrices = rowMatrices()
  assert.equal(matrices.length, MATRIX_COUNT * MATRIX_STRIDE)
  assert.equal(
    sha256(new Uint8Array(matrices.buffer)),
    'ea29f9b6e422bf7bbbd2d8e115e94b885b3d964bc956811db15aa315fec40369',
  )
  // A roll that changes by row: the first row leans one way, the last the other
  assert.ok(matrices[1] > 0.05, 'the first row matrix is rolled')
  assert.ok(
    matrices[(MATRIX_COUNT - 1) * MATRIX_STRIDE + 1] < -0.05,
    'the last row matrix leans the other way',
  )

  const coeffs = coefficients()
  assert.equal(coeffs.length, COEFFS_FLOATS)
  assert.deepEqual([...coeffs.slice(0, 4)], [1, 0, 0.96875, 0.03125])
})

test('the 16-bit PNG codec round-trips every value and the float comparison misses nothing', () => {
  const data = new Uint16Array(4 * 3 * 4).map((_, i) => (i * 4099) % 65536)
  const image = { width: 4, height: 3, data }
  const again = decodePng16(encodePng16(image))
  assert.deepEqual([again.width, again.height], [4, 3])
  assert.deepEqual(again.data, data)
  assert.throws(() => decodePng16(encodePng(decodePng(imagePng('card')))), /unsupported/)

  assert.ok(isIdentical16(diffStats16(image, again)))
  const oneStep = { ...image, data: data.slice() }
  oneStep.data[17] += 1
  const stats = diffStats16(image, oneStep)
  assert.ok(!isIdentical16(stats))
  assert.deepEqual([stats.differing, stats.max], [1, 1])
  assert.match(describeStats16(stats), /1 of 48 values differ/)
  assert.ok(!isIdentical16(diffStats16(image, { ...image, width: 3, height: 4 })))
})

test('the optical-flow case’s clip is what its stored frames were made from, and its check tells flow from blend', () => {
  const file = flowPatternFile()
  const frameBytes = FLOW_WIDTH * FLOW_HEIGHT * 2 * 3
  assert.equal(file.length, frameBytes * FLOW_SOURCE_FRAMES)
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), '1b8f53804ced46506b1d0d596fe81f8c8c82f480ab32d74b0e4fc2761395deb1')

  // A picture as the float composite delivers it (unorm16 RGBA), from the codes of a frame or of a mix of two
  const green = (frame, x, y) => file.readUInt16LE(frame * frameBytes + (y * FLOW_WIDTH + x) * 2)
  const picture = (codeAt) => {
    const data = new Uint16Array(FLOW_WIDTH * FLOW_HEIGHT * 4)
    for (let y = 0; y < FLOW_HEIGHT; y++) {
      for (let x = 0; x < FLOW_WIDTH; x++) {
        const value = Math.round((codeAt(x, y) / 1023) * 65535)
        data.set([value, value, value, 65535], (y * FLOW_WIDTH + x) * 4)
      }
    }
    return { width: FLOW_WIDTH, height: FLOW_HEIGHT, data }
  }
  assert.deepEqual(checkFlowHalfway(picture((x, y) => green(1, x, y)), 2), [])
  assert.notDeepEqual(checkFlowHalfway(picture((x, y) => green(2, x, y)), 2), [])
  // The blend of frames 0 and 1 shown for output frame 1 fails: that is the picture the flow must beat
  const blend = checkFlowHalfway(picture((x, y) => (green(0, x, y) + green(1, x, y)) / 2), 1)
  assert.ok(blend.some((problem) => problem.includes('under 0.1 of the blend')), blend.join('; '))
})

test('the raw 10-bit inputs of the float cases are what the stored frames were made from', () => {
  const frameBytes = RAW_WIDTH * RAW_HEIGHT * 2 * 3
  const ramp = rampFile()
  assert.equal(ramp.length, frameBytes * 2)
  assert.equal(shadowSourceFile().length, frameBytes * SHADOW_SOURCE_FRAMES)
  assert.equal(shadowPieceFile().length, frameBytes * SHADOW_PIECE_FRAMES)
  assert.equal(sha256(ramp), '8282c1e874e6b8e498808b3be51b071fe53ba8e498e609d36b7db1a708f935ce')
  assert.equal(sha256(shadowSourceFile()), '77ba18ca910558616d3d36da35e8665acb894c89a03abc2fa7f8d8c7c3f680c9')
  assert.equal(sha256(shadowPieceFile()), '05cd3811ce2737b486827cf9b72b7d231e6ed4f23f0c9c3c8678edf78012d8aa')

  // The ramp: 877 codes (64 to 940) in a row, every row the same; frame 1 is frame 0 reversed
  const plane = RAW_WIDTH * RAW_HEIGHT * 2
  const green = (frame, x, y = 5) => ramp.readUInt16LE(frame * frameBytes + (y * RAW_WIDTH + x) * 2)
  const codes = new Set(Array.from({ length: RAW_WIDTH }, (_, x) => green(0, x)))
  assert.equal(codes.size, RAMP_LEVELS)
  assert.equal(Math.min(...codes), 64)
  assert.equal(Math.max(...codes), 940)
  assert.equal(green(0, 100, 0), green(0, 100, 15))
  assert.equal(green(1, 0), 940)
  assert.equal(green(1, RAW_WIDTH - 1), 64)
  assert.equal(ramp.readUInt16LE(plane * 2), green(0, 0), 'the red plane is last and carries the grey too')

  // The level counter: 877 values in a row is what a float path keeps, 219 is what an 8-bit step leaves
  const row = (levels) => {
    const data = new Uint16Array(RAW_WIDTH * 4)
    for (let x = 0; x < RAW_WIDTH; x++) data[x * 4] = levels(x)
    return { width: RAW_WIDTH, height: 1, data }
  }
  const unorm = (code) => Math.round((code / 1023) * 65535)
  const float = row((x) => unorm(64 + Math.floor((x * 877) / 1024)))
  assert.deepEqual(countLevels(float, 0), { values: 877, codes: 877 })
  const eightBit = row((x) => Math.round((unorm(64 + Math.floor((x * 877) / 1024)) / 65535) * 255) * 257)
  assert.equal(countLevels(eightBit, 0).values, 219)
})

test('the coverage the brief asks for is present', () => {
  const have = (prefix) => CASES.some((c) => c.id.startsWith(prefix))
  for (const id of [
    'passthrough-',
    'transform-',
    'color-brightness',
    'color-contrast',
    'color-exposure',
    'color-saturation',
    'color-temperature',
    'color-levels',
    'color-curves',
    'color-wheels',
    'color-lut',
    'blur-',
    'distort-',
    'transition-',
    'blend-',
    'text-',
    'chain-',
    'video-h264',
    'video-hevc-main10',
  ]) {
    assert.ok(have(id), `missing cases: ${id}`)
  }
  const lut = CASES.find((c) => c.id === 'color-lut').project.timeline.items[0].effects[0].effect
  assert.equal(lut.gpuEffectType, 'gpu-lut')
  assert.equal(lut.params.lutSize, '5')
})

test('stored frames name a real GPU, and a software adapter is refused', () => {
  const machine = JSON.parse(fs.readFileSync(path.join(EXPECTED, 'machine.json'), 'utf8'))
  assertHardwareGpu({ available: true, ...machine.gpu, isFallbackAdapter: false })
  assert.throws(
    () =>
      assertHardwareGpu({
        available: true,
        vendor: 'google',
        architecture: 'swiftshader',
        device: '',
        description: '',
        isFallbackAdapter: false,
      }),
    /software/,
  )
  assert.throws(
    () =>
      assertHardwareGpu({
        available: true,
        vendor: 'x',
        architecture: 'y',
        device: '',
        description: '',
        isFallbackAdapter: true,
      }),
    /software/,
  )
  assert.throws(() => assertHardwareGpu({ available: false, reason: 'none' }), /No WebGPU adapter/)
})

test('the README lists every case', () => {
  const readme = fs.readFileSync(path.join(GOLDEN, 'README.md'), 'utf8')
  for (const c of CASES)
    assert.ok(readme.includes(`\`${c.id}\``), `README.md does not mention ${c.id}`)
})
