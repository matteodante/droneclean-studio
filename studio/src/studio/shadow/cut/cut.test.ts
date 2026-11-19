// @vitest-environment node

import { readFileSync } from 'node:fs'
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { describe, expect, it } from 'vite-plus/test'
import { cutShadowPiece } from './cut'
import { planShadowCut } from './plan'

const RATE = { num: 24, den: 1 }
const FRAME_SECONDS = 1 / 24
const FIXTURE = readFileSync(new URL('../../../../golden/media/hevc-main10.mp4', import.meta.url))

/** The kit's tiny clip repeated on its keyframe, so a window can start on a keyframe after 0. */
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

async function packetsOf(blob: Blob): Promise<EncodedPacket[]> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('the file has no video track')
    const packets: EncodedPacket[] = []
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet)
    return packets
  } finally {
    input.dispose()
  }
}

const CONTAINER_BOXES = new Set([
  'moov',
  'trak',
  'edts',
  'mdia',
  'minf',
  'stbl',
  'dinf',
  'udta',
  'mvex',
])

/** Every MP4 box type in the file, including the ones nested in containers, in file order. */
function boxTypes(bytes: Uint8Array, start = 0, end = bytes.byteLength, types: string[] = []) {
  let offset = start
  while (offset + 8 <= end) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (size < 8 || offset + size > end) break
    types.push(type)
    if (CONTAINER_BOXES.has(type)) boxTypes(bytes, offset + 8, offset + size, types)
    offset += size
  }
  return types
}

describe('cutShadowPiece', () => {
  it('copies the keyframe and every frame after it, with the frame times counted from it', async () => {
    const source = new Blob([FIXTURE])
    const window = await planShadowCut(source, { startFrame: 0, endFrame: 12 }, RATE)
    const piece = await cutShadowPiece(source, window)
    const sourcePackets = await packetsOf(source)
    const piecePackets = await packetsOf(piece)

    expect(piece.type).toBe('video/mp4')
    expect(window).toEqual({ startFrame: 0, endFrame: 12, startSeconds: 0, endSeconds: 0.5 })
    expect(piecePackets).toHaveLength(12)
    expect(piecePackets.map((packet) => packet.type)).toEqual(
      sourcePackets.map((packet) => packet.type),
    )
    // The first sample is the source's keyframe packet, and every sample after it is the source's
    // own bytes: nothing was re-encoded.
    expect(piecePackets[0]?.type).toBe('key')
    for (let frame = 0; frame < piecePackets.length; frame++) {
      expect(piecePackets[frame]?.data).toEqual(sourcePackets[frame]?.data)
    }
    // The frame times are the window's own: the twelve frames play at 0, 1/24, … 11/24 s.
    const times = piecePackets.map((packet) => packet.timestamp).sort((a, b) => a - b)
    expect(times).toEqual(Array.from({ length: 12 }, (_, frame) => frame / RATE.num))
    for (const packet of piecePackets) {
      expect(packet.duration).toBe(FRAME_SECONDS)
    }
  })

  it('cuts one second from a keyframe in the middle of the file', async () => {
    const source = await clipWithKeyframes(4) // keyframes at frames 0, 12, 24, 36; 48 frames
    const window = await planShadowCut(source, { startFrame: 12, endFrame: 36 }, RATE)
    const piece = await cutShadowPiece(source, window)
    const sourcePackets = await packetsOf(source)
    const piecePackets = await packetsOf(piece)

    expect(window).toEqual({ startFrame: 12, endFrame: 36, startSeconds: 0.5, endSeconds: 1.5 })
    expect(piecePackets).toHaveLength(24)
    expect(piecePackets[0]?.type).toBe('key')
    expect(piecePackets[0]?.data).toEqual(sourcePackets[12]?.data)
    for (let frame = 0; frame < piecePackets.length; frame++) {
      expect(piecePackets[frame]?.data).toEqual(sourcePackets[12 + frame]?.data)
    }
    const times = piecePackets.map((packet) => packet.timestamp).sort((a, b) => a - b)
    expect(times).toEqual(Array.from({ length: 24 }, (_, frame) => frame / RATE.num))
  })

  it('writes no edit list: the piece starts at 0 with its own sync sample table', async () => {
    const source = new Blob([FIXTURE])
    const piece = await cutShadowPiece(
      source,
      await planShadowCut(source, { startFrame: 4, endFrame: 9 }, RATE),
    )
    const types = boxTypes(new Uint8Array(await piece.arrayBuffer()))

    expect(types).toContain('moov')
    expect(types).toContain('stss')
    expect(types).not.toContain('edts')
    expect(types).not.toContain('elst')
  })

  it('refuses a window that does not start on a keyframe', async () => {
    // The fixture's only keyframe is frame 0, so frame 5's keyframe is 0, not 5.
    await expect(
      cutShadowPiece(new Blob([FIXTURE]), {
        startFrame: 5,
        endFrame: 9,
        startSeconds: 5 * FRAME_SECONDS,
        endSeconds: 0.5,
      }),
    ).rejects.toThrow(/does not start|keyframe is at/)
  })
})
