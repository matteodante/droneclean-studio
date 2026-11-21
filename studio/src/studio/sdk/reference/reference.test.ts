// @vitest-environment node

/**
 * The committed reference must be the one the current `types.ts` generates
 * (design §4.9). This test runs the generator — `tsc` declaration emit, the
 * parser, the renderer — and compares the two files byte for byte, then checks
 * the JSON against the live namespaces: a method added, renamed or removed
 * without regenerating fails here, and `verify` runs it.
 *
 * Regenerate with `npm run sdk:reference`.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

import { createStudio } from '../index'
import type { Studio } from '../types'
import { buildReferenceFiles, REFERENCE_JSON_PATH, REFERENCE_MARKDOWN_PATH } from './generate'

/** The generator runs `tsc` once and the checks share its result. */
let generated: ReturnType<typeof buildReferenceFiles> | null = null

function reference(): ReturnType<typeof buildReferenceFiles> {
  generated ??= buildReferenceFiles()
  return generated
}

/** The namespaces `Studio` declares, in declaration order. */
const NAMESPACES = [
  'project',
  'media',
  'subclips',
  'tracks',
  'clips',
  'titles',
  'effects',
  'keyframes',
  'transitions',
  'markers',
  'selection',
  'playback',
  'export',
  'history',
  'workspace',
  'looks',
  'shadow',
  'preview',
] as const

describe('the generated SDK reference', () => {
  it('matches the committed sdk-reference.json byte for byte', () => {
    expect(reference().json).toBe(readFileSync(REFERENCE_JSON_PATH, 'utf8'))
  })

  it('matches the committed sdk-reference.md byte for byte', () => {
    expect(reference().markdown).toBe(readFileSync(REFERENCE_MARKDOWN_PATH, 'utf8'))
  })

  it('lists exactly the methods the live namespaces carry', () => {
    const studio = createStudio() as unknown as Record<string, Record<string, unknown>>
    const namespaces = reference().reference.namespaces

    expect(namespaces.map((namespace) => namespace.name)).toEqual([...NAMESPACES])
    for (const namespace of namespaces) {
      const api = studio[namespace.name]!
      expect(
        namespace.methods.map((method) => method.name).sort(),
        `studio.${namespace.name}`,
      ).toEqual(Object.keys(api).sort())
    }
  })

  it('documents every namespace and error code of the contract', () => {
    const referenceJson = reference().reference

    expect(referenceJson.version).toBe(1)
    for (const namespace of referenceJson.namespaces) {
      expect(namespace.summary, `studio.${namespace.name} summary`).not.toBe('')
      for (const method of namespace.methods) {
        expect(method.summary, `${namespace.name}.${method.name} summary`).not.toBe('')
        expect(method.signature, `${namespace.name}.${method.name} signature`).toContain(
          method.name,
        )
        expect(method.example, `${namespace.name}.${method.name} example`).not.toBe('')
      }
    }
    expect(referenceJson.errors.map((error) => error.code)).toEqual([
      'INVALID_ARGUMENT',
      'NOT_FOUND',
      'CONFLICT',
      'UNSUPPORTED',
      'MEDIA_UNAVAILABLE',
      'EXPORT_FAILED',
      'INTERNAL',
    ])
  })

  it('is what studio.reference() returns', () => {
    const studio: Studio = createStudio()
    const served = studio.reference()

    expect(served.namespaces.map((namespace) => namespace.name)).toEqual([...NAMESPACES])
    expect(served).toEqual(reference().reference)
  })
})
