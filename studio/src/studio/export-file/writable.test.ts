// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { openDesktopFile, openFileHandle } from './writable'

/** A fetch that records what it was sent and answers like the shell: 204, or a sentence with a status. */
function fakeShell(options: { delayMs?: number; failAt?: number } = {}) {
  const requests: { url: string; body: number | null; position: number | null }[] = []
  let inFlight = 0
  let maxInFlight = 0
  let completed = 0
  const fetchImpl = (async (url: string, init: RequestInit) => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    const position = new URL(url).searchParams.get('position')
    const body = init.body as Uint8Array | null
    requests.push({
      url,
      body: body === null ? null : body.byteLength,
      position: position === null ? null : Number(position),
    })
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    inFlight -= 1
    completed += 1
    if (options.failAt !== undefined && requests.length === options.failAt) {
      return new Response('the disk is full\n', { status: 500 })
    }
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  return {
    fetchImpl,
    requests,
    completed: () => completed,
    maxInFlight: () => maxInFlight,
  }
}

const chunk = (position: number, size: number) =>
  ({ type: 'write', data: new Uint8Array(size), position }) as const

describe('the desktop file as a stream', () => {
  it('empties the file when the attempt starts, then writes each chunk at its position, in order', async () => {
    const shell = fakeShell()
    const open = openDesktopFile('exp-1', shell.fetchImpl)
    const writer = open.writable.getWriter()
    await writer.write(chunk(0, 4))
    await writer.write(chunk(4, 4))
    await writer.write(chunk(0, 2)) // a header patch
    await writer.close()

    expect(shell.requests.map((r) => r.url)).toEqual([
      'droneclean-export://file/exp-1/begin',
      'droneclean-export://file/exp-1/write?position=0',
      'droneclean-export://file/exp-1/write?position=4',
      'droneclean-export://file/exp-1/write?position=0',
    ])
    expect(await open.finish()).toBe(8)
  })

  it('applies backpressure: a slow writer slows the producer instead of growing a queue', async () => {
    const shell = fakeShell({ delayMs: 5 })
    const open = openDesktopFile('exp-2', shell.fetchImpl)
    const writer = open.writable.getWriter()

    // The muxer's own loop: it waits for `ready` whenever the stream says it is full.
    let produced = 0
    let widestGap = 0
    for (let i = 0; i < 40; i += 1) {
      if (writer.desiredSize !== null && writer.desiredSize <= 0) await writer.ready
      void writer.write(chunk(i * 4, 4))
      produced += 1
      widestGap = Math.max(widestGap, produced - shell.completed())
    }
    await writer.close()

    expect(shell.requests.filter((r) => r.position !== null)).toHaveLength(40)
    expect(shell.maxInFlight()).toBe(1)
    // One chunk is being written and one waits: never more, however slow the writer.
    expect(widestGap).toBeLessThanOrEqual(3)
  })

  it('stops with the shell’s own sentence when a write fails, and takes nothing more', async () => {
    const shell = fakeShell({ failAt: 3 }) // begin, write 0, write 4 fails
    const open = openDesktopFile('exp-3', shell.fetchImpl)
    const writer = open.writable.getWriter()
    await writer.write(chunk(0, 4))
    await expect(writer.write(chunk(4, 4)).then(() => writer.close())).rejects.toThrow('the disk is full')
    await expect(writer.write(chunk(8, 4))).rejects.toThrow()
    expect(shell.requests.filter((r) => r.position === 8)).toHaveLength(0)
  })

  it('says what failed when the shell cannot be reached', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const open = openDesktopFile('exp-4', fetchImpl)
    const writer = open.writable.getWriter()
    await expect(writer.write(chunk(0, 4))).rejects.toThrow(
      'writing the export file failed: Failed to fetch',
    )
  })

  it('takes no write after it was aborted', async () => {
    const shell = fakeShell()
    const open = openDesktopFile('exp-5', shell.fetchImpl)
    const writer = open.writable.getWriter()
    await writer.write(chunk(0, 4))
    await open.abort()
    await expect(writer.write(chunk(4, 4))).rejects.toThrow('closed')
  })
})

/** A file handle whose writable records whether it was closed (committed) or aborted (thrown away). */
function fakeHandle() {
  const state = { written: [] as number[], closed: false, aborted: false }
  const real = new WritableStream({
    write: (c: { position: number }) => {
      state.written.push(c.position)
    },
    close: () => {
      state.closed = true
    },
    abort: () => {
      state.aborted = true
    },
  })
  const handle = {
    createWritable: async () => real,
    getFile: async () => ({ size: 12 }),
  } as unknown as FileSystemFileHandle
  return { handle, state }
}

describe('a save-picker file as a stream', () => {
  it('is not completed by the muxer closing its writer, only by finish', async () => {
    const { handle, state } = fakeHandle()
    const open = await openFileHandle(handle)
    const writer = open.writable.getWriter()
    await writer.write(chunk(0, 4))
    await writer.close() // what a cancelled muxer does too
    expect(state.closed).toBe(false)
    expect(await open.finish()).toBe(12)
    expect(state.closed).toBe(true)
  })

  it('throws what was written away when it is aborted', async () => {
    const { handle, state } = fakeHandle()
    const open = await openFileHandle(handle)
    const writer = open.writable.getWriter()
    await writer.write(chunk(0, 4))
    await writer.close()
    await open.abort()
    expect(state.aborted).toBe(true)
    expect(state.closed).toBe(false)
  })
})
