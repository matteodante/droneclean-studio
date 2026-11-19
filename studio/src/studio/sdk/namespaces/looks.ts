/**
 * `studio.looks`: the workspace's looks library (plan decision D7). A look is the user's own `.cube` file, not
 * project content, so reading the list is no undo step.
 */

import { useLooksStore } from '@/studio/looks/store'
import { studioError } from '../errors'
import type { LookInfo, LooksApi } from '../types'

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
      return looks.map((look) => ({
        id: look.id,
        name: look.name,
        fileName: look.fileName,
        size: look.size,
      }))
    },
  }
}
