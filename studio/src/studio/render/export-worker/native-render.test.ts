// @vitest-environment node
// The render loop of a native 10-bit export (`native-render.ts`), with FreeCut's renderer, the GPU device and the
// encode stream replaced: what it switches on for the export's length, and that every way out switches it off.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { preciseOutputSink } from '@/studio/render/precise/contract'
import { nativeExportActive, nativeExportSession } from '@/studio/render/precise/native-session'
import type { ClientExportSettings } from '@/runtime/renderer/client-renderer'
import type { CompositionInputProps } from '@/types/export'
import type { NativeExportPlan } from './native-export'

const fakes = vi.hoisted(() => ({
  seen: [] as Array<{ frame: number; active: boolean; sinkSet: boolean }>,
  failAt: -1,
  disposed: 0,
  finished: 0,
  cancelled: 0,
  framesWritten: 3,
}))

vi.mock('@/infrastructure/gpu-effects/effects-pipeline', () => ({
  EffectsPipeline: { requestCachedDevice: async () => ({}) },
}))

vi.mock('@/runtime/renderer/client-render-engine', () => ({
  createCompositionRenderer: async () => ({
    async preload() {},
    async renderFrame(frame: number) {
      const { nativeExportActive: active } = await import('@/studio/render/precise/native-session')
      const { preciseOutputSink: sink } = await import('@/studio/render/precise/contract')
      fakes.seen.push({ frame, active: active(), sinkSet: sink() !== null })
      if (frame === fakes.failAt) throw new Error('the GPU went away')
    },
    dispose() {
      fakes.disposed += 1
    },
  }),
}))

vi.mock('@/studio/render/precise/p010-out', () => ({
  openNativeEncodeStream: () => ({
    jobId: 'native-1',
    counters: { framesDelivered: 0, framesSent: 0, allocations: 5 },
    deliver: async () => {},
    async finish() {
      fakes.finished += 1
      return { framesWritten: fakes.framesWritten, path: '/exports/flight.mp4' }
    },
    cancel() {
      fakes.cancelled += 1
    },
  }),
}))

const { renderNativeComposition } = await import('./native-render')

const PLAN: NativeExportPlan = {
  target: { format: 'prores-422-hq', path: '/exports/flight.mov', bitrate: 120_000_000 },
  paths: [['media-1', '/clips/a.mp4']],
  encode: { jobId: 'native-1', frameBytes: 24, width: 4, height: 2 },
  media: null,
}
const SETTINGS = { resolution: { width: 4, height: 2 } } as ClientExportSettings
const COMPOSITION = {
  fps: 30,
  durationInFrames: 3,
  width: 4,
  height: 2,
  tracks: [],
} as unknown as CompositionInputProps
const bridge = { startDecode: vi.fn(), cancel: vi.fn() }

beforeEach(() => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return {}
      }
    },
  )
  fakes.seen = []
  fakes.failAt = -1
  fakes.disposed = 0
  fakes.finished = 0
  fakes.cancelled = 0
  fakes.framesWritten = 3
})
afterEach(() => vi.unstubAllGlobals())

describe('renderNativeComposition', () => {
  it('renders every frame with the native session and the sink on, then switches both off and finishes the file', async () => {
    const progress: number[] = []
    const result = await renderNativeComposition({
      settings: SETTINGS,
      composition: COMPOSITION,
      onProgress: (p) => progress.push(p.progress),
      plan: PLAN,
      bridge,
    })
    expect(fakes.seen).toEqual([0, 1, 2].map((frame) => ({ frame, active: true, sinkSet: true })))
    expect(fakes.finished).toBe(1)
    expect(fakes.disposed).toBe(1)
    expect(nativeExportActive()).toBe(false)
    expect(preciseOutputSink()).toBeNull()
    expect(result).toMatchObject({ mimeType: 'video/quicktime', duration: 0.1, fileSize: 0 })
    expect(result.blob.size).toBe(0)
    expect(progress.at(-1)).toBe(100)
  })

  it('cancels the encode and switches everything off when a frame fails', async () => {
    fakes.failAt = 1
    await expect(
      renderNativeComposition({
        settings: SETTINGS,
        composition: COMPOSITION,
        onProgress: () => {},
        plan: PLAN,
        bridge,
      }),
    ).rejects.toThrow('the GPU went away')
    expect(fakes.cancelled).toBe(1)
    expect(fakes.finished).toBe(0)
    expect(nativeExportSession()).toBeNull()
    expect(preciseOutputSink()).toBeNull()
  })

  it('stops at once when cancelled, and refuses a file short of frames', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      renderNativeComposition({
        settings: SETTINGS,
        composition: COMPOSITION,
        onProgress: () => {},
        signal: controller.signal,
        plan: PLAN,
        bridge,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fakes.cancelled).toBe(1)

    fakes.framesWritten = 2
    await expect(
      renderNativeComposition({
        settings: SETTINGS,
        composition: COMPOSITION,
        onProgress: () => {},
        plan: PLAN,
        bridge,
      }),
    ).rejects.toThrow('The encoder wrote 2 of the 3 frames')
  })

  it('refuses another size than the project’s: the packing has no scaler yet', async () => {
    await expect(
      renderNativeComposition({
        settings: { resolution: { width: 2, height: 2 } } as ClientExportSettings,
        composition: COMPOSITION,
        onProgress: () => {},
        plan: PLAN,
        bridge,
      }),
    ).rejects.toThrow(/written at the project's size \(4x2\); 2x2 is not supported yet/)
  })
})
