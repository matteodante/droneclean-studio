/**
 * `studio.preview`: the playback resolution and the pre-render (design
 * `docs/designs/prerender-preview.md`). Nothing here is an undo step: the
 * resolution is an app setting, and the cache is pictures of the project, not
 * part of it.
 */

import { usePlaybackStore } from '@/shared/state/playback'
import { isPreviewQualityLevel, PREVIEW_QUALITY_LEVELS } from '@/studio/preview/quality'
import { prerenderRangeFor, requestPrerender } from '@/studio/prerender/actions'
import { prerenderCache } from '@/studio/prerender/cache'
import { cancelPrerender, PrerenderStartError } from '@/studio/prerender/job'
import { usePrerenderStore, type PrerenderOutcome } from '@/studio/prerender/store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import type {
  PrerenderRangeInput,
  PrerenderResult,
  PreviewApi,
  PreviewQualityLevel,
} from '../types'
import { invalidArgumentError, studioError } from '../errors'

function toResult(outcome: PrerenderOutcome): PrerenderResult {
  return {
    status: outcome.status,
    ...(outcome.reason !== undefined && { reason: outcome.reason }),
    ...(outcome.detail !== undefined && { detail: outcome.detail }),
    startFrame: outcome.startFrame,
    endFrame: outcome.endFrame,
    renderedFrames: outcome.renderedFrames,
    seconds: outcome.seconds,
  }
}

/** Check one bound a caller gave: an integer frame from 0 to `max` */
function checkBound(name: 'startFrame' | 'endFrame', value: number | undefined, max: number): void {
  if (value === undefined || (Number.isInteger(value) && value >= 0 && value <= max)) return
  throw invalidArgumentError({
    method: 'preview.prerender',
    argument: name,
    expectation: `an integer frame from 0 to ${max}`,
    value,
  })
}

/** Check the bounds a caller gave: integers inside a timeline that has clips */
function checkBounds(range: PrerenderRangeInput | undefined): PrerenderRangeInput {
  const timelineEnd = useItemsStore.getState().maxItemEndFrame
  if (timelineEnd === 0) {
    throw invalidArgumentError({
      method: 'preview.prerender',
      argument: 'range',
      expectation: 'a range of a timeline that has clips',
      value: range ?? {},
    })
  }
  const bounds = range ?? {}
  checkBound('startFrame', bounds.startFrame, timelineEnd - 1)
  checkBound('endFrame', bounds.endFrame, timelineEnd)
  return bounds
}

/**
 * Create the `studio.preview` namespace.
 * @example const preview = createPreviewApi()
 */
export function createPreviewApi(): PreviewApi {
  return {
    quality(): PreviewQualityLevel {
      const quality = usePlaybackStore.getState().previewQuality
      // FreeCut's 1/3, written by an older version, reads as the nearest level the menu offers
      return isPreviewQualityLevel(quality) ? quality : 0.25
    },

    setQuality(quality: PreviewQualityLevel): void {
      if (!isPreviewQualityLevel(quality)) {
        throw invalidArgumentError({
          method: 'preview.setQuality',
          argument: 'quality',
          expectation: `one of ${PREVIEW_QUALITY_LEVELS.join(', ')}`,
          value: quality,
        })
      }
      usePlaybackStore.getState().setPreviewQuality(quality)
    },

    async prerender(range?: PrerenderRangeInput): Promise<PrerenderResult> {
      const bounds = checkBounds(range)
      const resolved = prerenderRangeFor(bounds)
      if (resolved === null) {
        throw invalidArgumentError({
          method: 'preview.prerender',
          argument: 'range',
          expectation: 'a start frame before the end frame',
          value: bounds,
        })
      }
      try {
        return toResult(await requestPrerender(resolved))
      } catch (error) {
        if (!(error instanceof PrerenderStartError)) throw error
        throw error.reason === 'busy'
          ? studioError({
              code: 'CONFLICT',
              method: 'preview.prerender',
              message: 'a pre-render is already running',
              hint: 'await it, or call studio.preview.cancelPrerender() first',
            })
          : studioError({
              code: 'UNSUPPORTED',
              method: 'preview.prerender',
              message: "the editor's preview is not open",
              hint: 'open the project in the editor (studio.project.open) so its preview is mounted',
            })
      }
    },

    prerendered() {
      const { bytes, job, lastOutcome } = usePrerenderStore.getState()
      return {
        ranges: prerenderCache
          .validRanges()
          .map((entry) => ({ startFrame: entry.start, endFrame: entry.end })),
        bytes,
        running:
          job === null
            ? null
            : {
                startFrame: job.startFrame,
                endFrame: job.endFrame,
                done: job.done,
                total: job.total,
              },
        last: lastOutcome === null ? null : toResult(lastOutcome),
      }
    },

    cancelPrerender(): void {
      cancelPrerender()
    },

    clearPrerender(): void {
      prerenderCache.clear()
    },
  }
}
