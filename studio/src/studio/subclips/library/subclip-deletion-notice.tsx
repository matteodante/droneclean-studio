import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Scissors } from 'lucide-react'
import { countSubclipsForMedia, useSubclipsStore } from '@/studio/subclips'

/**
 * In the delete-media dialogs: deleting a file also deletes its subclips (design 1.6, D6), and the
 * confirmation says how many. Nothing is shown when the files have none.
 */
export function SubclipDeletionNotice({ mediaIds }: { mediaIds: readonly string[] }) {
  const { t } = useTranslation()
  const subclips = useSubclipsStore((s) => s.subclips)
  const count = useMemo(
    () => (subclips.length === 0 ? 0 : countSubclipsForMedia(mediaIds)),
    [mediaIds, subclips],
  )
  if (count === 0) return null

  return (
    <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
      <Scissors className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-yellow-600 dark:text-yellow-400" data-testid="subclip-deletion-notice">
        {t('media.deleteDialog.subclipsRemoved', {
          count,
          defaultValue_one: '{{count}} subclip of this media will also be deleted.',
          defaultValue_other: '{{count}} subclips of this media will also be deleted.',
        })}
      </p>
    </div>
  )
}
