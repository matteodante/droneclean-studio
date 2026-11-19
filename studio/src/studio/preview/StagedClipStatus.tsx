// What the preview says about a staged clip it cannot draw with all its stages (design 3.6 section 2.10, findings S3
// and R1): the preview shows the clip's last good staged frame, or its source before the first one, and this line on
// the picture says so, with Retry for a stage that failed. The export never holds a frame: it stops with the error.
//
// The states come from the renderer's stage pipeline (`render/stages/failure.ts`); a clip drawn with every stage again
// has none. A clip that was deleted, or that no stage changes any more, is not listed.

import { useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import {
  clipStageStates,
  notifyStagedFrameReady,
  subscribeClipStageStates,
  type ClipStageState,
} from '@/studio/render/stages/failure'
import { needsSourceStages } from '@/studio/render/stages/predicates'
import { pagePreparer } from '@/studio/render/stages/session'
import type { VideoItem } from '@/types/timeline'

/** Prepares the clip's failed stages again, then draws the current frame again */
async function retry(item: VideoItem): Promise<void> {
  await pagePreparer().retry(item)
  notifyStagedFrameReady()
}

function StatusLine({ item, state }: { item: VideoItem; state: ClipStageState }) {
  const { t } = useTranslation()
  const clip = item.label || item.id
  const stage = t(`editor.stagedClip.stage.${state.stage}`)
  if (state.kind === 'opening') {
    return (
      <div className="rounded bg-black/70 px-2 py-1 text-xs text-white" data-testid="staged-clip-opening">
        {t('editor.stagedClip.opening', { clip, stage })}
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-2 rounded bg-black/70 px-2 py-1 text-xs text-white"
      data-testid="staged-clip-failed"
    >
      <span>{t('editor.stagedClip.failed', { clip, stage, message: state.message })}</span>
      <button
        type="button"
        className="rounded border border-white/40 px-1.5 py-0.5 hover:bg-white/10"
        onClick={() => void retry(item)}
      >
        {t('editor.stagedClip.retry')}
      </button>
    </div>
  )
}

/** The preview's line for every staged clip that is held or drawn without all its stages */
export function StagedClipStatus() {
  const states = useSyncExternalStore(subscribeClipStageStates, clipStageStates, clipStageStates)
  const items = useItemsStore((store) => store.items)
  const rows = useMemo(() => {
    const list: Array<{ item: VideoItem; state: ClipStageState }> = []
    for (const item of items) {
      const state = states.get(item.id)
      if (state && item.type === 'video' && needsSourceStages(item)) list.push({ item, state })
    }
    return list
  }, [items, states])
  if (rows.length === 0) return null
  return (
    <div
      className="pointer-events-auto absolute left-2 top-2 z-20 flex max-w-[70%] flex-col gap-1"
      role="status"
      aria-live="polite"
    >
      {rows.map(({ item, state }) => (
        <StatusLine key={item.id} item={item} state={state} />
      ))}
    </div>
  )
}
