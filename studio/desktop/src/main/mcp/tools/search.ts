/**
 * `search`: one query over the SDK reference, the user guide and the feature
 * map (task 2.2, design §4.8).
 *
 * The BM25 index is built on the first query and kept: 5.8 ms to index the
 * corpus and about 2 ms per query, measured in the design. The tool never
 * evaluates code and never touches the page; it works while the editor is
 * still loading, so an agent can read the reference before it edits anything.
 */
import type { SearchRequest, SearchResult } from '../../../../../mcp/protocol'
import { createSearchIndex } from '../search/bm25'
import type { SearchIndex } from '../search/bm25'
import type { LoadSearchDocuments, ToolOutcome } from '../types'

/** The handler the server registers, with the index it fills lazily. */
export type SearchTool = (request: SearchRequest) => Promise<ToolOutcome>

/**
 * Build the tool over a document loader. A failed load is not cached, so a
 * transient read error (the workspace being moved, a slow disk) does not poison
 * every later query.
 */
export function createSearchTool(loadDocuments: LoadSearchDocuments): SearchTool {
  let index: SearchIndex | null = null
  let loading: Promise<SearchIndex> | null = null

  async function getIndex(): Promise<SearchIndex> {
    if (index !== null) return index
    if (loading === null) {
      loading = loadDocuments()
        .then((documents) => createSearchIndex(documents))
        .then(
          (built) => {
            index = built
            return built
          },
          (error: unknown) => {
            loading = null
            throw error
          },
        )
    }
    return loading
  }

  return async (request) => {
    const built = await getIndex()
    const result: SearchResult = { results: built.search(request.query, request.limit) }
    return { result }
  }
}
