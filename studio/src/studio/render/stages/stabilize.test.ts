// The stabilization adapter against a fake host and a fake warp: what `prepare` writes and never writes, what `ready`
// answers in each engine state, and what `encode` hands the warp (the frame of that source index, the caller's arena).

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { StabilizationSeat, EngineState } from '@/studio/stabilization/seat'
import type { StabilizationFrameData, StabilizationInfo } from '@/studio/stabilization/client'
import { NoMotionDataError } from '@/studio/stabilization/client'
import type { StabilizationAssets, StabilizationStage } from '@/studio/stabilization/stage'
import type { VideoItem } from '@/types/timeline'
import { createDerivedSizeStore, derivedSizeKey } from './derived-sizes'
import { setStabilizationProjectFrame } from '@/studio/stabilization/engine-key'
import { createStabilizeStage } from './stabilize'
import { isNotReady, StageError, type StageEnv } from './types'

const { stageForMock, builtMock } = vi.hoisted(() => ({
  stageForMock: vi.fn(async () => ({})),
  builtMock: vi.fn(),
}))
vi.mock('@/studio/stabilization/stage-cache', () => ({
  stabilizationStageFor: stageForMock,
  builtStabilizationStage: builtMock,
}))

const ASSETS = { kernelWgsl: 'k' } as unknown as StabilizationAssets
const INFO = { output: [3840, 2160], frames: 100, orientations: 10 } as unknown as StabilizationInfo
const DEVICE = { lost: new Promise(() => {}) } as unknown as GPUDevice

function item(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'c1',
    type: 'video',
    trackId: 't',
    label: 'Run 2',
    mediaId: 'm1',
    src: 'blob:x',
    from: 0,
    durationInFrames: 10,
    stabilization: {
      enabled: true,
      method: 'Default',
      params: {},
      fov: 1,
      horizonLockPercent: 0,
      horizonLockRoll: 0,
      adaptiveZoomSeconds: 4,
    },
    ...extra,
  } as VideoItem
}

interface FakeHost {
  state: EngineState
  frames: Map<number, StabilizationFrameData>
  failures: Map<number, Error>
  open: ReturnType<typeof vi.fn>
  requestFrame: ReturnType<typeof vi.fn>
  size: { width: number; height: number } | null
  gone: Promise<void>
}

function fakeHost(overrides: Partial<FakeHost> = {}): { host: StabilizationSeat; fake: FakeHost } {
  const fake: FakeHost = {
    state: { status: 'ready', info: INFO },
    frames: new Map(),
    failures: new Map(),
    open: vi.fn(async () => ({ kind: 'ready', info: INFO, lens: { name: 'l', model: null } })),
    requestFrame: vi.fn(async () => undefined),
    size: { width: 3840, height: 2160 },
    gone: new Promise(() => undefined),
    ...overrides,
  }
  const host = {
    open: fake.open,
    engineState: () => fake.state,
    outputSizeOf: () => fake.size,
    whenSettled: () => Promise.resolve(),
    frame: (_key: string, index: number) => fake.frames.get(index),
    requestFrame: fake.requestFrame,
    takeFrameFailure: (_key: string, index: number) => {
      const error = fake.failures.get(index)
      fake.failures.delete(index)
      return error
    },
    stageAssets: async () => ASSETS,
    loadedAssets: () => ASSETS,
    whenAssetsGone: vi.fn(() => fake.gone),
    release: vi.fn(async () => undefined),
  } as unknown as StabilizationSeat
  return { host, fake }
}

function make(fakeOverrides: Partial<FakeHost> = {}) {
  const sizes = createDerivedSizeStore()
  const { host, fake } = fakeHost(fakeOverrides)
  const stage = createStabilizeStage({ sizes, host: () => host })
  return { stage, sizes, fake, host }
}

describe('the stabilization stage and the project’s frame', () => {
  afterEach(() => setStabilizationProjectFrame(undefined))

  it('keys the clip and its derived size by the aspect of the project’s frame, so a changed frame is re-derived', async () => {
    const { stage, sizes, fake } = make()
    setStabilizationProjectFrame({ width: 1920, height: 1080 })
    const wide = stage.key(item())
    await stage.prepare(item(), DEVICE)
    expect(sizes.get(derivedSizeKey('stabilize', wide))).toEqual({ width: 3840, height: 2160 })

    // The project becomes 4:3: another key, no size yet for it (the layout waits), and the engine's new size once prepared
    setStabilizationProjectFrame({ width: 3840, height: 2880 })
    const tall = stage.key(item())
    expect(tall).not.toBe(wide)
    fake.size = { width: 3840, height: 2880 }
    fake.state = { status: 'opening', settled: Promise.resolve() }
    expect(isNotReady(stage.outputSize(item(), { width: 3840, height: 2880 }))).toBe(true)
    fake.state = { status: 'ready', info: INFO }
    await stage.prepare(item(), DEVICE)
    expect(sizes.get(derivedSizeKey('stabilize', tall))).toEqual({ width: 3840, height: 2880 })
    expect(stage.outputSize(item(), { width: 3840, height: 2880 })).toEqual({ width: 3840, height: 2880 })
    // The 16:9 size is still its own (a project that goes back to 16:9 finds it)
    expect(sizes.get(derivedSizeKey('stabilize', wide))).toEqual({ width: 3840, height: 2160 })
  })

  it('has the same key for frames of one shape: 1080p and 4K projects share an engine', () => {
    const { stage } = make()
    setStabilizationProjectFrame({ width: 1920, height: 1080 })
    const hd = stage.key(item())
    setStabilizationProjectFrame({ width: 3840, height: 2160 })
    expect(stage.key(item())).toBe(hd)
  })
})

describe('the stabilization stage', () => {
  it('is a source-frame stage, active for a stabilized clip, keyed by media and settings', () => {
    const { stage } = make()
    expect(stage.id).toBe('stabilize')
    expect(stage.scope).toBe('source-frame')
    expect(stage.active(item())).toBe(true)
    expect(
      stage.active(item({ stabilization: { ...item().stabilization!, enabled: false } })),
    ).toBe(false)
    expect(stage.key(item({ id: 'other' }))).toBe(stage.key(item()))
    expect(stage.key(item({ mediaId: 'm2' }))).not.toBe(stage.key(item()))
    expect(() => stage.key(item({ mediaId: undefined }))).toThrow(StageError)
  })

  it('prepare fills the derived-size store and builds the warp, and never touches the timeline store (the host test checks it opens nothing else)', async () => {
    const { stage, sizes, fake } = make()
    const out = stage.outputSize(item(), { width: 3840, height: 2880 })
    expect(isNotReady(out)).toBe(true)
    await stage.prepare(item(), DEVICE)
    expect(fake.open).toHaveBeenCalledTimes(1)
    expect(fake.open).toHaveBeenCalledWith(item(), { retry: true })
    expect(sizes.get(derivedSizeKey('stabilize', stage.key(item())))).toEqual({
      width: 3840,
      height: 2160,
    })
    expect(stage.outputSize(item(), { width: 3840, height: 2880 })).toEqual({
      width: 3840,
      height: 2160,
    })
    expect(stageForMock).toHaveBeenCalledWith(DEVICE, ASSETS, {
      input: 'rgba16float',
      output: 'rgba16float',
    })
  })

  it('prepare sets a moved engine’s size before its open resolves', async () => {
    const gate: { resolve: () => void } = { resolve: () => {} }
    const { stage, sizes } = make({
      open: vi.fn(
        () =>
          new Promise((resolve) => {
            gate.resolve = () =>
              resolve({ kind: 'ready', info: INFO, lens: { name: 'l', model: null } })
          }),
      ),
    })
    const preparing = stage.prepare(item(), DEVICE)
    expect(sizes.get(derivedSizeKey('stabilize', stage.key(item())))).toEqual({
      width: 3840,
      height: 2160,
    })
    gate.resolve()
    await preparing
  })

  it('prepare throws a StageError naming the clip, the stage and the reason when the open fails', async () => {
    const error = new NoMotionDataError()
    const { stage, sizes } = make({
      open: vi.fn(async () => ({ kind: 'no-motion-data', error })),
      size: null,
    })
    const failure = await stage.prepare(item(), DEVICE).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(StageError)
    expect((failure as StageError).message).toContain("Clip 'Run 2', stabilization")
    expect((failure as StageError).message).toContain('no motion data')
    expect((failure as StageError).cause).toBe(error)
    expect(sizes.get(derivedSizeKey('stabilize', stage.key(item())))).toBeUndefined()
  })

  it('outputSize throws the failure of an engine that did not open', () => {
    const { stage } = make({ state: { status: 'failed', error: new Error('disk') } })
    expect(() => stage.outputSize(item(), { width: 1, height: 1 })).toThrow(/disk/)
  })

  it('ready: not yet while the engine is absent or opening, thrown when it failed', () => {
    const absent = make({ state: { status: 'absent' } })
    expect(isNotReady(absent.stage.ready(item(), 5))).toBe(true)
    const opening = make({ state: { status: 'opening', settled: Promise.resolve() } })
    expect(isNotReady(opening.stage.ready(item(), 5))).toBe(true)
    const failed = make({ state: { status: 'failed', error: new Error('broken') } })
    expect(() => failed.stage.ready(item(), 5)).toThrow(
      /Clip 'Run 2', stabilization, source frame 5: broken/,
    )
  })

  it('ready: true when the frame is held, else the fetch is the "not yet", and a failed fetch is thrown once', async () => {
    const { stage, fake } = make()
    const waiting = stage.ready(item(), 7)
    expect(isNotReady(waiting)).toBe(true)
    expect(fake.requestFrame).toHaveBeenCalledWith(stage.key(item()), 7)
    fake.frames.set(7, { sourceFrame: 7 } as StabilizationFrameData)
    expect(stage.ready(item(), 7)).toBe(true)
    fake.failures.set(8, new Error('no answer'))
    expect(() => stage.ready(item(), 8)).toThrow(/source frame 8: no answer/)
    expect(isNotReady(stage.ready(item(), 8))).toBe(true)
  })

  it('encode hands the warp the frame of that source index and the caller’s arena', () => {
    const { stage, fake } = make()
    const warp = vi.fn()
    builtMock.mockReturnValue({ warp } as unknown as StabilizationStage)
    const frame = {
      sourceFrame: 9,
      matrices: new Float32Array(16),
    } as unknown as StabilizationFrameData
    fake.frames.set(9, frame)
    const env = {
      device: DEVICE,
      mode: 'export',
      arena: { upload: vi.fn() },
    } as unknown as StageEnv
    const encoder = {} as GPUCommandEncoder
    const input = { format: 'rgba16float' } as GPUTexture
    const output = { format: 'rgba16float' } as GPUTexture
    stage.encode(env, encoder, item(), 9, input, output)
    expect(warp).toHaveBeenCalledWith(encoder, input, output, frame, env.arena, undefined)
    // The clip's own framing goes to the warp (a clip that never set one passed none, above)
    const framed = item()
    framed.stabilization = { ...framed.stabilization!, framingX: -0.5 }
    stage.encode(env, encoder, framed, 9, input, output)
    expect(warp).toHaveBeenLastCalledWith(encoder, input, output, frame, env.arena, { x: -0.5, y: 0 })
  })

  it('encode names the clip, stage and frame when the data or the warp is missing, or the warp throws', () => {
    const { stage, fake } = make()
    const env = { device: DEVICE, mode: 'export', arena: {} } as unknown as StageEnv
    const args = [{} as GPUCommandEncoder, item(), 3, {} as GPUTexture, {} as GPUTexture] as const
    expect(() => stage.encode(env, args[0], args[1], args[2], args[3], args[4])).toThrow(
      /source frame 3.*not ready/,
    )
    fake.frames.set(3, { sourceFrame: 3 } as StabilizationFrameData)
    builtMock.mockReturnValue(undefined)
    expect(() => stage.encode(env, args[0], args[1], args[2], args[3], args[4])).toThrow(
      /not prepared/,
    )
    builtMock.mockReturnValue({
      warp: () => {
        throw new Error('the output is 1x1')
      },
    })
    expect(() => stage.encode(env, args[0], args[1], args[2], args[3], args[4])).toThrow(
      /Clip 'Run 2', stabilization, source frame 3: the output is 1x1/,
    )
  })

  it('release closes the key’s engine on the host', async () => {
    const { stage, host } = make()
    await stage.release('k')
    expect(host.release).toHaveBeenCalledWith('k')
  })

  it('counts what it prepared lost when the host’s engine and its assets for the key are gone', async () => {
    const { stage, host, fake } = make({ gone: Promise.resolve() })
    await expect(stage.lost('k')).resolves.toBeUndefined()
    expect(host.whenAssetsGone).toHaveBeenCalledWith('k')
    expect(stage.lost('k')).toBe(fake.gone)
  })
})
