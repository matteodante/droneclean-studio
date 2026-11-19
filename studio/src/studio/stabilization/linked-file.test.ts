// @vitest-environment node

// A file the desktop links by path reaches the worker as `{ url, size, name }`: the real message switch
// (`gyroflow/wasm/js/gyro-messages.js`) reads it through `readRange` in whole aligned chunks, never whole, and hands the
// engine exactly the bytes it asked for. Found on 19 Nov 2026: before this, a linked 3.7 GB clip was fetched whole into
// a Blob before the engine saw a byte.

import { describe, expect, it } from 'vite-plus/test'
import {
  LINKED_CHUNK_BYTES,
  serveGyroMessages,
  type GyroMessageScope,
} from '../../../../gyroflow/wasm/js/gyro-messages.js'

/** A file of `size` bytes whose byte at `i` is `i % 251`, so a misplaced byte shows */
const byteAt = (i: number): number => i % 251

interface Run {
  reply: { id: number; result?: unknown; error?: string }
  ranges: Array<[number, number]>
  reads: Uint8Array[]
}

/** Opens `file` on the switch with an engine that makes `asks` reads, and a `readRange` over the patterned file */
async function openLinked(
  file: unknown,
  asks: Array<[number, number]>,
  size: number,
  readRange?: (url: string, start: number, end: number) => ArrayBuffer,
): Promise<Run> {
  const ranges: Array<[number, number]> = []
  const reads: Uint8Array[] = []
  class Stabilizer {
    static open(
      _size: number,
      _name: string,
      read: (offset: number, length: number) => Uint8Array,
    ): Stabilizer {
      for (const [offset, length] of asks) reads.push(read(offset, length))
      return new Stabilizer()
    }
    info() {
      return {}
    }
    motionTrace() {
      return undefined
    }
    free() {}
  }
  const patterned = (url: string, start: number, end: number): ArrayBuffer => {
    expect(url).toBe('droneclean://app/__media/abc')
    ranges.push([start, end])
    const bytes = new Uint8Array(Math.min(end, size) - start)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = byteAt(start + i)
    return bytes.buffer
  }
  let reply: Run['reply'] | null = null
  const scope: GyroMessageScope = {
    onmessage: null,
    postMessage(message) {
      reply = message as Run['reply']
    },
  }
  serveGyroMessages(scope, {
    ready: Promise.resolve({}),
    Stabilizer,
    reader: { readAsArrayBuffer: () => new ArrayBuffer(0) },
    ...(readRange === undefined ? { readRange: patterned } : { readRange }),
  })
  await scope.onmessage?.({ data: { id: 1, type: 'open', file } })
  if (!reply) throw new Error('the switch did not reply')
  return { reply, ranges, reads }
}

const linked = (size: number) => ({
  url: 'droneclean://app/__media/abc',
  size,
  name: 'DJI_0020.MP4',
  lastModified: 1,
})

describe('a linked file in the gyro worker', () => {
  it('reads aligned chunks, one request per chunk for reads in order, and gives the engine the bytes it asked', async () => {
    const size = LINKED_CHUNK_BYTES * 2 + 1000
    const slice = 256 * 1024
    const asks: Array<[number, number]> = [
      [0, slice],
      [slice, slice],
      // across the first chunk's end
      [LINKED_CHUNK_BYTES - 100, 300],
      // the file's last bytes
      [size - 10, 10],
    ]
    const run = await openLinked(linked(size), asks, size)
    expect(run.reply.error).toBeUndefined()
    expect(run.ranges).toEqual([
      [0, LINKED_CHUNK_BYTES],
      [LINKED_CHUNK_BYTES, LINKED_CHUNK_BYTES * 2],
      [LINKED_CHUNK_BYTES * 2, size],
    ])
    run.reads.forEach((bytes, index) => {
      const [offset, length] = asks[index]!
      expect(bytes.length).toBe(length)
      expect(bytes[0]).toBe(byteAt(offset))
      expect(bytes[length - 1]).toBe(byteAt(offset + length - 1))
    })
  })

  it('fails the open in plain words when the route answers short, or a read runs past the end', async () => {
    const size = 1000
    const short = await openLinked(linked(size), [[0, 10]], size, () => new ArrayBuffer(5))
    expect(short.reply.error).toMatch(/bytes 0-999 answered 5 bytes/)
    const past = await openLinked(linked(size), [[995, 10]], size)
    expect(past.reply.error).toMatch(/read past the end/)
  })

  it('refuses something that is neither a File nor a linked file', async () => {
    const run = await openLinked({ url: '', size: 0, name: 'x' }, [[0, 1]], 1)
    expect(run.reply.error).toMatch(/linked file as \{ url, size, name \}/)
  })
})
