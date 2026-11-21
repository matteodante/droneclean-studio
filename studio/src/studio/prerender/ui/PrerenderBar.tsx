// The green line along the bottom of the timeline ruler (After Effects' render bar): the frames that play from the
// pre-render cache now. A stale part disappears as soon as the edit that made it stale lands; while a pre-render
// runs, its range is outlined and fills in as it goes.

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrerenderStore } from '../store'

const BAR_HEIGHT_PX = 3

export const PrerenderBar = memo(function PrerenderBar({
  frameToPixels,
}: {
  frameToPixels: (frame: number) => number
}) {
  const { t } = useTranslation()
  const ranges = usePrerenderStore((s) => s.ranges)
  const job = usePrerenderStore((s) => s.job)
  if (ranges.length === 0 && job === null) return null

  return (
    <div
      className="absolute left-0 right-0 bottom-0 pointer-events-none"
      style={{ height: BAR_HEIGHT_PX, zIndex: 9 }}
      aria-label={t('preview.previewRender.prerender.barLabel')}
      data-testid="prerender-bar"
    >
      {job !== null && (
        <div
          className="absolute top-0 bottom-0 bg-green-500/25"
          style={{
            left: frameToPixels(job.startFrame),
            width: Math.max(1, frameToPixels(job.endFrame) - frameToPixels(job.startFrame)),
          }}
        />
      )}
      {ranges.map((range) => (
        <div
          key={range.start}
          className="absolute top-0 bottom-0 bg-green-500"
          data-prerender-range={`${range.start}-${range.end}`}
          style={{
            left: frameToPixels(range.start),
            width: Math.max(1, frameToPixels(range.end) - frameToPixels(range.start)),
          }}
        />
      ))}
    </div>
  )
})
