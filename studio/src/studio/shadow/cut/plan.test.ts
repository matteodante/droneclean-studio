// @vitest-environment node

import { readFileSync } from 'node:fs'
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { describe, expect, it } from 'vite-plus/test'
import { planShadowCut } from './plan'

const RATE = { num: 24, den: 1 }
const FIXTURE = readFileSync(new URL('../../../../golden/media/hevc-main10.mp4', import.meta.url))

/**
 * The kit's tiny clip again and again, each copy starting on the clip's keyframe: a small file
 * whose keyframes are 12 frames apart, so a range can start and end between two of them.
 */
async function clipWithKeyframes(copies: number): Promise<Blob> {
  const input = new Input({ source: new BlobSource(new Blob([FIXTURE])), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('the fixture has no video track')
    const packets = []
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet)
    const secondsPerCopy = await track.computeDuration()
    const decoderConfig = await track.getDecoderConfig()

    const source = new EncodedVideoPacketSource((await track.getCodec())!)
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat(), target })
    output.addVideoTrack(source)
    await output.start()
    for (let copy = 0; copy < copies; copy++) {
      for (const packet of packets) {
        await source.add(packet.clone({ timestamp: packet.timestamp + copy * secondsPerCopy }), {
          decoderConfig: decoderConfig ?? undefined,
        })
      }
    }
    source.close()
    await output.finalize()
    return new Blob([target.buffer!], { type: 'video/mp4' })
  } finally {
    input.dispose()
  }
}

describe('planShadowCut', () => {
  it('widens a range to the keyframe before it and the end of the file', async () => {
    // The fixture has one keyframe, at frame 0, and 12 frames in all.
    await expect(
      planShadowCut(new Blob([FIXTURE]), { startFrame: 3, endFrame: 8 }, RATE),
    ).resolves.toEqual({ startFrame: 0, endFrame: 12, startSeconds: 0, endSeconds: 0.5 })
  })

  it('widens a range to the keyframes on both sides of it', async () => {
    const clip = await clipWithKeyframes(4) // keyframes at frames 0, 12, 24, 36; 48 frames

    await expect(planShadowCut(clip, { startFrame: 13, endFrame: 20 }, RATE)).resolves.toEqual({
      startFrame: 12,
      endFrame: 24,
      startSeconds: 0.5,
      endSeconds: 1,
    })
  })

  it('keeps a range that starts and ends on keyframes on those keyframes', async () => {
    const clip = await clipWithKeyframes(4)

    await expect(planShadowCut(clip, { startFrame: 12, endFrame: 24 }, RATE)).resolves.toEqual({
      startFrame: 12,
      endFrame: 24,
      startSeconds: 0.5,
      endSeconds: 1,
    })
    await expect(planShadowCut(clip, { startFrame: 24, endFrame: 30 }, RATE)).resolves.toEqual({
      startFrame: 24,
      endFrame: 36,
      startSeconds: 1,
      endSeconds: 1.5,
    })
  })

  it('ends at the end of the file when the range runs into the last keyframe', async () => {
    const clip = await clipWithKeyframes(4)

    await expect(planShadowCut(clip, { startFrame: 40, endFrame: 48 }, RATE)).resolves.toEqual({
      startFrame: 36,
      endFrame: 48,
      startSeconds: 1.5,
      endSeconds: 2,
    })
  })

  it('rejects a range that is not whole frames with an end after its start', async () => {
    const clip = new Blob([FIXTURE])

    await expect(planShadowCut(clip, { startFrame: 5, endFrame: 5 }, RATE)).rejects.toThrow(
      TypeError,
    )
    await expect(planShadowCut(clip, { startFrame: 1.5, endFrame: 8 }, RATE)).rejects.toThrow(
      TypeError,
    )
    await expect(planShadowCut(clip, { startFrame: 8, endFrame: 3 }, RATE)).rejects.toThrow(
      TypeError,
    )
  })

  it('rejects a frame rate that is not positive', async () => {
    await expect(
      planShadowCut(new Blob([FIXTURE]), { startFrame: 0, endFrame: 4 }, { num: 0, den: 1 }),
    ).rejects.toThrow(TypeError)
  })
})
