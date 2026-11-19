/**
 * `studio.looks`: the workspace's looks library (plan decision D7). A look is the user's own `.cube` file, not
 * project content, so reading or adding to the list is no undo step.
 */

import { useLooksStore, type LooksFailure } from '@/studio/looks/store'
import type { LookEntry } from '@/studio/looks/types'
import { studioError } from '../errors'
import type { LookAddInput, LookInfo, LooksApi } from '../types'

function info(look: LookEntry): LookInfo {
  return { id: look.id, name: look.name, fileName: look.fileName, size: look.size }
}

/** Plain words for why a `.cube` text did not become a look. */
function failureMessage(failure: LooksFailure | null): string {
  switch (failure?.code) {
    case 'range':
      return `the file declares ${failure.keyword} ${failure.min} ${failure.max}; only an input range of 0 1 can be applied`
    case 'too-large':
      return `the table has ${failure.size} points per side; a look has 65 at most`
    case 'no-grid':
      return 'the file has only a 1D shaper and no 3D table'
    case 'invalid':
      return `the text is not a valid .cube file: ${failure.detail}`
    default:
      return 'the text did not become a look'
  }
}

function invalid(argument: string, message: string) {
  return studioError({ code: 'INVALID_ARGUMENT', method: 'looks.add', argument, message })
}

/** The input of `looks.add`, trimmed, or the error that names the wrong argument. */
function checkAddInput(input: LookAddInput | undefined): LookAddInput {
  const { text, fileName, name } = input ?? ({} as LookAddInput)
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw invalid('text', '"text" must be the text of a .cube file')
  }
  const file = typeof fileName === 'string' ? fileName.trim() : ''
  if (!/^.+\.cube$/i.test(file)) {
    throw invalid('fileName', `"fileName" must be a file name ending in .cube (got ${JSON.stringify(fileName)})`)
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    throw invalid('name', '"name" must be a non-empty string when given')
  }
  return { text, fileName: file, name: name?.trim() }
}

/** The error of an add the library refused: the file's own fault, or the workspace's. */
function addFailure(failure: LooksFailure | null) {
  if (failure?.code === 'read' || failure?.code === 'store') {
    return studioError({
      code: 'INTERNAL',
      method: 'looks.add',
      message: 'the looks library could not be read or written in the workspace',
      hint: 'Open a workspace folder in the app; the library lives in it.',
    })
  }
  return invalid('text', failureMessage(failure))
}

/**
 * Create the `studio.looks` namespace over the looks store.
 * @example const looks = createLooksApi()
 */
export function createLooksApi(): LooksApi {
  return {
    async list(): Promise<LookInfo[]> {
      await useLooksStore.getState().load()
      const { status, looks } = useLooksStore.getState()
      if (status !== 'ready') {
        throw studioError({
          code: 'INTERNAL',
          method: 'looks.list',
          message: 'the looks library could not be read from the workspace',
          hint: 'Open a workspace folder in the app; the library lives in it.',
        })
      }
      return looks.map(info)
    },

    async add(input: LookAddInput): Promise<LookInfo> {
      const { text, fileName, name } = checkAddInput(input)
      const entry = await useLooksStore.getState().add({ text, fileName })
      if (!entry) throw addFailure(useLooksStore.getState().error)
      if (name !== undefined && name !== entry.name) await useLooksStore.getState().rename(entry.id, name)
      const stored = useLooksStore.getState().looks.find((look) => look.id === entry.id) ?? entry
      return info(stored)
    },
  }
}
