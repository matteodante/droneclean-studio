import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BufferSource, EncodedPacketSink, Input, ALL_FORMATS } from 'mediabunny'
import { describe, expect, it } from 'vite-plus/test'

/**
 * Import side of the AAC encoder delay (11.17, 19 Nov 2026).
 *
 * `fixtures/aac-click-0p5s.m4a` is a 1 s mono 48 kHz click track whose first transient (a 3 ms 1 kHz burst)
 * sits at exactly sample 24000 (0.5 s):
 *   ffmpeg -i click.wav -c:a aac -b:a 128k click.m4a        (FFmpeg 9.0.2: edit list media_time 1024)
 * Measured in Chrome with `AudioSampleSink` (the decoder every editor path uses: playback, export,
 * waveform), concatenating the decoded samples from range start 0, the click lands on sample 24000
 * (500.0 ms, offset 0 samples, 0 ms); the same click in the original WAV lands on 24000 too.
 * The same file decoded without the edit list would land on 25024 (1024 samples, 21.3 ms late).
 * It lands right because mediabunny reads the edit list's media time and gives the priming packets a
 * negative presentation time, so the decoded sample at time t is the audio of the original at time t.
 * A decoder is not available in Node, so this guard checks that demuxer behaviour: the packets that
 * carry the priming come before time 0 by exactly the declared delay (1024 here, 2112 for the
 * platform's encoder).
 *
 * A file with the delay only in an `iTunSMPB` tag and no edit list is handled by `aac-priming.ts`
 * (task 11.22, tested in `aac-priming.test.ts`).
 */
const SAMPLE_RATE = 48_000

function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, 'fixtures/aac-click-0p5s.m4a')))
}

/** Sets the edit list's media time (the declared priming) in a copy of the file. */
function withDeclaredPriming(bytes: Uint8Array, samples: number): Uint8Array {
  const copy = bytes.slice()
  const at = copy.findIndex(
    (_, i) => copy[i] === 0x65 && copy[i + 1] === 0x6c && copy[i + 2] === 0x73 && copy[i + 3] === 0x74,
  )
  expect(at).toBeGreaterThan(0)
  // 'elst', version/flags, entry count, segment duration, media time (all 32-bit, big endian)
  new DataView(copy.buffer).setUint32(at + 4 + 4 + 4 + 4, samples)
  return copy
}

async function firstPacketTimes(bytes: Uint8Array): Promise<number[]> {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) })
  try {
    const track = await input.getPrimaryAudioTrack()
    expect(track).not.toBeNull()
    const sink = new EncodedPacketSink(track!)
    const times: number[] = []
    let packet = await sink.getFirstPacket()
    while (packet && times.length < 3) {
      times.push(packet.timestamp)
      packet = await sink.getNextPacket(packet)
    }
    return times
  } finally {
    input.dispose()
  }
}

describe('AAC priming on import', () => {
  it('starts the packets before time 0 by the 1024 declared priming samples', async () => {
    const [first, second, third] = await firstPacketTimes(fixtureBytes())
    expect(first! * SAMPLE_RATE).toBeCloseTo(-1024, 3)
    // the second packet starts at 0: its first sample is the first sample of the original
    expect(second!).toBeCloseTo(0, 6)
    expect(third! * SAMPLE_RATE).toBeCloseTo(1024, 3)
  })

  it('honours a declared priming of 2112 samples', async () => {
    const [first] = await firstPacketTimes(withDeclaredPriming(fixtureBytes(), 2112))
    expect(first! * SAMPLE_RATE).toBeCloseTo(-2112, 3)
  })
})
