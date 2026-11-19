// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { createExportOutputTarget } from './export-output-target'

/** The two Mediabunny classes the target builds, recording what they were given. */
function fakeMediabunny() {
  class StreamTarget {
    constructor(
      readonly writable: WritableStream,
      readonly options: unknown,
    ) {}
  }
  class BufferTarget {
    buffer: ArrayBuffer | null = new ArrayBuffer(3)
  }
  return { StreamTarget, BufferTarget } as unknown as typeof import('mediabunny')
}

function fakeHandle(size = 765) {
  const state = { closed: false, aborted: false }
  const handle = {
    createWritable: async () =>
      new WritableStream({
        close: () => {
          state.closed = true
        },
        abort: () => {
          state.aborted = true
        },
      }),
    getFile: async () => ({ size }),
  } as unknown as FileSystemFileHandle
  return { handle, state }
}

describe('createExportOutputTarget with a destination', () => {
  it('writes straight into the destination and hands back no blob to read it again', async () => {
    const { handle, state } = fakeHandle(765)
    const target = await createExportOutputTarget(fakeMediabunny(), 'mp4', 'video/mp4', {
      kind: 'file-handle',
      handle,
    })
    expect(target.kind).toBe('file')
    const completed = await target.complete()
    expect(completed.directOutput).toBe(true)
    expect(completed.size).toBe(765)
    expect(completed.blob.size).toBe(0)
    expect(completed.blob.type).toBe('video/mp4')
    expect(completed.temporaryOutput).toBeUndefined()
    expect(state.closed).toBe(true)
    await target.discard() // after a completed export, a discard throws nothing away
    expect(state.aborted).toBe(false)
  })

  it('throws what was written away when the export does not complete', async () => {
    const { handle, state } = fakeHandle()
    const target = await createExportOutputTarget(fakeMediabunny(), 'mov', 'video/quicktime', {
      kind: 'file-handle',
      handle,
    })
    await target.discard()
    expect(state.aborted).toBe(true)
    expect(state.closed).toBe(false)
  })

  it('fails with the reason instead of writing somewhere else when the destination cannot be opened', async () => {
    const handle = {
      createWritable: vi.fn(async () => {
        throw new DOMException('permission denied', 'NotAllowedError')
      }),
    } as unknown as FileSystemFileHandle
    await expect(
      createExportOutputTarget(fakeMediabunny(), 'mp4', 'video/mp4', { kind: 'file-handle', handle }),
    ).rejects.toThrow('permission denied')
  })

  it('keeps the memory target, with its size, when there is no destination and no scratch storage', async () => {
    const target = await createExportOutputTarget(fakeMediabunny(), 'mp4', 'video/mp4')
    expect(target.kind).toBe('buffer')
    const completed = await target.complete()
    expect(completed.size).toBe(3)
    expect(completed.directOutput).toBeUndefined()
  })
})
