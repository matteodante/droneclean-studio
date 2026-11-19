// The page's half of a native 10-bit export (`native-export.ts`) and the decode relay it serves to the worker
// (`native-relay.ts`), through a real `MessageChannel`.

import { describe, expect, it, vi } from 'vite-plus/test'
import { NO_FILE_PATH } from '@/studio/render/frames/backends/native'
import { NativeEngineError } from '@/studio/render/precise/contract'
import { SourceError } from '@/studio/render/source-error'
import type { CompositionInputProps } from '@/types/export'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { openNativeExport, type NativeShellBridge } from './native-export'
import { createRelayedNativeMedia, serveNativeMedia } from './native-relay'

const TARGET = { format: 'hevc-main10' as const, path: '/exports/flight.mp4', bitrate: 120_000_000 }

function clip(id: string, mediaId: string | undefined): VideoItem {
  return {
    id,
    type: 'video',
    label: id,
    mediaId,
    src: `blob:${id}`,
    from: 0,
    durationInFrames: 60,
  } as VideoItem
}

function composition(
  items: VideoItem[],
  size = { width: 3840, height: 2880 },
): CompositionInputProps {
  return {
    fps: 60000 / 1001,
    durationInFrames: 60,
    ...size,
    tracks: [{ id: 't1', items }],
  } as unknown as CompositionInputProps
}

function record(id: string, filePath?: string): MediaMetadata {
  return {
    id,
    fileName: `${id}.mp4`,
    storageType: 'path',
    ...(filePath === undefined ? {} : { filePath }),
  } as MediaMetadata
}

function fakeShell(overrides: Partial<NativeShellBridge> = {}) {
  const calls = { described: [] as string[][], encodes: [] as unknown[], cancelled: [] as string[] }
  const shell: NativeShellBridge = {
    startDecode: vi.fn(),
    cancel: (request) => calls.cancelled.push(request.jobId),
    async encodeStart(request) {
      calls.encodes.push(request)
      return {
        ok: true,
        value: { readback: 'p010le', frameBytes: request.width * request.height * 3 },
      }
    },
    async describeMedia(paths) {
      calls.described.push([...paths])
      return paths.map((path) => `/real${path}`)
    },
    ...overrides,
  }
  return { shell, calls }
}

describe('openNativeExport', () => {
  it('names every clip’s file to the shell, starts the encode at the project’s size and rate, and plans the worker’s run', async () => {
    const { shell, calls } = fakeShell()
    const opening = await openNativeExport(
      composition([clip('a', 'media-1'), clip('b', 'media-2'), clip('c', 'media-1')]),
      TARGET,
      {
        'media-1': record('media-1', '/clips/a.mp4'),
        'media-2': record('media-2', '/clips/b.mp4'),
      },
      shell,
      { relay: true },
    )
    expect(calls.described).toEqual([['/clips/a.mp4', '/clips/b.mp4']])
    expect(calls.encodes).toEqual([
      expect.objectContaining({
        path: '/exports/flight.mp4',
        format: 'hevc-main10',
        readback: 'p010le',
        bitrate: 120_000_000,
        fps: { num: 60000, den: 1001 },
        width: 3840,
        height: 2880,
        tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
      }),
    ])
    expect(opening.plan.paths).toEqual([
      ['media-1', '/real/clips/a.mp4'],
      ['media-2', '/real/clips/b.mp4'],
    ])
    expect(opening.plan.encode).toMatchObject({
      frameBytes: 3840 * 2880 * 3,
      width: 3840,
      height: 2880,
    })
    expect(opening.plan.encode.jobId).toMatch(/^native-/)
    expect(opening.plan.media).not.toBeNull()
    expect(opening.transfer).toEqual([opening.plan.media])
    opening.close()
  })

  it('stops with a SourceError for a clip whose media has no file on disk, before the encode starts', async () => {
    const { shell, calls } = fakeShell()
    const failure = await openNativeExport(
      composition([clip('a', 'media-1'), clip('Flight 2', 'media-2')]),
      TARGET,
      { 'media-1': record('media-1', '/clips/a.mp4'), 'media-2': record('media-2') },
      shell,
      { relay: false },
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(SourceError)
    expect(failure).toMatchObject({ clip: 'Flight 2', mediaId: 'media-2', reason: NO_FILE_PATH })
    expect(calls.encodes).toEqual([])
  })

  it('refuses an odd picture size: 4:2:0 has whole chroma blocks', async () => {
    const { shell } = fakeShell()
    await expect(
      openNativeExport(composition([], { width: 3841, height: 2160 }), TARGET, {}, shell, {
        relay: false,
      }),
    ).rejects.toThrow(/even picture size, the project is 3841x2160/)
  })

  it('rejects with the shell’s error when the encode does not start (a path no save dialog granted)', async () => {
    const { shell } = fakeShell({
      async encodeStart() {
        return {
          ok: false,
          error: {
            message: 'encode.start: not a path the user chose',
            command: [],
            exitCode: null,
            signal: null,
            log: [],
          },
        }
      },
    })
    const failure = await openNativeExport(composition([]), TARGET, {}, shell, {
      relay: false,
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(NativeEngineError)
  })

  it('cancels the encode on close unless the export completed', async () => {
    const first = fakeShell()
    const failed = await openNativeExport(composition([]), TARGET, {}, first.shell, {
      relay: false,
    })
    failed.close()
    failed.close()
    expect(first.calls.cancelled).toEqual([failed.plan.encode.jobId])

    const second = fakeShell()
    const done = await openNativeExport(composition([]), TARGET, {}, second.shell, { relay: false })
    done.completed()
    done.close()
    expect(second.calls.cancelled).toEqual([])
  })

  it('stages the project’s sound for the job id before the encode starts, and leaves it to the encode afterwards', async () => {
    const { shell, calls } = fakeShell()
    const order: string[] = []
    const original = shell.encodeStart
    shell.encodeStart = async (request) => {
      order.push(`encode ${request.jobId}`)
      return original(request)
    }
    const opening = await openNativeExport(composition([]), TARGET, {}, shell, {
      relay: false,
      sendAudio: async (jobId) => {
        order.push(`audio ${jobId}`)
        return true
      },
    })
    const { jobId } = opening.plan.encode
    expect(order).toEqual([`audio ${jobId}`, `encode ${jobId}`])
    expect(calls.cancelled).toEqual([])
  })

  it('cancels the job, which removes the staged sound, when the sound fails or the encode does not start', async () => {
    const failing = fakeShell()
    await expect(
      openNativeExport(composition([]), TARGET, {}, failing.shell, {
        relay: false,
        sendAudio: async () => {
          throw new Error('native audio: 400 the disk is full')
        },
      }),
    ).rejects.toThrow(/disk is full/)
    expect(failing.calls.encodes).toEqual([])
    expect(failing.calls.cancelled).toHaveLength(1)

    const refused = fakeShell({
      async encodeStart() {
        return {
          ok: false,
          error: { message: 'no FFmpeg', command: [], exitCode: null, signal: null, log: [] },
        }
      },
    })
    await expect(
      openNativeExport(composition([]), TARGET, {}, refused.shell, {
        relay: false,
        sendAudio: async () => true,
      }),
    ).rejects.toThrow(NativeEngineError)
    expect(refused.calls.cancelled).toHaveLength(1)
  })

  it('a project with no sound sends none and cancels nothing', async () => {
    const { shell, calls } = fakeShell({
      async encodeStart() {
        return {
          ok: false,
          error: { message: 'no FFmpeg', command: [], exitCode: null, signal: null, log: [] },
        }
      },
    })
    await expect(
      openNativeExport(composition([]), TARGET, {}, shell, {
        relay: false,
        sendAudio: async () => false,
      }),
    ).rejects.toThrow(NativeEngineError)
    expect(calls.cancelled).toEqual([])
  })
})

describe('the decode relay', () => {
  const request = {
    jobId: 'decode-1',
    file: '/clips/a.mp4',
    startSeconds: 0,
    frames: 10,
    format: 'p010le' as const,
  }
  const reply = {
    width: 4,
    height: 2,
    rate: { num: 30, den: 1 },
    colour: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' } as const,
    format: 'p010le' as const,
    frameBytes: 24,
  }

  it('starts a decode through the page’s bridge and passes its cancel on', async () => {
    const channel = new MessageChannel()
    const cancelled: string[] = []
    const stop = serveNativeMedia(channel.port1, {
      startDecode: async () => ({ ok: true, value: reply }),
      cancel: (asked) => cancelled.push(asked.jobId),
    })
    const relayed = createRelayedNativeMedia(channel.port2)
    expect(await relayed.startDecode(request)).toEqual({ ok: true, value: reply })
    relayed.cancel({ jobId: 'decode-1' })
    await vi.waitFor(() => expect(cancelled).toEqual(['decode-1']))
    relayed.destroy()
    stop()
  })

  it('answers a page failure as the contract’s payload, and refuses what is asked after the export ended', async () => {
    const channel = new MessageChannel()
    const stop = serveNativeMedia(channel.port1, {
      startDecode: async () => {
        throw new NativeEngineError({
          message: 'no FFmpeg',
          command: [],
          exitCode: null,
          signal: null,
          log: ['x'],
        })
      },
      cancel: () => {},
    })
    const relayed = createRelayedNativeMedia(channel.port2)
    expect(await relayed.startDecode(request)).toEqual({
      ok: false,
      error: { message: 'no FFmpeg', command: [], exitCode: null, signal: null, log: ['x'] },
    })
    relayed.destroy()
    expect(await relayed.startDecode(request)).toMatchObject({
      ok: false,
      error: { message: /ended/ },
    })
    stop()
  })
})
