// The golden kit's float caller (design 3.6 section 2.13, review finding R2): a `PreciseOutputSink` that reads the
// renderer's `rgba16float` accumulator back exactly, as 16-bit values, and the switch that makes a headless frame
// render the way a precise export does. Until this existed, nothing in a check ever ran the float path on a GPU.
//
//   begin()  registers the sink and turns the raw 10-bit backend on (`frames/backends/raw-test.ts`);
//   (the golden runner then renders one frame with `window.freecut.renderFrame`, which composites in float and delivers
//   the accumulator to the sink before it is converted to 8 bits for the canvas);
//   end()    unregisters both and returns the frames the sink read.
//
// A value is read back from the half float itself, so nothing is lost on the way: 16 bits cover every code a half
// float can hold between 0 and 1 at the resolution of a 10-bit source, and a value outside 0..1 is counted, not hidden.

import { parseCube } from '@/studio/color/cube'
import { cacheLookTable, forgetLookTable } from '@/studio/looks/tables'
import { EffectsPipeline } from '@/infrastructure/gpu-effects/effects-pipeline'
import { setFeatureOverride, type FeatureSwitchId } from '@/studio/feature-switches'
import { setRawTestKit } from './frames/backends/raw-test'
import { unpackHalfRows } from './half-float'
import { setPreciseOutputSink, type PreciseFrame, type PreciseOutputSink } from './precise/contract'

/** One float frame as the golden kit stores it: unorm16 RGBA, row after row. */
export interface FloatFrame {
  readonly index: number
  readonly width: number
  readonly height: number
  /** `width * height * 4` values, 0..65535 for 0..1 */
  readonly rgba16: Uint16Array
  /** Colour values below 0, above 1 or not a number, which `rgba16` clamps */
  readonly outOfRange: number
}

/** The sink and the frames it has read */
export interface TestSink extends PreciseOutputSink {
  readonly frames: readonly FloatFrame[]
}

/** The sink: copies each delivered accumulator to a buffer on the renderer's device and reads it exactly. */
export function createTestSink(): TestSink {
  const frames: FloatFrame[] = []
  return {
    frames,
    async deliver(texture: GPUTexture, frame: PreciseFrame): Promise<void> {
      if (texture.format !== 'rgba16float') {
        throw new Error(`the test sink reads rgba16float accumulators, got ${texture.format}`)
      }
      // The renderer composites on the effects pipeline's cached device; a texture does not name its device.
      const device = await EffectsPipeline.requestCachedDevice()
      if (device === null) throw new Error('the test sink has no GPU device')
      const { width, height } = texture
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256
      const buffer = device.createBuffer({
        label: 'test-sink-readback',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        const encoder = device.createCommandEncoder({ label: 'test-sink-readback' })
        encoder.copyTextureToBuffer(
          { texture },
          { buffer, bytesPerRow, rowsPerImage: height },
          { width, height },
        )
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
        buffer.unmap()
        const { rgba16, outOfRange } = unpackHalfRows(bytes, width, height, bytesPerRow)
        frames.push({ index: frame.index, width, height, rgba16, outOfRange })
      } finally {
        buffer.destroy()
      }
    },
  }
}

/** What the page hands the golden runner: frames with their values as base64 of little-endian unorm16 */
export interface PreciseTestResult {
  readonly frames: ReadonlyArray<{
    readonly index: number
    readonly width: number
    readonly height: number
    readonly outOfRange: number
    readonly rgba16: string
  }>
}

/** The golden runner's handle on the kit (`window.freecutPrecise`) */
export interface PreciseTestKit {
  /**
   * Float composite on, raw 10-bit files of `width` x `height` as the clips' pictures: the frames of the file at URL
   * `src` are at `src + rawSuffix` (the clip's own file is a real, tiny video the renderer can open)
   */
  begin(options: {
    width: number
    height: number
    rawSuffix: string
    /** Switches to turn on while the kit is on: a feature the golden run proves before the app shows it */
    features?: readonly FeatureSwitchId[]
    /**
     * Looks the clips may point at, as `.cube` text: parsed into the looks library's table cache under `id` while the kit
     * is on, so a case needs no workspace file (a look is the user's file; the golden run makes its own)
     */
    looks?: ReadonlyArray<{ id: string; text: string }>
  }): void
  /** Both off again; the frames the sink read since `begin` */
  end(): PreciseTestResult
}

function toBase64(values: Uint16Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Creates the kit's handle; the headless page puts it on `window.freecutPrecise` */
export function createPreciseTestKit(): PreciseTestKit {
  let sink: TestSink | null = null
  let features: readonly FeatureSwitchId[] = []
  let looks: readonly string[] = []
  return {
    begin({ width, height, rawSuffix, features: shown = [], looks: tables = [] }) {
      if (sink !== null) throw new Error('the precise test kit is already on: end() it first')
      sink = createTestSink()
      setRawTestKit({ width, height, rawUrl: (src) => `${src}${rawSuffix}` })
      setPreciseOutputSink(sink)
      features = shown
      for (const id of features) setFeatureOverride(id, true)
      for (const { id, text } of tables) cacheLookTable(id, parseCube(text))
      looks = tables.map((table) => table.id)
    },
    end() {
      if (sink === null) throw new Error('the precise test kit is not on')
      const read = sink.frames
      sink = null
      setPreciseOutputSink(null)
      setRawTestKit(null)
      for (const id of features) setFeatureOverride(id, undefined)
      features = []
      for (const id of looks) forgetLookTable(id)
      looks = []
      return {
        frames: read.map((frame) => ({
          index: frame.index,
          width: frame.width,
          height: frame.height,
          outOfRange: frame.outOfRange,
          rgba16: toBase64(frame.rgba16),
        })),
      }
    },
  }
}

/** Puts the kit on `window.freecutPrecise` (the headless harness page's one line) */
export function installPreciseTestKit(): void {
  ;(window as unknown as { freecutPrecise: PreciseTestKit }).freecutPrecise = createPreciseTestKit()
}
