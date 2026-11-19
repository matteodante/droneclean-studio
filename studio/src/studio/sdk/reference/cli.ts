/**
 * Write the two reference files (design §4.9).
 *
 *   npm run sdk:reference        # or: node src/studio/sdk/reference/cli.ts
 *
 * Node 24 runs a `.ts` file directly, so the command needs no build step. It
 * regenerates `sdk-reference.json` and `sdk-reference.md` from the JSDoc of
 * `types.ts`; commit both. `reference.test.ts` fails when they are stale.
 */

import { writeFileSync } from 'node:fs'

import { buildReferenceFiles, REFERENCE_JSON_PATH, REFERENCE_MARKDOWN_PATH } from './generate.ts'

const { json, markdown } = buildReferenceFiles()

writeFileSync(REFERENCE_JSON_PATH, json)
writeFileSync(REFERENCE_MARKDOWN_PATH, markdown)

process.stdout.write(`sdk-reference.json: ${json.length} bytes\n`)
process.stdout.write(`sdk-reference.md: ${markdown.length} bytes\n`)
