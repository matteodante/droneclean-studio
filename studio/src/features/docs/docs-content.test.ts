import { describe, expect, it } from 'vite-plus/test'
import { DOC_PAGES, docPagesFor, getDocPage, loadDocsLanguage, mergeDocPages } from './docs-content'
import type { DocBlock, DocPage, DocPageContent, DocSection } from './docs-content'

describe('user guide content', () => {
  it('uses unique slugs and valid related-page links', () => {
    const slugs = DOC_PAGES.map((page) => page.slug)
    const slugSet = new Set(slugs)

    expect(slugSet.size).toBe(slugs.length)

    for (const page of DOC_PAGES) {
      for (const relatedSlug of page.related ?? []) {
        expect(slugSet.has(relatedSlug), `${page.slug} links to missing page ${relatedSlug}`).toBe(
          true,
        )
      }
    }
  })

  it('uses the current Motion guide slugs', () => {
    const slugs = new Set(DOC_PAGES.map((page) => page.slug))

    expect(slugs.has('animate')).toBe(false)
    expect(slugs.has('motion')).toBe(true)
    expect(slugs.has('motion-library')).toBe(true)
  })

  it('finds a page by slug', () => {
    expect(getDocPage('getting-started')?.slug).toBe('getting-started')
    expect(getDocPage('no-such-page')).toBeUndefined()
  })
})

describe('user guide languages', () => {
  const [first, second, third] = DOC_PAGES as [DocPage, DocPage, DocPage]

  it('keeps the English set and order, replacing a page by slug when it is translated', () => {
    const translated = new Map([[second.slug, { ...second, title: 'Tradotta' }]])
    const merged = mergeDocPages(DOC_PAGES, translated)

    expect(merged.map((page) => page.slug)).toEqual(DOC_PAGES.map((page) => page.slug))
    expect(merged[0]).toBe(first)
    expect(merged[1]?.title).toBe('Tradotta')
    expect(merged[2]).toBe(third)
  })

  it('ignores translated pages that have no English page', () => {
    const merged = mergeDocPages(DOC_PAGES, new Map([['ghost', { ...first, slug: 'ghost' }]]))

    expect(merged).toEqual(DOC_PAGES)
  })

  it('returns English for a language with no folder, and loading it is harmless', async () => {
    await loadDocsLanguage('zz-none')
    await loadDocsLanguage('en')

    expect(docPagesFor('zz-none')).toBe(DOC_PAGES)
    expect(docPagesFor('en')).toBe(DOC_PAGES)
  })
})

// Every translated guide (pages/<code>/<same file name>.ts) must have the English page's shape:
// the same links, `code` spans, bold marks and number of blocks, so the interface never loses a
// step or a link in translation. With no pages/<code>/ folder this passes with nothing to compare.
// `glob` and `root` are parameters so the check itself can be tried on a copy (see below).

type Pages = Record<string, { default: DocPageContent }>

function folderOf(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

function marks(text: string) {
  return {
    bold: (text.match(/\*\*/g) ?? []).length,
    code: (text.match(/`[^`]+`/g) ?? []).join('|'),
    links: (text.match(/\]\(([^)]+)\)/g) ?? []).join('|'),
  }
}

function compareDocPages(
  file: string,
  english: DocPageContent,
  translated: DocPageContent,
): string[] {
  const problems: string[] = []
  const sameText = (where: string, a: string, b: unknown) => {
    if (typeof b !== 'string' || !b.trim()) {
      problems.push(`${where}: missing text`)
      return
    }
    const x = marks(a)
    const y = marks(b)
    if (x.bold !== y.bold) problems.push(`${where}: ** count ${x.bold} vs ${y.bold}`)
    if (x.code !== y.code) problems.push(`${where}: code spans differ (${x.code} vs ${y.code})`)
    if (x.links !== y.links) problems.push(`${where}: link targets differ`)
  }
  const sameList = (where: string, a: string[] = [], b: unknown) => {
    if (!Array.isArray(b) || a.length !== b.length) {
      problems.push(`${where}: ${a.length} items vs ${Array.isArray(b) ? b.length : 'none'}`)
      return
    }
    a.forEach((text, i) => sameText(`${where}[${i}]`, text, b[i]))
  }

  for (const key of ['order', 'slug', 'category'] as const) {
    if (english[key] !== translated[key]) {
      problems.push(`${file}: ${key} ${english[key]} vs ${translated[key]}`)
    }
  }
  if (JSON.stringify(english.related ?? null) !== JSON.stringify(translated.related ?? null)) {
    problems.push(`${file}: related differs`)
  }
  sameText(`${file} title`, english.title, translated.title)
  sameText(`${file} description`, english.description, translated.description)

  if (english.sections.length !== translated.sections?.length) {
    problems.push(`${file}: ${english.sections.length} sections vs ${translated.sections?.length}`)
    return problems
  }
  english.sections.forEach((section: DocSection, i) => {
    const other = translated.sections[i] as DocSection
    const where = `${file} §${i}`
    sameText(`${where} title`, section.title, other.title)
    if (section.items) sameList(`${where} items`, section.items, other.items)
    if (!section.blocks) return
    if (section.blocks.length !== other.blocks?.length) {
      problems.push(`${where}: ${section.blocks.length} blocks vs ${other.blocks?.length}`)
      return
    }
    section.blocks.forEach((block: DocBlock, j) => {
      const twin = other.blocks![j] as DocBlock
      const at = `${where}.${j}`
      if (block.kind !== twin.kind) {
        problems.push(`${at}: kind ${block.kind} vs ${twin.kind}`)
        return
      }
      if (block.kind === 'note' && twin.kind === 'note') {
        if (block.tone !== twin.tone) problems.push(`${at}: tone differs`)
        sameText(at, block.text, twin.text)
      } else if (block.kind === 'paragraph' && twin.kind === 'paragraph') {
        sameText(at, block.text, twin.text)
      } else if (
        (block.kind === 'list' || block.kind === 'steps') &&
        (twin.kind === 'list' || twin.kind === 'steps')
      ) {
        sameList(at, block.items, twin.items)
      } else if (block.kind === 'table' && twin.kind === 'table') {
        sameList(`${at} headers`, block.headers, twin.headers)
        if (block.rows.length !== twin.rows?.length) problems.push(`${at}: rows differ`)
        else block.rows.forEach((row, k) => sameList(`${at} row ${k}`, row, twin.rows[k]))
      } else if (block.kind === 'figure' && twin.kind === 'figure') {
        if (block.figure.src !== twin.figure?.src) problems.push(`${at}: figure src differs`)
      }
    })
  })
  return problems
}

function compareDocFolders(englishPages: Pages, translatedPages: Pages): string[] {
  const problems: string[] = []
  const englishByFile = new Map(
    Object.entries(englishPages).map(([path, module]) => [path.split('/').pop()!, module.default]),
  )
  const folders = new Map<string, Map<string, DocPageContent>>()
  for (const [path, module] of Object.entries(translatedPages)) {
    const folder = folderOf(path)
    const files = folders.get(folder) ?? new Map<string, DocPageContent>()
    files.set(path.split('/').pop()!, module.default)
    folders.set(folder, files)
  }
  for (const [folder, files] of folders) {
    for (const [file, page] of files) {
      const english = englishByFile.get(file)
      if (!english) {
        problems.push(`${folder}/${file}: no English page of that name`)
        continue
      }
      problems.push(...compareDocPages(`${folder}/${file}`, english, page))
    }
  }
  return problems
}

const english = import.meta.glob<{ default: DocPageContent }>('./pages/*.ts', { eager: true })
const translated = import.meta.glob<{ default: DocPageContent }>('./pages/*/*.ts', {
  eager: true,
})

describe('translated user guide pages', () => {
  it('match the English pages page by page', () => {
    expect(compareDocFolders(english, translated)).toEqual([])
  })

  it('catches a mismatch', () => {
    const [path, module] = Object.entries(english)[0]!
    const page = module.default
    const folder = `./pages/xx/${path.split('/').pop()}`
    const clone = (edit: (copy: DocPageContent) => void) => {
      const copy = structuredClone(page)
      edit(copy)
      return { [folder]: { default: copy } }
    }

    expect(
      compareDocFolders(
        english,
        clone(() => {}),
      ),
    ).toEqual([])
    expect(
      compareDocFolders(
        english,
        clone((c) => (c.slug = 'other')),
      ),
    ).not.toEqual([])
    expect(
      compareDocFolders(
        english,
        clone((c) => (c.title = '  ')),
      ),
    ).not.toEqual([])
    expect(
      compareDocFolders(
        english,
        clone((c) => c.sections.pop()),
      ),
    ).not.toEqual([])
    expect(
      compareDocFolders(english, {
        './pages/xx/99-nothing.ts': { default: page },
      }),
    ).toEqual(['./pages/xx/99-nothing.ts: no English page of that name'])
  })
})
