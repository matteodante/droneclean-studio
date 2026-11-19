/**
 * A parser for the `.d.ts` files TypeScript emits (design §4.9).
 *
 * TypeScript 7 has no compiler API (`ts.CreateSourceFile` is absent), so the
 * reference is built by running `tsc` as a process and reading its declaration
 * emit. That emit keeps every JSDoc block verbatim, so this file only has to
 * split the text into top-level `export interface` / `export type`
 * declarations, their members, and the JSDoc blocks above them.
 *
 * It reads the SDK's own emitted files only; the emit also contains the
 * editor's declarations because the SDK imports the stores.
 */

/** One member of an emitted interface (`current(): ProjectInfo | null;`). */
export interface DeclaredMember {
  /** Member name, e.g. `current`. */
  name: string
  /** The signature as one line, e.g. `current(): ProjectInfo | null`. */
  signature: string
  /** The JSDoc block above the member, raw, or null. */
  doc: string | null
}

/** One top-level declaration of an emitted `.d.ts`. */
export interface DeclaredType {
  /** Declared name, e.g. `ProjectApi`. */
  name: string
  /** Whether it is an interface or a type alias. */
  kind: 'interface' | 'type'
  /** The declaration text, without its JSDoc blocks. */
  declaration: string
  /** The JSDoc block above the declaration, raw, or null. */
  doc: string | null
  /** The members of an interface; empty for a type alias. */
  members: DeclaredMember[]
}

/** Read a JSDoc block starting at `start`; returns it and the line after it. */
function readDocBlock(lines: readonly string[], start: number): { block: string; next: number } {
  let end = start
  while (end < lines.length && !lines[end]!.trimEnd().endsWith('*/')) end += 1
  return { block: lines.slice(start, end + 1).join('\n'), next: end + 1 }
}

/** The lines of an interface body, without the braces. */
function readInterfaceBody(
  lines: readonly string[],
  start: number,
): { body: string[]; next: number } {
  let end = start + 1
  while (end < lines.length && lines[end] !== '}') end += 1
  return { body: lines.slice(start + 1, end), next: end + 1 }
}

/** A declaration line joined from its lines, with `;` removed and spaces folded. */
function signatureOf(lines: readonly string[]): string {
  return lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/;\s*$/, '')
    .trim()
}

/**
 * The members of an interface body: each JSDoc block, then the member it
 * documents, which ends at the first line whose signature ends with `;`.
 */
function parseMembers(body: readonly string[]): DeclaredMember[] {
  const members: DeclaredMember[] = []
  let doc: string | null = null
  let index = 0
  while (index < body.length) {
    const line = body[index]!
    if (line.trimStart().startsWith('/**')) {
      const block = readDocBlock(body, index)
      doc = block.block
      index = block.next
      continue
    }
    const member = /^\s+(?:readonly\s+)?(\w+)[<(?:]/.exec(line)
    if (!member) {
      index += 1
      doc = null
      continue
    }
    let end = index
    while (end < body.length && !body[end]!.trimEnd().endsWith(';')) end += 1
    members.push({
      name: member[1]!,
      signature: signatureOf(body.slice(index, end + 1)),
      doc,
    })
    doc = null
    index = end + 1
  }
  return members
}

/** Remove JSDoc blocks and blank lines from a declaration's text. */
function stripDocs(lines: readonly string[]): string {
  const kept: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trimStart().startsWith('/**')) {
      index = readDocBlock(lines, index).next
      continue
    }
    if (line.trim() !== '') kept.push(line)
    index += 1
  }
  return kept.join('\n')
}

/**
 * Every top-level `export interface` and `export type` of one emitted `.d.ts`,
 * in declaration order, with the JSDoc block above each.
 */
export function parseDeclarations(source: string): DeclaredType[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const declarations: DeclaredType[] = []
  let doc: string | null = null
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    if (line.startsWith('/**')) {
      const block = readDocBlock(lines, index)
      doc = block.block
      index = block.next
      continue
    }

    const header = /^export interface (\w+)(?:<[^>]*>)?(?: extends [^{]+)? \{/.exec(line)
    if (header) {
      const body = readInterfaceBody(lines, index)
      const declaration = stripDocs([line, ...body.body, '}'])
      declarations.push({
        name: header[1]!,
        kind: 'interface',
        declaration,
        doc,
        members: parseMembers(body.body),
      })
      doc = null
      index = body.next
      continue
    }

    const alias = /^export type (\w+)(?:<[^>]*>)? =/.exec(line)
    if (alias) {
      let end = index
      while (end < lines.length && !lines[end]!.trimEnd().endsWith(';')) end += 1
      const declarationLines = lines.slice(index, end + 1)
      declarations.push({
        name: alias[1]!,
        kind: 'type',
        declaration: stripDocs(declarationLines),
        doc,
        members: [],
      })
      doc = null
      index = end + 1
      continue
    }

    if (line.trim() === '') doc = null
    index += 1
  }

  return declarations
}

/** The text lines of a raw JSDoc block, without the delimiters and stars. */
function docLines(doc: string): string[] {
  const lines = doc.split('\n')
  return lines.map((line, index) => {
    let text = line
    if (index === 0) text = text.replace(/^\s*\/\*\*/, '')
    if (index === lines.length - 1) text = text.replace(/\*\/\s*$/, '')
    return text.replace(/^\s*\* ?/, '').trimEnd()
  })
}

/** The first paragraph of a JSDoc block, on one line; `''` when it has none. */
export function docSummary(doc: string | null): string {
  if (!doc) return ''
  const summary: string[] = []
  let started = false
  for (const line of docLines(doc)) {
    const text = line.trim()
    if (text === '') {
      // A block opens with an empty line before its first ` * text` line.
      if (started) break
      continue
    }
    if (text.startsWith('@')) break
    started = true
    summary.push(text)
  }
  return summary.join(' ').trim()
}

/** The text of the first `@tag` of a JSDoc block, paragraphs joined; null when absent. */
export function docTag(doc: string | null, tag: string): string | null {
  if (!doc) return null
  const lines = docLines(doc)
  const start = lines.findIndex((line) => line.trimStart().startsWith(`@${tag}`))
  if (start < 0) return null
  const parts: string[] = [
    lines[start]!.trimStart()
      .slice(tag.length + 1)
      .trim(),
  ]
  for (const line of lines.slice(start + 1)) {
    if (line.trimStart().startsWith('@')) break
    parts.push(line.trim())
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

/**
 * The `StudioError` codes a JSDoc block documents, in order. `Nothing` means
 * the method throws no `StudioError` and is not a code.
 */
export function docThrows(doc: string | null): string[] {
  if (!doc) return []
  const codes: string[] = []
  for (const line of docLines(doc)) {
    const thrown = /^\s*@throws\s+(\w+)/.exec(line)
    if (thrown && thrown[1] !== 'Nothing' && !codes.includes(thrown[1]!)) {
      codes.push(thrown[1]!)
    }
  }
  return codes
}

/** Whether a JSDoc block is marked `@internal`. */
export function isInternal(doc: string | null): boolean {
  return doc !== null && docLines(doc).some((line) => line.trimStart().startsWith('@internal'))
}
