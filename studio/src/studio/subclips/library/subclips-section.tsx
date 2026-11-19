import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AlertTriangle, ChevronRight, Scissors } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/shared/ui/cn'
import { formatTimecode } from '@/shared/utils/time-utils'
import {
  getSubclipValidity,
  useSubclipsStore,
  type Subclip,
  type SubclipInvalidReason,
} from '@/studio/subclips'
import { subclipPosters } from '@/studio/subclips/poster'
import type { MediaMetadata } from '@/types/storage'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { importMediaLibraryService } from '@/features/media-library/services/media-library-service-loader'
import {
  setMediaDragData,
  clearMediaDragData,
} from '@/features/media-library/utils/drag-data-cache'
import {
  buildSubclipDragData,
  deleteSubclips,
  openSubclipInSourceMonitor,
  renameSubclip,
} from './actions'
import {
  GRID_MIN_SIZE_PX,
  GRID_GAP_BY_SIZE,
} from '@/features/media-library/components/media-grid-constants'
import {
  CARD_GRID_BASE,
  CARD_LIST_BASE,
  CARD_PERF_STYLE,
} from '@/features/media-library/components/card-styles'

const INVALID_REASON_DEFAULTS: Record<SubclipInvalidReason, string> = {
  'parent-missing': 'The original file is not in the library',
  'range-past-end': 'The original file is now shorter than this subclip',
  'rate-changed': 'The original file now has a different frame rate',
}

/**
 * The poster of a subclip: the parent's thumbnail at once, replaced by the frame at the start of
 * the range when that is ready. A file this process cannot read keeps the parent's thumbnail.
 */
function useSubclipPoster(subclip: Subclip, media: MediaMetadata | undefined): string | null {
  const [parentUrl, setParentUrl] = useState<string | null>(null)
  const [posterUrl, setPosterUrl] = useState<{ key: string; url: string } | null>(null)
  const key = `${subclip.id}:${subclip.mediaId}:${subclip.startFrame}:${subclip.sourceFps}`
  const thumbnailId = media?.thumbnailId

  useEffect(() => {
    if (!media) return
    let mounted = true
    void importMediaLibraryService().then(async ({ mediaLibraryService }) => {
      const url = await mediaLibraryService.getThumbnailBlobUrl(media.id, thumbnailId)
      if (mounted) setParentUrl(url)
    })
    return () => {
      mounted = false
    }
  }, [media, thumbnailId])

  const hasParent = media !== undefined
  useEffect(() => {
    if (!hasParent) return
    let mounted = true
    void subclipPosters.getPosterUrl(subclip).then((url) => {
      if (mounted && url) setPosterUrl({ key, url })
    })
    return () => {
      mounted = false
    }
    // `subclip` is read for its range only: `key` names exactly those fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasParent])

  return posterUrl?.key === key ? posterUrl.url : parentUrl
}

/** Subclips section of the media library: hidden when the project has none. */
export function SubclipsSection() {
  const { t } = useTranslation()
  const subclips = useSubclipsStore((s) => s.subclips)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const viewMode = useMediaLibraryStore((s) => s.viewMode)
  const mediaItemSize = useMediaLibraryStore((s) => s.mediaItemSize)
  const [open, setOpen] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Subclip | null>(null)

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) deleteSubclips([deleteTarget.id])
    setDeleteTarget(null)
  }, [deleteTarget])

  if (subclips.length === 0) return null

  const containerClassName =
    viewMode === 'grid'
      ? `grid ${GRID_GAP_BY_SIZE[mediaItemSize] ?? GRID_GAP_BY_SIZE[3]}`
      : 'space-y-1'
  const containerStyle: CSSProperties | undefined =
    viewMode === 'grid'
      ? {
          gridTemplateColumns: `repeat(auto-fill, minmax(min(${GRID_MIN_SIZE_PX[mediaItemSize] ?? GRID_MIN_SIZE_PX[3]}px, 100%), 1fr))`,
        }
      : undefined

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
          <ChevronRight
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <Scissors className="w-3 h-3 text-sky-400" />
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {t('media.subclips.sectionTitle', { defaultValue: 'Subclips' })}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{subclips.length}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1 pb-2">
          <div className={containerClassName} style={containerStyle}>
            {subclips.map((subclip) => (
              <SubclipCard
                key={subclip.id}
                subclip={subclip}
                media={mediaById[subclip.mediaId]}
                layout={viewMode}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('media.subclips.deleteTitle', { defaultValue: 'Delete Subclip' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('media.subclips.deleteBody', {
                name: deleteTarget?.name ?? '',
                defaultValue:
                  'Delete subclip "{{name}}"? The original file and the clips already on the timeline are not touched.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SubclipCardProps {
  subclip: Subclip
  media: MediaMetadata | undefined
  layout: 'grid' | 'list'
  onDelete: (subclip: Subclip) => void
}

/** The inline rename of a subclip's name: Enter keeps it, Escape or an empty name does not. */
function useSubclipRename(subclip: Subclip) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(subclip.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameCancelledRef = useRef(false)
  const renameRequestedRef = useRef(false)

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  const startRename = useCallback(() => {
    renameRequestedRef.current = true
    renameCancelledRef.current = false
    setEditValue(subclip.name)
    setIsEditing(true)
  }, [subclip.name])

  const commitRename = useCallback(() => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
    } else {
      const trimmed = editValue.trim()
      if (trimmed && trimmed !== subclip.name) renameSubclip(subclip.id, trimmed)
    }
    setIsEditing(false)
  }, [editValue, subclip.id, subclip.name])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        commitRename()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        renameCancelledRef.current = true
        setIsEditing(false)
      }
    },
    [commitRename],
  )

  return {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    renameRequestedRef,
    startRename,
    commitRename,
    handleKeyDown,
  }
}

function describeValidity(
  subclip: Subclip,
  media: MediaMetadata | undefined,
  t: TFunction,
): { invalidReason: SubclipInvalidReason | null; invalidLabel: string | null } {
  const validity = getSubclipValidity(
    subclip,
    media ? { duration: media.duration, fps: media.fps } : undefined,
  )
  if (validity.valid) return { invalidReason: null, invalidLabel: null }
  return {
    invalidReason: validity.reason,
    invalidLabel: t(`media.subclips.invalid.${validity.reason}`, {
      defaultValue: INVALID_REASON_DEFAULTS[validity.reason],
    }),
  }
}

function SubclipBadge({
  label,
  reason,
}: {
  label: string | null
  reason: SubclipInvalidReason | null
}) {
  if (!label) return null
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-subclip-invalid={reason}
      className="p-0.5 rounded bg-yellow-500/90 text-black flex-shrink-0"
    >
      <AlertTriangle className="w-2.5 h-2.5" />
    </span>
  )
}

function SubclipPoster({
  url,
  name,
  dimmed,
}: {
  url: string | null
  name: string
  dimmed: boolean
}) {
  if (!url) return <Scissors className="w-6 h-6 text-sky-400/70" />
  return (
    <img
      src={url}
      alt={name}
      draggable={false}
      className={cn('w-full h-full object-contain', dimmed && 'opacity-50 grayscale')}
    />
  )
}

function SubclipCard({ subclip, media, layout, onDelete }: SubclipCardProps) {
  const { t } = useTranslation()
  const posterUrl = useSubclipPoster(subclip, media)
  const rename = useSubclipRename(subclip)
  const { isEditing, editValue, setEditValue, inputRef, startRename, commitRename, handleKeyDown } =
    rename
  const renameRequestedRef = rename.renameRequestedRef

  const { invalidReason, invalidLabel } = describeValidity(subclip, media, t)
  const dragDisabled = invalidReason !== null || isEditing
  const durationLabel = useMemo(
    () => formatTimecode(subclip.endFrame - subclip.startFrame, subclip.sourceFps),
    [subclip.endFrame, subclip.startFrame, subclip.sourceFps],
  )

  const mediaTimes = useMemo(
    () => (media ? { duration: media.duration, fps: media.fps } : undefined),
    [media],
  )
  const handleOpen = useCallback(
    () => openSubclipInSourceMonitor(subclip, mediaTimes),
    [subclip, mediaTimes],
  )
  const handleShowOriginal = useCallback(
    () => openSubclipInSourceMonitor(subclip, mediaTimes, { withWindow: false }),
    [subclip, mediaTimes],
  )

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      if (dragDisabled) {
        event.preventDefault()
        return
      }
      const data = buildSubclipDragData(subclip)
      event.dataTransfer.setData('application/json', JSON.stringify(data))
      event.dataTransfer.effectAllowed = 'copy'
      setMediaDragData(data)
    },
    [dragDisabled, subclip],
  )

  const nameElement = isEditing ? (
    <input
      ref={inputRef}
      value={editValue}
      aria-label={t('media.subclips.renameLabel', { defaultValue: 'Subclip name' })}
      onChange={(event) => setEditValue(event.target.value)}
      onBlur={commitRename}
      onKeyDown={handleKeyDown}
      className="w-full bg-transparent border border-primary rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
    />
  ) : (
    <h3 className="text-[10px] font-medium text-foreground truncate" title={subclip.name}>
      {subclip.name}
    </h3>
  )

  const badge = <SubclipBadge label={invalidLabel} reason={invalidReason} />
  const poster = (
    <SubclipPoster url={posterUrl} name={subclip.name} dimmed={invalidReason !== null} />
  )

  const common = {
    'data-subclip-id': subclip.id,
    draggable: !dragDisabled,
    onDragStart: handleDragStart,
    onDragEnd: clearMediaDragData,
    onDoubleClick: isEditing ? undefined : handleOpen,
    style: CARD_PERF_STYLE,
  }
  const stateClassName = invalidReason
    ? 'opacity-60 cursor-not-allowed border-yellow-500/50'
    : 'cursor-grab border-border hover:border-sky-500/50'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {layout === 'grid' ? (
          <div {...common} className={cn(CARD_GRID_BASE, stateClassName)}>
            <div className="flex-1 bg-secondary relative overflow-hidden min-h-0 flex items-center justify-center">
              {poster}
              <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between gap-1 pointer-events-none">
                {invalidLabel ? (
                  badge
                ) : (
                  <div className="p-0.5 rounded bg-sky-600/90 text-white">
                    <Scissors className="w-2.5 h-2.5" />
                  </div>
                )}
                <div className="px-1 py-0.5 bg-black/70 border border-white/20 rounded text-[8px] font-mono text-white">
                  {durationLabel}
                </div>
              </div>
            </div>
            <div className="px-1.5 py-1 bg-panel-bg/50 flex-shrink-0">{nameElement}</div>
          </div>
        ) : (
          <div {...common} className={cn(CARD_LIST_BASE, stateClassName)}>
            <div className="w-16 h-12 bg-secondary rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
              {poster}
            </div>
            <div className="flex-1 min-w-0">
              {nameElement}
              <div className="flex items-center gap-2 mt-0.5">
                {badge}
                <span className="text-[10px] text-muted-foreground font-mono">{durationLabel}</span>
                {media && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {media.fileName}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          // The menu would hand focus back to the row, away from the name being typed.
          if (!renameRequestedRef.current) return
          renameRequestedRef.current = false
          event.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
      >
        <ContextMenuItem onClick={handleOpen} disabled={invalidReason !== null}>
          {t('media.subclips.openInSource', { defaultValue: 'Open in source monitor' })}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleShowOriginal} disabled={!media}>
          {t('media.subclips.showOriginal', { defaultValue: 'Show original' })}
        </ContextMenuItem>
        <ContextMenuItem onClick={startRename}>
          {t('media.subclips.rename', { defaultValue: 'Rename' })}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onDelete(subclip)}
          className="text-destructive focus:text-destructive"
        >
          {t('common.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
