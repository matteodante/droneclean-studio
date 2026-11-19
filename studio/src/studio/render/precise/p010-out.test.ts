// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { preciseReadbackBytes, NativeEngineError, type ColourTags } from './contract'
import { p010PixelReference } from './p010-in'
import {
  P010_OUT_WGSL,
  P010_READBACK_RING,
  createP010OutPass,
  openNativeEncodeStream,
  p010CodesReference,
  startNativeEncode,
  type NativeEncodeBridge,
} from './p010-out'

const BT709: ColourTags = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }
const RATE = { num: 60000, den: 1001 }

describe('the packing is the inverse of the decode', () => {
  it('gives back every code a decoded pixel came from', () => {
    for (const y of [300, 502, 700, 940, 1000]) {
      for (const cb of [420, 512, 600]) {
        for (const cr of [430, 512, 610]) {
          const [r, g, b] = p010PixelReference(y, cb, cr, BT709)
          expect(p010CodesReference(r, g, b)).toEqual([y, cb, cr])
        }
      }
    }
  })

  it('puts the decode’s white (1020 of 1023) on code 940, and keeps 1.0 and above as super-white', () => {
    const white = 1020 / 1023
    expect(p010CodesReference(white, white, white)).toEqual([940, 512, 512])
    expect(p010CodesReference(1, 1, 1)[0]).toBe(943)
    expect(p010CodesReference(1.2, 1.2, 1.2)[0]).toBe(1023)
    expect(p010CodesReference(-0.1, -0.1, -0.1)[0]).toBe(0)
  })

  it('writes the same constants into the shader, codes in the top ten bits', () => {
    expect(P010_OUT_WGSL).toContain(`dot(rgb, K) * ${(1023 * 219) / 255}`)
    expect(P010_OUT_WGSL).toContain('<< 6u')
    expect(P010_OUT_WGSL).toContain('override WIDTH: u32;')
  })
})

interface FakePicture {
  readonly width: number
  readonly height: number
  readonly tag: number
  createView(): { of: FakePicture }
}

interface FakeBuffer {
  readonly label: string
  readonly size: number
  content: number
  mapped: boolean
  destroyed: boolean
  mapAsync(): Promise<void>
  getMappedRange(): ArrayBuffer
  unmap(): void
  destroy(): void
}

/** A device whose pack writes the picture's tag into every byte of the storage buffer, so a frame says which it is. */
function fakeDevice() {
  const buffers: FakeBuffer[] = []
  /** Which buffer a mapped range belongs to, so a test can ask whether it is still mapped. */
  const rangeOwner = new WeakMap<ArrayBuffer, FakeBuffer>()
  const dispatches: Array<[number, number]> = []
  let packedTag = -1
  const device = {
    createBuffer(descriptor: { label: string; size: number }) {
      const buffer: FakeBuffer = {
        label: descriptor.label,
        size: descriptor.size,
        content: -1,
        mapped: false,
        destroyed: false,
        async mapAsync() {
          await Promise.resolve()
          buffer.mapped = true
        },
        getMappedRange() {
          if (!buffer.mapped) throw new Error('not mapped')
          const range = new Uint8Array(buffer.size).fill(buffer.content).buffer
          rangeOwner.set(range, buffer)
          return range
        },
        unmap() {
          buffer.mapped = false
        },
        destroy() {
          buffer.destroyed = true
        },
      }
      buffers.push(buffer)
      return buffer
    },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createComputePipeline: () => ({}),
    createBindGroup: (descriptor: { entries: Array<{ resource: { of?: FakePicture } }> }) => ({
      picture: descriptor.entries[0]!.resource.of,
    }),
    createCommandEncoder() {
      const steps: Array<() => void> = []
      return {
        beginComputePass: () => {
          let picture: FakePicture | undefined
          return {
            setPipeline() {},
            setBindGroup(_index: number, group: { picture: FakePicture }) {
              picture = group.picture
            },
            dispatchWorkgroups(x: number, y: number) {
              dispatches.push([x, y])
              const tag = picture!.tag
              steps.push(() => {
                packedTag = tag
              })
            },
            end() {},
          }
        },
        copyBufferToBuffer(_source: FakeBuffer, _o: number, target: FakeBuffer) {
          steps.push(() => {
            target.content = packedTag
          })
        },
        finish: () => steps,
      }
    },
    queue: {
      submit(lists: Array<Array<() => void>>) {
        for (const steps of lists) for (const step of steps) step()
      },
    },
  }
  return { device: device as unknown as GPUDevice, buffers, dispatches, rangeOwner }
}

const picture = (tag: number, width = 4, height = 2): FakePicture => {
  const p: FakePicture = { width, height, tag, createView: () => ({ of: p }) }
  return p
}

/**
 * `fetch` for the encode scheme: reads the whole body, chunk by chunk as the network stack does (a chunk is taken whole
 * before the next is asked for), then answers like the shell. `onChunk` sees each chunk while it is being read.
 */
function fakeEncoder(
  answer?: (frames: Uint8Array[]) => Response,
  onChunk?: (chunk: Uint8Array, at: number) => void,
) {
  const received: { url?: string; init?: RequestInit; frames: Uint8Array[] } = { frames: [] }
  const fetchFake = (async (url: string, init: RequestInit) => {
    received.url = url
    received.init = init
    const reader = (init.body as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk?.(value, received.frames.length)
      received.frames.push(value.slice())
    }
    return (
      answer?.(received.frames) ??
      new Response(
        JSON.stringify({ framesWritten: received.frames.length, path: '/out/clip.mp4' }),
        { status: 200 },
      )
    )
  }) as unknown as typeof fetch
  return { fetchFake, received }
}

describe('the pack pass', () => {
  it('writes 3 bytes a pixel and dispatches one invocation per 2x2 block', () => {
    const { device, buffers, dispatches } = fakeDevice()
    const pass = createP010OutPass(device, 40, 20)
    expect(pass.frameBytes).toBe(preciseReadbackBytes('p010le', 40, 20))
    expect(buffers[0]!.size).toBe(40 * 20 * 3)
    const encoder = device.createCommandEncoder()
    pass.encode(encoder, picture(0, 40, 20) as unknown as GPUTexture)
    expect(dispatches).toEqual([[3, 2]])
  })

  it('refuses an odd size, and a picture of another size', () => {
    const { device } = fakeDevice()
    expect(() => createP010OutPass(device, 41, 20)).toThrow(/must be even/)
    const pass = createP010OutPass(device, 4, 2)
    expect(() =>
      pass.encode(device.createCommandEncoder(), picture(0, 8, 2) as unknown as GPUTexture),
    ).toThrow(/the picture is 8x2, the export 4x2/)
  })
})

describe('the encode stream', () => {
  const frameBytes = preciseReadbackBytes('p010le', 4, 2)

  it('streams every frame, in order, to the job’s URL, and allocates nothing after it opens', async () => {
    const { device, buffers, rangeOwner } = fakeDevice()
    // The body is the mapped memory itself: a chunk's buffer stays mapped while the next two are read.
    const sentFrom: FakeBuffer[] = []
    const { fetchFake, received } = fakeEncoder(undefined, (chunk, at) => {
      const owner = rangeOwner.get(chunk.buffer as ArrayBuffer)!
      expect(owner.mapped).toBe(true)
      sentFrom.push(owner)
      if (at >= 1) expect(sentFrom[at - 1]!.mapped).toBe(true)
    })
    const sink = openNativeEncodeStream({
      device,
      jobId: 'encode-1',
      width: 4,
      height: 2,
      frameBytes,
      fetch: fetchFake,
    })
    const opened = sink.counters.allocations
    expect(opened).toBe(1 + P010_READBACK_RING)
    for (let index = 0; index < 9; index += 1) {
      await sink.deliver(picture(index + 1) as unknown as GPUTexture, {
        index,
        rate: RATE,
        durationFrames: 1,
      })
    }
    const reply = await sink.finish()

    expect(reply).toEqual({ framesWritten: 9, path: '/out/clip.mp4' })
    expect(received.url).toBe('droneclean-encode://encode/encode-1')
    expect(received.init?.method).toBe('POST')
    expect(
      received.frames.map((frame) => [frame.byteLength, frame[0], frame[frameBytes - 1]]),
    ).toEqual(Array.from({ length: 9 }, (_, index) => [frameBytes, index + 1, index + 1]))
    expect(sink.counters).toEqual({ framesDelivered: 9, framesSent: 9, allocations: opened })
    expect(buffers).toHaveLength(1 + P010_READBACK_RING)
    expect(buffers.every((buffer) => buffer.destroyed)).toBe(true)
  })

  it('refuses a frame out of order: the file would be wrong', async () => {
    const { device } = fakeDevice()
    const { fetchFake } = fakeEncoder()
    const sink = openNativeEncodeStream({
      device,
      jobId: 'encode-2',
      width: 4,
      height: 2,
      frameBytes,
      fetch: fetchFake,
    })
    await sink.deliver(picture(1) as unknown as GPUTexture, {
      index: 0,
      rate: RATE,
      durationFrames: 1,
    })
    await expect(
      sink.deliver(picture(3) as unknown as GPUTexture, {
        index: 2,
        rate: RATE,
        durationFrames: 1,
      }),
    ).rejects.toThrow(/frame 2 was delivered where frame 1 is next/)
    sink.cancel()
  })

  it('turns the shell’s failure into the contract’s error, with its log', async () => {
    const { device } = fakeDevice()
    const { fetchFake } = fakeEncoder(
      () =>
        new Response(
          JSON.stringify({
            message: 'the encoder stopped after 1 frames',
            command: ['ffmpeg'],
            exitCode: 1,
            signal: null,
            log: ['x'],
          }),
          { status: 500 },
        ),
    )
    const sink = openNativeEncodeStream({
      device,
      jobId: 'encode-3',
      width: 4,
      height: 2,
      frameBytes,
      fetch: fetchFake,
    })
    await sink.deliver(picture(1) as unknown as GPUTexture, {
      index: 0,
      rate: RATE,
      durationFrames: 1,
    })
    const failure = await sink.finish().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(NativeEngineError)
    expect((failure as NativeEngineError).log).toEqual(['x'])
  })

  it('refuses a job whose frame length is not the packing’s, and cancels it', () => {
    const { device } = fakeDevice()
    const cancelled: string[] = []
    expect(() =>
      openNativeEncodeStream({
        device,
        jobId: 'encode-4',
        width: 4,
        height: 2,
        frameBytes: frameBytes + 2,
        cancel: () => cancelled.push('encode-4'),
      }),
    ).toThrow(/the shell takes 26-byte frames, the packing makes 24/)
    expect(cancelled).toEqual(['encode-4'])
  })

  it('starts the job through the shell asking for p010le, and refuses a shell that answers another readback', async () => {
    const { device } = fakeDevice()
    const requests: unknown[] = []
    const cancels: string[] = []
    const bridge: NativeEncodeBridge = {
      async encodeStart(request) {
        requests.push(request)
        return { ok: true, value: { readback: 'rgba64le', frameBytes: 64 } }
      },
      cancel: (request) => cancels.push(request.jobId),
    }
    await expect(
      startNativeEncode({
        device,
        path: '/out/clip.mp4',
        format: 'hevc-main10',
        bitrate: 120_000_000,
        fps: RATE,
        width: 4,
        height: 2,
        jobId: 'encode-5',
        bridge,
      }),
    ).rejects.toThrow(/the shell takes rgba64le, and the GPU packs p010le/)
    expect(requests).toEqual([
      expect.objectContaining({
        jobId: 'encode-5',
        readback: 'p010le',
        format: 'hevc-main10',
        width: 4,
        height: 2,
      }),
    ])
    expect(cancels).toEqual(['encode-5'])
  })
})
