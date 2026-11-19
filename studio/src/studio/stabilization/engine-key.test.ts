import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import {
  engineSettingsOf,
  setStabilizationProjectFrame,
  stabilizationEngineKey,
  stabilizationProjectAspect,
} from './engine-key'

function item(): VideoItem {
  return {
    id: 'c1',
    type: 'video',
    trackId: 't',
    mediaId: 'm1',
    src: 'blob:x',
    from: 0,
    durationInFrames: 10,
    stabilization: {
      enabled: true,
      method: 'Default',
      params: { smoothness: 0.5 },
      fov: 1,
      horizonLockPercent: 0,
      horizonLockRoll: 0,
      adaptiveZoomSeconds: 4,
    },
  } as unknown as VideoItem
}

afterEach(() => setStabilizationProjectFrame(undefined))

describe('the stabilization key and the project’s frame', () => {
  it('changes with the aspect of the project’s frame: 16:9, 4:3 and 9:16 are three engines', () => {
    const keys = [undefined, [1920, 1080], [3840, 2880], [1080, 1920]].map((frame) => {
      setStabilizationProjectFrame(frame ? { width: frame[0]!, height: frame[1]! } : undefined)
      return stabilizationEngineKey(item())
    })

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is the same for frames of one shape, whatever their pixels', () => {
    setStabilizationProjectFrame({ width: 1920, height: 1080 })
    const hd = stabilizationEngineKey(item())
    setStabilizationProjectFrame({ width: 3840, height: 2160 })

    expect(stabilizationEngineKey(item())).toBe(hd)
  })

  it('asks the engine for the project’s aspect, and replaces one a stored field might carry', () => {
    setStabilizationProjectFrame({ width: 1440, height: 1080 })
    const stored = {
      ...item(),
      stabilization: { ...item().stabilization!, outputAspect: { width: 1, height: 1 } },
    } as VideoItem

    expect(stabilizationProjectAspect()).toEqual({ width: 4, height: 3 })
    expect(engineSettingsOf(stored)?.outputAspect).toEqual({ width: 4, height: 3 })
    expect(stabilizationEngineKey(stored)).toBe(stabilizationEngineKey(item()))
  })

  it('leaves the engine’s own output while the frame is unknown, and has no key for a clip without file or settings', () => {
    expect(engineSettingsOf(item())?.outputAspect).toBeUndefined()
    expect(stabilizationEngineKey({ ...item(), mediaId: undefined } as VideoItem)).toBeNull()
    expect(stabilizationEngineKey({ ...item(), stabilization: undefined } as VideoItem)).toBeNull()
  })
})
