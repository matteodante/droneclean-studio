/**
 * The clip panel's looks area (design 5.1 §4.4, §6 slice 5.2b): the look a clip applies and the
 * 0…100 % blend it is applied with, plus the way into the library.
 *
 * The section is drawn from `ColorPresetSection` (the clip panel's one colour hook), so the fork
 * needs no new element in the clip panel. It is hidden while the `looks` feature switch is off:
 * the library and the per-clip choice work, but the look stage that draws them is a follow-up
 * (AGENTS.md: a feature is finished or hidden).
 *
 * Every change is written on all the selected video clips as one undo step (`updateClipsTogether`),
 * so picking a look and moving the intensity are each one undo step however many clips are
 * selected, like the colour profile beside them.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PropertyRow, PropertySection, SliderInput } from '@/shared/ui/property-controls'
import { updateClipsTogether } from '@/studio/presets/batch-update'
import { isFeatureShown } from '@/studio/feature-switches'
import type { VideoItem } from '@/types/timeline'
import { useLooksStore } from './store'
import { LooksLibraryDialog } from './LooksLibraryDialog'
import { DEFAULT_LOOK_INTENSITY, lookIntensityPercent } from './types'

/** The select's "no look" value; a look id is never this. */
const NONE = 'none'

/** The select's value that opens the library; a look id is never this. */
const MANAGE = 'manage'

/** The clip panel's looks group: nothing while the feature is hidden. */
export function LooksSection({ items }: { items: readonly VideoItem[] }) {
  if (!isFeatureShown('looks') || items.length === 0) return null
  return <LooksGroup items={items} />
}

/** The group's frame, so it sits beside the colour preset section like any other property group. */
function LooksGroup({ items }: { items: readonly VideoItem[] }) {
  const { t } = useTranslation()
  return (
    <PropertySection title={t('presets.looks.title')} icon={Clapperboard}>
      <LooksControls items={items} />
    </PropertySection>
  )
}

/** The select's value for clips whose looks differ; a look id is never this. */
const MIXED = 'mixed'

/** A clip's look id, or undefined for none (or an unreadable one). */
function lookIdOf(item: VideoItem): string | undefined {
  const id = item.look?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * The selected clips' look, its intensity and the way into the library. Several clips show their
 * common look, or "Mixed". A new look keeps each clip's own blend; the slider is the blend of the
 * first clip that has a look and moves every clip that has one.
 */
function LooksControls({ items }: { items: readonly VideoItem[] }) {
  const { t } = useTranslation()
  const looks = useLooksStore((state) => state.looks)
  const load = useLooksStore((state) => state.load)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const ids = new Set(items.map(lookIdOf))
  const mixed = ids.size > 1
  const selectedId = mixed ? undefined : [...ids][0]
  const withLook = items.filter((item) => lookIdOf(item) !== undefined)
  const selected = withLook[0]?.look
  const missingIds = [...ids].filter(
    (id): id is string => id !== undefined && !looks.some((entry) => entry.id === id),
  )

  const choose = (value: string) => {
    if (value === MANAGE) {
      setLibraryOpen(true)
      return
    }
    if (value === NONE) {
      updateClipsTogether(
        'SET_LOOK',
        items.map((item) => ({ id: item.id, updates: { look: undefined } })),
      )
      return
    }
    // A new look keeps the blend each clip was using, so the two controls stay independent.
    updateClipsTogether(
      'SET_LOOK',
      items.map((item) => ({
        id: item.id,
        updates: {
          look: {
            id: value,
            intensity:
              lookIdOf(item) === undefined
                ? DEFAULT_LOOK_INTENSITY
                : lookIntensityPercent(item.look) / 100,
          },
        },
      })),
    )
  }

  const setIntensity = (percent: number) => {
    updateClipsTogether(
      'SET_LOOK_INTENSITY',
      withLook.map((item) => ({
        id: item.id,
        updates: {
          look: { id: lookIdOf(item) as string, intensity: percent / 100 },
        },
      })),
    )
  }

  return (
    <div className="space-y-2 text-xs" data-testid="looks-section">
      <PropertyRow label={t('presets.looks.title')}>
        <Select value={mixed ? MIXED : (selectedId ?? NONE)} onValueChange={choose}>
          <SelectTrigger
            className="h-7 text-xs flex-1 min-w-0"
            aria-label={t('presets.looks.title')}
            data-testid="look-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs">
              {t('presets.looks.unset')}
            </SelectItem>
            {looks.map((entry) => (
              <SelectItem key={entry.id} value={entry.id} className="text-xs">
                {entry.name}
              </SelectItem>
            ))}
            {mixed && (
              <SelectItem value={MIXED} className="text-xs" disabled>
                {t('presets.mixed')}
              </SelectItem>
            )}
            {missingIds.map((id) => (
              <SelectItem key={id} value={id} className="text-xs" disabled>
                {t('presets.looks.missing')}
              </SelectItem>
            ))}
            <SelectItem value={MANAGE} className="text-xs" data-testid="look-manage">
              {t('presets.looks.manage')}
            </SelectItem>
          </SelectContent>
        </Select>
      </PropertyRow>
      <PropertyRow label={t('presets.looks.intensity')}>
        <SliderInput
          value={lookIntensityPercent(selected)}
          onChange={setIntensity}
          min={0}
          max={100}
          step={1}
          unit="%"
          disabled={withLook.length === 0}
          className="flex-1 min-w-0"
        />
      </PropertyRow>
      <LooksLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />
    </div>
  )
}
