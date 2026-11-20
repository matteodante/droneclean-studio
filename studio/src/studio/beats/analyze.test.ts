// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { detectBeatsOffThread, mixToMono } from './analyze'

function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (channel: number) => channels[channel] as Float32Array,
  } as unknown as AudioBuffer
}

describe('mixToMono', () => {
  it('averages the channels over the span only', () => {
    const left = Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1])
    const right = Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0])
    // A slice that starts 10 s into the media, 4 samples per second.
    const mono = mixToMono(fakeBuffer([left, right], 4), 10, { start: 10.5, end: 11.5 })

    expect(Array.from(mono)).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('clamps a span that runs past the decoded audio', () => {
    const mono = mixToMono(fakeBuffer([new Float32Array(8)], 4), 0, { start: 1, end: 99 })
    expect(mono).toHaveLength(4)
  })
})

describe('detectBeatsOffThread', () => {
  it('runs on this thread where there is no Worker', async () => {
    expect(await detectBeatsOffThread(new Float32Array(44100), 44100, {})).toEqual([])
  })
})
