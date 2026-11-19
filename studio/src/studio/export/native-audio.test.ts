// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import * as shell from '../../../desktop/src/main/media/audio-protocol'
import {
  audioPieceUrl,
  MIX_SAMPLE_RATE,
  PIECE_SECONDS,
  sendProjectMix,
  type MixWindow,
  type ProjectMix,
} from './native-audio'

const COMPOSITION = { fps: 30, durationInFrames: 30, width: 8, height: 8 } as CompositionInputProps

/** A mix of windows whose sample at global frame `n` is `n` on both channels */
function mixOf(windowFrames: readonly number[], hasAudio = true): ProjectMix {
  return {
    async hasAudio() {
      return hasAudio
    },
    async *windows(): AsyncGenerator<MixWindow> {
      let next = 0
      for (const frames of windowFrames) {
        const channel = Float32Array.from({ length: frames }, (_, index) => next + index)
        next += frames
        yield { samples: [channel, channel.slice()], sampleRate: MIX_SAMPLE_RATE, channels: 2 }
      }
    },
  }
}

function recorder(failAt?: number) {
  const requests: Array<{ url: string; bytes: Uint8Array | null }> = []
  const doFetch = (async (url: string, init: RequestInit) => {
    const body = init.body as Uint8Array | undefined
    requests.push({ url, bytes: body === undefined ? null : Uint8Array.from(body) })
    if (failAt !== undefined && requests.length === failAt) {
      return new Response('the disk is full\n', { status: 400 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { requests, doFetch }
}

describe('sendProjectMix', () => {
  it('sends the mix in order as numbered pieces of interleaved float, then ends it with the count', async () => {
    const piece = PIECE_SECONDS * MIX_SAMPLE_RATE
    // Two windows: 1.5 pieces, then 0.25 piece.
    const { requests, doFetch } = recorder()
    const sent = await sendProjectMix(COMPOSITION, {
      jobId: 'native-1',
      mix: mixOf([piece * 1.5, piece * 0.25]),
      fetch: doFetch,
    })
    expect(sent).toEqual({ chunks: 3, samples: piece * 1.75 })
    expect(requests.map((request) => request.url)).toEqual([
      audioPieceUrl('native-1', 0),
      audioPieceUrl('native-1', 1),
      audioPieceUrl('native-1', 2),
      audioPieceUrl('native-1', 'end', 3),
    ])
    expect(requests.at(-1)?.bytes).toBeNull()
    const floats = requests
      .slice(0, 3)
      .flatMap((request) => [...new Float32Array(request.bytes!.buffer.slice(request.bytes!.byteOffset))])
    expect(floats).toHaveLength(piece * 1.75 * 2)
    // Frame n is n on the left and on the right: the order and the interleaving survived.
    for (const frame of [0, 1, piece - 1, piece, piece * 1.5, piece * 1.75 - 1]) {
      expect(floats[frame * 2]).toBe(frame)
      expect(floats[frame * 2 + 1]).toBe(frame)
    }
  })

  it('sends nothing for a project with no sound', async () => {
    const { requests, doFetch } = recorder()
    const sent = await sendProjectMix(COMPOSITION, {
      jobId: 'native-2',
      mix: mixOf([100], false),
      fetch: doFetch,
    })
    expect(sent).toBeNull()
    expect(requests).toEqual([])
  })

  it('sends nothing when the mix turns out empty', async () => {
    const { requests, doFetch } = recorder()
    expect(
      await sendProjectMix(COMPOSITION, { jobId: 'native-3', mix: mixOf([]), fetch: doFetch }),
    ).toBeNull()
    expect(requests).toEqual([])
  })

  it('stops at the shell’s refusal and says why', async () => {
    const { requests, doFetch } = recorder(2)
    await expect(
      sendProjectMix(COMPOSITION, {
        jobId: 'native-4',
        mix: mixOf([MIX_SAMPLE_RATE * PIECE_SECONDS * 3]),
        fetch: doFetch,
      }),
    ).rejects.toThrow(/400 the disk is full/)
    expect(requests).toHaveLength(2)
  })

  it('stops when the export is aborted, before the next piece', async () => {
    const abort = new AbortController()
    const { requests } = recorder()
    const doFetch = (async (url: string) => {
      requests.push({ url, bytes: null })
      abort.abort()
      return new Response('{}')
    }) as unknown as typeof fetch
    await expect(
      sendProjectMix(COMPOSITION, {
        jobId: 'native-5',
        mix: mixOf([MIX_SAMPLE_RATE * PIECE_SECONDS * 3]),
        fetch: doFetch,
        signal: abort.signal,
      }),
    ).rejects.toThrow(/cancelled/)
    expect(requests).toHaveLength(1)
  })

  it('refuses a mix that is not stereo at 48 kHz', async () => {
    const odd: ProjectMix = {
      async hasAudio() {
        return true
      },
      async *windows() {
        yield { samples: [new Float32Array(10)], sampleRate: 44_100, channels: 1 }
      },
    }
    await expect(
      sendProjectMix(COMPOSITION, { jobId: 'native-6', mix: odd, fetch: recorder().doFetch }),
    ).rejects.toThrow(/1 channels at 44100 Hz/)
  })

  it('speaks the URLs the shell parses', () => {
    expect(shell.parseAudioUrl(audioPieceUrl('native-7', 3), 'droneclean-encode')).toEqual({
      ok: true,
      jobId: 'native-7',
      part: 3,
      chunks: null,
    })
    expect(shell.parseAudioUrl(audioPieceUrl('native-7', 'end', 9), 'droneclean-encode')).toEqual({
      ok: true,
      jobId: 'native-7',
      part: 'end',
      chunks: 9,
    })
  })
})
