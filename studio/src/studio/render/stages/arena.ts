// The per-frame arena (design 3.6 section 2.7): where a frame's per-encode data (a warp's matrices, a pass's
// uniforms) is written. `writeBuffer` into one buffer a stage owns makes N warps in one encoder all see the last
// frame's bytes (S8); here every upload gets its own aligned range of a slab, bound with a dynamic offset, so a
// range's bytes stay what they were until the frame that used them is done.
//
// Slabs live in a ring: a frame takes a free slab, and the slab goes back to the ring when
// `queue.onSubmittedWorkDone()` says the GPU is through with the frame. A slab starts at 4 MB and a frame that
// outgrows it moves to a slab twice the size; the old one is destroyed once the frame is done. No stage owns a buffer
// it writes per frame.

/** The buffer usages a slab needs, as the WebGPU spec numbers them: COPY_DST, UNIFORM, STORAGE. */
const SLAB_USAGE = 0x08 | 0x40 | 0x80

/** The first slab's size in bytes. */
export const ARENA_START_BYTES = 4 * 1024 * 1024

/** How many slabs the ring starts with: frames in flight at once before it has to grow. */
export const ARENA_RING_SIZE = 3

/** The part of a `GPUBuffer` the arena uses. */
export interface ArenaBuffer {
  destroy(): void
}

/** The part of a `GPUDevice` the arena uses; a real device satisfies it, and a test's recording fake can. */
export interface ArenaDevice<B extends ArenaBuffer = GPUBuffer> {
  createBuffer(descriptor: { size: number; usage: number; label?: string }): B
  readonly queue: {
    writeBuffer(buffer: B, offset: number, data: BufferSource): void
    onSubmittedWorkDone(): Promise<void>
  }
  readonly limits?: {
    readonly minUniformBufferOffsetAlignment?: number
    readonly minStorageBufferOffsetAlignment?: number
  }
}

/** One uploaded range: bind `buffer` with `offset` as the dynamic offset and `size` as the binding size. */
export interface ArenaRange<B extends ArenaBuffer = GPUBuffer> {
  readonly buffer: B
  readonly offset: number
  readonly size: number
}

interface Slab<B extends ArenaBuffer> {
  buffer: B
  capacity: number
}

/** Rounds `value` up to a multiple of `alignment`. */
function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

/**
 * The arena of one renderer instance. A frame is `beginFrame()`, any number of `upload`s, the queue submit, then
 * `endFrame()`; frames may overlap (the next begins before the last is done) up to as many slabs as exist, and the
 * ring grows by one slab when all are in flight.
 */
export class FrameArena<B extends ArenaBuffer = GPUBuffer> {
  private readonly device: ArenaDevice<B>
  private readonly alignment: number
  private readonly free: Slab<B>[] = []
  private current: Slab<B> | undefined
  private cursor = 0
  /** Buffers a frame outgrew: kept alive for its bound ranges, destroyed when the frame is done. */
  private retired: B[] = []
  private slabCount = 0
  private destroyed = false

  constructor(device: ArenaDevice<B>) {
    this.device = device
    this.alignment = Math.max(
      256,
      device.limits?.minUniformBufferOffsetAlignment ?? 0,
      device.limits?.minStorageBufferOffsetAlignment ?? 0,
    )
    for (let i = 0; i < ARENA_RING_SIZE; i += 1) this.free.push(this.makeSlab(ARENA_START_BYTES))
  }

  /** How many slabs exist (free, or in use by a frame in flight). */
  get slabs(): number {
    return this.slabCount
  }

  private makeSlab(capacity: number): Slab<B> {
    this.slabCount += 1
    return {
      buffer: this.device.createBuffer({ size: capacity, usage: SLAB_USAGE, label: 'stage-arena' }),
      capacity,
    }
  }

  /** Takes a free slab for the frame about to be recorded (growing the ring when every slab is in flight). */
  beginFrame(): void {
    this.assertLive()
    if (this.current !== undefined)
      throw new Error('FrameArena: beginFrame called twice without endFrame')
    this.current = this.free.shift() ?? this.makeSlab(ARENA_START_BYTES)
    this.cursor = 0
  }

  /**
   * Writes `data` into the frame's slab at the next aligned offset and returns where.
   *
   * @throws RangeError when `data`'s length is not a multiple of 4 (WebGPU's `writeBuffer` rule) or is empty.
   */
  upload(data: ArrayBufferView): ArenaRange<B> {
    this.assertLive()
    const slab = this.current
    if (slab === undefined) throw new Error('FrameArena: upload called outside beginFrame/endFrame')
    const size = data.byteLength
    if (size === 0 || size % 4 !== 0) {
      throw new RangeError(
        `FrameArena: an upload must be a non-empty multiple of 4 bytes, got ${size}`,
      )
    }
    let offset = alignUp(this.cursor, this.alignment)
    if (offset + size > slab.capacity) {
      // Outgrown: earlier uploads of this frame stay bound to the old buffer, which lives until the frame is done.
      this.retired.push(slab.buffer)
      slab.capacity = Math.max(slab.capacity * 2, alignUp(size, this.alignment))
      slab.buffer = this.device.createBuffer({
        size: slab.capacity,
        usage: SLAB_USAGE,
        label: 'stage-arena',
      })
      offset = 0
    }
    this.device.queue.writeBuffer(slab.buffer, offset, data as unknown as BufferSource)
    this.cursor = offset + size
    return { buffer: slab.buffer, offset, size }
  }

  /**
   * Ends the frame: call it right after the queue submit. The frame's slab returns to the ring, and its outgrown
   * buffers are destroyed, when `onSubmittedWorkDone` resolves; the returned promise resolves then.
   */
  endFrame(): Promise<void> {
    this.assertLive()
    const slab = this.current
    if (slab === undefined) throw new Error('FrameArena: endFrame called without beginFrame')
    this.current = undefined
    const retired = this.retired
    this.retired = []
    const done = this.device.queue.onSubmittedWorkDone()
    return done.then(() => {
      for (const buffer of retired) buffer.destroy()
      if (this.destroyed) slab.buffer.destroy()
      else this.free.push(slab)
    })
  }

  /** Destroys every buffer not in flight; a frame still in flight destroys its own when it is done. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const slab of this.free) slab.buffer.destroy()
    this.free.length = 0
    this.current?.buffer.destroy()
    for (const buffer of this.retired) buffer.destroy()
    this.current = undefined
    this.retired = []
  }

  private assertLive(): void {
    if (this.destroyed) throw new Error('FrameArena: used after destroy')
  }
}
