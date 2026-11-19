/**
 * `search`: BM25 over the fixture and over the real corpora (task 2.2,
 * design §4.8).
 *
 * The fixture is the deterministic case: the same query, the same hits. The
 * real corpora are loaded through the same code the app uses, which is also
 * the check that the guide pages' data modules still evaluate — a future page
 * with a real `import` or a new TypeScript construct fails here, by file name,
 * instead of quietly leaving the guide out of search.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as fixture from '../../mcp/fixture.mjs'
import { createSearchIndex } from '../out/main/mcp/search/bm25.js'
import { corpusRootsFor, loadCorpusDocuments } from '../out/main/mcp/search/corpus.js'
import { createSearchTool } from '../out/main/mcp/tools/search.js'

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('BM25 over the fixture returns the recorded hits, best first', () => {
  const index = createSearchIndex(fixture.CORPUS)
  const hits = index.search('split clip', 3)
  const recorded = JSON.parse(fixture.SEARCH_RESULT.result.content[0].text).results
  assert.deepEqual(hits, recorded)
})

test('an exact method name comes first', () => {
  const index = createSearchIndex(fixture.CORPUS)
  const hits = index.search('studio.clips.split', 5)
  assert.equal(hits[0].title, 'studio.clips.split')
  assert.equal(hits[0].source, 'sdk')
})

test('limit is honoured and an empty query has no hits', () => {
  const index = createSearchIndex(fixture.CORPUS)
  assert.equal(index.search('clip', 2).length, 2)
  assert.deepEqual(index.search('   ', 5), [])
})

test('the search tool indexes once and answers the same hits twice', async () => {
  let loads = 0
  const tool = createSearchTool(async () => {
    loads += 1
    return fixture.CORPUS
  })
  const first = await tool({ query: 'split clip', limit: 3 })
  const second = await tool({ query: 'split clip', limit: 3 })
  assert.ok('result' in first && 'result' in second)
  assert.deepEqual(first.result, second.result)
  assert.equal(loads, 1)
})

test('the real SDK reference, guide and feature map load', async () => {
  const load = await loadCorpusDocuments(corpusRootsFor(STUDIO_ROOT))
  assert.deepEqual(load.missing, [])
  const documents = load.documents
  assert.ok(documents.length > 400, `only ${documents.length} documents`)

  const sdk = documents.filter((document) => document.source === 'sdk')
  const guide = documents.filter((document) => document.source === 'guide')
  const map = documents.filter((document) => document.source === 'feature-map')
  assert.ok(sdk.some((document) => document.title === 'studio.clips.split'))
  assert.ok(sdk.some((document) => document.title === 'INVALID_ARGUMENT'))
  assert.equal(
    guide.filter((document) => /^guide:[^:]+$/.test(document.id)).length,
    27,
    'the user guide should contribute one document per page',
  )
  assert.ok(map.length > 50, `only ${map.length} feature-map entries`)

  const index = createSearchIndex(documents)
  const hits = index.search('split a clip', 8)
  assert.ok(
    hits.some((hit) => hit.title === 'studio.clips.split'),
    `studio.clips.split should be in the top hits: ${hits.map((hit) => hit.title).join(', ')}`,
  )
})
