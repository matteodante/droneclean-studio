/**
 * The clip panel's stabilization section mounted in the benchmark page, for the controls proof (task 6.4,
 * `bench/measurements/stabilization-controls.mjs`): the section itself (the app's component, its real hook, the timeline
 * store, the page's stabilization host with the real engine), with one clip in the timeline store; whatever the section
 * stores is handed back to the page, which draws the clip from it.
 */
import { createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { StabilizationSection } from '@/studio/stabilization/ui/StabilizationSection'
import type { TimelineItem, VideoItem } from '@/types/timeline'

let root: Root | null = null
let unsubscribe: (() => void) | null = null

function Harness({ itemId }: { itemId: string }): ReactElement | null {
  const item = useItemsStore((state) => state.itemById[itemId])
  return item ? createElement(StabilizationSection, { items: [item] }) : null
}

/**
 * Puts `item` in the timeline store and shows its section; `onItem` is called with the clip each time the store changes
 * it (a switch, a control, an undo). Returns the id of the container the section is drawn in.
 */
export function mountStabilizationControls(
  item: VideoItem,
  fps: number,
  onItem: (item: VideoItem) => void,
): string {
  unmountStabilizationControls()
  useTimelineSettingsStore.setState({ fps })
  useItemsStore.getState().setItems([item as TimelineItem])
  useTimelineCommandStore.getState().clearHistory?.()
  unsubscribe = useItemsStore.subscribe((state, previous) => {
    const next = state.itemById[item.id]
    if (next && next !== previous.itemById[item.id]) onItem(next as VideoItem)
  })
  const container = document.createElement('div')
  container.id = 'stabilization-controls-host'
  container.style.cssText = 'position:fixed;top:0;right:0;width:320px;background:#111;color:#eee;padding:8px;z-index:10'
  document.body.append(container)
  root = createRoot(container)
  root.render(
    createElement(I18nextProvider, { i18n }, createElement(Harness, { itemId: item.id })),
  )
  return container.id
}

function unmountStabilizationControls(): void {
  unsubscribe?.()
  unsubscribe = null
  root?.unmount()
  root = null
  document.getElementById('stabilization-controls-host')?.remove()
}

/** One undo, as the timeline's undo shortcut does it */
export function undoLast(): number {
  useTimelineCommandStore.getState().undo()
  return useTimelineCommandStore.getState().undoStack.length
}

/** The clip as the store has it now */
export function storedClip(id: string): VideoItem | undefined {
  return useItemsStore.getState().itemById[id] as VideoItem | undefined
}

/** How many undo steps the store holds */
export function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}
