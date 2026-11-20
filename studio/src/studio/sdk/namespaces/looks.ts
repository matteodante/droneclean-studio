/**
 * `studio.looks`: the workspace's looks library (plan decision D7). A look is the user's own `.cube` file, not
 * project content, so reading or adding to the list is no undo step.
 */

import { useLooksStore, type LooksFailure } from '@/studio/looks/store'
import type { LookEntry } from '@/studio/looks/types'
import { clipIdsUsingLook } from '@/studio/looks/usage'
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

/** The library with the stored list read, or the error of a library the workspace cannot give. */
async function readLibrary(method: string): Promise<readonly LookEntry[]> {
  await useLooksStore.getState().load()
  const { status, looks } = useLooksStore.getState()
  if (status !== 'ready') {
    throw studioError({
      code: 'INTERNAL',
      method,
      message: 'the looks library could not be read from the workspace',
      hint: 'Open a workspace folder in the app; the library lives in it.',
    })
  }
  return looks
}

/** The look an id names. @throws NOT_FOUND when the library has no such look. */
function requireLook(looks: readonly LookEntry[], id: unknown, method: string): LookEntry {
  const found = typeof id === 'string' ? looks.find((look) => look.id === id) : undefined
  if (found !== undefined) return found
  throw studioError({
    code: 'NOT_FOUND',
    method,
    argument: 'id',
    message: `no look of the library has the id ${JSON.stringify(id)}`,
    valid: looks.map((look) => look.id),
    hint: 'The ids come from studio.looks.list().',
  })
}

/** The error of a change the library accepted but the workspace did not store. */
function storeFailure(method: string) {
  return studioError({
    code: 'INTERNAL',
    method,
    message: 'the looks library could not be written in the workspace',
    hint: 'Open a workspace folder in the app; the library lives in it.',
  })
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

    async rename(id: string, name: string): Promise<LookInfo> {
      const method = 'looks.rename'
      const look = requireLook(await readLibrary(method), id, method)
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw studioError({
          code: 'INVALID_ARGUMENT',
          method,
          argument: 'name',
          message: '"name" must be a non-empty string',
        })
      }
      if (!(await useLooksStore.getState().rename(look.id, name))) throw storeFailure(method)
      const stored = useLooksStore.getState().looks.find((entry) => entry.id === look.id)
      return info(stored ?? { ...look, name: name.trim() })
    },

    async remove(id: string): Promise<LookInfo> {
      const method = 'looks.remove'
      const look = requireLook(await readLibrary(method), id, method)
      const using = clipIdsUsingLook(look.id)
      if (using.length > 0) {
        throw studioError({
          code: 'CONFLICT',
          method,
          argument: 'id',
          message: `the look "${look.name}" is still used by ${using.length} clip${using.length === 1 ? '' : 's'}: ${using.join(', ')}`,
          hint: 'Clear it first with studio.clips.setLook(clipId, null) on each of those clips.',
        })
      }
      if (!(await useLooksStore.getState().remove(look.id))) throw storeFailure(method)
      return info(look)
    },
  }
}
