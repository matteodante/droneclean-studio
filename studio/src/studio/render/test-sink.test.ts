import { afterEach, describe, expect, it } from 'vite-plus/test'
import { rawTestKitActive } from './frames/backends/raw-test'
import { preciseOutputSink, setPreciseOutputSink } from './precise/contract'
import { createPreciseTestKit, createTestSink } from './test-sink'

afterEach(() => setPreciseOutputSink(null))

describe('the precise test kit', () => {
  it('switches the sink and the raw backend on together and off together', () => {
    const kit = createPreciseTestKit()
    expect(preciseOutputSink()).toBeNull()
    expect(rawTestKitActive()).toBe(false)

    kit.begin({ width: 8, height: 2, rawSuffix: '-raw' })
    expect(preciseOutputSink()).not.toBeNull()
    expect(rawTestKitActive()).toBe(true)
    expect(() => kit.begin({ width: 8, height: 2, rawSuffix: '-raw' })).toThrow(/already on/)

    expect(kit.end()).toEqual({ frames: [] })
    expect(preciseOutputSink()).toBeNull()
    expect(rawTestKitActive()).toBe(false)
    expect(() => kit.end()).toThrow(/not on/)
  })
})

describe('the test sink', () => {
  it('refuses an accumulator that is not float', async () => {
    const sink = createTestSink()
    const texture = { format: 'rgba8unorm', width: 1, height: 1 } as unknown as GPUTexture
    await expect(sink.deliver(texture, { index: 0, rate: { num: 24, den: 1 }, durationFrames: 1 })).rejects.toThrow(
      /rgba16float/,
    )
    expect(sink.frames).toEqual([])
  })
})
