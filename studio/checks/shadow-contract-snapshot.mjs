#!/usr/bin/env node
// Writes the editor's snapshot of the DroneClean cloud's API contract.
//
// The cloud (`cloud/packages/shared/src/schemas.ts`, zod) is the contract; the editor's
// `src/studio/shadow/api/types.ts` and its recorded answers are hand-written. This script reads the
// cloud clone's zod schemas, converts the ones the editor uses to JSON Schema with the cloud's own
// zod (`z.toJSONSchema`), and writes
//   src/studio/shadow/api/contract-snapshot.json      the schemas, the contract version, the commit
//   src/studio/shadow/api/__fixtures__/contract-snapshot.types.ts
//                                                       the same schemas as TypeScript types
// `contract.test.ts` checks the recorded answers and `types.ts` against them, without needing the
// cloud clone, so it runs everywhere. Run this by hand when the cloud's contract changes:
//
//   node checks/shadow-contract-snapshot.mjs [--cloud <path to the cloud clone>] [--allow-dirty]
//
// Read only on the cloud clone: the schemas are bundled in memory with the editor's esbuild (zod
// comes from the cloud clone's own node_modules); nothing is installed or written there.

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { snapshotForm, snapshotToTypesFile } from '../src/studio/shadow/api/__fixtures__/contract-codegen.ts'

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = resolve(studioRoot, 'src/studio/shadow/api')

const args = process.argv.slice(2)
const cloudFlag = args.indexOf('--cloud')
// Default: `cloud/` beside the editor's checkout, found through git so a worktree finds it too.
const mainCheckout = resolve(
  execFileSync('git', ['-C', studioRoot, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(),
  '..',
)
const cloudRoot = resolve(cloudFlag >= 0 ? args[cloudFlag + 1] : resolve(mainCheckout, 'cloud'))
const allowDirty = args.includes('--allow-dirty')
const sharedRoot = resolve(cloudRoot, 'packages/shared')
if (!existsSync(resolve(sharedRoot, 'src/schemas.ts'))) {
  console.error(`No cloud schemas at ${sharedRoot}/src/schemas.ts (pass --cloud <path>).`)
  process.exit(1)
}

/**
 * What the editor uses, by the name its type has in `types.ts` (`Contract<name>` in the generated
 * file). `io` says which side of the schema: `input` is what a client sends (defaults optional),
 * `output` is what the API answers. `both` asserts the two are the same and keeps one.
 * `schema` is the export of `schemas.ts`, or a function building one from the module.
 */
const ENTRIES = [
  // Requests.
  { name: 'VideoMeta', schema: 'VideoMetaSchema', io: 'both' },
  { name: 'PieceSource', schema: 'PieceSourceSchema', io: 'both' },
  { name: 'ShadowClick', schema: 'ShadowClickSchema', io: 'both' },
  { name: 'Segment', schema: 'SegmentSchema', io: 'both' },
  { name: 'JobOptions', schema: 'JobOptionsSchema', io: 'input' },
  { name: 'CreateJobRequest', schema: 'CreateJobRequestSchema', io: 'input' },
  { name: 'JobQuoteRequest', schema: 'JobQuoteRequestSchema', io: 'input' },
  {
    name: 'JobQuoteOptions',
    schema: (m) => m.JobOptionsSchema.pick({ quality: true, outputStep: true }),
    io: 'input',
  },
  { name: 'SignPartsRequest', schema: 'SignPartsRequestSchema', io: 'input' },
  // Answers.
  { name: 'JobSettings', schema: 'JobOptionsSchema', io: 'output' },
  { name: 'UploadTicket', schema: 'UploadTicketSchema', io: 'output' },
  { name: 'PartsTicket', schema: 'PartsTicketSchema', io: 'output' },
  { name: 'SignedParts', schema: 'SignedPartsSchema', io: 'output' },
  { name: 'DeleteUploadResult', schema: 'DeleteUploadResultSchema', io: 'output' },
  { name: 'Upload', schema: 'UploadSchema', io: 'output' },
  { name: 'Job', schema: 'JobSchema', io: 'output' },
  { name: 'JobResult', schema: 'JobResultSchema', io: 'output' },
  { name: 'JobError', schema: 'JobErrorSchema', io: 'output' },
  { name: 'TimeRange', schema: 'TimeRangeSchema', io: 'output' },
  { name: 'TrackSummary', schema: 'TrackSummarySchema', io: 'output' },
  { name: 'Keyframe', schema: 'KeyframeSchema', io: 'output' },
  { name: 'TrackData', schema: 'TrackDataSchema', io: 'output' },
  { name: 'PreviewWindow', schema: 'PreviewWindowSchema', io: 'output' },
  { name: 'DeleteJobResult', schema: 'DeleteJobResultSchema', io: 'output' },
  { name: 'JobQuote', schema: 'JobQuoteSchema', io: 'output' },
  { name: 'CreditBalance', schema: 'CreditBalanceSchema', io: 'output' },
  { name: 'Account', schema: 'AccountSchema', io: 'output' },
  { name: 'ServiceConfig', schema: 'ServiceConfigSchema', io: 'output' },
  { name: 'ApiErrorBody', schema: 'ApiErrorBodySchema', io: 'output' },
]

/**
 * The `/v1` routes the editor's client calls (`api/client.ts`): the route table lives in the
 * cloud's `services/api/src/app.ts` as code, not as a schema, so this list is written by hand and
 * `contract.test.ts` checks that the client calls exactly these. `request` and `response` name
 * `ENTRIES`; `null` is no body.
 */
const ENDPOINTS = [
  { method: 'GET', path: '/v1/me', request: null, response: 'Account' },
  { method: 'GET', path: '/v1/config', request: null, response: 'ServiceConfig' },
  { method: 'POST', path: '/v1/uploads', request: 'VideoMeta', response: 'UploadTicket' },
  { method: 'POST', path: '/v1/uploads/parts', request: 'VideoMeta', response: 'PartsTicket' },
  {
    method: 'POST',
    path: '/v1/uploads/{id}/parts',
    request: 'SignPartsRequest',
    response: 'SignedParts',
  },
  { method: 'POST', path: '/v1/uploads/{id}/complete', request: null, response: 'Upload' },
  { method: 'DELETE', path: '/v1/uploads/{id}', request: null, response: 'DeleteUploadResult' },
  { method: 'POST', path: '/v1/jobs', request: 'CreateJobRequest', response: 'Job' },
  { method: 'POST', path: '/v1/jobs/quote', request: 'JobQuoteRequest', response: 'JobQuote' },
  { method: 'GET', path: '/v1/jobs/{id}', request: null, response: 'Job' },
  { method: 'GET', path: '/v1/jobs/{id}/track', request: null, response: 'TrackData' },
  { method: 'POST', path: '/v1/jobs/{id}/cancel', request: null, response: 'Job' },
  { method: 'DELETE', path: '/v1/jobs/{id}', request: null, response: 'DeleteJobResult' },
]

function git(...gitArgs) {
  return execFileSync('git', ['-C', cloudRoot, ...gitArgs], { encoding: 'utf8' }).trim()
}

const dirty = git('status', '--porcelain', '--', 'packages/shared/src')
if (dirty && !allowDirty) {
  console.error(`The cloud's packages/shared/src has uncommitted changes:\n${dirty}\nCommit them or pass --allow-dirty.`)
  process.exit(1)
}
const cloudCommit = git('rev-parse', 'HEAD')

// Bundle the schemas with the zod they import (the cloud clone's own), in memory.
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/schemas'; export * from './src/constants'; export { z } from 'zod'",
    resolveDir: sharedRoot,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
})
const cloud = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
)
if (typeof cloud.z?.toJSONSchema !== 'function') {
  console.error("The cloud's zod has no toJSONSchema (zod 4.2 or later is needed).")
  process.exit(1)
}

const convert = (schema, io) => snapshotForm(cloud.z.toJSONSchema(schema, { io, unrepresentable: 'throw' }))

const schemas = {}
for (const entry of ENTRIES) {
  const schema = typeof entry.schema === 'function' ? entry.schema(cloud) : cloud[entry.schema]
  if (!schema) throw new Error(`The cloud has no export ${entry.schema}.`)
  if (entry.io === 'both') {
    const input = convert(schema, 'input')
    const output = convert(schema, 'output')
    if (JSON.stringify(input) !== JSON.stringify(output)) {
      throw new Error(`${entry.name} reads differently as input and output: use one io.`)
    }
    schemas[entry.name] = input
  } else {
    schemas[entry.name] = convert(schema, entry.io)
  }
}

const names = new Set(ENTRIES.map((entry) => entry.name))
for (const endpoint of ENDPOINTS) {
  for (const name of [endpoint.request, endpoint.response]) {
    if (name !== null && !names.has(name)) throw new Error(`${endpoint.path}: no entry ${name}.`)
  }
}

const snapshot = {
  contract: cloud.API_CONTRACT,
  contractHeader: cloud.API_CONTRACT_HEADER,
  cloudCommit,
  generator: {
    zod: JSON.parse(
      execFileSync('node', ['-p', "JSON.stringify({version: require('zod/package.json').version})"], {
        cwd: sharedRoot,
        encoding: 'utf8',
      }),
    ).version,
    jsonSchema: 'draft 2020-12, zod toJSONSchema (patterns of date-time and uuid left out)',
  },
  endpoints: ENDPOINTS,
  schemas,
}

writeFileSync(resolve(apiDir, 'contract-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`)
writeFileSync(
  resolve(apiDir, '__fixtures__/contract-snapshot.types.ts'),
  snapshotToTypesFile({ contract: snapshot.contract, cloudCommit }, schemas),
)
// The editor's formatter checks every file of `src`: leave the JSON as it wants it.
execFileSync(resolve(studioRoot, 'node_modules/.bin/vp'), ['fmt', resolve(apiDir, 'contract-snapshot.json')], {
  cwd: studioRoot,
  stdio: 'ignore',
})
console.log(
  `Contract ${snapshot.contract} at cloud ${cloudCommit.slice(0, 9)} (zod ${snapshot.generator.zod}): ` +
    `${ENTRIES.length} schemas, ${ENDPOINTS.length} routes.`,
)
