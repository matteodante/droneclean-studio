import { describe, expect, it } from 'vite-plus/test'
import { ARENA_RING_SIZE, ARENA_START_BYTES, FrameArena, type ArenaDevice } from './arena'

interface FakeBuffer {
  id: number
  size: number
  destroyed: boolean
  destroy(): void
  bytes: Uint8Array
}

/** A recording device: buffers are byte arrays, and the test decides when `onSubmittedWorkDone` resolves. */
function fakeDevice(limits: ArenaDevice<FakeBuffer>['limits'] = undefined) {
  const buffers: FakeBuffer[] = []
  const pending: Array<() => void> = []
  const device: ArenaDevice<FakeBuffer> = {
    limits,
    createBuffer({ size }) {
      const buffer: FakeBuffer = {
        id: buffers.length,
        size,
        destroyed: false,
        bytes: new Uint8Array(size),
        destroy() {
          buffer.destroyed = true
        },
      }
      buffers.push(buffer)
      return buffer
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        const view = data as ArrayBufferView
        buffer.bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset)
      },
      onSubmittedWorkDone: () => new Promise<void>((resolve) => pending.push(resolve)),
    },
  }
  return { device, buffers, finishOldest: () => pending.shift()!() }
}

const floats = (...values: number[]) => new Float32Array(values)

describe('FrameArena', () => {
  it('starts with a ring of three 4 MB slabs', () => {
    const { device, buffers } = fakeDevice()
    const arena = new FrameArena(device)
    expect(arena.slabs).toBe(ARENA_RING_SIZE)
    expect(buffers.map((b) => b.size)).toEqual([
      ARENA_START_BYTES,
      ARENA_START_BYTES,
      ARENA_START_BYTES,
    ])
  })

  it('gives distinct, 256-aligned ranges that keep their own bytes', () => {
    const { device } = fakeDevice()
    const arena = new FrameArena(device)
    arena.beginFrame()
    const a = arena.upload(floats(1, 2, 3, 4))
    const b = arena.upload(floats(5, 6, 7, 8, 9))
    const c = arena.upload(floats(10, 11))
    expect([a.offset, b.offset, c.offset]).toEqual([0, 256, 512])
    expect(a.buffer).toBe(b.buffer)
    expect([a.size, b.size, c.size]).toEqual([16, 20, 8])
    const read = (range: typeof a, count: number) =>
      Array.from(new Float32Array(range.buffer.bytes.buffer, range.offset, count))
    expect(read(a, 4)).toEqual([1, 2, 3, 4])
    expect(read(b, 5)).toEqual([5, 6, 7, 8, 9])
    expect(read(c, 2)).toEqual([10, 11])
  })

  it('honours a larger device alignment', () => {
    const { device } = fakeDevice({ minUniformBufferOffsetAlignment: 512 })
    const arena = new FrameArena(device)
    arena.beginFrame()
    expect(arena.upload(floats(1)).offset).toBe(0)
    expect(arena.upload(floats(2)).offset).toBe(512)
  })

  it('refuses an upload that WebGPU would reject or that has no frame', () => {
    const { device } = fakeDevice()
    const arena = new FrameArena(device)
    expect(() => arena.upload(floats(1))).toThrow(/outside beginFrame/)
    arena.beginFrame()
    expect(() => arena.upload(new Uint8Array(6))).toThrow(RangeError)
    expect(() => arena.upload(new Uint8Array(0))).toThrow(RangeError)
    expect(() => arena.beginFrame()).toThrow(/twice/)
  })

  it('recycles a slab only after its onSubmittedWorkDone resolves', async () => {
    const { device, buffers, finishOldest } = fakeDevice()
    const arena = new FrameArena(device)
    const used: FakeBuffer[] = []
    // Three frames in flight take the three slabs.
    const done: Promise<void>[] = []
    for (let i = 0; i < 3; i += 1) {
      arena.beginFrame()
      used.push(arena.upload(floats(i)).buffer)
      done.push(arena.endFrame())
    }
    expect(new Set(used).size).toBe(3)
    // A fourth frame, with all three in flight, grows the ring: it must not reuse a slab the GPU may still read.
    arena.beginFrame()
    const fourth = arena.upload(floats(99)).buffer
    expect(used).not.toContain(fourth)
    expect(arena.slabs).toBe(4)
    const fourthDone = arena.endFrame()
    // The first frame finishes: its slab is free again and the next frame gets exactly it.
    finishOldest()
    await done[0]
    arena.beginFrame()
    const fifth = arena.upload(floats(7)).buffer
    expect(fifth).toBe(used[0])
    expect(new Float32Array(fifth.bytes.buffer, 0, 1)[0]).toBe(7)
    expect(arena.slabs).toBe(4)
    void fourthDone
    expect(buffers).toHaveLength(4)
  })

  it('moves a frame that outgrows its slab to one twice the size, keeping earlier ranges valid', async () => {
    const { device, buffers, finishOldest } = fakeDevice()
    const arena = new FrameArena(device)
    arena.beginFrame()
    const first = arena.upload(floats(1, 2))
    const big = arena.upload(new Uint8Array(ARENA_START_BYTES - 256 + 4))
    expect(big.offset).toBe(0)
    expect(big.buffer).not.toBe(first.buffer)
    expect(big.buffer.size).toBe(ARENA_START_BYTES * 2)
    // The earlier range still points at the old buffer, with its bytes, and the old buffer is alive.
    expect(first.buffer.destroyed).toBe(false)
    expect(Array.from(new Float32Array(first.buffer.bytes.buffer, 0, 2))).toEqual([1, 2])
    const done = arena.endFrame()
    expect(first.buffer.destroyed).toBe(false)
    finishOldest()
    await done
    expect(first.buffer.destroyed).toBe(true)
    expect(big.buffer.destroyed).toBe(false)
    expect(buffers.filter((b) => !b.destroyed)).toHaveLength(ARENA_RING_SIZE)
  })

  it('a single upload larger than double the slab gets a slab that fits it', () => {
    const { device } = fakeDevice()
    const arena = new FrameArena(device)
    arena.beginFrame()
    const huge = arena.upload(new Uint8Array(ARENA_START_BYTES * 3))
    expect(huge.buffer.size).toBe(ARENA_START_BYTES * 3)
  })

  it('destroy frees the free slabs now and an in-flight one when its frame is done', async () => {
    const { device, buffers, finishOldest } = fakeDevice()
    const arena = new FrameArena(device)
    arena.beginFrame()
    const range = arena.upload(floats(1))
    const done = arena.endFrame()
    arena.destroy()
    expect(buffers.filter((b) => b.destroyed)).toHaveLength(2)
    finishOldest()
    await done
    expect(range.buffer.destroyed).toBe(true)
    expect(() => arena.beginFrame()).toThrow(/after destroy/)
  })
})
