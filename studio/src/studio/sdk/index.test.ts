// @vitest-environment node

/**
 * The SDK's entry point (design §4.8): one object with the seventeen namespaces
 * of `types.ts`, the format version, the transaction helper and the reference.
 *
 * The methods each namespace must have are read from `types.ts` itself, the
 * same way `contract.test.ts` reads its `@throws` lines, so a method added to
 * the interface without an implementation (or the other way round) fails here.
 */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { resetTimelineCompositionTestState } from '@/features/timeline/test-helpers'
import { installStudio } from './install'
import { createStudio } from './index'

/** The namespaces of `Studio`, in the order `types.ts` declares them. */
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
] as const

/** The interface `types.ts` declares for one namespace (`project` -> `ProjectApi`). */
function apiInterfaceName(namespace: string): string {
  return `${namespace[0]!.toUpperCase()}${namespace.slice(1)}Api`
}

/** The method names of an `export interface <Name> { … }` block of `types.ts`. */
function declaredMethods(interfaceName: string): string[] {
  const lines = readFileSync(new URL('./types.ts', import.meta.url), 'utf8').split('\n')
  const header = `export interface ${interfaceName} {`
  const start = lines.indexOf(header)
  expect(start, `${header} is declared in types.ts`).toBeGreaterThanOrEqual(0)

  const methods: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line === '}') break
    const member = /^  (\w+)[(<]/.exec(line)
    if (member) methods.push(member[1]!)
  }
  return methods
}

/** Remove every timeline edit and history entry a previous test left behind. */
function resetStores(): void {
  resetTimelineCompositionTestState()
}

describe('createStudio', () => {
  beforeEach(resetStores)

  it('carries the seventeen namespaces with exactly the methods types.ts declares', () => {
    const studio = createStudio()

    expect(Object.keys(studio).sort()).toEqual(
      [...NAMESPACES, 'transaction', 'reference', 'version'].sort(),
    )
    for (const namespace of NAMESPACES) {
      const api = studio[namespace] as unknown as Record<string, unknown>
      expect(Object.keys(api).sort(), `studio.${namespace}`).toEqual(
        declaredMethods(apiInterfaceName(namespace)).sort(),
      )
      for (const [method, value] of Object.entries(api)) {
        expect(typeof value, `studio.${namespace}.${method}`).toBe('function')
      }
    }
  })

  it('reports version 1', () => {
    expect(createStudio().version).toBe(1)
  })

  it('returns the reference as a copy, so a caller cannot corrupt it', () => {
    const studio = createStudio()
    const reference = studio.reference()

    expect(reference.version).toBe(1)
    ;(reference as { version: number }).version = 99
    expect(studio.reference().version).toBe(1)
  })

  it('runs a transaction over the object it hands the callback', () => {
    const studio = createStudio()

    const result = studio.transaction('SDK_TEST', (inside) => inside.version)

    expect(result.value).toBe(1)
    expect(result.changes).toEqual({
      commands: [],
      added: [],
      removed: [],
      updated: [],
      undoSteps: 0,
    })
  })
})

describe('installStudio', () => {
  it('exposes the SDK on globalThis, which is the page global', () => {
    const installed = installStudio()

    expect(globalThis.studio).toBe(installed)
    expect(globalThis.studio.version).toBe(1)
    expect(globalThis.studio.clips.list()).toEqual([])
  })
})
