// The pre-render as the interface starts it (the timeline's menu and the shortcut): the range is the timeline's
// In/Out, or the whole timeline when there is none, and the outcome is said in a toast. The SDK's
// `studio.preview.prerender` goes through `requestPrerender` too, with its own bounds and no toast.

import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { runPrerender, PrerenderStartError } from './job'
import { resolvePrerenderRange, type FrameRange } from './ranges'
import type { PrerenderOutcome } from './store'

/** The range a request covers on the open timeline, or `null` when it covers nothing */
export function prerenderRangeFor(
  bounds: { startFrame?: number; endFrame?: number } = {},
): FrameRange | null {
  const { inPoint, outPoint } = useMarkersStore.getState()
  return resolvePrerenderRange({
    ...bounds,
    inPoint,
    outPoint,
    timelineEnd: useItemsStore.getState().maxItemEndFrame,
  })
}

/** Run a pre-render of `range`; `PrerenderStartError` when one is running or no preview is open */
export function requestPrerender(range: FrameRange): Promise<PrerenderOutcome> {
  return runPrerender(range)
}

/** The toast an outcome deserves */
function announce(outcome: PrerenderOutcome): void {
  const t = i18n.t.bind(i18n)
  if (outcome.status === 'done') {
    if (outcome.renderedFrames === 0) {
      toast.info(t('preview.previewRender.prerender.alreadyDone'))
      return
    }
    const fps = Math.max(1, useTimelineSettingsStore.getState().fps)
    toast.success(
      t('preview.previewRender.prerender.done', {
        seconds: (outcome.renderedFrames / fps).toFixed(1),
        took: outcome.seconds.toFixed(1),
      }),
    )
    return
  }
  if (outcome.status === 'cancelled') {
    toast.info(t('preview.previewRender.prerender.cancelled'))
    return
  }
  switch (outcome.reason) {
    case 'changed':
      toast.warning(t('preview.previewRender.prerender.changed'))
      return
    case 'full':
      toast.warning(t('preview.previewRender.prerender.full'))
      return
    case 'unsupported':
      toast.warning(t('preview.previewRender.prerender.unsupported'))
      return
    default:
      toast.error(t('preview.previewRender.prerender.error', { message: outcome.detail ?? '' }))
  }
}

/** The menu's and the shortcut's action: render the In/Out range (or the whole timeline) and say how it went */
export async function prerenderFromInterface(): Promise<void> {
  const range = prerenderRangeFor()
  if (range === null) {
    toast.info(i18n.t('preview.previewRender.prerender.empty'))
    return
  }
  try {
    announce(await requestPrerender(range))
  } catch (error) {
    if (error instanceof PrerenderStartError) {
      toast.info(
        i18n.t(
          error.reason === 'busy'
            ? 'preview.previewRender.prerender.busy'
            : 'preview.previewRender.prerender.noPreview',
        ),
      )
      return
    }
    throw error
  }
}
