// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { keyFrameInterval, pickPrerenderCodec, type CodecSupport } from './codec'

function support(encodes: readonly string[], decodes: readonly string[] = encodes): CodecSupport {
  return {
    encoderSupported: async (config) => encodes.includes(config.codec),
    decoderSupported: async (config) => decodes.includes(config.codec),
  }
}

describe('pickPrerenderCodec', () => {
  it('prefers H.264 in Annex B, at an even size and a bitrate for the size and rate', async () => {
    const codec = await pickPrerenderCodec(
      support(['avc1.640033', 'vp8']),
      { width: 1919, height: 1081 },
      60,
    )
    expect(codec?.encoder).toMatchObject({
      codec: 'avc1.640033',
      width: 1920,
      height: 1082,
      framerate: 60,
      latencyMode: 'realtime',
      avc: { format: 'annexb' },
    })
    expect(codec?.encoder.bitrate).toBe(Math.round(1920 * 1082 * 60 * 0.25))
    expect(codec?.decoder).toEqual({ codec: 'avc1.640033', codedWidth: 1920, codedHeight: 1082 })
  })

  it('falls back to a codec the machine can both encode and decode', async () => {
    const codec = await pickPrerenderCodec(
      support(['avc1.640033', 'vp09.00.41.08'], ['vp09.00.41.08']),
      { width: 960, height: 540 },
      30,
    )
    expect(codec?.encoder.codec).toBe('vp09.00.41.08')
  })

  it('answers none when nothing works, so the preview stays live', async () => {
    expect(await pickPrerenderCodec(support([]), { width: 960, height: 540 }, 30)).toBeNull()
  })
})

describe('keyFrameInterval', () => {
  it('puts a key frame every half second', () => {
    expect(keyFrameInterval(60)).toBe(30)
    expect(keyFrameInterval(59.94)).toBe(30)
    expect(keyFrameInterval(24)).toBe(12)
    expect(keyFrameInterval(0)).toBe(15)
  })
})
