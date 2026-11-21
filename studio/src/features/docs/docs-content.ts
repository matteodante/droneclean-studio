import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

export type DocCategory = 'Start' | 'Core Editing' | 'Creative Tools' | 'Output' | 'Reference'

export interface DocFigure {
  /** Imported asset URL (import the image in the page module and pass it here). */
  src: string
  /** Required alt text for accessibility. */
  alt: string
  /** Optional caption shown under the image. */
  caption?: string
}

/**
 * Rich content blocks a section can render. Text in `paragraph`, `list`, `steps`,
 * and `note` supports inline markup: `**bold**` for UI labels and `` `code` `` for
 * keys and file names (see RichText in docs-shell).
 */
export type DocBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'note'; tone?: 'tip' | 'warning' | 'info'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'figure'; figure: DocFigure }

export interface DocSection {
  title: string
  /** Shorthand: rendered as a bullet list. Ignored when `blocks` is provided. */
  items?: string[]
  /** Richer content. Takes precedence over `items` when present. */
  blocks?: DocBlock[]
}

export interface DocPage {
  slug: string
  title: string
  description: string
  category: DocCategory
  sections: DocSection[]
  /** Slugs of related pages, shown as links at the foot of the article. */
  related?: string[]
}

export interface DocPageContent extends DocPage {
  order: number
}

type DocPageModule = { default: DocPageContent }

const pageModules = import.meta.glob<DocPageModule>('./pages/*.ts', { eager: true })

const orderedDocPageContent = Object.values(pageModules)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order)

/** The English guide: always loaded, the fallback for every language and page. */
export const DOC_PAGES: DocPage[] = orderedDocPageContent.map(({ order: _order, ...page }) => page)

export const DOC_GROUPS: DocCategory[] = [
  'Start',
  'Core Editing',
  'Creative Tools',
  'Output',
  'Reference',
]

export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug)
}

// ---- Translated guides -------------------------------------------------------------------------
// `pages/<code>/<same file name>.ts` holds one language. Each language is loaded on demand (one
// chunk, see vite.config.ts) and any page it lacks falls back to the English one.

const translatedLoaders = import.meta.glob<DocPageModule>('./pages/*/*.ts')

const loadersByLanguage = new Map<string, Array<() => Promise<DocPageModule>>>()
for (const [path, loader] of Object.entries(translatedLoaders)) {
  const code = /^\.\/pages\/([^/]+)\//.exec(path)?.[1]
  if (!code) continue
  const list = loadersByLanguage.get(code) ?? []
  list.push(loader)
  loadersByLanguage.set(code, list)
}

const loadedLanguages = new Map<string, Map<string, DocPage>>()
const pendingLanguages = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0

function emitChange() {
  version += 1
  for (const listener of listeners) listener()
}

function subscribeDocsLanguages(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getDocsLanguagesVersion(): number {
  return version
}

/** Loads a language's guide once. A language with no folder (or English) resolves at once. */
export function loadDocsLanguage(code: string): Promise<void> {
  const loaders = loadersByLanguage.get(code)
  if (!loaders) return Promise.resolve()
  const pending = pendingLanguages.get(code)
  if (pending) return pending

  const promise = Promise.all(loaders.map((load) => load()))
    .then((modules) => {
      const pages = new Map<string, DocPage>()
      for (const { default: content } of modules) {
        const { order: _order, ...page } = content
        pages.set(page.slug, page)
      }
      loadedLanguages.set(code, pages)
      emitChange()
    })
    .catch(() => {
      // The English pages stay on screen; a later call tries again.
      pendingLanguages.delete(code)
    })
  pendingLanguages.set(code, promise)
  return promise
}

/** English order and set; each page replaced by its translation (matched by slug) when there is one. */
export function mergeDocPages(english: DocPage[], translated?: Map<string, DocPage>): DocPage[] {
  if (!translated) return english
  return english.map((page) => translated.get(page.slug) ?? page)
}

export function docPagesFor(code: string): DocPage[] {
  return mergeDocPages(DOC_PAGES, loadedLanguages.get(code))
}

/** The guide in the interface language: English until the translation has loaded. */
export function useDocPages(): DocPage[] {
  const { i18n } = useTranslation()
  const code = i18n.resolvedLanguage ?? 'en'
  useEffect(() => {
    void loadDocsLanguage(code)
  }, [code])
  const loadedVersion = useSyncExternalStore(subscribeDocsLanguages, getDocsLanguagesVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadedVersion is the cache key for the loaded pages
  return useMemo(() => docPagesFor(code), [code, loadedVersion])
}

export function useDocPage(slug: string): DocPage | undefined {
  return useDocPages().find((page) => page.slug === slug)
}
