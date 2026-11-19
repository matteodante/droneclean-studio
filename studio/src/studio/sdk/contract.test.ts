// @vitest-environment node

/**
 * The `@throws` contract of the SDK's JSDoc and its tests (design §4.5).
 *
 * `types.ts` is the public contract and every namespace's tests are its proof:
 * a code a test expects must be documented on the method it names, and a code
 * a method documents must be thrown by a test. The pairing is read from the two
 * files, with no runtime:
 *
 * - from `types.ts`: each `*Api` interface, its methods and the `@throws` codes
 *   in the JSDoc block directly above them;
 * - from each namespace's test file: every code an `it` block asserts (in an
 *   `expect(error.code).toBe(...)` or a `toMatchObject({ code: ... })`) and the
 *   method that block belongs to, named either by the error messages it asserts
 *   (`'clips.update: "id" must …'`) or by its innermost `describe` block
 *   (`describe('update')` inside `describe('studio.clips')`).
 *
 * A block whose codes belong to no method fails this test: naming the block
 * after the method (or asserting the method-prefixed message) is what keeps the
 * pairing readable. `export-settings.test.ts` is left out: it tests the
 * settings module, and `export.test.ts` covers the public methods.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

/** The error codes of `StudioError` (`types.ts`, design §4.5). */
const ERROR_CODES = new Set([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'CONFLICT',
  'UNSUPPORTED',
  'MEDIA_UNAVAILABLE',
  'EXPORT_FAILED',
  'INTERNAL',
])

/** Documentation of one namespace: its methods and the codes each documents. */
type NamespaceDocs = Map<string, Map<string, Set<string>>>

/** One `it` block of a test file, with the `describe` names around it. */
interface TestBlock {
  /** The block's first line, for a message. */
  name: string
  /** Body lines, joined, without the block's own line. */
  body: string
  /** Enclosing `describe` names, outermost first. */
  describes: string[]
}

/** One code a test block expects from one method. */
interface ObservedPair {
  method: string
  code: string
  test: string
}

/** A file of the SDK, read through the module's own folder. */
function readSdkFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

/**
 * Every namespace of `types.ts`: `ProjectApi` is the `project` namespace, and
 * each method's codes are the `@throws` lines of the JSDoc above it.
 */
function parseTypes(): NamespaceDocs {
  const namespaces: NamespaceDocs = new Map()
  let methods: Map<string, Set<string>> | null = null
  let doc: string[] | null = null
  let pendingDoc: string[] | null = null

  for (const line of readSdkFile('types.ts').split('\n')) {
    const header = /^export interface (\w+)Api \{/.exec(line)
    if (header) {
      const name = header[1]!
      methods = new Map()
      namespaces.set(name[0]!.toLowerCase() + name.slice(1), methods)
      doc = null
      pendingDoc = null
      continue
    }
    if (!methods) continue
    if (line === '}') {
      methods = null
      continue
    }
    if (doc !== null) {
      doc.push(line)
      if (line.trim().endsWith('*/')) {
        pendingDoc = doc
        doc = null
      }
      continue
    }
    if (line.startsWith('  /**')) {
      doc = [line]
      continue
    }
    const member = /^  (\w+)[(<]/.exec(line)
    if (member && pendingDoc) {
      const codes = new Set<string>()
      for (const docLine of pendingDoc) {
        const thrown = /@throws (\w+)/.exec(docLine)
        if (thrown && ERROR_CODES.has(thrown[1]!)) codes.add(thrown[1]!)
      }
      methods.set(member[1]!, codes)
    }
    pendingDoc = null
  }

  return namespaces
}

/** Whether `line` opens an `it`, `test` or `describe` at any indentation. */
const BLOCK_OPEN = /^(\s*)(?:(?:it|test|describe)(?:\.\w+)?\(|\})\)/

/**
 * The `it` blocks of a test file: where each starts and ends, and the names of
 * the `describe` blocks around it. Indentation delimits the blocks (the project
 * formats test files with oxfmt, which fixes it), and a sibling or a closing
 * `})` at the same indentation ends the body.
 */
function parseTestBlocks(source: string): TestBlock[] {
  const lines = source.split('\n')
  const blocks: TestBlock[] = []
  const describesByIndent = new Map<number, string>()
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    const describeLine = /^(\s*)describe\(\s*'([^']*)'/.exec(line)
    if (describeLine) {
      const indent = describeLine[1]!.length
      for (const seen of [...describesByIndent.keys()]) {
        if (seen >= indent) describesByIndent.delete(seen)
      }
      describesByIndent.set(indent, describeLine[2]!)
      index += 1
      continue
    }
    const itLine = /^(\s*)(?:it|test)(?:\.\w+)?\(/.exec(line)
    if (!itLine) {
      index += 1
      continue
    }
    const indent = itLine[1]!.length
    let end = index + 1
    while (end < lines.length) {
      const candidate = BLOCK_OPEN.exec(lines[end]!)
      if (candidate && candidate[1]!.length <= indent) break
      end += 1
    }
    blocks.push({
      name: line.trim(),
      body: lines.slice(index, end).join('\n'),
      describes: [...describesByIndent.entries()]
        .filter(([seen]) => seen < indent)
        .sort((left, right) => left[0] - right[0])
        .map(([, name]) => name),
    })
    index = end
  }

  return blocks
}

/** The codes an `it` block asserts, in either of the two project styles. */
function assertedCodes(body: string): Set<string> {
  const codes = new Set<string>()
  const patterns = [/\.code\)\.(?:toBe|toEqual)\(\s*'([A-Z_]+)'/g, /code:\s*'([A-Z_]+)'/g]
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      if (ERROR_CODES.has(match[1]!)) codes.add(match[1]!)
    }
  }
  return codes
}

/** The methods a block names in the error messages it asserts. */
function methodsNamedInMessages(
  body: string,
  namespace: string,
  methods: readonly string[],
): string[] {
  const named = new Set<string>()
  for (const match of body.matchAll(/['"`]([a-z][a-z]*)\.([a-zA-Z]\w*): /g)) {
    if (match[1] === namespace && methods.includes(match[2]!)) named.add(match[2]!)
  }
  return [...named]
}

/**
 * The methods a `describe` name names: `update`, `studio.clips`, `clips.add`,
 * or `play` and `pause` joined by `and`/`,`; an empty list when it names none.
 */
function methodsInDescribeName(
  name: string,
  namespace: string,
  methods: readonly string[],
): string[] {
  const withoutStudio = name.replace(/^studio\./, '')
  if (withoutStudio === namespace) return []
  const prefix = `${namespace}.`
  return withoutStudio
    .split(/\s+and\s+|\s*,\s*/)
    .map((part) => (part.startsWith(prefix) ? part.slice(prefix.length) : part))
    .filter((part) => methods.includes(part))
}

/** The methods a test block belongs to: its messages, else its describes. */
function blockMethods(block: TestBlock, namespace: string, methods: readonly string[]): string[] {
  const fromMessages = methodsNamedInMessages(block.body, namespace, methods)
  if (fromMessages.length > 0) return fromMessages
  for (const name of [...block.describes].reverse()) {
    const fromDescribe = methodsInDescribeName(name, namespace, methods)
    if (fromDescribe.length > 0) return fromDescribe
  }
  return []
}

/**
 * The codes each method's tests expect, read from every namespace's test file.
 * A block whose codes belong to no method is returned as `unattributed`.
 */
function observedPairs(namespaces: NamespaceDocs): {
  pairs: ObservedPair[]
  unattributed: string[]
} {
  const pairs: ObservedPair[] = []
  const unattributed: string[] = []

  for (const [namespace, methods] of namespaces) {
    const names = [...methods.keys()]
    const source = readSdkFile(`namespaces/${namespace}.test.ts`)
    for (const block of parseTestBlocks(source)) {
      const codes = assertedCodes(block.body)
      if (codes.size === 0) continue
      const owners = blockMethods(block, namespace, names)
      if (owners.length === 0) {
        unattributed.push(`${namespace}: ${block.name} (${[...codes].join(', ')})`)
        continue
      }
      for (const method of owners) {
        for (const code of codes)
          pairs.push({ method: `${namespace}.${method}`, code, test: block.name })
      }
    }
  }

  return { pairs, unattributed }
}

/** `pairs` as `method CODE` lines, sorted, for a readable failure. */
function describePairs(pairs: ObservedPair[]): string[] {
  return [...new Set(pairs.map((pair) => `${pair.method} ${pair.code}`))].sort()
}

const namespaces = parseTypes()
const { pairs, unattributed } = observedPairs(namespaces)

describe('the @throws contract of types.ts and the namespace tests', () => {
  it('documents every code a namespace test expects from a method', () => {
    const undocumented = pairs
      .filter((pair) => {
        const [, namespace, method] = /^(\w+)\.(\w+)$/.exec(pair.method)!
        return !namespaces.get(namespace!)?.get(method!)?.has(pair.code)
      })
      .map((pair) => `${pair.method} ${pair.code} — expected in ${pair.test}`)

    expect(undocumented).toEqual([])
  })

  it('tests every code a method documents', () => {
    const tested = new Set(describePairs(pairs))
    const untested: string[] = []
    for (const [namespace, methods] of namespaces) {
      for (const [method, codes] of methods) {
        for (const code of codes) {
          if (!tested.has(`${namespace}.${method} ${code}`)) {
            untested.push(`${namespace}.${method} ${code}`)
          }
        }
      }
    }

    expect(untested).toEqual([])
  })

  it('attributes every code assertion of a namespace test to a method', () => {
    expect(unattributed).toEqual([])
  })

  it('reads all seventeen namespaces and their methods', () => {
    expect([...namespaces.keys()].sort()).toEqual([
      'clips',
      'effects',
      'export',
      'history',
      'keyframes',
      'looks',
      'markers',
      'media',
      'playback',
      'project',
      'selection',
      'shadow',
      'subclips',
      'titles',
      'tracks',
      'transitions',
      'workspace',
    ])
    for (const methods of namespaces.values()) {
      expect(methods.size).toBeGreaterThan(0)
    }
  })
})
