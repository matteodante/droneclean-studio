// @vitest-environment node

/**
 * The editor against the cloud's contract (review finding C10).
 *
 * `contract-snapshot.json` is what `checks/shadow-contract-snapshot.mjs` read from the cloud's zod
 * schemas (`cloud/packages/shared/src/schemas.ts`) on the day it was run; this test needs no access
 * to the cloud, so it runs everywhere. It checks four things:
 *
 * 1. The recorded answers (`__fixtures__/recorded.ts`) are valid answers of the real contract,
 *    and the bodies the client sends are valid requests of it, over the routes the client calls.
 * 2. `types.ts` is the contract's own shape, field by field: the same properties, the same
 *    required and optional ones, the same values. The snapshot's schemas become TypeScript types
 *    (`__fixtures__/contract-snapshot.types.ts`, generated) and the `it('types.ts ...')` test below holds an
 *    identity check per type: a difference is a compile error that `npm run check:quick` stops on
 *    (vitest strips types, so the runtime test only proves the generated file is in step).
 * 3. The client speaks the contract version the snapshot has.
 * 4. The checks themselves bite: a renamed field, a missing one or an extra one is refused.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { createDroneCleanClient, type DroneCleanClient } from './client'
import { snapshotForm, snapshotToTypesFile, type JsonSchema } from './__fixtures__/contract-codegen'
import snapshot from './contract-snapshot.json'
import type * as Contract from './__fixtures__/contract-snapshot.types'
import { createFakeServer, type FakeRoute, type RecordedCall } from './__fixtures__/fake-server'
import {
  ACCOUNT,
  CONFIG,
  DELETE_JOB,
  DELETE_UPLOAD,
  FULL_JOB,
  FULL_JOB_ID,
  PARTS_TICKET,
  QUOTE,
  SIGNED_PARTS,
  TRACK_DATA,
  TRACK_JOB,
  TRACK_JOB_ID,
  UPLOAD,
  UPLOAD_ID,
  UPLOAD_TICKET,
  VIDEO,
} from './__fixtures__/recorded'
import { createMemorySession } from './session'
import type * as Editor from './types'

const schemas = snapshot.schemas as unknown as Record<string, JsonSchema>

/** A validator for one snapshot entry: unknown keys, missing keys and wrong values all fail. */
function validator(name: string): z.ZodType {
  const schema = schemas[name]
  if (!schema) throw new Error(`The snapshot has no schema ${name}.`)
  return z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema)
}

function problems(name: string, value: unknown): string[] {
  const result = validator(name).safeParse(value)
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
}

// ---------------------------------------------------------------------------
// 1. Answers and requests

/** Every recorded answer, with the contract schema it must satisfy. */
const RECORDED_ANSWERS: [label: string, value: unknown, schema: string][] = [
  ['UPLOAD_TICKET', UPLOAD_TICKET, 'UploadTicket'],
  ['PARTS_TICKET', PARTS_TICKET, 'PartsTicket'],
  ['SIGNED_PARTS', SIGNED_PARTS, 'SignedParts'],
  ['UPLOAD', UPLOAD, 'Upload'],
  ['DELETE_UPLOAD', DELETE_UPLOAD, 'DeleteUploadResult'],
  ['TRACK_DATA', TRACK_DATA, 'TrackData'],
  ['TRACK_JOB', TRACK_JOB, 'Job'],
  ['FULL_JOB', FULL_JOB, 'Job'],
  ['DELETE_JOB', DELETE_JOB, 'DeleteJobResult'],
  ['QUOTE', QUOTE, 'JobQuote'],
  ['ACCOUNT', ACCOUNT, 'Account'],
  ['CONFIG', CONFIG, 'ServiceConfig'],
  ['VIDEO', VIDEO, 'VideoMeta'],
]

describe('the recorded answers are answers of the real contract', () => {
  it.each(RECORDED_ANSWERS)('%s', (_label, value, schema) => {
    expect(problems(schema, value)).toEqual([])
  })

  it('knows the error body the fake server and the client use', () => {
    expect(
      problems('ApiErrorBody', { error: { code: 'not_found', message: 'No route.' } }),
    ).toEqual([])
  })
})

/** A UUID the way the API wants one (an `attemptId`, a tracking pass). */
const ATTEMPT_ID = '0b6f3d2e-8a41-4c57-9e10-3d5f7a9b1c24'
const ANCHOR = { x: 1871.5, y: 2418, timeSeconds: 0.75075, radius: 98 }
const SEGMENT = {
  startSeconds: 0.5005,
  endSeconds: 1.001,
  anchor: ANCHOR,
  trackJobIds: [TRACK_JOB_ID],
}

/** What each client method sends and the recorded answer it gets, by route. */
interface ClientCase {
  route: string
  call: (client: DroneCleanClient) => Promise<unknown>
  answer: unknown
}

const CLIENT_CASES: ClientCase[] = [
  { route: 'GET /v1/me', call: (c) => c.getAccount(), answer: ACCOUNT },
  { route: 'GET /v1/config', call: (c) => c.getConfig(), answer: CONFIG },
  { route: 'POST /v1/uploads', call: (c) => c.createUpload(VIDEO), answer: UPLOAD_TICKET },
  {
    route: 'POST /v1/uploads/parts',
    call: (c) => c.createPartsUpload(VIDEO),
    answer: PARTS_TICKET,
  },
  {
    route: 'POST /v1/uploads/{id}/parts',
    call: (c) => c.signUploadParts(UPLOAD_ID, [1, 2]),
    answer: SIGNED_PARTS,
  },
  {
    route: 'POST /v1/uploads/{id}/complete',
    call: (c) => c.completeUpload(UPLOAD_ID),
    answer: UPLOAD,
  },
  {
    route: 'DELETE /v1/uploads/{id}',
    call: (c) => c.abortUpload(UPLOAD_ID),
    answer: DELETE_UPLOAD,
  },
  {
    route: 'POST /v1/jobs',
    call: (c) =>
      c.createJob({
        uploadId: UPLOAD_ID,
        kind: 'full',
        segments: [SEGMENT],
        options: { harmonize: true, motion: 30, quality: 'maximum', outputStep: 2 },
        attemptId: ATTEMPT_ID,
      }),
    answer: FULL_JOB,
  },
  {
    route: 'POST /v1/jobs/quote',
    call: (c) =>
      c.quoteJob({ uploadId: UPLOAD_ID, segments: [SEGMENT], options: { quality: 'standard' } }),
    answer: QUOTE,
  },
  { route: 'GET /v1/jobs/{id}', call: (c) => c.getJob(FULL_JOB_ID), answer: FULL_JOB },
  { route: 'GET /v1/jobs/{id}/track', call: (c) => c.getTrack(TRACK_JOB_ID), answer: TRACK_DATA },
  { route: 'POST /v1/jobs/{id}/cancel', call: (c) => c.cancelJob(FULL_JOB_ID), answer: FULL_JOB },
  { route: 'DELETE /v1/jobs/{id}', call: (c) => c.deleteJob(FULL_JOB_ID), answer: DELETE_JOB },
]

/** More request bodies than one per route: the other kinds of job, and a quote before the upload. */
const OTHER_REQUESTS: [label: string, call: ClientCase['call']][] = [
  [
    'a preview with its tracking passes',
    (c) =>
      c.createJob({
        uploadId: UPLOAD_ID,
        kind: 'preview',
        click: ANCHOR,
        trackJobIds: [TRACK_JOB_ID],
        options: { quality: 'maximum' },
      }),
  ],
  [
    'a tracking pass',
    (c) =>
      c.createJob({ uploadId: UPLOAD_ID, kind: 'track', click: ANCHOR, attemptId: ATTEMPT_ID }),
  ],
  [
    'a quote before the upload',
    (c) => c.quoteJob({ fps: 59.94, segments: [SEGMENT], options: { outputStep: 4 } }),
  ],
]

/** The client over a fake server that answers every route of `CLIENT_CASES`. */
function clientOverCases() {
  const routes: FakeRoute[] = CLIENT_CASES.map(({ route, answer }) => {
    const [method, template] = route.split(' ') as [FakeRoute['method'], string]
    const pattern = new RegExp(`^${template.replace('{id}', '[^/]+')}$`)
    return { method, path: pattern, respond: () => ({ body: answer }) }
  })
  const server = createFakeServer(routes)
  const client = createDroneCleanClient({
    baseUrl: 'https://api.test',
    fetch: server.fetch,
    session: createMemorySession('token'),
    openUrl: () => {},
  })
  return { server, client }
}

/** The route a call went to, with its ids as `{id}`. */
function routeOf(call: RecordedCall): string {
  return `${call.method} ${call.path.replace(/^(\/v1\/(?:uploads|jobs)\/)(?!parts$|quote$)[^/]+/, '$1{id}')}`
}

describe('the client calls the routes and sends the bodies of the real contract', () => {
  it('calls exactly the snapshot’s routes', async () => {
    const { server, client } = clientOverCases()
    for (const { call } of CLIENT_CASES) await call(client)

    const called = server.calls.map(routeOf).toSorted()
    const known = snapshot.endpoints.map((e) => `${e.method} ${e.path}`).toSorted()
    expect(called).toEqual(known)
  })

  it.each(CLIENT_CASES.map((c) => [c.route, c] as const))('%s: body and answer', async (_r, c) => {
    const { server, client } = clientOverCases()
    await expect(c.call(client)).resolves.toBeDefined()

    const [call] = server.calls
    const endpoint = snapshot.endpoints.find((e) => `${e.method} ${e.path}` === c.route)
    expect(endpoint).toBeDefined()
    if (!endpoint) return
    if (endpoint.request === null) expect(call?.body).toBeUndefined()
    else expect(problems(endpoint.request, call?.body)).toEqual([])
    expect(problems(endpoint.response, c.answer)).toEqual([])
  })

  it.each(OTHER_REQUESTS)('sends %s as the contract takes it', async (_label, call) => {
    const { server, client } = clientOverCases()
    await call(client)
    const sent = server.calls[0]!
    const endpoint = snapshot.endpoints.find((e) => `${e.method} ${e.path}` === routeOf(sent))
    expect(problems(endpoint!.request!, sent.body)).toEqual([])
  })

  it('speaks the contract version the snapshot has', async () => {
    const { server, client } = clientOverCases()
    await client.getConfig()
    expect(server.calls[0]!.headers[snapshot.contractHeader]).toBe(String(snapshot.contract))
  })
})

// ---------------------------------------------------------------------------
// 2. types.ts, field by field

/** `true` only for the very same type: optional and required, extra and missing fields all differ. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** `true` when every `A` is a `B`, and the two have the very same keys. */
type RefinesWithSameKeys<A, B> = [A] extends [B]
  ? [keyof B] extends [keyof A]
    ? [keyof A] extends [keyof B]
      ? true
      : false
    : false
  : false

/** Only compiles for `true`. */
function holds<_T extends true>(): void {}

describe('types.ts is the contract, field by field', () => {
  it('the generated types are the snapshot, as it stands', () => {
    const generated = readFileSync(
      new URL('./__fixtures__/contract-snapshot.types.ts', import.meta.url),
      'utf8',
    )
    expect(generated).toBe(
      snapshotToTypesFile(
        { contract: snapshot.contract, cloudCommit: snapshot.cloudCommit },
        schemas,
      ),
    )
  })

  it('types.ts has the shape of every request and answer (checked by the compiler)', () => {
    // What the editor sends.
    holds<Same<Editor.VideoMeta, Contract.ContractVideoMeta>>()
    holds<Same<Editor.PieceSource, Contract.ContractPieceSource>>()
    holds<Same<Editor.ShadowClick, Contract.ContractShadowClick>>()
    holds<Same<Editor.Segment, Contract.ContractSegment>>()
    holds<Same<Editor.JobOptions, Contract.ContractJobOptions>>()
    holds<Same<Editor.CreateJobRequest, Contract.ContractCreateJobRequest>>()
    holds<Same<Editor.JobQuoteOptions, Contract.ContractJobQuoteOptions>>()
    // The quote's request is stricter in the editor (an upload or a frame rate, never both),
    // which the schema's refinements say but JSON Schema cannot: so every editor request must be a
    // contract request, with the same keys.
    holds<RefinesWithSameKeys<Editor.JobQuoteRequest, Contract.ContractJobQuoteRequest>>()
    // What the API answers.
    holds<Same<Editor.JobSettings, Contract.ContractJobSettings>>()
    holds<Same<Editor.UploadTicket, Contract.ContractUploadTicket>>()
    holds<Same<Editor.PartsTicket, Contract.ContractPartsTicket>>()
    holds<Same<Editor.SignedParts, Contract.ContractSignedParts>>()
    holds<Same<Editor.DeleteUploadResult, Contract.ContractDeleteUploadResult>>()
    holds<Same<Editor.Upload, Contract.ContractUpload>>()
    holds<Same<Editor.Job, Contract.ContractJob>>()
    holds<Same<Editor.JobResult, Contract.ContractJobResult>>()
    holds<Same<Editor.JobError, Contract.ContractJobError>>()
    holds<Same<Editor.TimeRange, Contract.ContractTimeRange>>()
    holds<Same<Editor.TrackSummary, Contract.ContractTrackSummary>>()
    holds<Same<Editor.Keyframe, Contract.ContractKeyframe>>()
    holds<Same<Editor.TrackData, Contract.ContractTrackData>>()
    holds<Same<Editor.PreviewWindow, Contract.ContractPreviewWindow>>()
    holds<Same<Editor.DeleteJobResult, Contract.ContractDeleteJobResult>>()
    holds<Same<Editor.JobQuote, Contract.ContractJobQuote>>()
    holds<Same<Editor.CreditBalance, Contract.ContractCreditBalance>>()
    holds<Same<Editor.Account, Contract.ContractAccount>>()
    holds<Same<Editor.ServiceConfig, Contract.ContractServiceConfig>>()
    holds<Same<Editor.ApiErrorBody, Contract.ContractApiErrorBody>>()
    // The one request the client sends that has no editor type of its own.
    holds<Same<{ partNumbers: number[] }, Contract.ContractSignPartsRequest>>()
    expect(Object.keys(schemas).length).toBeGreaterThan(0)
  })

  it('has an identity check for every schema of the snapshot', () => {
    // A schema added to the snapshot without a line above would go unchecked: say so here.
    const checked = new Set(
      readFileSync(new URL('./contract.test.ts', import.meta.url), 'utf8').match(
        /Contract\.Contract(\w+)>/g,
      ),
    )
    const names = Object.keys(schemas).map((name) => `Contract.Contract${name}>`)
    expect(names.filter((name) => !checked.has(name))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. The checks bite

describe('a change to a recorded answer or a request is refused', () => {
  const job = structuredClone(FULL_JOB) as unknown as Record<string, unknown>

  it('accepts the answer as it is', () => {
    expect(problems('Job', job)).toEqual([])
  })

  it('refuses a renamed field', () => {
    const { progress, ...rest } = job
    expect(problems('Job', { ...rest, progres: progress }).length).toBeGreaterThan(0)
  })

  it('refuses a missing required field', () => {
    const { cost: _cost, ...rest } = job
    expect(problems('Job', rest)).toEqual([
      'cost: Invalid input: expected object, received undefined',
    ])
  })

  it('refuses a field the contract does not have', () => {
    expect(problems('Job', { ...job, extra: 1 })).toHaveLength(1)
  })

  it('refuses a wrong value', () => {
    expect(problems('Job', { ...job, status: 'finished' })).toHaveLength(1)
    expect(problems('Job', { ...job, createdAt: 'yesterday' })).toHaveLength(1)
  })

  it('refuses a request with a misspelled key, which the API would silently drop', () => {
    expect(
      problems('CreateJobRequest', { uploadId: UPLOAD_ID, kind: 'full', attemptID: ATTEMPT_ID }),
    ).toHaveLength(1)
  })
})

describe('the snapshot generator', () => {
  it('keeps the formats, drops their patterns and closes every object', () => {
    const written = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', pattern: '^long$' },
        word: { type: 'string', pattern: '^kept$' },
        nested: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid', pattern: 'x' } },
        },
      },
      required: ['at'],
    }
    expect(snapshotForm(written)).toEqual({
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time' },
        word: { type: 'string', pattern: '^kept$' },
        nested: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          additionalProperties: false,
        },
      },
      required: ['at'],
      additionalProperties: false,
    })
  })

  it('writes types for nullable values, records, tuples and literals, and refuses what it does not know', () => {
    const file = snapshotToTypesFile(
      { contract: 1, cloudCommit: 'abc' },
      {
        Mixed: {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
            point: { type: 'array', prefixItems: [{ type: 'integer' }, { type: 'number' }] },
            step: { type: 'number', enum: [1, 2] },
            on: { const: true },
          },
          required: ['name'],
        },
      },
    )
    expect(file).toContain(
      'export type ContractMixed = { "name": string | null; "headers"?: Record<string, string>; ' +
        '"point"?: [number, number]; "step"?: 1 | 2; "on"?: true }',
    )
    expect(() => snapshotToTypesFile({ contract: 1, cloudCommit: 'abc' }, { Odd: {} })).toThrow(
      /Unsupported JSON Schema/,
    )
  })
})
