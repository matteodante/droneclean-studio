// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { frameToSeconds, toRate } from '@/studio/time'
import { preciseFrameBytes, type ColourTags } from '@/studio/render/precise/contract'
import {
  createFrameSlotPool,
  type NativeSource,
  type NativeSourceOptions,
} from '@/studio/render/precise/native-source'
import type { FrameFile } from '../types'
import {
  NATIVE_MAX_STREAMS,
  NATIVE_RUN_FRAMES,
  NATIVE_SKIP_LIMIT,
  NO_FILE_PATH,
  createNativeBackend,
  nativeProviderOptions,
} from './native'
import { setNativeExportSession } from '@/studio/render/precise/native-session'
import { SourceError } from '@/studio/render/source-error'
import type { VideoItem } from '@/types/timeline'

const W = 4
const H = 2
const RATE = toRate(60000 / 1001)
const COLOUR: ColourTags = { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' }
const FILE: FrameFile = {
  key: 'source:/media/a.mp4',
  src: '/media/a.mp4',
  path: '/media/a.mp4',
  rate: RATE,
}
const OTHER: FrameFile = {
  key: 'source:/media/b.mp4',
  src: '/media/b.mp4',
  path: '/media/b.mp4',
  rate: RATE,
}

/** The shell's decoder, faked: frame `n`'s bytes all say `n % 256`; it records what was started and closed. */
function fakeShell(format: 'p010le' | 'gbrp10le' = 'p010le', rate = RATE) {
  const started: NativeSourceOptions[] = []
  const closed: number[] = []
  const reads: number[] = []
  const start = async (options: NativeSourceOptions): Promise<NativeSource> => {
    started.push(options)
    const id = started.length - 1
    const frameBytes = preciseFrameBytes(format, W, H)
    let k = 0
    const source = {
      jobId: `job-${id}`,
      reply: { width: W, height: H, rate, colour: COLOUR, format, frameBytes },
      width: W,
      height: H,
      format,
      frameBytes,
      colour: COLOUR,
      raw: () => ({
        async next() {
          const index = (options.startIndex ?? 0) + k
          k += 1
          reads.push(index)
          return {
            done: false as const,
            value: {
              bytes: new Uint8Array(frameBytes).fill(index % 256),
              frame: { index, rate, durationFrames: 1 },
            },
          }
        },
        async return() {
          return { done: true as const, value: undefined }
        },
      }),
      cancel() {},
      destroy() {
        closed.push(id)
      },
    }
    return source as unknown as NativeSource
  }
  return { start, started, closed, reads }
}

interface FakeTexture {
  readonly label?: string
  readonly format: string
  readonly width: number
  readonly height: number
  destroyed: boolean
  createView(): { of: FakeTexture }
  destroy(): void
}

/** A device that records textures, plane uploads and draws (target and source of each). */
function fakeDevice() {
  const textures: FakeTexture[] = []
  const uploads: Array<{ texture: string | undefined; first: number }> = []
  const draws: Array<{ to: FakeTexture; from?: FakeTexture }> = []
  const device = {
    lost: new Promise<never>(() => {}),
    createTexture(descriptor: {
      label?: string
      format: string
      size: { width: number; height: number }
    }) {
      const texture: FakeTexture = {
        label: descriptor.label,
        format: descriptor.format,
        width: descriptor.size.width,
        height: descriptor.size.height,
        destroyed: false,
        createView: () => ({ of: texture }),
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
    createBindGroup: (descriptor: { entries: Array<{ resource: { of?: FakeTexture } }> }) => ({
      from: descriptor.entries[0]?.resource.of,
    }),
    createCommandEncoder: () => {
      const recorded: Array<{ to: FakeTexture; from?: FakeTexture }> = []
      return {
        beginRenderPass(descriptor: { colorAttachments: Array<{ view: { of: FakeTexture } }> }) {
          const draw: { to: FakeTexture; from?: FakeTexture } = {
            to: descriptor.colorAttachments[0]!.view.of,
          }
          recorded.push(draw)
          return {
            setPipeline() {},
            setBindGroup(_index: number, group: { from?: FakeTexture }) {
              draw.from = group.from
            },
            draw() {},
            end() {},
          }
        },
        finish: () => recorded,
      }
    },
    queue: {
      writeTexture(destination: { texture: FakeTexture }, data: Uint8Array) {
        uploads.push({ texture: destination.texture.label, first: data[0] ?? -1 })
      },
      submit(lists: Array<Array<{ to: FakeTexture; from?: FakeTexture }>>) {
        for (const list of lists) draws.push(...list)
      },
    },
  }
  return { device: device as unknown as GPUDevice, textures, uploads, draws }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the native backend', () => {
  it('reads frames in order off one decode, started half a frame early and as long as the file', async () => {
    const shell = fakeShell()
    const slots = createFrameSlotPool()
    const backend = createNativeBackend(fakeDevice().device, { start: shell.start, slots })
    const decoded = []
    for (const index of [100, 101, 102]) decoded.push(await backend.decode(FILE, index))
    expect(decoded.map((frame) => frame.index)).toEqual([100, 101, 102])
    expect(shell.started).toHaveLength(1)
    expect(shell.started[0]).toMatchObject({
      file: '/media/a.mp4',
      startIndex: 100,
      startSeconds: frameToSeconds(RATE, 99.5),
      frames: NATIVE_RUN_FRAMES,
      slots,
    })
  })

  it('starts frame 0 at 0 s', async () => {
    const shell = fakeShell()
    const backend = createNativeBackend(fakeDevice().device, { start: shell.start })
    await backend.decode(FILE, 0)
    expect(shell.started[0]?.startSeconds).toBe(0)
  })

  it('converts each p010le frame on the GPU straight into a texture of its own, at the source size', async () => {
    const shell = fakeShell('p010le')
    const { device, textures, uploads, draws } = fakeDevice()
    const backend = createNativeBackend(device, { start: shell.start })
    const first = await backend.decode(FILE, 7)
    const second = await backend.decode(FILE, 8)
    expect(first.texture).not.toBe(second.texture)
    expect([first.width, first.height]).toEqual([W, H])
    expect(first.colour).toEqual(COLOUR)
    // One pass's two staging planes, then one rgba16float texture per frame, each drawn into once.
    expect(textures.map((texture) => texture.format)).toEqual([
      'r16uint',
      'rg16uint',
      'rgba16float',
      'rgba16float',
    ])
    expect(uploads).toEqual([
      { texture: 'p010-luma', first: 7 },
      { texture: 'p010-chroma', first: 7 },
      { texture: 'p010-luma', first: 8 },
      { texture: 'p010-chroma', first: 8 },
    ])
    expect(draws.map((draw) => draw.to)).toEqual([first.texture, second.texture])
  })

  it('takes a gbrp10le source through P3’s pass and a blit', async () => {
    // The WebGPU constants P3's pass reads; a real device has them, Node does not.
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 })
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
    const shell = fakeShell('gbrp10le')
    const { device, uploads, draws } = fakeDevice()
    const backend = createNativeBackend(device, { start: shell.start })
    const frame = await backend.decode(FILE, 3)
    expect(uploads.map((upload) => upload.texture)).toEqual([
      'precise-source-g',
      'precise-source-b',
      'precise-source-r',
    ])
    expect(draws).toHaveLength(2)
    expect(draws[1]?.to).toBe(frame.texture)
  })

  it('reads and drops a short jump forward, and starts a new decode for a long one', async () => {
    const shell = fakeShell()
    const backend = createNativeBackend(fakeDevice().device, { start: shell.start })
    await backend.decode(FILE, 10)
    await backend.decode(FILE, 10 + 1 + NATIVE_SKIP_LIMIT)
    expect(shell.started).toHaveLength(1)
    expect(shell.reads.at(-1)).toBe(11 + NATIVE_SKIP_LIMIT)
    await backend.decode(FILE, 200)
    expect(shell.started.map((options) => options.startIndex)).toEqual([10, 200])
  })

  it('keeps two places of one file open (a cut or a dissolve within a clip) instead of reopening every frame', async () => {
    const shell = fakeShell()
    const backend = createNativeBackend(fakeDevice().device, { start: shell.start })
    for (let k = 0; k < 4; k += 1) {
      await backend.decode(FILE, 100 + k)
      await backend.decode(FILE, 500 + k)
    }
    expect(NATIVE_MAX_STREAMS).toBe(2)
    expect(shell.started.map((options) => options.startIndex)).toEqual([100, 500])
    expect(shell.closed).toEqual([])
  })

  it('closes the least recently used decode when a third is needed', async () => {
    const shell = fakeShell()
    const backend = createNativeBackend(fakeDevice().device, { start: shell.start })
    await backend.decode(FILE, 100)
    await backend.decode(OTHER, 0)
    await backend.decode(FILE, 101)
    await backend.decode(FILE, 900)
    // The decode of OTHER was the least recently read.
    expect(shell.closed).toEqual([1])
    expect(shell.started.map((options) => options.file)).toEqual([
      '/media/a.mp4',
      '/media/b.mp4',
      '/media/a.mp4',
    ])
  })

  it('refuses a file that is not on disk, and a file whose rate is not the clip’s', async () => {
    const backend = createNativeBackend(fakeDevice().device, { start: fakeShell().start })
    await expect(
      backend.decode({ ...FILE, key: 'source:blob:x', path: 'blob:x' }, 0),
    ).rejects.toThrow(/has no file path the shell can open/)
    const slow = fakeShell('p010le', toRate(30))
    const mismatched = createNativeBackend(fakeDevice().device, { start: slow.start })
    await expect(mismatched.decode(FILE, 0)).rejects.toThrow(
      /runs at 30\/1 fps, the clip counts its frames at 60000\/1001/,
    )
    expect(slow.closed).toEqual([0])
  })

  it('closes every decode and frees its passes when destroyed', async () => {
    const shell = fakeShell()
    const { device, textures } = fakeDevice()
    const backend = createNativeBackend(device, { start: shell.start })
    await backend.decode(FILE, 0)
    await backend.decode(OTHER, 0)
    backend.destroy()
    expect(shell.closed.sort()).toEqual([0, 1])
    expect(
      textures
        .filter((texture) => texture.format !== 'rgba16float')
        .every((texture) => texture.destroyed),
    ).toBe(true)
    await expect(backend.decode(FILE, 1)).rejects.toThrow(/destroyed/)
  })
})

describe('nativeProviderOptions', () => {
  const bridge = { startDecode: vi.fn(), cancel: vi.fn() }
  const clip = (mediaId?: string) =>
    ({ id: 'clip-1', label: 'Flight', type: 'video', src: 'blob:x', mediaId }) as unknown as VideoItem

  afterEach(() => setNativeExportSession(null))

  it('gives an export the native backend and each clip’s file on disk while a native export runs', () => {
    setNativeExportSession({ bridge, paths: new Map([['media-1', '/media/a.mp4']]) })
    const options = nativeProviderOptions(fakeDevice().device, 'export')
    expect(options.native?.origin).toBe('native')
    expect(options.sourceFile?.(clip('media-1'), RATE)).toEqual({
      key: 'source:/media/a.mp4',
      src: 'blob:x',
      path: '/media/a.mp4',
      rate: RATE,
    })
  })

  it('stops the export with a SourceError for a clip that has no file on disk', () => {
    setNativeExportSession({ bridge, paths: new Map() })
    const options = nativeProviderOptions(fakeDevice().device, 'export')
    const failure = (() => {
      try {
        options.sourceFile?.(clip('media-2'), RATE)
        return null
      } catch (error) {
        return error
      }
    })()
    expect(failure).toBeInstanceOf(SourceError)
    expect((failure as SourceError).mediaId).toBe('media-2')
    expect((failure as Error).message).toContain(NO_FILE_PATH)
  })

  it('gives nothing to a preview, nor to an export when no native export runs', () => {
    setNativeExportSession({ bridge, paths: new Map() })
    expect(nativeProviderOptions(fakeDevice().device, 'preview')).toEqual({})
    setNativeExportSession(null)
    expect(nativeProviderOptions(fakeDevice().device, 'export')).toEqual({})
  })
})
