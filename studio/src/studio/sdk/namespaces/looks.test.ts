// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useLooksStore } from '@/studio/looks/store'
import { StudioError } from '../errors'
import { createLooksApi } from './looks'

const LOOK = {
  id: 'look-1',
  name: 'Teal',
  fileName: 'teal.cube',
  filePath: 'teal.cube',
  size: 33,
  hasShaper: false,
  entryOrder: 'red-fastest' as const,
  hash: 'h',
  addedAt: 1,
}

describe('studio.looks', () => {
  beforeEach(() => {
    useLooksStore.setState({ status: 'ready', looks: [LOOK], error: null })
  })

  describe('list', () => {
    it('names the looks of the library with the ids clips.setLook takes', async () => {
      expect(await createLooksApi().list()).toEqual([
        { id: 'look-1', name: 'Teal', fileName: 'teal.cube', size: 33 },
      ])
    })

    it('throws INTERNAL when the library cannot be read', async () => {
      useLooksStore.setState({
        status: 'error',
        looks: [],
        // The store retries a failed read; the library's own read fails here too.
        load: async () => undefined,
      })

      const error = await createLooksApi()
        .list()
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(StudioError)
      expect((error as StudioError).code).toBe('INTERNAL')
    })

    it('studio.looks.list()', async () => {
      expect(await createLooksApi().list()).toHaveLength(1)
    })
  })
})
