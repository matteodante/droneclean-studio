/**
 * BM25 over the `search` corpus (task 2.2, design §4.8).
 *
 * One index built in memory from plain documents, no dependency, no network
 * and no model: the design measured 5.8 ms to index 934 documents and 2.05 ms
 * per query. The parameters are the classic ones (k1 1.2, b 0.75); a hyphenated
 * method name such as `studio.clips.split` gets an exact-title boost, and a
 * query word that is not in the dictionary also matches tokens with it as a
 * prefix, so "transit" finds "transitions" and "keyframe" is not lost to
 * stemming.
 */
import type { SearchHit, SearchSource } from '../../../../../mcp/protocol'
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from '../protocol'

/** One document of the corpus. */
export interface SearchDocument {
  /** Stable id, e.g. `sdk:clips.split`. */
  id: string
  /** Which corpus it belongs to. */
  source: SearchSource
  /** What the result's title shows. */
  title: string
  /** The searchable text. */
  text: string
  /** Where to read the whole entry. */
  location: string
}

/** The index a tool queries. */
export interface SearchIndex {
  /** The best `limit` documents for `query`, best first. */
  search(query: string, limit?: number): SearchHit[]
}

/** One indexed document. */
interface IndexedDocument {
  document: SearchDocument
  /** Term frequencies of the body plus the weighted title. */
  termFrequency: Map<string, number>
  /** Number of indexed tokens, for the length normalisation. */
  length: number
}

/** Weight of a title token against a body token. */
const TITLE_WEIGHT = 3

/** Classic BM25 parameters (design §4.8). */
const K1 = 1.2
const B = 0.75

/** How many dictionary tokens one unknown query word may expand to. */
const MAX_PREFIX_EXPANSIONS = 24

/** Weight of a prefix-matched query word against an exact one. */
const PREFIX_WEIGHT = 0.6

/** The longest snippet a hit carries, in characters. */
const SNIPPET_MAX_CHARS = 420

/** The context each side of the matched word in a snippet. */
const SNIPPET_CONTEXT_CHARS = 180

/**
 * The longest SDK entry a hit carries whole instead of a snippet: a method's signature and a type's declaration are
 * what an agent writes its call from, and a snippet cut them mid-field (20 Nov 2026: `ClipAddInput` stopped at
 * "durat…", before `sourceStart` and `sourceEnd`). The longest entry of the reference is 1106 characters.
 */
const SDK_WHOLE_MAX_CHARS = 1600

/** Lowercase, strip diacritics, split on everything that is not a letter or a digit. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/** A query that names one SDK method gets its exact result first. */
function methodName(query: string): string | null {
  const trimmed = query.trim()
  return /^studio\.[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed) ? trimmed : null
}

/** The excerpt of `text` around the first occurrence of any query word. */
function snippet(text: string, words: readonly string[]): string {
  const lower = text.toLowerCase()
  let at = -1
  for (const word of words) {
    if (word.length < 3) continue
    const found = lower.indexOf(word)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at === -1) {
    return text.length <= SNIPPET_MAX_CHARS ? text : `${text.slice(0, SNIPPET_MAX_CHARS - 1)}…`
  }
  const start = Math.max(0, at - SNIPPET_CONTEXT_CHARS)
  const end = Math.min(text.length, at + SNIPPET_CONTEXT_CHARS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

/**
 * Build the index. The documents are taken in the order given, which fixes the
 * order of equal scores: SDK methods first, then the guide, then the feature
 * map, as `corpus.ts` loads them.
 */
export function createSearchIndex(documents: readonly SearchDocument[]): SearchIndex {
  const indexed: IndexedDocument[] = documents.map((document) => {
    const titleTokens = tokenize(document.title)
    const bodyTokens = tokenize(document.text)
    const termFrequency = new Map<string, number>()
    for (const token of titleTokens) {
      for (let i = 0; i < TITLE_WEIGHT; i += 1) {
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)
      }
    }
    for (const token of bodyTokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)
    }
    return {
      document,
      termFrequency,
      length: titleTokens.length * TITLE_WEIGHT + bodyTokens.length,
    }
  })

  const documentFrequency = new Map<string, number>()
  for (const entry of indexed) {
    for (const token of entry.termFrequency.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }
  const dictionary = [...documentFrequency.keys()].sort()

  const averageLength =
    indexed.length === 0
      ? 0
      : indexed.reduce((total, entry) => total + entry.length, 0) / indexed.length

  /** Tokens a query word matches: itself when indexed, else its prefixes. */
  function expandToken(token: string): string[] {
    if (documentFrequency.has(token)) return [token]
    const matches: string[] = []
    for (const candidate of dictionary) {
      if (candidate.startsWith(token) && candidate.length > token.length) {
        matches.push(candidate)
        if (matches.length >= MAX_PREFIX_EXPANSIONS) break
      }
    }
    return matches
  }

  /** Inverse document frequency; a token no document has contributes nothing. */
  function idf(token: string): number {
    const df = documentFrequency.get(token) ?? 0
    if (df === 0 || indexed.length === 0) return 0
    return Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5))
  }

  return {
    search(query, requestedLimit) {
      const limit = Math.min(
        Math.max(1, requestedLimit ?? DEFAULT_SEARCH_LIMIT),
        MAX_SEARCH_LIMIT,
      )
      const words = [...new Set(tokenize(query))]
      if (words.length === 0) return []
      const exactMethod = methodName(query)
      const scored: Array<{ entry: IndexedDocument; score: number }> = []
      for (const entry of indexed) {
        let score = 0
        for (const word of words) {
          for (const token of expandToken(word)) {
            const frequency = entry.termFrequency.get(token)
            if (!frequency) continue
            const weight = token === word ? 1 : PREFIX_WEIGHT
            const normalisation = 1 - B + B * (entry.length / (averageLength || 1))
            score +=
              weight *
              idf(token) *
              ((frequency * (K1 + 1)) / (frequency + K1 * normalisation))
          }
        }
        if (exactMethod !== null && entry.document.title === exactMethod) {
          score += 1000
        }
        if (score > 0) scored.push({ entry, score })
      }
      scored.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.entry.document.id.localeCompare(right.entry.document.id)
      })
      return scored.slice(0, limit).map(({ entry, score }) => ({
        title: entry.document.title,
        source: entry.document.source,
        text:
          entry.document.source === 'sdk' && entry.document.text.length <= SDK_WHOLE_MAX_CHARS
            ? entry.document.text
            : snippet(entry.document.text, words),
        location: entry.document.location,
        score: Math.round(score * 1000) / 1000,
      }))
    },
  }
}
