// The timeline's Render preview menu (beside its In/Out buttons): render the In/Out range, or the whole timeline
// when none is set, as After Effects renders its work area; and delete what is rendered.

import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, MonitorPlay } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatHotkeyBinding } from '@/config/hotkeys'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { hasInOutRange } from '@/features/export/utils/export-range'
import { prerenderFromInterface } from '../actions'
import { prerenderCache } from '../cache'
import { usePrerenderStore } from '../store'

export function PrerenderMenu({ buttonStyle }: { buttonStyle: CSSProperties }) {
  const { t } = useTranslation()
  const hotkeys = useResolvedHotkeys()
  const hasRange = useMarkersStore((s) => hasInOutRange(s.inPoint, s.outPoint))
  const running = usePrerenderStore((s) => s.job !== null)
  const hasRendered = usePrerenderStore((s) => s.ranges.length > 0)
  const shortcut = hotkeys.RENDER_PREVIEW ? formatHotkeyBinding(hotkeys.RENDER_PREVIEW) : ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`gap-0.5 px-1.5 ${hasRendered ? 'text-green-500 hover:text-green-400' : ''}`}
          style={{ height: buttonStyle.height }}
          aria-label={t('preview.previewRender.prerender.menu')}
          data-tooltip={t('preview.previewRender.prerender.menu')}
          data-testid="prerender-menu"
        >
          <MonitorPlay className="w-3.5 h-3.5" />
          <ChevronDown className="w-3 h-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          disabled={running}
          onClick={() => {
            void prerenderFromInterface()
          }}
        >
          <span className="flex-1">
            {hasRange
              ? t('preview.previewRender.prerender.renderInOut')
              : t('preview.previewRender.prerender.renderTimeline')}
          </span>
          {shortcut && <span className="text-xs text-muted-foreground">{shortcut}</span>}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={running || !hasRendered} onClick={() => prerenderCache.clear()}>
          {t('preview.previewRender.prerender.clear')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
