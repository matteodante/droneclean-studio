// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import { derivedSizeKey } from '@/studio/render/stages/derived-sizes'
import { derivedSizes } from '@/studio/render/stages/staged-size'
import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import { getSourceDimensions, toTransformStyle } from './transform-resolver'

describe('toTransformStyle', () => {
  it('includes horizontal flip in the CSS transform', () => {
    const style = toTransformStyle(
      {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        anchorX: 160,
        anchorY: 90,
        rotation: 45,
        opacity: 1,
        cornerRadius: 0,
      },
      { width: 1920, height: 1080, fps: 30 },
      { flipHorizontal: true },
    )

    expect(style.transform).toBe('rotate(45deg) scale(-1, 1)')
    expect(style.transformOrigin).toBe('160px 90px')
  })

  it('supports vertical-only flips without rotation', () => {
    const style = toTransformStyle(
      {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        anchorX: 160,
        anchorY: 90,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      { width: 1920, height: 1080, fps: 30 },
      { flipVertical: true },
    )

    expect(style.transform).toBe('scale(1, -1)')
  })

  it('uses explicit anchor values for transform origin', () => {
    const style = toTransformStyle(
      {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        anchorX: 24,
        anchorY: 36,
        rotation: 30,
        opacity: 1,
        cornerRadius: 0,
      },
      { width: 1920, height: 1080, fps: 30 },
    )

    expect(style.transformOrigin).toBe('24px 36px')
  })
})

describe('getSourceDimensions and a staged clip', () => {
  const clip = {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 1,
    label: 'clip',
    mediaId: 'media-1',
    src: 'blob:clip',
    sourceWidth: 3840,
    sourceHeight: 2880,
  } as const

  const stabilization = {
    enabled: true,
    method: 'Default',
    params: { smoothness: 0.5 },
    fov: 1,
    horizonLockPercent: 0,
    horizonLockRoll: 0,
    adaptiveZoomSeconds: 4,
  }

  afterEach(() => {
    derivedSizes.delete(sizeKey(stabilization))
  })

  function sizeKey(settings: typeof stabilization): string {
    return derivedSizeKey('stabilize', stabilizationEngineKey({ ...clip, stabilization: settings })!)
  }

  it('is the staged picture’s size from the session’s derived-size store, not the file’s (S5)', () => {
    derivedSizes.set(sizeKey(stabilization), { width: 3840, height: 2160 })
    expect(getSourceDimensions({ ...clip, stabilization })).toEqual({ width: 3840, height: 2160 })
  })

  it('is the file’s size until the stage is prepared, while the clip is not stabilized, and for other settings', () => {
    expect(getSourceDimensions({ ...clip, stabilization })).toEqual({ width: 3840, height: 2880 })
    derivedSizes.set(sizeKey(stabilization), { width: 3840, height: 2160 })
    expect(getSourceDimensions({ ...clip, stabilization: { ...stabilization, enabled: false } })).toEqual(
      { width: 3840, height: 2880 },
    )
    expect(getSourceDimensions({ ...clip, stabilization: { ...stabilization, fov: 1.2 } })).toEqual({
      width: 3840,
      height: 2880,
    })
  })
})
