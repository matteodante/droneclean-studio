/**
 * The timeline's "Smooth edit…" button and its dialog: the song, the shot length in bars, the crossfade, and
 * Apply. It shows, before anything changes, how many clips will change; Apply is one undo step.
 *
 * The beats are found when the dialog opens and again when another song is picked (a few seconds for a
 * three-minute song, off the main thread); changing the shot length only re-plans, so it is instant.
 */

import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { findBeatFrames } from '@/studio/beats/mark'
import { createLogger } from '@/shared/logging/logger'
import { SMOOTH_SHOT_BARS, type SmoothShotBars } from './plan'
import {
  applySmoothPlan,
  listSongs,
  previewSmoothEdit,
  type SmoothEditPreview,
  type SongInfo,
} from './timeline'

const logger = createLogger('SmoothEdit')

type Beats = { songId: string; frames: number[] } | 'loading' | 'failed'

/** The beats of a song: found when the song changes, off the main thread, and `loading` meanwhile. */
function useSongBeats(songId: string | undefined): Beats {
  const [beats, setBeats] = useState<Beats>('loading')
  useEffect(() => {
    if (songId === undefined) return
    let current = true
    setBeats('loading')
    findBeatFrames(songId, {}, 'clips.smoothEditTimeline').then(
      (frames) => {
        if (current) setBeats({ songId, frames })
      },
      (error: unknown) => {
        logger.warn('Finding the beats failed', error)
        if (current) setBeats('failed')
      },
    )
    return () => {
      current = false
    }
  }, [songId])
  return beats
}

/** The translation key of what stops an Apply, or undefined when the edit can go ahead. */
function blockingStatus(
  beats: Beats,
  frames: number[] | undefined,
  preview: SmoothEditPreview | undefined,
): string | undefined {
  if (beats === 'failed' || (frames !== undefined && frames.length < 2)) return 'noBeats'
  if (frames === undefined) return 'finding'
  if (preview !== undefined && preview.clipCount === 0) return 'noVideo'
  return undefined
}

function NoSongView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('timeline.smoothEdit.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('timeline.smoothEdit.noSongHint')}</DialogDescription>
      </DialogHeader>
      <p className="text-sm font-medium" role="status">
        {t('timeline.smoothEdit.noSong')}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('timeline.smoothEdit.close')}
        </Button>
      </DialogFooter>
    </>
  )
}

interface SongFieldProps {
  songs: SongInfo[]
  selected: string
  disabled: boolean
  onPick: (id: string) => void
}

function SongField({ songs, selected, disabled, onPick }: SongFieldProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor="smooth-edit-song">{t('timeline.smoothEdit.song')}</Label>
      {songs.length === 1 ? (
        <p id="smooth-edit-song" className="truncate rounded-md border px-3 py-2">
          {songs[0]!.label}
        </p>
      ) : (
        <select
          id="smooth-edit-song"
          className="w-full rounded-md border bg-background px-3 py-2"
          value={selected}
          onChange={(event) => onPick(event.target.value)}
          disabled={disabled}
        >
          {songs.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

interface BarsFieldProps {
  bars: SmoothShotBars
  disabled: boolean
  onPick: (bars: SmoothShotBars) => void
}

function BarsField({ bars, disabled, onPick }: BarsFieldProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label>{t('timeline.smoothEdit.shotLength')}</Label>
      <div className="flex gap-2" role="group" aria-label={t('timeline.smoothEdit.shotLength')}>
        {SMOOTH_SHOT_BARS.map((option) => (
          <Button
            key={option}
            type="button"
            variant={bars === option ? 'default' : 'outline'}
            aria-pressed={bars === option}
            disabled={disabled}
            onClick={() => onPick(option)}
          >
            {t('timeline.smoothEdit.bars', { count: option })}
          </Button>
        ))}
      </div>
    </div>
  )
}

interface SummaryProps {
  status: string | undefined
  loading: boolean
  preview: SmoothEditPreview | undefined
}

/** The sentence for a blocking status, in the interface language. */
function statusText(status: string, t: TFunction): string {
  if (status === 'noBeats') return t('timeline.smoothEdit.noBeats')
  if (status === 'noVideo') return t('timeline.smoothEdit.noVideo')
  return t('timeline.smoothEdit.finding')
}

/** What the edit will do, or what is stopping it, under the options. */
function Summary({ status, loading, preview }: SummaryProps) {
  const { t } = useTranslation()
  const shots = preview?.plan.shots.length ?? 0
  const leftAlone = preview
    ? preview.plan.tooShort.length + preview.plan.afterSong.length + preview.unsupported.length
    : 0
  return (
    <div className="min-h-[3.5rem] space-y-1 text-muted-foreground" role="status">
      {status !== undefined ? (
        <p className="flex items-center gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {statusText(status, t)}
        </p>
      ) : (
        <>
          <p className="font-medium text-foreground">
            {t('timeline.smoothEdit.willChange', { count: shots })}
          </p>
          {leftAlone > 0 ? <p>{t('timeline.smoothEdit.leftAlone', { count: leftAlone })}</p> : null}
          <p>{t('timeline.smoothEdit.undoHint')}</p>
        </>
      )}
    </div>
  )
}

/** The plan for the song and shot length chosen: the beats, the clips' preview, and what stops an Apply. */
function useSmoothPlanState(songId: string | undefined, bars: SmoothShotBars) {
  const items = useItemsStore((state) => state.items)
  const beats = useSongBeats(songId)
  const frames = typeof beats === 'object' && beats.songId === songId ? beats.frames : undefined
  const preview = useMemo(
    () => (songId === undefined || frames === undefined ? undefined : previewSmoothEdit(songId, frames, bars)),
    [songId, frames, bars, items],
  )
  const status = blockingStatus(beats, frames, preview)
  const canApply = status === undefined && (preview?.plan.shots.length ?? 0) > 0
  return { frames, preview, status, canApply }
}

/** Apply: runs the edit after the button has shown "Applying…", tells the person, and closes on success. */
function useApplyEdit(onClose: () => void) {
  const { t } = useTranslation()
  const [applying, setApplying] = useState(false)
  const apply = (songId: string, frames: number[] | undefined, bars: number, crossfade: boolean) => {
    if (frames === undefined) return
    setApplying(true)
    setTimeout(() => {
      try {
        const result = applySmoothPlan(songId, frames, bars, { crossfade })
        toast.success(t('timeline.smoothEdit.done', { count: result.shots.length }))
        onClose()
      } catch (error) {
        logger.warn('Smooth edit failed', error)
        toast.error(t('timeline.smoothEdit.failed'))
        setApplying(false)
      }
    }, 0)
  }
  return { applying, apply }
}

/** What the dialog says and lets a person do, for the clips and songs on the timeline right now. */
function SmoothEditBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const items = useItemsStore((state) => state.items)
  const songs = useMemo(() => listSongs(), [items])
  const [pickedSong, setPickedSong] = useState<string | undefined>(undefined)
  const [bars, setBars] = useState<SmoothShotBars>(1)
  const [crossfade, setCrossfade] = useState(true)
  const song = songs.find((candidate) => candidate.id === pickedSong) ?? songs[0]
  const plan = useSmoothPlanState(song?.id, bars)
  const { applying, apply } = useApplyEdit(onClose)
  if (song === undefined) return <NoSongView onClose={onClose} />

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('timeline.smoothEdit.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('timeline.smoothEdit.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <SongField songs={songs} selected={song.id} disabled={applying} onPick={setPickedSong} />
        <BarsField bars={bars} disabled={applying} onPick={setBars} />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="smooth-edit-crossfade">{t('timeline.smoothEdit.crossfade')}</Label>
          <Switch
            id="smooth-edit-crossfade"
            checked={crossfade}
            disabled={applying}
            onCheckedChange={setCrossfade}
          />
        </div>
        <Summary status={plan.status} loading={plan.status === 'finding'} preview={plan.preview} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={applying}>
          {t('timeline.smoothEdit.cancel')}
        </Button>
        <Button
          onClick={() => apply(song.id, plan.frames, bars, crossfade)}
          disabled={applying || !plan.canApply}
        >
          {applying ? t('timeline.smoothEdit.applying') : t('timeline.smoothEdit.apply')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** The Timeline toolbar's "Smooth edit…" button; its dialog is built only while it is open. */
export const SmoothEditControl = memo(function SmoothEditControl() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const size = {
    width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
    height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
  } as const
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        style={size}
        onClick={() => setOpen(true)}
        aria-label={t('timeline.smoothEdit.title')}
        data-tooltip={t('timeline.smoothEdit.tooltip')}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {open ? <SmoothEditBody onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
})
