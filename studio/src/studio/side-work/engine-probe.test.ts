// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { chooseWidth, machineKey, probeEngineLanes, shouldTryMore } from './engine-probe'

describe('chooseWidth', () => {
  it('keeps one lane when a second adds less than 25 %', () => {
    // what the M4 measures: 195 then 221 frames per second
    expect(chooseWidth([200, 223])).toBe(1)
  })

  it('keeps every lane that still gains 25 %', () => {
    expect(chooseWidth([100, 190, 270, 280])).toBe(3)
    expect(chooseWidth([100, 200])).toBe(2)
  })

  it('stops at the first count that does not gain, even if a later one would', () => {
    expect(chooseWidth([100, 105, 300])).toBe(1)
  })

  it('answers 1 for no data or a zero rate', () => {
    expect(chooseWidth([])).toBe(1)
    expect(chooseWidth([0, 0])).toBe(1)
    expect(chooseWidth([150])).toBe(1)
  })
})

describe('shouldTryMore', () => {
  it('always tries two lanes, then goes on only while the last count gained enough', () => {
    expect(shouldTryMore([], 4)).toBe(true)
    expect(shouldTryMore([100], 4)).toBe(true)
    expect(shouldTryMore([100, 110], 4)).toBe(false)
    expect(shouldTryMore([100, 190], 4)).toBe(true)
    expect(shouldTryMore([100, 190, 280, 400], 4)).toBe(false)
    expect(shouldTryMore([], 1)).toBe(true)
    expect(shouldTryMore([100], 1)).toBe(false)
  })
})

describe('machineKey', () => {
  it('differs when the cores, the memory, the GPU or the browser differ', () => {
    const base = {
      platform: 'MacIntel',
      cores: 10,
      memoryGb: 8,
      gpu: 'Apple M4',
      browser: 'Chrome/1',
    }
    const keys = new Set([
      machineKey(base),
      machineKey({ ...base, cores: 8 }),
      machineKey({ ...base, memoryGb: 4 }),
      machineKey({ ...base, gpu: 'NVIDIA RTX' }),
      machineKey({ ...base, browser: 'Chrome/2' }),
    ])
    expect(keys.size).toBe(5)
    expect(machineKey(base)).toBe(machineKey({ ...base }))
  })
})

describe('probeEngineLanes without a media engine', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers width 1 and says why when the browser has no WebCodecs', async () => {
    const result = await probeEngineLanes()
    expect(result).toMatchObject({ transcode: 1, source: 'fallback', probeMs: 0 })
    expect(result.reason).toContain('WebCodecs')
  })

  it('answers from the cache of this machine, and measures again for another machine', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: async () => ({ supported: false }),
    })
    vi.stubGlobal('VideoDecoder', {})
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 10,
      platform: 'MacIntel',
      userAgent: 'Chrome/1.0',
    })
    // no hardware encoder: a fallback, which is not cached
    const first = await probeEngineLanes()
    expect(first).toMatchObject({ source: 'fallback', reason: 'no hardware video encoder' })
    expect(store.size).toBe(0)

    const key = `droneclean.side-work.engine-lanes.v2:${machineKey({
      platform: 'MacIntel',
      cores: 10,
      memoryGb: undefined,
      gpu: '?',
      browser: 'Chrome/1.0',
    })}`
    store.set(key, JSON.stringify({ transcode: 3, framesPerSecond: [1, 2, 3], source: 'measured' }))
    const cached = await probeEngineLanes()
    expect(cached).toMatchObject({ transcode: 3, source: 'cached', probeMs: 0 })

    vi.stubGlobal('navigator', {
      hardwareConcurrency: 4,
      platform: 'MacIntel',
      userAgent: 'Chrome/1.0',
    })
    const other = await probeEngineLanes()
    expect(other.source).toBe('fallback')
  })

  it('ignores a damaged cache entry', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: false }) })
    vi.stubGlobal('VideoDecoder', {})
    vi.stubGlobal('navigator', { hardwareConcurrency: 10, platform: 'P', userAgent: 'Chrome/1.0' })
    const key = `droneclean.side-work.engine-lanes.v2:${machineKey({ platform: 'P', cores: 10, gpu: '?', browser: 'Chrome/1.0' })}`
    store.set(key, '{not json')
    expect((await probeEngineLanes()).source).toBe('fallback')
    store.set(key, JSON.stringify({ transcode: 0 }))
    expect((await probeEngineLanes()).source).toBe('fallback')
  })
})
