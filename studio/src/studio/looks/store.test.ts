// @vitest-environment node
//
// The looks library's state (design 5.1 §4.4, §6 slice 5.2b): adding a `.cube` writes it into the
// workspace and survives a reload of the store, removing it takes its file and its parsed table
// with it, renaming it rewrites the index, and the row-order retry replaces the parsed table.

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { readJson } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { useLooksStore } from './store'
import { cachedLookTable } from './tables'
import type { LooksIndexFile } from './types'

/** The identity table's rows, red fastest. */
const IDENTITY_RED_FASTEST = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const

/** The identity table's rows, blue fastest: the order some writers emit. */
const IDENTITY_BLUE_FASTEST = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 1],
  [1, 0, 0],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1],
] as const

function cubeText(rows: readonly (readonly [number, number, number])[]): string {
  return ['TITLE "Test look"', 'LUT_3D_SIZE 2', ...rows.map(([r, g, b]) => `${r} ${g} ${b}`)].join(
    '\n',
  )
}

async function indexOnDisk(root: MemDir): Promise<LooksIndexFile | null> {
  return readJson<LooksIndexFile>(asHandle(root), ['looks', 'index.json'])
}

let root: MemDir

beforeEach(() => {
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  useLooksStore.setState({ status: 'idle', looks: [], error: null })
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('useLooksStore', () => {
  it('adds a .cube to the workspace and lists it', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Test look.cube' })

    expect(entry).not.toBeNull()
    expect(entry?.name).toBe('Test look')
    expect(entry?.size).toBe(2)
    expect(useLooksStore.getState().looks).toEqual([entry])
    expect(useLooksStore.getState().error).toBeNull()
    await expect(indexOnDisk(root)).resolves.toMatchObject({ version: 1, looks: [entry] })
    await expect(readFileText(root, 'looks', entry?.id ?? '', 'Test look.cube')).resolves.toBe(
      cubeText(IDENTITY_RED_FASTEST),
    )
  })

  it('survives a reload: a fresh store reads the look back from the workspace', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Test look.cube' })

    // A reload: no in-memory list, the same workspace folder.
    useLooksStore.setState({ status: 'idle', looks: [], error: null })
    await useLooksStore.getState().load()

    expect(useLooksStore.getState().status).toBe('ready')
    expect(useLooksStore.getState().looks).toEqual([entry])
  })

  it('adds a second look beside the first, keeping the stored list', async () => {
    await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'one.cube' })
    await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'two.cube' })

    expect(useLooksStore.getState().looks).toHaveLength(2)
    await expect(indexOnDisk(root)).resolves.toMatchObject({
      looks: [{ name: 'Test look' }, { name: 'Test look' }],
    })
  })

  it('refuses a file that is too large, or whose input range is not 0…1, and writes nothing', async () => {
    const tooLarge = await useLooksStore
      .getState()
      .add({ text: 'LUT_3D_SIZE 66\n', fileName: 'big.cube' })
    expect(tooLarge).toBeNull()
    expect(useLooksStore.getState().error).toEqual({ code: 'too-large', size: 66 })

    const ranged = await useLooksStore.getState().add({
      text: ['LUT_3D_INPUT_RANGE 0 2', ...cubeText(IDENTITY_RED_FASTEST).split('\n')].join('\n'),
      fileName: 'range.cube',
    })
    expect(ranged).toBeNull()
    expect(useLooksStore.getState().error).toMatchObject({ code: 'range', min: '0', max: '2' })

    expect(useLooksStore.getState().looks).toEqual([])
    await expect(indexOnDisk(root)).resolves.toBeNull()
  })

  it('renames a look in the list and in the index', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Test look.cube' })

    await expect(useLooksStore.getState().rename(entry?.id ?? '', 'Evening warm')).resolves.toBe(
      true,
    )

    expect(useLooksStore.getState().looks[0]?.name).toBe('Evening warm')
    await expect(indexOnDisk(root)).resolves.toMatchObject({ looks: [{ name: 'Evening warm' }] })
  })

  it('does not rename a look to an empty name', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Test look.cube' })

    await expect(useLooksStore.getState().rename(entry?.id ?? '', '   ')).resolves.toBe(false)
    expect(useLooksStore.getState().looks[0]?.name).toBe('Test look')
  })

  it('removes a look with its file and its parsed table', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Test look.cube' })
    expect(cachedLookTable(entry?.id ?? '')).toBeDefined()

    await expect(useLooksStore.getState().remove(entry?.id ?? '')).resolves.toBe(true)

    expect(useLooksStore.getState().looks).toEqual([])
    expect(cachedLookTable(entry?.id ?? '')).toBeUndefined()
    await expect(readFileText(root, 'looks', entry?.id ?? '', 'Test look.cube')).resolves.toBeNull()
    await expect(indexOnDisk(root)).resolves.toMatchObject({ looks: [] })
  })

  it('re-reads a blue-fastest file in the other row order, replacing the parsed table', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_BLUE_FASTEST), fileName: 'blue.cube' })
    const id = entry?.id ?? ''
    // Read as red-fastest, entry (1, 0, 0) is the file's second row: the blue channel.
    expect(Array.from(cachedLookTable(id)?.lut3d?.data.slice(3, 6) ?? [])).toEqual([0, 0, 1])

    await expect(useLooksStore.getState().setEntryOrder(id, 'blue-fastest')).resolves.toBe(true)

    expect(useLooksStore.getState().looks[0]?.entryOrder).toBe('blue-fastest')
    expect(Array.from(cachedLookTable(id)?.lut3d?.data.slice(3, 6) ?? [])).toEqual([1, 0, 0])
    await expect(indexOnDisk(root)).resolves.toMatchObject({
      looks: [{ entryOrder: 'blue-fastest' }],
    })
  })

  it('reports a failure the dialog met itself', () => {
    useLooksStore.getState().report({ code: 'unavailable' })

    expect(useLooksStore.getState().error).toEqual({ code: 'unavailable' })
    useLooksStore.getState().report(null)
    expect(useLooksStore.getState().error).toBeNull()
  })
})
