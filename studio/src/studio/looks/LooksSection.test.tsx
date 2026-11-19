// The clip panel's looks area (design 5.1 §4.4, §6 slice 5.2b), with the switch the look's render
// seat will turn on: the picker lists the workspace's library, picking a look is one undo step and
// keeps the blend, the intensity slider is one undo step, a look that is not in the library still
// shows, and the library dialog is reached from the same select.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import {
  asHandle,
  createRoot,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import type { VideoItem } from '@/types/timeline'
import { useLooksStore } from './store'
import type { LookEntry } from './types'
import { LooksSection } from './LooksSection'

// The state the look's render seat ships: the switch is on.
vi.mock('@/studio/feature-switches', () => ({
  FEATURE_SWITCHES: {
    shadowRemovalClean: false,
    looks: true,
    stabilization: false,
    speedCurve: false,
  },
  isFeatureShown: (id: string) => id === 'looks',
}))

// The English strings the section reads, which the wave's shared-file pass adds to
// `src/i18n/locales/*.json` (the exact lines are in the report).
beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { cancel: 'Cancel' },
      presets: {
        mixed: 'Mixed',
        looks: {
          title: 'Looks',
          unset: 'None',
          intensity: 'Intensity',
          manage: 'Manage looks…',
          add: 'Add .cube',
          rename: 'Rename',
          remove: 'Remove',
          rowOrder: 'Try the other row order',
          blueFirst: 'blue-first',
          missing: 'Look not in the library',
          empty: 'No looks yet. Drop a .cube file here, or use Add .cube.',
          removeConfirm: 'Remove “{{name}}” from the library?',
          removeUsed: 'Clips using this look: {{count}}. Remove it anyway?',
          error: {
            range: 'This look expects inputs from {{min}} to {{max}}, not 0 to 1.',
            tooLarge: 'This look has {{size}} points per side; a look can have at most {{max}}.',
            noGrid: 'This file holds only a 1D curve, not a 3D look.',
            invalid: 'This file is not a valid .cube look: {{detail}}',
            read: 'The .cube file could not be read.',
            store: 'The looks library could not be saved in the workspace folder.',
            unavailable: 'This browser cannot open a file picker.',
          },
        },
      },
    },
    true,
    true,
  )
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => undefined
  }
})

const CUBE = [
  'TITLE "Warm evening"',
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n')

/** The same table without a `TITLE`, so the look is named after its file. */
const CUBE_NO_TITLE = CUBE.split('\n').slice(1).join('\n')

function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    label: 'DJI_20261115124704_0020_D.MP4',
    src: 'blob:clip-1',
    from: 0,
    durationInFrames: 60,
    sourceFps: 59.94,
    sourceWidth: 3840,
    sourceHeight: 2880,
    ...extra,
  }
}

/**
 * The clip panel's own wiring: the items come from the store, so a change the section makes comes
 * back to it as a new selection snapshot, as it does in the panel.
 */
function StoreHarness({ itemIds }: { itemIds: string[] }) {
  const byId = useItemsStore((state) => state.itemById)
  const items = itemIds.flatMap((id) => {
    const item = byId[id]
    return item?.type === 'video' ? [item] : []
  })
  return <LooksSection items={items} />
}

function renderStored(...clips: VideoItem[]) {
  useItemsStore.getState().setItems(clips)
  return render(<StoreHarness itemIds={clips.map((c) => c.id)} />)
}

function storedLook(itemId: string): VideoItem['look'] {
  const item = useItemsStore.getState().itemById[itemId]
  return item?.type === 'video' ? item.look : undefined
}

let root: MemDir
let warmEvening: LookEntry

beforeEach(async () => {
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  useLooksStore.setState({ status: 'idle', looks: [], error: null })
  useItemsStore.getState().setItems([])
  useTimelineCommandStore.getState().clearHistory()
  const entry = await useLooksStore.getState().add({ text: CUBE, fileName: 'Warm evening.cube' })
  if (entry === null) throw new Error('the test look was not added')
  warmEvening = entry
})

describe('LooksSection', () => {
  it('picks a look from the library as one undo step', async () => {
    const item = clip()
    renderStored(item)

    expect(screen.getByTestId('look-select').textContent).toBe('None')

    fireEvent.click(screen.getByTestId('look-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'Warm evening' }))

    expect(storedLook(item.id)).toEqual({ id: warmEvening.id, intensity: 1 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(screen.getByTestId('look-select').textContent).toBe('Warm evening')

    useTimelineCommandStore.getState().undo()
    expect(storedLook(item.id)).toBeUndefined()

    useTimelineCommandStore.getState().redo()
    expect(storedLook(item.id)).toEqual({ id: warmEvening.id, intensity: 1 })
  })

  it('clears the look back to None as one undo step', async () => {
    const item = clip({ look: { id: warmEvening.id, intensity: 0.4 } })
    renderStored(item)

    fireEvent.click(screen.getByTestId('look-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'None' }))

    expect(storedLook(item.id)).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('changes the intensity in percent as one undo step', () => {
    const item = clip({ look: { id: warmEvening.id, intensity: 1 } })
    renderStored(item)

    fireEvent.click(screen.getByText('100%'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '40' } })
    fireEvent.blur(screen.getByRole('textbox'))

    expect(storedLook(item.id)).toEqual({ id: warmEvening.id, intensity: 0.4 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(screen.getByText('40%')).toBeTruthy()

    useTimelineCommandStore.getState().undo()
    expect(storedLook(item.id)).toEqual({ id: warmEvening.id, intensity: 1 })
  })

  it('keeps the blend when another look is picked', async () => {
    const second = await useLooksStore
      .getState()
      .add({ text: CUBE_NO_TITLE, fileName: 'Second.cube' })
    const item = clip({ look: { id: warmEvening.id, intensity: 0.4 } })
    renderStored(item)

    fireEvent.click(screen.getByTestId('look-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'Second' }))

    expect(storedLook(item.id)).toEqual({ id: second?.id, intensity: 0.4 })
  })

  it('shows a look that is no longer in the library instead of hiding it', () => {
    const item = clip({ look: { id: 'look-gone', intensity: 0.5 } })
    renderStored(item)

    expect(screen.getByTestId('look-select').textContent).toBe('Look not in the library')
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('opens the library dialog from the look select', async () => {
    renderStored(clip())

    fireEvent.click(screen.getByTestId('look-select'))
    fireEvent.click(await screen.findByTestId('look-manage'))

    expect(await screen.findByTestId('looks-library-dialog')).toBeTruthy()
    expect(screen.getByTestId('look-row')).toBeTruthy()
  })

  it('sets one look on three selected clips as one undo step, each keeping its blend', async () => {
    const a = clip({ id: 'a', look: { id: 'look-gone', intensity: 0.4 } })
    const b = clip({ id: 'b' })
    const c = clip({ id: 'c' })
    renderStored(a, b, c)

    fireEvent.click(screen.getByTestId('look-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'Warm evening' }))

    expect(storedLook('a')).toEqual({ id: warmEvening.id, intensity: 0.4 })
    expect(storedLook('b')).toEqual({ id: warmEvening.id, intensity: 1 })
    expect(storedLook('c')).toEqual({ id: warmEvening.id, intensity: 1 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()
    expect(storedLook('a')).toEqual({ id: 'look-gone', intensity: 0.4 })
    expect(storedLook('b')).toBeUndefined()
    expect(storedLook('c')).toBeUndefined()
  })

  it('shows Mixed when the looks differ, and None clears them all in one step', async () => {
    renderStored(clip({ id: 'a', look: { id: warmEvening.id, intensity: 1 } }), clip({ id: 'b' }))

    expect(screen.getByTestId('look-select').textContent).toBe('Mixed')

    fireEvent.click(screen.getByTestId('look-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'None' }))

    expect(storedLook('a')).toBeUndefined()
    expect(storedLook('b')).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('moves the intensity of every selected clip that has a look, in one step', () => {
    renderStored(
      clip({ id: 'a', look: { id: warmEvening.id, intensity: 1 } }),
      clip({ id: 'b', look: { id: warmEvening.id, intensity: 0.5 } }),
      clip({ id: 'c' }),
    )

    fireEvent.click(screen.getByText('100%'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '30' } })
    fireEvent.blur(screen.getByRole('textbox'))

    expect(storedLook('a')).toEqual({ id: warmEvening.id, intensity: 0.3 })
    expect(storedLook('b')).toEqual({ id: warmEvening.id, intensity: 0.3 })
    expect(storedLook('c')).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })
})
