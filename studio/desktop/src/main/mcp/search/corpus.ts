/**
 * The `search` corpus: the SDK reference, the user guide pages and the feature
 * map (task 2.2, design §4.8).
 *
 * The design put the guide's flattening in the page because the page modules
 * import their figures; this slice does not touch `src/`, so the main process
 * reads the three sources itself. The guide pages are plain data modules (a
 * type-only import, one object literal ending in `satisfies DocPageContent`,
 * and `export default page`), so a strict, loud loader evaluates them:
 *
 * - a page with any other `import` throws — a future figure import must be
 *   solved when it lands, not silently dropped from search;
 * - a page without the expected `satisfies` line throws for the same reason;
 * - the test `studio/desktop/test/agent-search.test.mjs` loads the real guide,
 *   so a change in the pages fails the check that guards this loader.
 *
 * The feature map is Markdown today (`studio/docs/feature-map/*.md`), one `###`
 * entry per control; the design's `*.json` is read as Markdown here. All three
 * sources are read from disk once, when the first query arrives.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SearchDocument } from './bm25'

/** Where the three corpora live. */
export interface CorpusRoots {
  /** `src/studio/sdk/reference/sdk-reference.json`. */
  sdkReference: string
  /** `src/features/docs/pages`. */
  guideDir: string
  /** `docs/feature-map`. */
  featureMapDir: string
}

/** What was loaded, and which sources were missing (reported, not fatal). */
export interface CorpusLoad {
  documents: SearchDocument[]
  missing: string[]
}

/** The SDK reference's JSON, as far as the corpus reads it. */
interface SdkReferenceJson {
  namespaces: Array<{
    name: string
    summary?: string
    methods: Array<{
      name: string
      signature?: string
      summary?: string
      mapsTo?: string
      throws?: string[]
      example?: string
    }>
  }>
  types: Array<{ name: string; declaration?: string; summary?: string }>
  errors: Array<{ code: string; summary?: string }>
}

/** A guide page's object literal, as far as the corpus reads it. */
interface GuidePageJson {
  slug: string
  title: string
  description?: string
  sections: Array<{
    title: string
    items?: string[]
    blocks?: Array<Record<string, unknown>>
  }>
}

/** Join the text of one guide block. */
function blockText(block: Record<string, unknown>): string {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
      return typeof block.text === 'string' ? block.text : ''
    case 'list':
    case 'steps': {
      const items = Array.isArray(block.items) ? block.items : []
      return items.filter((item): item is string => typeof item === 'string').join(' · ')
    }
    case 'table': {
      const headers = Array.isArray(block.headers) ? block.headers : []
      const rows = Array.isArray(block.rows) ? block.rows : []
      const header = headers.filter((cell): cell is string => typeof cell === 'string').join(' | ')
      const body = rows
        .map((row) =>
          Array.isArray(row)
            ? row.filter((cell): cell is string => typeof cell === 'string').join(' | ')
            : '',
        )
        .filter((row) => row.length > 0)
        .join('\n')
      return [header, body].filter((part) => part.length > 0).join('\n')
    }
    case 'figure': {
      const figure =
        typeof block.figure === 'object' && block.figure !== null
          ? (block.figure as Record<string, unknown>)
          : {}
      return typeof figure.alt === 'string' ? figure.alt : ''
    }
    default:
      return ''
  }
}

/** The text of one guide section. */
function sectionText(section: GuidePageJson['sections'][number]): string {
  const fromBlocks = (section.blocks ?? []).map(blockText).filter((text) => text.length > 0)
  if (fromBlocks.length > 0) return fromBlocks.join('\n')
  return (section.items ?? []).join(' · ')
}

/**
 * Evaluate one guide page module. The two TypeScript-only pieces are removed
 * by exact line, and anything else that is not JavaScript throws: this is a
 * data module, and a real import must be handled when it appears.
 */
export function evaluateGuidePage(source: string, file: string): GuidePageJson {
  const imports = source.match(/^import .*$/gm) ?? []
  const runtimeImports = imports.filter((line) => !line.startsWith('import type '))
  if (runtimeImports.length > 0) {
    throw new Error(
      `guide loader: ${file} has an import the corpus cannot evaluate: ${runtimeImports[0]}`,
    )
  }
  if (!/^\} satisfies DocPageContent$/m.test(source)) {
    throw new Error(`guide loader: ${file} does not end its page with "} satisfies DocPageContent"`)
  }
  if (!/^export default page$/m.test(source)) {
    throw new Error(`guide loader: ${file} does not end with "export default page"`)
  }
  const code = source
    .replace(/^import type .*$/gm, '')
    .replace(/^\} satisfies DocPageContent$/m, '}')
    .replace(/^export default page$/m, 'return page')
  let page: unknown
  try {
    page = new Function(`"use strict";\n${code}`)()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`guide loader: ${file} could not be evaluated: ${message}`)
  }
  if (typeof page !== 'object' || page === null) {
    throw new Error(`guide loader: ${file} did not evaluate to an object`)
  }
  const candidate = page as Partial<GuidePageJson>
  if (
    typeof candidate.slug !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.sections)
  ) {
    throw new Error(`guide loader: ${file} is missing slug, title or sections`)
  }
  return candidate as GuidePageJson
}

/** The SDK reference as documents: namespaces, methods, types and error codes. */
function sdkDocuments(reference: SdkReferenceJson, location: string): SearchDocument[] {
  const documents: SearchDocument[] = []
  for (const namespace of reference.namespaces ?? []) {
    documents.push({
      id: `sdk:${namespace.name}`,
      source: 'sdk',
      title: `studio.${namespace.name}`,
      text: namespace.summary ?? `The ${namespace.name} namespace of window.studio.`,
      location,
    })
    for (const method of namespace.methods ?? []) {
      const text = [
        method.summary,
        method.signature,
        method.mapsTo ? `Maps to: ${method.mapsTo}` : '',
        method.throws && method.throws.length > 0 ? `Throws: ${method.throws.join(', ')}` : '',
        method.example ? `Example: ${method.example}` : '',
      ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n')
      documents.push({
        id: `sdk:${namespace.name}.${method.name}`,
        source: 'sdk',
        title: `studio.${namespace.name}.${method.name}`,
        text,
        location,
      })
    }
  }
  for (const type of reference.types ?? []) {
    documents.push({
      id: `sdk:type:${type.name}`,
      source: 'sdk',
      title: type.name,
      text: [type.summary, type.declaration]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n'),
      location,
    })
  }
  for (const error of reference.errors ?? []) {
    documents.push({
      id: `sdk:error:${error.code}`,
      source: 'sdk',
      title: error.code,
      text: error.summary ?? '',
      location,
    })
  }
  return documents
}

/** The guide as documents: one for the page's description, one per section. */
function guideDocuments(pages: readonly GuidePageJson[]): SearchDocument[] {
  const documents: SearchDocument[] = []
  for (const page of pages) {
    documents.push({
      id: `guide:${page.slug}`,
      source: 'guide',
      title: page.title,
      text: page.description ?? '',
      location: `docs/${page.slug}`,
    })
    page.sections.forEach((section, index) => {
      documents.push({
        id: `guide:${page.slug}:${index}`,
        source: 'guide',
        title: `${page.title} › ${section.title}`,
        text: sectionText(section),
        location: `docs/${page.slug}`,
      })
    })
  }
  return documents
}

/** A heading as an anchor-ish suffix for the location. */
function anchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The feature map as documents: one per `###` entry, tagged with its `##` group. */
function featureMapDocuments(filePath: string, markdown: string): SearchDocument[] {
  const fileName = path.basename(filePath)
  const location = `docs/feature-map/${fileName}`
  const documents: SearchDocument[] = []
  let group = ''
  let entry: { title: string; lines: string[] } | null = null
  const flush = (): void => {
    if (!entry) return
    documents.push({
      id: `feature-map:${fileName}:${documents.length}`,
      source: 'feature-map',
      title: entry.title,
      text: entry.lines.join('\n'),
      location: group ? `${location}#${anchor(group)}` : location,
    })
    entry = null
  }
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      group = line.slice(3).trim()
    } else if (line.startsWith('### ')) {
      flush()
      entry = { title: line.slice(4).trim(), lines: [] }
    } else if (entry) {
      entry.lines.push(line)
    }
  }
  flush()
  return documents
}

/** Read a text file, or null when it does not exist. */
async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Read and parse a JSON file, or null when it does not exist. */
async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const contents = await readIfExists(filePath)
  if (contents === null) return null
  try {
    return JSON.parse(contents) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${filePath} is not valid JSON: ${message}`)
  }
}

/** Sorted entries of a folder with one extension, or an empty list when it is missing. */
async function listFiles(folder: string, extension: string): Promise<string[] | null> {
  try {
    const names = await fs.promises.readdir(folder)
    return names
      .filter((name) => name.endsWith(extension))
      .sort()
      .map((name) => path.join(folder, name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Load the three corpora. A missing source is listed in `missing` and the
 * others still index: a packaged app whose guide copy was forgotten must still
 * answer SDK questions, and the caller logs the gap.
 */
export async function loadCorpusDocuments(roots: CorpusRoots): Promise<CorpusLoad> {
  const documents: SearchDocument[] = []
  const missing: string[] = []

  const reference = await readJsonIfExists<SdkReferenceJson>(roots.sdkReference)
  if (reference === null) missing.push(roots.sdkReference)
  else documents.push(...sdkDocuments(reference, 'src/studio/sdk/reference/sdk-reference.json'))

  const guideFiles = await listFiles(roots.guideDir, '.ts')
  if (guideFiles === null) {
    missing.push(roots.guideDir)
  } else {
    const pages: GuidePageJson[] = []
    for (const file of guideFiles) {
      const source = await fs.promises.readFile(file, 'utf8')
      pages.push(evaluateGuidePage(source, file))
    }
    pages.sort((left, right) => left.slug.localeCompare(right.slug))
    documents.push(...guideDocuments(pages))
  }

  const mapFiles = await listFiles(roots.featureMapDir, '.md')
  if (mapFiles === null) {
    missing.push(roots.featureMapDir)
  } else {
    for (const file of mapFiles) {
      documents.push(...featureMapDocuments(file, await fs.promises.readFile(file, 'utf8')))
    }
  }

  return { documents, missing }
}

/** Where the three corpora live in a working copy (the desktop's parent folder). */
export function corpusRootsFor(studioRoot: string): CorpusRoots {
  return {
    sdkReference: path.join(studioRoot, 'src/studio/sdk/reference/sdk-reference.json'),
    guideDir: path.join(studioRoot, 'src/features/docs/pages'),
    featureMapDir: path.join(studioRoot, 'docs/feature-map'),
  }
}
