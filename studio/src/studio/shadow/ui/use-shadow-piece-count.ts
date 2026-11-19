import { useEffect, useState } from 'react'
import { countShadowPieceFiles } from '../pieces-delete'

/**
 * How many paid cleaned piece files these media keep, or `null` while that is being counted.
 * The delete dialogs disable "Delete" until it is a number (zero included), so a deletion that
 * takes pieces with it is only ever confirmed after the notice said how many.
 */
export function useShadowPieceCount(mediaIds: readonly string[]): number | null {
  const key = mediaIds.join('|')
  const [counted, setCounted] = useState<{ key: string; count: number } | null>(null)

  useEffect(() => {
    if (key === '') return
    let current = true
    void countShadowPieceFiles(key.split('|')).then((count) => {
      if (current) setCounted({ key, count })
    })
    return () => {
      current = false
    }
  }, [key])

  if (key === '') return 0
  return counted?.key === key ? counted.count : null
}
