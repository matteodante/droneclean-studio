// The colour preset section as it ships: the hint, its one Apply press as one undo step, the
// select that changes and clears the answer, and the unset state of a clip whose file name hints
// at nothing. The `colorPresets` switch is on since slice 5.1c seated the input transform, so the
// section reads the real switch.

import { beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import type { MediaMetadata } from '@/types/storage'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { ColorPresetSection } from './ColorPresetSection'

// The English strings the section reads, which the wave's shared-file pass adds to
// `src/i18n/locales/*.json` (the exact lines are in the report).
beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      presets: {
        profile: {
          label: 'Colour profile',
          unset: 'Not set',
          suggested: 'Suggested: {{profile}}?',
          apply: 'Apply',
        },
        mixed: 'Mixed',
      },
    },
    true,
    true,
  )
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
})

const AVATA_MEDIA: MediaMetadata = {
  id: 'media-avata',
  storageType: 'workspace',
  fileName: 'DJI_20261115124704_0020_D.MP4',
  fileSize: 3_764_360_098,
  mimeType: 'video/mp4',
  droneModel: 'DJI Avata2',
  duration: 230.88065,
  width: 3840,
  height: 2880,
  fps: 59.94,
  codec: 'hevc',
  bitrate: 129_885_000,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

/** A DJI file name with no profile suffix: a clip the editor can only ask about. */
const NO_HINT_MEDIA: MediaMetadata = {
  ...AVATA_MEDIA,
  id: 'media-no-hint',
  fileName: 'DJI_20261115124704_0021.MP4',
  droneModel: undefined,
}

function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    label: 'DJI_20261115124704_0020_D.MP4',
    mediaId: AVATA_MEDIA.id,
    src: 'blob:clip-1',
    from: 0,
    durationInFrames: 13_839,
    sourceFps: 59.94,
    sourceWidth: 3840,
    sourceHeight: 2880,
    ...extra,
  }
}

const TEXT: TextItem = {
  id: 'text-1',
  trackId: 'track-1',
  type: 'text',
  label: 'Title',
  text: 'Hello',
  color: '#ffffff',
  from: 0,
  durationInFrames: 60,
}

function renderSection(items: TimelineItem[]) {
  return render(<ColorPresetSection items={items} />)
}

/**
 * The clip panel's own wiring: the items come from the store, so a change the section makes
 * comes back to it as a new selection snapshot, as it does in the panel.
 */
function StoreHarness({ itemId }: { itemId: string }) {
  const item = useItemsStore((state) => state.itemById[itemId])
  return item ? <ColorPresetSection items={[item]} /> : null
}

function renderStored(item: TimelineItem) {
  useItemsStore.getState().setItems([item])
  return render(<StoreHarness itemId={item.id} />)
}

/** The same wiring for a multi-selection: the section gets the stored items, in order. */
function SelectionHarness({ itemIds }: { itemIds: string[] }) {
  const byId = useItemsStore((state) => state.itemById)
  const items = itemIds.flatMap((id) => (byId[id] ? [byId[id]] : []))
  return <ColorPresetSection items={items} />
}

function renderSelection(items: TimelineItem[]) {
  useItemsStore.getState().setItems(items)
  return render(<SelectionHarness itemIds={items.map((item) => item.id)} />)
}

function storedInputColor(itemId: string): VideoItem['inputColor'] {
  return (useItemsStore.getState().itemById[itemId] as VideoItem | undefined)?.inputColor
}

describe('ColorPresetSection', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
    useMediaLibraryStore.setState({ mediaItems: [AVATA_MEDIA, NO_HINT_MEDIA] })
  })

  it('shows the file name’s hint with the drone model and one Apply press', () => {
    const item = clip()

    renderStored(item)

    expect(screen.getByTestId('color-preset-suggestion').textContent).toBe(
      'DJI Avata2 · Suggested: D-Log M?',
    )
    expect(screen.getByTestId('color-preset-apply').textContent).toBe('Apply')
    expect(screen.getByTestId('color-preset-select').textContent).toBe('Not set')
  })

  it('sets the profile on Apply, as one undo step', () => {
    const item = clip()
    renderStored(item)

    fireEvent.click(screen.getByTestId('color-preset-apply'))

    expect(storedInputColor(item.id)).toBe('dlog-m')
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    // The question is answered: the hint and its press are gone, the select shows the answer.
    expect(screen.queryByTestId('color-preset-apply')).toBeNull()
    expect(screen.getByTestId('color-preset-select').textContent).toBe('D-Log M')

    useTimelineCommandStore.getState().undo()
    expect(storedInputColor(item.id)).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)

    useTimelineCommandStore.getState().redo()
    expect(storedInputColor(item.id)).toBe('dlog-m')
  })

  it('changes the profile from the select, and clears it to “Not set”', async () => {
    const item = clip({ inputColor: 'dlog-m' })
    renderStored(item)

    fireEvent.click(screen.getByTestId('color-preset-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'D-Log' }))
    expect(storedInputColor(item.id)).toBe('dlog')
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    fireEvent.click(screen.getByTestId('color-preset-select'))
    fireEvent.click(await screen.findByRole('option', { name: 'Not set' }))
    expect(storedInputColor(item.id)).toBe('none')
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(2)
  })

  it('shows the unset state for a clip whose file name hints at nothing, and applies nothing', () => {
    const item = clip({
      id: 'clip-2',
      mediaId: NO_HINT_MEDIA.id,
      label: NO_HINT_MEDIA.fileName,
    })

    renderStored(item)

    expect(screen.queryByTestId('color-preset-suggestion')).toBeNull()
    expect(screen.queryByTestId('color-preset-apply')).toBeNull()
    expect(screen.getByTestId('color-preset-select').textContent).toBe('Not set')
    expect(storedInputColor(item.id)).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('renders nothing for a selection without a video clip', () => {
    useItemsStore.getState().setItems([TEXT])

    const { container } = renderSection([TEXT])

    expect(container.querySelector('[data-testid="color-preset-section"]')).toBeNull()
  })

  describe('with several clips selected', () => {
    const three = () => [clip({ id: 'a' }), clip({ id: 'b' }), clip({ id: 'c' })]

    it('sets all three D-Log M clips with one Apply, and one undo restores all three', () => {
      renderSelection(three())

      expect(screen.getByTestId('color-preset-suggestion').textContent).toBe(
        'DJI Avata2 · Suggested: D-Log M?',
      )
      fireEvent.click(screen.getByTestId('color-preset-apply'))

      expect(['a', 'b', 'c'].map(storedInputColor)).toEqual(['dlog-m', 'dlog-m', 'dlog-m'])
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
      expect(screen.getByTestId('color-preset-select').textContent).toBe('D-Log M')

      useTimelineCommandStore.getState().undo()
      expect(['a', 'b', 'c'].map(storedInputColor)).toEqual([undefined, undefined, undefined])
      useTimelineCommandStore.getState().redo()
      expect(['a', 'b', 'c'].map(storedInputColor)).toEqual(['dlog-m', 'dlog-m', 'dlog-m'])
    })

    it('sets all three from the select as one undo step', async () => {
      renderSelection(three())

      fireEvent.click(screen.getByTestId('color-preset-select'))
      fireEvent.click(await screen.findByRole('option', { name: 'D-Log' }))

      expect(['a', 'b', 'c'].map(storedInputColor)).toEqual(['dlog', 'dlog', 'dlog'])
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
      useTimelineCommandStore.getState().undo()
      expect(['a', 'b', 'c'].map(storedInputColor)).toEqual([undefined, undefined, undefined])
    })

    it('shows Mixed when the profiles differ, and a choice makes them equal', async () => {
      renderSelection([
        clip({ id: 'a', inputColor: 'dlog-m' }),
        clip({ id: 'b', inputColor: 'dlog' }),
      ])

      expect(screen.getByTestId('color-preset-select').textContent).toBe('Mixed')

      fireEvent.click(screen.getByTestId('color-preset-select'))
      fireEvent.click(await screen.findByRole('option', { name: 'D-Log M' }))

      expect(['a', 'b'].map(storedInputColor)).toEqual(['dlog-m', 'dlog-m'])
      expect(screen.getByTestId('color-preset-select').textContent).toBe('D-Log M')
    })

    it('Apply answers only the clips still asked', () => {
      renderSelection([clip({ id: 'a', inputColor: 'none' }), clip({ id: 'b' })])

      fireEvent.click(screen.getByTestId('color-preset-apply'))

      expect(['a', 'b'].map(storedInputColor)).toEqual(['none', 'dlog-m'])
    })

    it('sets the two videos of a selection that also holds an image', async () => {
      const image = {
        id: 'img',
        trackId: 'track-1',
        type: 'image',
        label: 'still.png',
        src: 'blob:img',
        from: 0,
        durationInFrames: 30,
      } as TimelineItem
      renderSelection([clip({ id: 'a' }), image, clip({ id: 'b' })])

      fireEvent.click(screen.getByTestId('color-preset-select'))
      fireEvent.click(await screen.findByRole('option', { name: 'D-Log M' }))

      expect(['a', 'b'].map(storedInputColor)).toEqual(['dlog-m', 'dlog-m'])
      expect(
        (useItemsStore.getState().itemById['img'] as VideoItem | undefined)?.inputColor,
      ).toBeUndefined()
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    })
  })
})
