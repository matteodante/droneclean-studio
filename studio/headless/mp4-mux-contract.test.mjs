// The muxer half of Meta's Reel container rules (task 11.19), on the installed mediabunny and without a
// browser: `fastStart: 'reserve'` puts the moov box ahead of the media while the media streams, and an audio
// track whose first packet is stamped 0 gets no edit list, while one stamped at minus the AAC priming does
// (what the export used to write). The browser half (a real export, AAC at 128 kbps) is
// `headless/export-media-video.mjs`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, Output } from 'mediabunny'
import { describeMp4 } from './lib/mp4-boxes.mjs'

const SAMPLE_RATE = 48_000
const PACKETS = 94
const PACKET_FRAMES = 1024
// AAC-LC, 48 kHz, stereo: the two-byte AudioSpecificConfig.
const AAC_CONFIG = Uint8Array.from([0x11, 0x90])
/** 128 kbps worth of bytes per 1024-frame packet. */
const PACKET_BYTES = Math.round((128_000 / 8) * (PACKET_FRAMES / SAMPLE_RATE))

async function mux({ firstTimestamp, fastStart }) {
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart }), target })
  const source = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(source, fastStart === 'reserve' ? { maximumPacketCount: PACKETS + 16 } : undefined)
  await output.start()
  for (let i = 0; i < PACKETS; i++) {
    const timestamp = firstTimestamp + (i * PACKET_FRAMES) / SAMPLE_RATE
    await source.add(
      new EncodedPacket(new Uint8Array(PACKET_BYTES).fill(1), 'key', timestamp, PACKET_FRAMES / SAMPLE_RATE),
      i === 0
        ? { decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: SAMPLE_RATE, description: AAC_CONFIG } }
        : undefined,
    )
  }
  await output.finalize()
  return Buffer.from(target.buffer)
}

test("fastStart 'reserve' writes the moov box before the media", async () => {
  const info = describeMp4(await mux({ firstTimestamp: 0, fastStart: 'reserve' }))
  assert.equal(info.moovBeforeMdat, true, info.topLevel.join(' '))
})

test('without it the moov box is at the end (the old file target)', async () => {
  const info = describeMp4(await mux({ firstTimestamp: 0, fastStart: false }))
  assert.equal(info.moovBeforeMdat, false, info.topLevel.join(' '))
})

test('a first packet at 0 leaves no edit list', async () => {
  const info = describeMp4(await mux({ firstTimestamp: 0, fastStart: 'reserve' }))
  assert.equal(info.editListBoxes, 0)
  assert.equal(info.audio.firstSampleTime, 0)
  assert.ok(Math.abs(info.audio.bitrate - 128_000) < 3_000, String(info.audio.bitrate))
})

test('a first packet at minus the priming writes the edit list that skips it', async () => {
  const info = describeMp4(await mux({ firstTimestamp: -2112 / SAMPLE_RATE, fastStart: 'reserve' }))
  assert.ok(info.editListBoxes > 0)
  assert.equal(info.audio.hasEditList, true)
})
