import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'

/**
 * In the delete-media dialogs: the cleaned pieces of the media are files the user paid for, and
 * deleting the media with this dialog deletes them too. The notice says how many, that they were
 * paid for, and that the service keeps a copy for 30 days after the cleaning. Nothing is shown
 * when the media have no pieces.
 */
export function ShadowPiecesDeletionNotice({ count }: { count: number | null }) {
  const { t } = useTranslation()
  if (count === null || count === 0) return null

  return (
    <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
      <Sparkles className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
      <p
        className="text-sm text-yellow-600 dark:text-yellow-400"
        data-testid="shadow-pieces-deletion-notice"
      >
        {t('media.deleteDialog.shadowPieces', {
          count,
          defaultValue_one:
            '{{count}} cleaned piece of this media will also be deleted. You paid for it. It can be downloaded again from the service for 30 days after the cleaning, if it is still available.',
          defaultValue_other:
            '{{count}} cleaned pieces of this media will also be deleted. You paid for them. They can be downloaded again from the service for 30 days after the cleaning, if they are still available.',
        })}
      </p>
    </div>
  )
}
