// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { makeTimelineVideoItem, resetTimelineCompositionTestState } from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useLooksStore } from '@/studio/looks/store'
import { StudioError } from '../errors'
import { createLooksApi } from './looks'

/** The workspace folder's looks files: the index and the removal are recorded, not written. */
const workspace = vi.hoisted(() => ({
  writeIndex: vi.fn(async () => undefined),
  removeFiles: vi.fn(async () => undefined),
}))
vi.mock('@/studio/looks/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/studio/looks/workspace')>()),
  writeLooksIndex: workspace.writeIndex,
  removeLookFiles: workspace.removeFiles,
}))

/** What an api call rejected with. */
async function rejection(run: () => Promise<unknown>): Promise<StudioError> {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(StudioError)
  return error as StudioError
}

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
    // A test that replaced a store action must not leak it into the next one.
    useLooksStore.setState({ ...useLooksStore.getInitialState(), status: 'ready', looks: [LOOK], error: null })
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

  describe('rename', () => {
    beforeEach(() => {
      workspace.writeIndex.mockReset()
      workspace.writeIndex.mockResolvedValue(undefined)
    })

    it('renames the look, keeps its id and writes the index', async () => {
      const look = await createLooksApi().rename('look-1', '  Warm  ')

      expect(look).toEqual({ id: 'look-1', name: 'Warm', fileName: 'teal.cube', size: 33 })
      expect(useLooksStore.getState().looks[0]?.name).toBe('Warm')
      expect(workspace.writeIndex).toHaveBeenCalledTimes(1)
    })

    it('throws NOT_FOUND for an id outside the library', async () => {
      const error = await rejection(() => createLooksApi().rename('nope', 'Warm'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.valid).toEqual(['look-1'])
    })

    it('throws INVALID_ARGUMENT for an empty name', async () => {
      const error = await rejection(() => createLooksApi().rename('look-1', '  '))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('name')
      expect(useLooksStore.getState().looks[0]?.name).toBe('Teal')
    })

    it('throws INTERNAL when the index cannot be written', async () => {
      workspace.writeIndex.mockRejectedValue(new Error('disk'))

      const error = await rejection(() => createLooksApi().rename('look-1', 'Warm'))

      expect(error.code).toBe('INTERNAL')
      expect(useLooksStore.getState().looks[0]?.name).toBe('Teal')
    })

    it("studio.looks.rename('look-1', 'Warm')", async () => {
      expect((await createLooksApi().rename('look-1', 'Warm')).name).toBe('Warm')
    })
  })

  describe('remove', () => {
    beforeEach(() => {
      resetTimelineCompositionTestState()
      workspace.writeIndex.mockReset()
      workspace.writeIndex.mockResolvedValue(undefined)
      workspace.removeFiles.mockReset()
      workspace.removeFiles.mockResolvedValue(undefined)
    })

    it('removes an unused look and its files, and answers the look that went', async () => {
      const removed = await createLooksApi().remove('look-1')

      expect(removed).toEqual({ id: 'look-1', name: 'Teal', fileName: 'teal.cube', size: 33 })
      expect(useLooksStore.getState().looks).toEqual([])
      expect(workspace.removeFiles).toHaveBeenCalledWith('look-1')
    })

    it('throws CONFLICT naming the clips that still use the look, and removes nothing', async () => {
      useItemsStore.setState({
        items: [
          makeTimelineVideoItem({ id: 'c1', look: { id: 'look-1', intensity: 1 } }),
          makeTimelineVideoItem({ id: 'c2', look: { id: 'look-1', intensity: 0.5 } }),
          makeTimelineVideoItem({ id: 'c3' }),
        ],
      })

      const error = await rejection(() => createLooksApi().remove('look-1'))

      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('c1, c2')
      expect(error.message).not.toContain('c3')
      expect(error.hint).toContain('clips.setLook')
      expect(useLooksStore.getState().looks).toHaveLength(1)
      expect(workspace.removeFiles).not.toHaveBeenCalled()
    })

    it('removes the look once the clips have let go of it', async () => {
      useItemsStore.setState({ items: [makeTimelineVideoItem({ id: 'c1' })] })

      await createLooksApi().remove('look-1')

      expect(useLooksStore.getState().looks).toEqual([])
    })

    it('throws NOT_FOUND for an id outside the library', async () => {
      const error = await rejection(() => createLooksApi().remove('nope'))

      expect(error.code).toBe('NOT_FOUND')
    })

    it('throws INTERNAL when the index cannot be written, and keeps the look', async () => {
      workspace.writeIndex.mockRejectedValue(new Error('disk'))

      const error = await rejection(() => createLooksApi().remove('look-1'))

      expect(error.code).toBe('INTERNAL')
      expect(useLooksStore.getState().looks).toHaveLength(1)
    })

    it("studio.looks.remove('look-1')", async () => {
      expect((await createLooksApi().remove('look-1')).id).toBe('look-1')
    })
  })
})
