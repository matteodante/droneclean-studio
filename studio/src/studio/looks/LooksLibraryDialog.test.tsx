// The looks library dialog (design 5.1 §4.4, §6 slice 5.2b): its empty state, a dropped `.cube`,
// the refusals in plain words, renaming, the removal question that says how many clips use the
// look, and the row-order retry a blue-fastest file needs.

import { beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { makeTimelineTrack, makeTimelineVideoItem } from '@/features/timeline/test-helpers'
import {
  asHandle,
  createRoot,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { LooksLibraryDialog } from './LooksLibraryDialog'
import { useLooksStore } from './store'

beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { cancel: 'Cancel' },
      presets: {
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
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => undefined
    Element.prototype.releasePointerCapture = () => undefined
  }
})

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
  return [
    'TITLE "Warm evening"',
    'LUT_3D_SIZE 2',
    ...rows.map(([r, g, b]) => `${r} ${g} ${b}`),
  ].join('\n')
}

function dropZone(): HTMLElement {
  return screen.getByTestId('looks-drop-zone')
}

function fileOf(text: string, name = 'Warm evening.cube'): File {
  // The dialog reads a dropped file with `File.text()`, which every Chromium has; jsdom's File
  // does not implement it, so the test hands it the two members the dialog uses.
  return { name, text: async () => text } as unknown as File
}

function renderDialog() {
  return render(<LooksLibraryDialog open onOpenChange={() => undefined} />)
}

let root: MemDir

beforeEach(() => {
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  useLooksStore.setState({ status: 'idle', looks: [], error: null })
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([])
})

describe('LooksLibraryDialog', () => {
  it('says the library is empty and offers Add .cube', () => {
    renderDialog()

    expect(screen.getByText('No looks yet. Drop a .cube file here, or use Add .cube.')).toBeTruthy()
    expect(screen.getByTestId('look-add')).toBeTruthy()
    expect(screen.queryByTestId('look-row')).toBeNull()
  })

  it('adds a dropped .cube file to the library', async () => {
    renderDialog()

    fireEvent.drop(dropZone(), {
      dataTransfer: { files: [fileOf(cubeText(IDENTITY_RED_FASTEST))] },
    })

    await waitFor(() => {
      expect(useLooksStore.getState().looks).toHaveLength(1)
    })
    expect(screen.getByTestId('look-row').textContent).toContain('Warm evening')
    expect(useLooksStore.getState().looks[0]?.size).toBe(2)
  })

  it('refuses a look whose input range is not 0…1, in plain words', async () => {
    renderDialog()
    const ranged = ['LUT_3D_INPUT_RANGE 0 2', ...cubeText(IDENTITY_RED_FASTEST).split('\n')].join(
      '\n',
    )

    fireEvent.drop(dropZone(), { dataTransfer: { files: [fileOf(ranged, 'Ranged.cube')] } })

    expect((await screen.findByTestId('looks-error')).textContent).toBe(
      'This look expects inputs from 0 to 2, not 0 to 1.',
    )
    expect(useLooksStore.getState().looks).toHaveLength(0)
  })

  it('renames a look', async () => {
    await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Warm.cube' })
    renderDialog()

    const row = screen.getByTestId('look-row')
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }))
    const input = within(row).getByTestId('look-rename-input')
    fireEvent.change(input, { target: { value: 'Golden hour' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(useLooksStore.getState().looks[0]?.name).toBe('Golden hour')
    })
    expect(screen.getByTestId('look-row').textContent).toContain('Golden hour')
  })

  it('asks before removing a look that clips use, and says how many', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Warm.cube' })
    const id = entry?.id ?? ''
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({ id: 'clip-1', look: { id, intensity: 1 } }),
        makeTimelineVideoItem({ id: 'clip-2', look: { id, intensity: 0.5 } }),
      ])
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    const confirm = await screen.findByTestId('look-remove-confirm')
    expect(confirm.textContent).toContain('Clips using this look: 2. Remove it anyway?')
    expect(useLooksStore.getState().looks).toHaveLength(1)

    fireEvent.click(screen.getByTestId('look-remove-confirm-button'))

    await waitFor(() => {
      expect(useLooksStore.getState().looks).toHaveLength(0)
    })
    expect(screen.queryByTestId('look-row')).toBeNull()
  })

  it('keeps the look when the removal is cancelled', async () => {
    await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_RED_FASTEST), fileName: 'Warm.cube' })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('look-remove-confirm')).toBeNull()
    expect(useLooksStore.getState().looks).toHaveLength(1)
  })

  it('retries a blue-fastest file in the other row order, and shows which order it is read in', async () => {
    const entry = await useLooksStore
      .getState()
      .add({ text: cubeText(IDENTITY_BLUE_FASTEST), fileName: 'Blue.cube' })
    renderDialog()
    expect(screen.getByTestId('look-row').textContent).not.toContain('blue-first')

    fireEvent.click(screen.getByTestId('look-row-order'))

    await waitFor(() => {
      expect(useLooksStore.getState().looks[0]?.entryOrder).toBe('blue-fastest')
    })
    expect(screen.getByTestId('look-row').textContent).toContain('blue-first')
    expect(useLooksStore.getState().looks[0]?.id).toBe(entry?.id)

    fireEvent.click(screen.getByTestId('look-row-order'))

    await waitFor(() => {
      expect(useLooksStore.getState().looks[0]?.entryOrder).toBe('red-fastest')
    })
    expect(screen.getByTestId('look-row').textContent).not.toContain('blue-first')
  })
})
