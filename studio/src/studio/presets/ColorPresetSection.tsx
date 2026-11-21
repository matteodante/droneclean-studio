// The clip panel's colour preset section (design 5.1, sections 4.5, 4.6 and 6 slice 5.2a): the
// profile DJI's file name hints at, the one press that applies it, and the select that changes or
// clears it.
//
// A clip's colour profile is not in its metadata, so the section asks rather than decides: the
// hint from the file name's suffix is shown with a question mark and an "Apply" press, and until
// that press the clip keeps no input transform. A clip whose file name hints at nothing shows the
// same select standing at "Not set" and applies nothing. The press goes through the timeline's
// `updateItem` command, so one press is one undo step, like every other clip-panel control.
//
// The transform itself is drawn by the renderer's stage pipeline (`src/studio/render/stages/`,
// design 3.6): one press changes the picture, and the profile group is shown now that it does. The
// section is also the clip panel's one hook for the clip's creative look, whose own group is
// drawn beside the profile by `LooksSection` (slice 5.2b) under its own switch. See design 5.1,
// section 6.

import { useTranslation } from 'react-i18next'
import { Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PropertyRow, PropertySection } from '@/shared/ui/property-controls'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { isFeatureShown } from '@/studio/feature-switches'
import type { ColorProfileId } from '@/studio/color/types'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { LooksSection } from '@/studio/looks/LooksSection'
import { suggestColorProfile, type SuggestedProfile } from './suggest'
import { updateClipsTogether } from './batch-update'
import { dlogMUncheckedFor, droneDisplayName } from './drone-model'

interface ColorPresetSectionProps {
  /** The selected items; the section works on every video clip among them, in one step. */
  items: TimelineItem[]
}

/** The profiles as the product writes them. DJI's names, so they are not translated. */
const PROFILE_LABELS: Record<Exclude<ColorProfileId, 'none'>, string> = {
  'dlog-m': 'D-Log M',
  dlog: 'D-Log',
}

/** The select's choices: "Not set" first, then the two logs. */
const PROFILE_OPTIONS: readonly ColorProfileId[] = ['none', 'dlog-m', 'dlog']

/**
 * The hint row: the drone model and the profile question on the left, the one press that answers
 * it on the right. It appears only while the question is open.
 */
function SuggestionRow({
  drone,
  profile,
  onApply,
}: {
  drone: string | null
  profile: SuggestedProfile
  onApply: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground" data-testid="color-preset-suggestion">
          {drone !== null ? `${droneDisplayName(drone)} · ` : ''}
          {t('presets.profile.suggested', { profile: PROFILE_LABELS[profile] })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2"
          onClick={onApply}
          data-testid="color-preset-apply"
        >
          {t('presets.profile.apply')}
        </Button>
      </div>
      {profile === 'dlog-m' && dlogMUncheckedFor(drone) && (
        <p className="text-muted-foreground" data-testid="color-preset-unchecked">
          {t('presets.profile.uncheckedDrone')}
        </p>
      )}
    </div>
  )
}

/** The select's value for clips that do not agree; a profile id is never this. */
const MIXED = 'mixed'

/**
 * What the hint row offers for the selected clips: the clips still to be asked (a hint and no
 * answer yet), each with the profile its own file name suggests. The row is shown when those
 * clips agree on one profile; clips that disagree are left to the select.
 */
function useOpenQuestion(clips: readonly VideoItem[]) {
  const mediaById = useMediaLibraryStore((state) => state.mediaById)
  const asked = clips
    .filter((item) => item.inputColor === undefined)
    .map((item) => {
      const media = item.mediaId ? mediaById[item.mediaId] : undefined
      const suggestion = suggestColorProfile({
        fileName: media?.fileName ?? item.label,
        droneModel: media?.droneModel,
      })
      return { id: item.id, suggestion }
    })
    .flatMap(({ id, suggestion }) => (suggestion ? [{ id, ...suggestion }] : []))
  const profiles = new Set(asked.map((entry) => entry.profile))
  const drones = new Set(asked.map((entry) => entry.drone))
  if (profiles.size !== 1) return null
  return {
    ids: asked.map((entry) => entry.id),
    profile: asked[0]!.profile,
    drone: drones.size === 1 ? asked[0]!.drone : null,
  }
}

/**
 * The selected clips' colour profile: the hint and its Apply press, and the select that changes
 * or clears the answer. Several clips show their common profile, or "Mixed" when they differ, and
 * a choice is written on all of them as one undo step. A clip with no hint shows only the select,
 * at "Not set".
 */
function ColorPresetControls({ clips }: { clips: readonly VideoItem[] }) {
  const { t } = useTranslation()
  const question = useOpenQuestion(clips)
  const profiles = new Set<ColorProfileId>(clips.map((clip) => clip.inputColor ?? 'none'))
  const shown: string = profiles.size === 1 ? [...profiles][0]! : MIXED

  const choose = (profile: ColorProfileId, ids: readonly string[]) => {
    updateClipsTogether(
      'SET_COLOR_PROFILE',
      ids.map((id) => ({ id, updates: { inputColor: profile } })),
    )
  }

  return (
    <div className="space-y-2 text-xs" data-testid="color-preset-section">
      {question && (
        <SuggestionRow
          drone={question.drone}
          profile={question.profile}
          onApply={() => choose(question.profile, question.ids)}
        />
      )}
      <PropertyRow label={t('presets.profile.label')}>
        <Select
          value={shown}
          onValueChange={(value) =>
            choose(
              value as ColorProfileId,
              clips.map((clip) => clip.id),
            )
          }
        >
          <SelectTrigger
            className="h-7 text-xs flex-1 min-w-0"
            aria-label={t('presets.profile.label')}
            data-testid="color-preset-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFILE_OPTIONS.map((profile) => (
              <SelectItem key={profile} value={profile} className="text-xs">
                {profile === 'none' ? t('presets.profile.unset') : PROFILE_LABELS[profile]}
              </SelectItem>
            ))}
            {shown === MIXED && (
              <SelectItem value={MIXED} className="text-xs" disabled>
                {t('presets.mixed')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </PropertyRow>
    </div>
  )
}

/**
 * The clip panel's one colour hook: the input colour profile, and beside it the clip's look. Each
 * group has its own switch (`colorPresets` on since the 5.1c render seat draws the transform;
 * the look's own seat is a follow-up that turns `looks` on), so the looks area can ship on its
 * own and the clip panel keeps a single element for both. It renders nothing while both switches
 * are false, and nothing for a selection without a video clip.
 */
export function ColorPresetSection({ items }: ColorPresetSectionProps) {
  const showProfiles = isFeatureShown('colorPresets')
  const showLooks = isFeatureShown('looks')
  if (!showProfiles && !showLooks) return null
  const clips = items.filter((candidate): candidate is VideoItem => candidate.type === 'video')
  if (clips.length === 0) return null
  return (
    <>
      {showProfiles && <ColorPresetGroup clips={clips} />}
      <LooksSection items={clips} />
    </>
  )
}

/** The section's frame: the collapsible property group around the controls. */
function ColorPresetGroup({ clips }: { clips: readonly VideoItem[] }) {
  const { t } = useTranslation()
  return (
    <PropertySection title={t('presets.profile.label')} icon={Palette}>
      <ColorPresetControls clips={clips} />
    </PropertySection>
  )
}
