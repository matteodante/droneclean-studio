// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { createFakeServer, type FakeRoute } from './__fixtures__/fake-server'
import {
  PARTS_TICKET,
  SIGNED_PARTS,
  UPLOAD,
  UPLOAD_ID,
  UPLOAD_TICKET,
  VIDEO,
  signedPart,
} from './__fixtures__/recorded'
import {
  PARTS_THRESHOLD_BYTES,
  putToStorage,
  uploadInParts,
  uploadPiece,
  type UploadApi,
} from './uploads'
import { DroneCleanApiError } from './types'

/** The signed URL of `UPLOAD_TICKET`, as the fake server sees it. */
const PIECE_PATH = `/uploads/${UPLOAD_ID}/piece.mp4`

/** The API calls of an upload, answering the recorded bodies unless a test says otherwise. */
function fakeApi(overrides: Partial<UploadApi> = {}): UploadApi {
  return {
    createUpload: async () => UPLOAD_TICKET,
    createPartsUpload: async () => PARTS_TICKET,
    signUploadParts: async (_uploadId, partNumbers) => ({
      parts: partNumbers.map((partNumber) => signedPart(partNumber)),
      expiresAt: SIGNED_PARTS.expiresAt,
    }),
    completeUpload: async () => UPLOAD,
    abortUpload: async () => ({ deleted: true }),
    ...overrides,
  }
}

/** A sleep that records how long the client said it would wait, without waiting. */
function sleeping(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = []
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms)
    },
  }
}

/** The storage's answer to one part's PUT. */
function putPart(partNumber: number, respond: FakeRoute['respond']): FakeRoute {
  return { method: 'PUT', path: `/uploads/${UPLOAD_ID}/part${partNumber}`, respond }
}

/**
 * A piece of VIDEO that the API cuts in three parts of four bytes. The bytes and those three parts
 * stand in for the 162,505,440 bytes of the real piece and its ten: the route follows the video's
 * declared size (`VIDEO.sizeBytes` is over the threshold), so the test keeps everything in memory.
 */
const SMALL_PIECE = new Blob(['abcdefghijkl'])
const SMALL_PARTS = { uploadId: UPLOAD_ID, partSizeBytes: 4, partCount: 3 }

describe('a piece sent in parts', () => {
  it('sends a part that failed again alone, and resumes where it stopped', async () => {
    const { sleep, delays } = sleeping()
    let partTwoAttempts = 0
    const server = createFakeServer([
      putPart(1, () => ({ status: 200 })),
      putPart(2, () => {
        partTwoAttempts += 1
        return partTwoAttempts === 1
          ? { status: 500, body: { error: { code: 'internal', message: 'The storage failed.' } } }
          : { status: 200 }
      }),
      putPart(3, () => ({ status: 200 })),
    ])
    const createPartsUpload = vi.fn(async () => SMALL_PARTS)
    const signUploadParts = vi.fn(async (_uploadId: string, partNumbers: number[]) => {
      return {
        parts: partNumbers.map((partNumber) => signedPart(partNumber)),
        expiresAt: SIGNED_PARTS.expiresAt,
      }
    })
    const completeUpload = vi.fn(async () => UPLOAD)
    const abortUpload = vi.fn(async () => ({ deleted: true as const }))
    const progress: number[] = []

    const upload = await uploadPiece(
      fakeApi({ createPartsUpload, signUploadParts, completeUpload, abortUpload }),
      SMALL_PIECE,
      VIDEO,
      { fetch: server.fetch, sleep, onProgress: (fraction) => progress.push(fraction) },
    )

    expect(upload).toEqual(UPLOAD)
    // Part 1 arrived once, part 2 twice (the failure and the retry), part 3 once: nothing started over.
    expect(server.to(`/uploads/${UPLOAD_ID}/part1`)).toHaveLength(1)
    expect(server.to(`/uploads/${UPLOAD_ID}/part2`)).toHaveLength(2)
    expect(server.to(`/uploads/${UPLOAD_ID}/part3`)).toHaveLength(1)
    const bodies = await Promise.all(
      server.calls.map((call) =>
        call.body instanceof Blob ? call.body.text() : Promise.resolve(''),
      ),
    )
    expect(bodies).toEqual(['abcd', 'efgh', 'efgh', 'ijkl'])
    // The failed part was asked for a fresh URL, and the retry waited the first pause.
    expect(signUploadParts).toHaveBeenCalledTimes(4)
    expect(delays).toEqual([2000])
    expect(progress).toEqual([1 / 3, 2 / 3, 1])
    expect(completeUpload).toHaveBeenCalledWith(UPLOAD_ID)
    expect(abortUpload).not.toHaveBeenCalled()
  })

  it('drops the upload on the server when it cannot be completed, and keeps the error', async () => {
    const refusal = new DroneCleanApiError(422, 'upload_failed', 'The video has no length.')
    const server = createFakeServer([
      putPart(1, () => ({ status: 200 })),
      putPart(2, () => ({ status: 200 })),
      putPart(3, () => ({ status: 200 })),
    ])
    const completeUpload = vi.fn(async () => {
      throw refusal
    })
    const abortUpload = vi.fn(async () => ({ deleted: true as const }))

    await expect(
      uploadPiece(
        fakeApi({ createPartsUpload: async () => SMALL_PARTS, completeUpload, abortUpload }),
        SMALL_PIECE,
        VIDEO,
        { fetch: server.fetch },
      ),
    ).rejects.toBe(refusal)

    expect(abortUpload).toHaveBeenCalledWith(UPLOAD_ID)
    // A refusal is not tried again: only what the network or the server's side failed is.
    expect(completeUpload).toHaveBeenCalledTimes(1)
  })

  it('gives up on a part the API has no URL for, after its attempts', async () => {
    const { sleep } = sleeping()
    const server = createFakeServer([])
    const signUploadParts = vi.fn(async () => ({
      parts: [],
      expiresAt: SIGNED_PARTS.expiresAt,
    }))

    const error = await uploadPiece(fakeApi({ signUploadParts }), SMALL_PIECE, VIDEO, {
      fetch: server.fetch,
      sleep,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DroneCleanApiError)
    expect((error as DroneCleanApiError).code).toBe('internal')
    expect(server.calls).toHaveLength(0)
    expect(signUploadParts).toHaveBeenCalledTimes(3)
  })

  it('sends nothing once the upload is stopped', async () => {
    const server = createFakeServer([])
    const abortUpload = vi.fn(async () => ({ deleted: true as const }))

    const error = await uploadPiece(fakeApi({ abortUpload }), SMALL_PIECE, VIDEO, {
      fetch: server.fetch,
      signal: AbortSignal.abort(),
    }).catch((caught: unknown) => caught)

    expect((error as Error).name).toBe('AbortError')
    expect(server.calls).toHaveLength(0)
    expect(abortUpload).toHaveBeenCalledWith(UPLOAD_ID)
  })
})

describe('a piece sent in one PUT', () => {
  it('puts the bytes with the ticket’s headers and reports it stored once', async () => {
    const server = createFakeServer([{ method: 'PUT', path: PIECE_PATH, respond: () => ({}) }])
    const progress: number[] = []

    await putToStorage(UPLOAD_TICKET, new Blob(['abc']), {
      fetch: server.fetch,
      onProgress: (fraction) => progress.push(fraction),
    })

    const [call] = server.to(PIECE_PATH)
    expect(call?.method).toBe('PUT')
    expect(call?.headers['content-type']).toBe('video/mp4')
    // Signed storage: the editor's token never goes there.
    expect(call?.headers.authorization).toBeUndefined()
    const body = call?.body
    expect(body).toBeInstanceOf(Blob)
    expect((body as Blob).size).toBe(3)
    expect(progress).toEqual([1])
  })

  it('tries a PUT again on a lost network and on the storage’s side, then gives up', async () => {
    const { sleep, delays } = sleeping()
    let attempts = 0
    const flaky = createFakeServer([
      {
        method: 'PUT',
        path: PIECE_PATH,
        respond: () => {
          attempts += 1
          if (attempts === 1) throw new TypeError('fetch failed')
          return attempts === 2 ? { status: 503 } : { status: 200 }
        },
      },
    ])

    await putToStorage(UPLOAD_TICKET, new Blob(['abc']), { fetch: flaky.fetch, sleep })
    expect(attempts).toBe(3)
    expect(delays).toEqual([2000, 5000])

    const broken = createFakeServer([
      {
        method: 'PUT',
        path: PIECE_PATH,
        respond: () => ({
          status: 503,
          body: { error: { code: 'unavailable', message: 'Busy.' } },
        }),
      },
    ])
    const error = await putToStorage(UPLOAD_TICKET, new Blob(['abc']), {
      fetch: broken.fetch,
      sleep,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DroneCleanApiError)
    expect((error as DroneCleanApiError).code).toBe('upload_failed')
    expect((error as DroneCleanApiError).status).toBe(503)
    expect(broken.calls).toHaveLength(3)
  })

  it('is the route for a piece under the parts threshold', async () => {
    expect(uploadInParts(PARTS_THRESHOLD_BYTES - 1)).toBe(false)
    expect(uploadInParts(PARTS_THRESHOLD_BYTES)).toBe(true)

    const server = createFakeServer([{ method: 'PUT', path: '/uploads/one', respond: () => ({}) }])
    const createUpload = vi.fn(async () => ({
      ...UPLOAD_TICKET,
      url: 'https://storage.test/uploads/one',
    }))
    const createPartsUpload = vi.fn(async () => PARTS_TICKET)
    const completeUpload = vi.fn(async () => UPLOAD)

    await uploadPiece(
      fakeApi({ createUpload, createPartsUpload, completeUpload }),
      new Blob(['x']),
      { ...VIDEO, sizeBytes: 1 },
      { fetch: server.fetch },
    )

    expect(createUpload).toHaveBeenCalledTimes(1)
    expect(createPartsUpload).not.toHaveBeenCalled()
    expect(completeUpload).toHaveBeenCalledWith(UPLOAD_ID)
  })
})
