// @vitest-environment node
//
// The registry the render seat calls (design 5.1 §4.4, §4.6, §6 slice 5.2b): a 65³ `.cube` in the
// workspace's library reaches a fake `LookStage` parsed, a repeated registration uploads nothing
// again, a look the project stopped using is released, and a look id with no file is skipped.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  asHandle,
  createRoot,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import type { LookStage } from '@/studio/color/gpu/look-pass'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { makeTimelineTrack, makeTimelineVideoItem } from '@/features/timeline/test-helpers'
import { isLookRegistered, lookTable, registerLooksWith } from './registry'
import { useLooksStore } from './store'

/** A `.cube` text of `size³` points, each entry its integer coordinates (0…size − 1). */
function gridText(size: number): string {
  const lines: string[] = [`LUT_3D_SIZE ${size}`]
  for (let blue = 0; blue < size; blue++) {
    for (let green = 0; green < size; green++) {
      for (let red = 0; red < size; red++) lines.push(`${red} ${green} ${blue}`)
    }
  }
  return lines.join('\n')
}

function fakeStage(): LookStage & {
  setLook: ReturnType<typeof vi.fn<LookStage['setLook']>>
  removeLook: ReturnType<typeof vi.fn<LookStage['removeLook']>>
} {
  return {
    encode: vi.fn<LookStage['encode']>(),
    setLook: vi.fn<LookStage['setLook']>(),
    removeLook: vi.fn<LookStage['removeLook']>(),
    destroy: vi.fn<LookStage['destroy']>(),
  }
}

const TRACK = makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })

function clipWithLook(id: string): void {
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: 'clip-1', trackId: TRACK.id, look: { id, intensity: 0.6 } }),
    ])
}

let root: MemDir

beforeEach(() => {
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  useLooksStore.setState({ status: 'idle', looks: [], error: null })
  useItemsStore.getState().setTracks([TRACK])
  useItemsStore.getState().setItems([])
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('registerLooksWith', () => {
  it('gives a real 65³ look to a stage, parsed and only once', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: gridText(65), fileName: 'Sixty five.cube' })
    expect(entry?.size).toBe(65)
    clipWithLook(entry?.id ?? '')

    const stage = fakeStage()
    await registerLooksWith(stage)

    expect(stage.setLook).toHaveBeenCalledTimes(1)
    const [id, cube] = stage.setLook.mock.calls[0] as [string, { lut3d: { size: number } }]
    expect(id).toBe(entry?.id)
    expect(cube.lut3d.size).toBe(65)

    // A second call after an unrelated edit uploads nothing again.
    await registerLooksWith(stage)
    expect(stage.setLook).toHaveBeenCalledTimes(1)
    expect(isLookRegistered(stage, entry?.id ?? '')).toBe(true)
    expect(isLookRegistered(stage, 'another-look')).toBe(false)
  })

  it('releases a look the project stopped using', async () => {
    const entry = await useLooksStore.getState().add({ text: gridText(2), fileName: 'Small.cube' })
    clipWithLook(entry?.id ?? '')
    const stage = fakeStage()
    await registerLooksWith(stage)

    useItemsStore.getState().setItems([])
    await registerLooksWith(stage)

    expect(stage.removeLook).toHaveBeenCalledWith(entry?.id)
    expect(stage.setLook).toHaveBeenCalledTimes(1)
  })

  it('skips a clip whose look id has no file, rather than failing', async () => {
    clipWithLook('look-that-never-existed')
    const stage = fakeStage()

    await expect(registerLooksWith(stage)).resolves.toBeUndefined()
    expect(stage.setLook).not.toHaveBeenCalled()
  })

  it('reads one look’s table once and gives the same table back', async () => {
    const entry = await useLooksStore.getState().add({ text: gridText(2), fileName: 'Small.cube' })
    const id = entry?.id ?? ''

    const first = await lookTable(id)
    const again = await lookTable(id)

    expect(first).not.toBeNull()
    expect(again).toBe(first)
    expect(await lookTable('not-a-look')).toBeNull()
  })

  it('uploads a look again after its row order was retried', async () => {
    const blueFastest = [
      'LUT_3D_SIZE 2',
      '0 0 0',
      '0 0 1',
      '0 1 0',
      '0 1 1',
      '1 0 0',
      '1 0 1',
      '1 1 0',
      '1 1 1',
    ].join('\n')
    const entry = await useLooksStore.getState().add({ text: blueFastest, fileName: 'Blue.cube' })
    clipWithLook(entry?.id ?? '')
    const stage = fakeStage()
    await registerLooksWith(stage)
    expect(stage.setLook).toHaveBeenCalledTimes(1)

    await useLooksStore.getState().setEntryOrder(entry?.id ?? '', 'blue-fastest')
    await registerLooksWith(stage)

    expect(stage.setLook).toHaveBeenCalledTimes(2)
    const [, cube] = stage.setLook.mock.calls[1] as [string, { lut3d: { data: Float32Array } }]
    // Entry (red, green, blue) = (1, 0, 0) of the identity grid, read blue-fastest.
    expect(Array.from(cube.lut3d.data.slice(3, 6))).toEqual([1, 0, 0])
  })
})
