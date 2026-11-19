/**
 * Build the SDK reference from declaration emit (design §4.9).
 *
 * TypeScript 7 has no compiler API, so this runs `tsc` as a process on
 * `tsconfig.sdk.json` (declaration emit of `src/studio/sdk/index.ts`), reads
 * the emitted `types.d.ts` with `parse-declarations.ts` and renders the two
 * committed files: `sdk-reference.json` for task 2.2's `search`, and
 * `sdk-reference.md` for people. `cli.ts` writes them; `reference.test.ts`
 * regenerates and compares, so a stale file fails the test run.
 *
 * The emit is written to a folder under the OS temp directory and removed
 * afterwards; the repository never holds `.d.ts` files.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SdkReference, StudioErrorCode } from '../types.ts'
import {
  docSummary,
  docTag,
  docThrows,
  isInternal,
  parseDeclarations,
  type DeclaredType,
} from './parse-declarations.ts'

/** The folder this file lives in: `src/studio/sdk/reference`. */
const REFERENCE_DIR = fileURLToPath(new URL('.', import.meta.url))

/** The editor's root (`studio/`), four folders above this one. */
const STUDIO_ROOT = join(REFERENCE_DIR, '..', '..', '..', '..')

/** The `tsconfig` the declaration emit runs with. */
const TSCONFIG_PATH = join(REFERENCE_DIR, 'tsconfig.sdk.json')

/** The emitted file the reference is read from, inside the temporary folder. */
const EMITTED_TYPES = join('studio', 'sdk', 'types.d.ts')

/** The committed JSON. */
export const REFERENCE_JSON_PATH = join(REFERENCE_DIR, 'sdk-reference.json')

/** The committed Markdown. */
export const REFERENCE_MARKDOWN_PATH = join(REFERENCE_DIR, 'sdk-reference.md')

/** The format version of both files. */
const REFERENCE_VERSION = 1

/**
 * When each error code is thrown. The codes themselves come from
 * `StudioErrorCode` in `types.ts`; this table says what they mean, and the
 * generator fails if a code has no line here.
 */
const ERROR_SUMMARIES: Record<StudioErrorCode, string> = {
  INVALID_ARGUMENT:
    'An argument has the wrong type, the wrong shape or a value outside its range; the message names the argument and lists the valid values when they are known.',
  NOT_FOUND:
    'An id does not exist in the active editing context or in the media library; the message names the argument, the ids that do exist and `studio.project.context()`.',
  CONFLICT:
    "The call is valid on its own but contradicts the project's state: a cut that cannot take a transition, a keyframe inside a transition, a split outside the clip.",
  UNSUPPORTED:
    'The editor cannot do this yet or in this browser: import without file handles, export settings the pipeline does not read, a project stored with an older schema.',
  MEDIA_UNAVAILABLE:
    "A media file's bytes cannot be read: permission denied, the file is gone, or nothing of an import could be read.",
  EXPORT_FAILED: 'An export job failed or was cancelled before it wrote its file.',
  INTERNAL:
    'A store or storage operation failed unexpectedly; the message carries the underlying reason.',
}

/** The executable that runs the declaration emit. */
function tscBinary(): string {
  const local = join(STUDIO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    readFileSync(local, 'utf8')
    return local
  } catch {
    return join(STUDIO_ROOT, 'node_modules', '.bin', 'tsc')
  }
}

/** Run the declaration emit into a temporary folder and return its `types.d.ts`. */
function emitDeclarations(): string {
  const outDir = mkdtempSync(join(tmpdir(), 'droneclean-sdk-reference-'))
  try {
    const result = spawnSync(
      process.execPath,
      [tscBinary(), '-p', TSCONFIG_PATH, '--outDir', outDir],
      { cwd: STUDIO_ROOT, encoding: 'utf8' },
    )
    if (result.status !== 0) {
      throw new Error(
        `the SDK declaration emit failed (tsc exited with ${String(result.status)}):\n` +
          `${result.stdout ?? ''}${result.stderr ?? ''}`,
      )
    }
    return readFileSync(join(outDir, EMITTED_TYPES), 'utf8')
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

/** Whether a declaration is one of the fourteen namespace interfaces. */
function isNamespaceInterface(declaration: DeclaredType): boolean {
  return declaration.kind === 'interface' && declaration.name.endsWith('Api')
}

/** `ProjectApi` -> `project`. */
function namespaceName(interfaceName: string): string {
  const name = interfaceName.slice(0, -'Api'.length)
  return name[0]!.toLowerCase() + name.slice(1)
}

/** The codes of the `StudioErrorCode` union, in declaration order. */
function errorCodes(declarations: readonly DeclaredType[]): StudioErrorCode[] {
  const declaration = declarations.find((candidate) => candidate.name === 'StudioErrorCode')
  if (!declaration) throw new Error('types.ts declares no StudioErrorCode')
  const codes: StudioErrorCode[] = []
  for (const match of declaration.declaration.matchAll(/'([A-Z_]+)'/g)) {
    codes.push(match[1]! as StudioErrorCode)
  }
  return codes
}

/** Build the reference object from the parsed declarations. */
function buildReference(declarations: readonly DeclaredType[]): SdkReference {
  const namespaces = declarations.filter(isNamespaceInterface).map((declaration) => ({
    name: namespaceName(declaration.name),
    summary: docSummary(declaration.doc),
    methods: declaration.members
      .filter((member) => !isInternal(member.doc))
      .map((member) => ({
        name: member.name,
        signature: member.signature,
        summary: docSummary(member.doc),
        mapsTo: docTag(member.doc, 'mapsTo') ?? '',
        throws: docThrows(member.doc),
        example: docTag(member.doc, 'example') ?? '',
      })),
  }))

  const types = declarations
    .filter((declaration) => !isNamespaceInterface(declaration) && !isInternal(declaration.doc))
    .map((declaration) => ({
      name: declaration.name,
      declaration: declaration.declaration,
      summary: docSummary(declaration.doc),
    }))

  const errors = errorCodes(declarations).map((code) => {
    const summary = ERROR_SUMMARIES[code]
    if (!summary) throw new Error(`the reference has no summary for the ${code} error code`)
    return { code, summary }
  })

  return { version: REFERENCE_VERSION, namespaces, types, errors }
}

/** The JSON file's text: two-space indentation and a final newline. */
function renderJson(reference: SdkReference): string {
  return `${JSON.stringify(reference, null, 2)}\n`
}

/** A fenced code block. */
function codeBlock(language: string, text: string): string {
  return `\`\`\`${language}\n${text}\n\`\`\``
}

/** One method's Markdown section. */
function methodMarkdown(
  namespace: string,
  method: SdkReference['namespaces'][number]['methods'][number],
): string {
  const lines = [
    `### \`studio.${namespace}.${method.name}()\``,
    '',
    codeBlock('ts', method.signature),
  ]
  if (method.summary) lines.push('', method.summary)
  const facts: string[] = []
  if (method.mapsTo) facts.push(`- Maps to: \`${method.mapsTo}\``)
  facts.push(
    method.throws.length > 0 ? `- Throws: ${method.throws.join(', ')}` : '- Throws: nothing',
  )
  lines.push('', ...facts)
  if (method.example) lines.push('', 'Example:', '', codeBlock('ts', method.example))
  return lines.join('\n')
}

/** The Markdown file's text. */
function renderMarkdown(reference: SdkReference): string {
  const sections: string[] = [
    '# DroneClean Studio SDK reference',
    '',
    'Generated from the JSDoc of `src/studio/sdk/types.ts` by `npm run sdk:reference`;',
    `format version ${reference.version}. Every call that changes the timeline is one undo step, and a`,
    'failed call leaves the project exactly as it was. The same content is committed as',
    '`sdk-reference.json` for `studio.reference()` and the MCP `search` tool.',
    '',
    '## Namespaces',
    '',
    '| Namespace | Methods |',
    '|---|---|',
    ...reference.namespaces.map(
      (namespace) => `| \`studio.${namespace.name}\` | ${namespace.methods.length} |`,
    ),
  ]

  for (const namespace of reference.namespaces) {
    sections.push('', `## studio.${namespace.name}`, '')
    if (namespace.summary) sections.push(namespace.summary, '')
    for (const method of namespace.methods) {
      sections.push(methodMarkdown(namespace.name, method), '')
    }
  }

  sections.push('## Types', '')
  for (const type of reference.types) {
    sections.push(`### \`${type.name}\``, '')
    if (type.summary) sections.push(type.summary, '')
    sections.push(codeBlock('ts', type.declaration), '')
  }

  sections.push('## Errors', '', '| Code | When it is thrown |', '|---|---|')
  for (const error of reference.errors) sections.push(`| \`${error.code}\` | ${error.summary} |`)
  sections.push('')

  return `${sections
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

/**
 * The two reference files' text, generated from the current `types.ts`.
 * @example const { json } = buildReferenceFiles()
 */
export function buildReferenceFiles(): { reference: SdkReference; json: string; markdown: string } {
  const reference = buildReference(parseDeclarations(emitDeclarations()))
  return { reference, json: renderJson(reference), markdown: renderMarkdown(reference) }
}
