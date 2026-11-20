/**
 * The clip context menu's "Mark Beats": runs `markBeats` on the clip and
 * tells the user what happened.
 */

import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { createLogger } from '@/shared/logging/logger'
import { markBeats } from './mark'

const logger = createLogger('MarkBeats')

/** Mark the beats of one clip and toast the result; never rejects. */
export async function markBeatsFromMenu(clipId: string): Promise<void> {
  const progress = toast.loading(
    i18n.t('timeline.itemActions.beatsAnalysing', { defaultValue: 'Finding the beats…' }),
  )
  try {
    const frames = await markBeats(clipId)
    toast.dismiss(progress)
    if (frames.length === 0) {
      toast.info(
        i18n.t('timeline.itemActions.beatsNone', {
          defaultValue: 'No strong bass hits found in this clip',
        }),
      )
      return
    }
    toast.success(
      i18n.t('timeline.itemActions.beatsMarked', {
        count: frames.length,
        defaultValue: 'Marked {{count}} beats',
      }),
    )
  } catch (error) {
    toast.dismiss(progress)
    logger.warn('Mark beats failed', error)
    toast.error(
      i18n.t('timeline.itemActions.beatsFailed', {
        defaultValue: 'Could not find the beats of this clip',
      }),
    )
  }
}
