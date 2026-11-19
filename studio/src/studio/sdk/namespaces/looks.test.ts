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

  describe('add', () => {
    const CUBE = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n'

    it('adds the text through the library and answers the new look', async () => {
      const added = { ...LOOK, id: 'look-2', name: 'warm', fileName: 'warm.cube', filePath: 'warm.cube', size: 2 }
      const calls: unknown[] = []
      useLooksStore.setState({
        add: async (input) => {
          calls.push(input)
          useLooksStore.setState({ looks: [LOOK, added] })
          return added
        },
      })

      expect(await createLooksApi().add({ text: CUBE, fileName: 'warm.cube' })).toEqual({
        id: 'look-2',
        name: 'warm',
        fileName: 'warm.cube',
        size: 2,
      })
      expect(calls).toEqual([{ text: CUBE, fileName: 'warm.cube' }])
    })

    it('names the look when a name is given', async () => {
      const added = { ...LOOK, id: 'look-2', name: 'warm', fileName: 'warm.cube', filePath: 'warm.cube', size: 2 }
      useLooksStore.setState({
        add: async () => {
          useLooksStore.setState({ looks: [LOOK, added] })
          return added
        },
        rename: async (id, name) => {
          useLooksStore.setState({ looks: [LOOK, { ...added, id, name }] })
          return true
        },
      })

      const look = await createLooksApi().add({ text: CUBE, fileName: 'warm.cube', name: 'Domenica' })

      expect(look.name).toBe('Domenica')
    })

    it('throws INVALID_ARGUMENT with the reason when the text is not a look', async () => {
      useLooksStore.setState({
        add: async () => {
          useLooksStore.setState({ error: { code: 'too-large', size: 129 } })
          return null
        },
      })

      const error = await createLooksApi()
        .add({ text: CUBE, fileName: 'big.cube' })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(StudioError)
      expect((error as StudioError).code).toBe('INVALID_ARGUMENT')
      expect((error as StudioError).message).toContain('129 points per side')
    })

    it('throws INTERNAL when the library cannot be written', async () => {
      useLooksStore.setState({
        add: async () => {
          useLooksStore.setState({ error: { code: 'store' } })
          return null
        },
      })

      const error = await createLooksApi()
        .add({ text: CUBE, fileName: 'warm.cube' })
        .catch((caught: unknown) => caught)

      expect((error as StudioError).code).toBe('INTERNAL')
    })

    it('throws INVALID_ARGUMENT for a missing text or a name without .cube', async () => {
      const api = createLooksApi()
      const noText = await api.add({ text: ' ', fileName: 'a.cube' }).catch((caught: unknown) => caught)
      const badName = await api.add({ text: CUBE, fileName: 'a.txt' }).catch((caught: unknown) => caught)

      expect((noText as StudioError).code).toBe('INVALID_ARGUMENT')
      expect((badName as StudioError).code).toBe('INVALID_ARGUMENT')
    })

    it("studio.looks.add({ fileName: 'warm.cube', text: cubeText, name: 'Warm' })", async () => {
      const added = { ...LOOK, id: 'look-3', name: 'Warm', fileName: 'warm.cube', filePath: 'warm.cube', size: 2 }
      useLooksStore.setState({
        add: async () => {
          useLooksStore.setState({ looks: [LOOK, added] })
          return added
        },
      })

      expect((await createLooksApi().add({ fileName: 'warm.cube', text: CUBE, name: 'Warm' })).id).toBe('look-3')
    })
  })
})
