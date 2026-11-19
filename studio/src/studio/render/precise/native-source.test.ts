// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { NativeEngineError, preciseFrameBytes, preciseFramePts, type ColourTags } from './contract'
import {
  NATIVE_SOURCE_PREFETCH,
  createFrameSlot,
  createFrameSlotPool,
  nativeMediaBridge,
  readFrameBody,
  startNativeSource,
  type NativeMediaBridge,
  type NativeSourceOptions,
} from './native-source'

/**
 * Tests of the page side of the native decoder (`native-source.ts`): the frame
 * assembly against the contract's sizes, and the pipeline — prefetch, upload
 * through P3's pass, publication in P0's registry — with the shell's bridge, the
 * `fetch` of the frame scheme and the `GPUDevice` replaced by the smallest fakes
 * that answer. The real GPU and the real FFmpeg are
 * `desktop/test/native-decode-harness/`'s job.
 */

const WIDTH = 4
const HEIGHT = 2
const FRAME_BYTES = preciseFrameBytes('gbrp10le', WIDTH, HEIGHT)

const COLOUR: ColourTags = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }
const RATE = { num: 60000, den: 1001 }

/** One frame's bytes, every byte saying which frame it is. */
function frameOf(index: number, bytes = FRAME_BYTES): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes).fill(index)
}

interface FakeTexture {
  readonly label: string | undefined
  readonly format: string
  readonly width: number
  readonly height: number
  destroyed: boolean
  createView(): unknown
  destroy(): void
}

/** A `GPUDevice` that records what P3's pass creates and uploads, and does nothing else. */
function fakeDevice() {
  const textures: FakeTexture[] = []
  const writes: Array<{ bytes: number; first: number }> = []
  const device = {
    createTexture(descriptor: { label?: string; format: string; size: { width: number; height: number } }) {
      const texture: FakeTexture = {
        label: descriptor.label,
        format: descriptor.format,
        width: descriptor.size.width,
        height: descriptor.size.height,
        destroyed: false,
        createView: () => ({}),
        destroy() {
          texture.destroyed = true
        },
      }
      textures.push(texture)
      return texture
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
      finish: () => ({}),
    }),
    queue: {
      writeTexture(_destination: unknown, data: Uint8Array) {
        writes.push({ bytes: data.byteLength, first: data[0] ?? -1 })
      },
      submit() {},
    },
  }
  return { device: device as unknown as GPUDevice, textures, writes }
}

/** The shell's side of the IPC, answering one fixed reply and recording cancels. */
function fakeBridge({
  frameBytes = FRAME_BYTES,
  width = WIDTH,
  height = HEIGHT,
  format = 'gbrp10le' as 'gbrp10le' | 'p010le',
  colour = COLOUR,
} = {}) {
  const cancelled: string[] = []
  const startDecode = vi.fn(async () => ({
    ok: true as const,
    value: { width, height, rate: RATE, colour, format, frameBytes },
  }))
  const nativeMedia = {
    startDecode,
    capabilities: vi.fn(),
    cancel: vi.fn((request: { jobId: string }) => {
      cancelled.push(request.jobId)
    }),
    onProgress: vi.fn(),
  } as unknown as NativeMediaBridge
  return { nativeMedia, startDecode, cancelled }
}

/** The preload's bridge, as the page reads it. */
function installBridge(nativeMedia: NativeMediaBridge): void {
  vi.stubGlobal('window', {
    dronecleanDesktop: {
      version: 1,
      platform: 'darwin',
      getPathForFile: () => '',
      nativeMedia,
    },
  })
}

/** `fetch` for the frame scheme: one frame per URL, or the 410 of the given index. */
function installFrames({ failAt }: { failAt?: number } = {}) {
  const started: number[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const index = Number(url.slice(url.lastIndexOf('/') + 1))
    started.push(index)
    if (index === failAt) {
      return new Response(`frame ${index} is past the ${index} this job decodes\n`, { status: 410 })
    }
    return new Response(frameOf(index), { status: 200 })
  })
  return { started }
}

function options(overrides: Partial<NativeSourceOptions> = {}): NativeSourceOptions {
  return {
    device: fakeDevice().device,
    file: '/Volumes/Media/clip.mp4',
    startSeconds: 1.001,
    frames: 5,
    startIndex: 60,
    jobId: 'decode-test',
    format: 'gbrp10le',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// The WebGPU constants P3's pass reads; a real device has them, Node does not.
beforeEach(() => {
  vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 })
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
})

describe('readFrameBody', () => {
  it('assembles one frame from the body’s chunks, in order', async () => {
    const chunks = [frameOf(9).subarray(0, 8), frameOf(9).subarray(8, 40), frameOf(9).subarray(40)]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const bytes = await readFrameBody(new Response(body), FRAME_BYTES)
    expect([...bytes]).toEqual([...frameOf(9)])
  })

  it('refuses a short frame rather than uploading it shifted', async () => {
    await expect(readFrameBody(new Response(frameOf(0, 47)), FRAME_BYTES)).rejects.toThrow(
      `the frame is 47 of the ${FRAME_BYTES} bytes it must be`,
    )
  })

  it('refuses a body longer than the contract’s frame', async () => {
    await expect(readFrameBody(new Response(frameOf(0, 49)), FRAME_BYTES)).rejects.toThrow(
      `longer than the ${FRAME_BYTES} bytes the contract fixes`,
    )
  })

  it('refuses a response with no body at all', async () => {
    await expect(readFrameBody(new Response(null), FRAME_BYTES)).rejects.toThrow(
      `a ${FRAME_BYTES}-byte frame had no body`,
    )
  })
})

describe('nativeMediaBridge', () => {
  it('is an error, not silence, outside the desktop shell', () => {
    expect(() => nativeMediaBridge()).toThrow(/needs the desktop app/)
  })

  it('is the preload’s member inside it', () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    expect(nativeMediaBridge()).toBe(nativeMedia)
  })
})

describe('startNativeSource', () => {
  it('keeps three frames in flight and one more issued for the frame handed over', async () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    const { started } = installFrames()

    const source = await startNativeSource(options())
    expect(NATIVE_SOURCE_PREFETCH).toBe(3)
    const iterator = source[Symbol.asyncIterator]()
    await iterator.next()
    // Three are prefetched before the first frame, and the next is asked for as
    // soon as it is handed over: the decoder is never idle between frames.
    expect(started).toEqual([0, 1, 2, 3])
    await iterator.return?.(undefined)
  })

  it('uploads every frame through P3’s pass and hands each one over as the pass’s source texture', async () => {
    const { nativeMedia, startDecode, cancelled } = fakeBridge()
    installBridge(nativeMedia)
    installFrames()
    const { device, textures, writes } = fakeDevice()

    const source = await startNativeSource(options({ device }))
    const frames = []
    for await (const frame of source) frames.push(frame)

    expect(startDecode).toHaveBeenCalledWith({
      jobId: 'decode-test',
      file: '/Volumes/Media/clip.mp4',
      startSeconds: 1.001,
      frames: 5,
      format: 'gbrp10le',
    })
    expect(source.frameBytes).toBe(FRAME_BYTES)
    expect(source.reply.rate).toEqual(RATE)

    // The exact source frames, at the source's rate, a duration of one frame each.
    expect(frames.map((frame) => frame.frame.index)).toEqual([60, 61, 62, 63, 64])
    expect(frames.map((frame) => frame.frame.rate)).toEqual(Array.from({ length: 5 }, () => RATE))
    expect(frames.map((frame) => frame.frame.durationFrames)).toEqual([1, 1, 1, 1, 1])
    expect(preciseFramePts(frames[1]!.frame)).toBe(61_061)
    expect(frames[0]!.colour).toEqual(COLOUR)

    // Three planes uploaded per frame, each the size the contract's layout gives,
    // and the first plane's first byte says which frame it is.
    expect(writes).toHaveLength(15)
    for (let index = 0; index < 5; index += 1) {
      expect(writes.slice(index * 3, index * 3 + 3)).toEqual([
        { bytes: (WIDTH * HEIGHT * 2), first: index },
        { bytes: (WIDTH * HEIGHT * 2), first: index },
        { bytes: (WIDTH * HEIGHT * 2), first: index },
      ])
    }

    // Every frame handed over is the pass's rgba16float source texture: no registry in between
    // (design 3.6 section 2.4, finding R3), the caller owns what it does with it.
    const sourceTexture = textures.find((texture) => texture.format === 'rgba16float')
    expect(sourceTexture).toBeDefined()
    expect(frames.every((frame) => frame.texture === (sourceTexture as unknown as GPUTexture))).toBe(true)

    // The last frame is handed over, then the decode is cancelled: the shell kills
    // FFmpeg instead of leaving it at the end of its range.
    expect(cancelled).toEqual(['decode-test'])
  })

  it('derives the first source index from the start time and the reported rate', async () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    installFrames()
    const source = await startNativeSource(
      options({ startIndex: undefined, startSeconds: 1.001, frames: 1 }),
    )
    const first = await source[Symbol.asyncIterator]().next()
    expect(first.value?.frame.index).toBe(60)
  })

  it('fails the iteration with the shell’s 410 and its reason', async () => {
    const { nativeMedia, cancelled } = fakeBridge()
    installBridge(nativeMedia)
    installFrames({ failAt: 3 })

    const source = await startNativeSource(options({ frames: 4 }))
    const received: number[] = []
    const failure = await (async () => {
      try {
        for await (const frame of source) received.push(frame.frame.index)
        return null
      } catch (error) {
        return error
      }
    })()

    expect(failure).toBeInstanceOf(NativeEngineError)
    expect((failure as Error).message).toContain('frame 3: 410 frame 3 is past the 3 this job decodes')
    expect(received).toEqual([60, 61, 62])
    expect(cancelled).toEqual(['decode-test'])
  })

  it('refuses a reply whose frame length disagrees with the contract, and stops the decode', async () => {
    const { nativeMedia, cancelled } = fakeBridge({ frameBytes: FRAME_BYTES - 1 })
    installBridge(nativeMedia)
    installFrames()

    await expect(startNativeSource(options())).rejects.toThrow(
      `the shell reports ${FRAME_BYTES - 1}-byte frames, the contract ${FRAME_BYTES} for 4x2 gbrp10le`,
    )
    expect(cancelled).toEqual(['decode-test'])
  })

  it('rejects when the shell refuses to start, with the contract’s error', async () => {
    const { nativeMedia } = fakeBridge()
    nativeMedia.startDecode = vi.fn(async () => ({
      ok: false as const,
      error: {
        message: 'no FFmpeg binary',
        command: [],
        exitCode: null,
        signal: null,
        log: ['ffmpeg: not found'],
      },
    })) as unknown as NativeMediaBridge['startDecode']
    installBridge(nativeMedia)

    const failure = await startNativeSource(options()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(NativeEngineError)
    expect((failure as NativeEngineError).log).toEqual(['ffmpeg: not found'])
  })

  it('destroy releases the pass’s textures and stops the decode', async () => {
    const { nativeMedia, cancelled } = fakeBridge()
    installBridge(nativeMedia)
    installFrames()
    const { device, textures } = fakeDevice()

    const source = await startNativeSource(options({ device, frames: 1 }))
    await source[Symbol.asyncIterator]().next()
    source.destroy()

    expect(textures.every((texture) => texture.destroyed)).toBe(true)
    expect(cancelled).toEqual(['decode-test'])
  })
})

describe('the frame slots (BYOB read)', () => {
  it('reads a frame into the slot and returns a view of it, chunk by chunk', async () => {
    const slot = createFrameSlot(FRAME_BYTES)
    const whole = frameOf(5)
    const body = new ReadableStream({
      type: 'bytes',
      start(controller) {
        controller.enqueue(whole.slice(0, 7))
        controller.enqueue(whole.slice(7, 33))
        controller.enqueue(whole.slice(33))
        controller.close()
      },
    })
    const bytes = await readFrameBody(new Response(body), FRAME_BYTES, slot)
    expect(bytes.byteLength).toBe(FRAME_BYTES)
    expect([...bytes]).toEqual([...whole])
    // The same memory as the slot, not a copy.
    expect(bytes.buffer).toBe(slot.bytes.buffer)
  })

  it('reuses the slot for the next frame', async () => {
    const slot = createFrameSlot(FRAME_BYTES)
    const first = await readFrameBody(new Response(frameOf(1)), FRAME_BYTES, slot)
    expect(first[0]).toBe(1)
    const second = await readFrameBody(new Response(frameOf(2)), FRAME_BYTES, slot)
    expect(second[0]).toBe(2)
    expect(second.buffer).toBe(slot.bytes.buffer)
  })

  it('still refuses a short frame and a long one', async () => {
    const slot = createFrameSlot(FRAME_BYTES)
    await expect(readFrameBody(new Response(frameOf(0, 47)), FRAME_BYTES, slot)).rejects.toThrow(
      `the frame is 47 of the ${FRAME_BYTES} bytes it must be`,
    )
    await expect(readFrameBody(new Response(frameOf(0, 49)), FRAME_BYTES, slot)).rejects.toThrow(
      `longer than the ${FRAME_BYTES} bytes the contract fixes`,
    )
    // A refused read leaves the slot usable.
    const ok = await readFrameBody(new Response(frameOf(3)), FRAME_BYTES, slot)
    expect(ok[0]).toBe(3)
  })

  it('falls back to a plain reader when the body is not a byte stream', async () => {
    const slot = createFrameSlot(FRAME_BYTES)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(frameOf(4).subarray(0, 20))
        controller.enqueue(frameOf(4).subarray(20))
        controller.close()
      },
    })
    const bytes = await readFrameBody(new Response(body), FRAME_BYTES, slot)
    expect([...bytes]).toEqual([...frameOf(4)])
    expect(bytes.buffer).toBe(slot.bytes.buffer)
  })

  it('refuses a slot too small for the frame', async () => {
    await expect(
      readFrameBody(new Response(frameOf(0)), FRAME_BYTES, { bytes: new Uint8Array(FRAME_BYTES) }),
    ).rejects.toThrow(/cannot hold/)
  })

  it('allocates no frame-sized buffer per frame: a 12-frame decode creates the 4 slots and no more', async () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    const { device, writes } = fakeDevice()
    // The shell's frames are built before the count starts: the test's own buffers are not the decoder's.
    const shellFrames = Array.from({ length: 12 }, (_, index) => frameOf(index))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      return new Response(shellFrames[Number(url.slice(url.lastIndexOf('/') + 1))]!.slice(), {
        status: 200,
      })
    })
    const RealUint8Array = Uint8Array
    let frameSized = 0
    vi.stubGlobal(
      'Uint8Array',
      new Proxy(RealUint8Array, {
        construct(target, args, newTarget) {
          // Only the decoder's own allocations count: the fake Response copies its body, as a real one does.
          const ours = new Error().stack?.split('\n')[2]?.includes('/render/precise/native-source.ts') === true
          if (ours && typeof args[0] === 'number' && args[0] >= FRAME_BYTES) frameSized += 1
          return Reflect.construct(target, args, newTarget)
        },
      }),
    )

    const source = await startNativeSource(options({ device, frames: 12 }))
    const indices: number[] = []
    for await (const frame of source) indices.push(frame.frame.index)
    vi.unstubAllGlobals()

    expect(indices).toHaveLength(12)
    expect(frameSized).toBe(NATIVE_SOURCE_PREFETCH + 1)
    // Every frame arrived intact through a reused slot: the first byte of each plane says which frame it is.
    expect(writes.filter((_, i) => i % 3 === 0).map((write) => write.first)).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    )
  })
})

describe('p010le, the compact format (design 3.6 section 2.16)', () => {
  const P010_BYTES = preciseFrameBytes('p010le', WIDTH, HEIGHT)

  it('is asked for by default, and each frame goes through the GPU conversion: two planes, no FFmpeg conversion', async () => {
    const { nativeMedia, startDecode } = fakeBridge({ format: 'p010le', frameBytes: P010_BYTES })
    installBridge(nativeMedia)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      return new Response(frameOf(Number(url.slice(url.lastIndexOf('/') + 1)), P010_BYTES), { status: 200 })
    })
    const { device, textures, writes } = fakeDevice()
    const source = await startNativeSource(options({ device, frames: 3, format: undefined }))
    const indices: number[] = []
    for await (const frame of source) indices.push(frame.frame.index)

    expect(startDecode).toHaveBeenCalledWith(expect.objectContaining({ format: 'p010le' }))
    expect(source.format).toBe('p010le')
    expect(source.frameBytes).toBe(P010_BYTES)
    expect(indices).toEqual([60, 61, 62])
    expect(textures.map((texture) => texture.format)).toEqual(['r16uint', 'rg16uint', 'rgba16float'])
    // Luma (4x2 words) and chroma (2x1 pairs) per frame, each frame's own bytes.
    expect(writes).toEqual(
      [0, 1, 2].flatMap((index) => [
        { bytes: WIDTH * HEIGHT * 2, first: index },
        { bytes: WIDTH * 2, first: index },
      ]),
    )
  })

  it('takes gbrp10le when the shell answers it (a source p010le cannot carry), through P3’s pass', async () => {
    const { nativeMedia } = fakeBridge({ format: 'gbrp10le' })
    installBridge(nativeMedia)
    installFrames()
    const { device, writes } = fakeDevice()
    const source = await startNativeSource(options({ device, frames: 1, format: 'p010le' }))
    for await (const frame of source) void frame
    expect(source.format).toBe('gbrp10le')
    expect(writes).toHaveLength(3)
  })

  it('refuses p010le for a source the GPU pass does not convert, and stops the decode', async () => {
    const { nativeMedia, cancelled } = fakeBridge({
      format: 'p010le',
      frameBytes: P010_BYTES,
      colour: { ...COLOUR, range: 'pc' },
    })
    installBridge(nativeMedia)
    await expect(startNativeSource(options({ format: 'p010le' }))).rejects.toThrow(
      /sends p010le for a bt709 pc-range source/,
    )
    expect(cancelled).toEqual(['decode-test'])
  })

  it('hands the raw bytes over once, and only once', async () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    installFrames()
    const source = await startNativeSource(options({ frames: 2 }))
    const raw = source.raw()
    const first = await raw.next()
    expect(first.value?.bytes[0]).toBe(0)
    expect(first.value?.frame.index).toBe(60)
    expect(() => source.raw()).toThrow(/can be read once/)
    await raw.return?.(undefined)
  })
})

describe('the slot pool', () => {
  it('lends the slots of one decode to the next: two decodes allocate four slots between them', async () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    installFrames()
    const pool = createFrameSlotPool()
    for (const jobId of ['decode-a', 'decode-b']) {
      const source = await startNativeSource(options({ frames: 6, jobId, slots: pool }))
      const raw = source.raw()
      for (let step = await raw.next(); step.done !== true; step = await raw.next()) void step
    }
    expect(pool.allocated).toBe(NATIVE_SOURCE_PREFETCH + 1)
  })

  it('takes back the slots of an abandoned decode only once their reads have settled', async () => {
    const { nativeMedia } = fakeBridge()
    installBridge(nativeMedia)
    const releases: Array<() => void> = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      const index = Number(url.slice(url.lastIndexOf('/') + 1))
      // Frame 0 answers at once, the others when the test lets them.
      if (index > 0) await new Promise<void>((resolve) => releases.push(resolve))
      return new Response(frameOf(index), { status: 200 })
    })
    const pool = createFrameSlotPool()
    const source = await startNativeSource(options({ frames: 6, slots: pool }))
    const raw = source.raw()
    await raw.next()
    await raw.return?.(undefined)
    // The frame handed over is back at once; reads 1..3 are still in flight, so their slots are not the pool's to
    // lend yet and a second take allocates.
    pool.take(FRAME_BYTES)
    expect(pool.allocated).toBe(NATIVE_SOURCE_PREFETCH + 1)
    pool.take(FRAME_BYTES)
    expect(pool.allocated).toBe(NATIVE_SOURCE_PREFETCH + 2)
    for (const release of releases) release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let i = 0; i < NATIVE_SOURCE_PREFETCH; i += 1) pool.take(FRAME_BYTES)
    expect(pool.allocated).toBe(NATIVE_SOURCE_PREFETCH + 2)
  })
})
