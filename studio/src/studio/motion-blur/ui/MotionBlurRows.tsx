/**
 * The two rows of the clip panel's Playback section that set motion blur (design 7.2, section
 * 4.7): a switch, and while it is on the shutter angle. `video-section.tsx` draws them with one
 * line, so the fork needs no other element in the clip panel.
 *
 * They are hidden while the `motionBlur` feature switch is off (nothing draws the blur until the
 * export stage and the preview land: AGENTS.md, a feature is finished or hidden), and for a
 * selection with no clip that can carry blur. Every change goes through `setMotionBlur`, so the
 * switch and each shutter choice are one undo step however many clips are selected.
 */

import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PropertyRow } from '@/shared/ui/property-controls'
import { isFeatureShown } from '@/studio/feature-switches'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { setMotionBlur } from './actions'
import {
  canHoldMotionBlur,
  DEFAULT_SHUTTER_DEGREES,
  isShutterDegrees,
  SHUTTER_DEGREES,
} from '../settings'
import type { ShutterDegrees } from '../types'

interface MotionBlurRowsProps {
  /** The selected items; the rows work on the video clips among them that can carry blur */
  items: TimelineItem[]
}

/** The fastest speed of a clip: its constant speed, or its curve's peak. */
function peakSpeed(item: VideoItem): number {
  const keys = item.speedCurve?.keys
  if (keys !== undefined && keys.length > 0) return Math.max(...keys.map((key) => key.speed))
  return item.speed ?? 1
}

export function MotionBlurRows({ items }: MotionBlurRowsProps) {
  const { t } = useTranslation()
  if (!isFeatureShown('motionBlur')) return null
  const targets = items.filter(
    (item): item is VideoItem => item.type === 'video' && canHoldMotionBlur(item),
  )
  if (targets.length === 0) return null

  const ids = targets.map((item) => item.id)
  const enabled = targets.every((item) => item.motionBlur !== undefined)
  const shutter =
    targets.find((item) => item.motionBlur !== undefined)?.motionBlur?.shutterDegrees ??
    DEFAULT_SHUTTER_DEGREES
  const fastest = Math.max(...targets.map(peakSpeed))
  const blend = targets.every((item) => item.motionBlur?.blendSlowMotion === true)
  /** The blur settings with the shutter and the blend the rows show, one of them changed. */
  const settingsWith = (change: { shutterDegrees?: ShutterDegrees; blendSlowMotion?: boolean }) => {
    const next = { shutterDegrees: change.shutterDegrees ?? shutter, blendSlowMotion: change.blendSlowMotion ?? blend }
    return next.blendSlowMotion ? next : { shutterDegrees: next.shutterDegrees }
  }

  return (
    <div className="space-y-1" data-testid="motion-blur-rows">
      <PropertyRow label={t('editor.videoSection.motionBlur', { defaultValue: 'Motion blur' })}>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            setMotionBlur(ids, checked ? settingsWith({}) : null)
          }
          aria-label={t('editor.videoSection.motionBlur', { defaultValue: 'Motion blur' })}
          data-testid="motion-blur-enabled"
        />
      </PropertyRow>
      {!enabled && fastest >= 2 && (
        <p className="text-xs text-muted-foreground" data-testid="motion-blur-hint">
          {t('editor.videoSection.motionBlurHint', {
            speed: Math.round(fastest),
            defaultValue: 'At {{speed}}x this removes the strobe',
          })}
        </p>
      )}
      {enabled && (
        <>
          <PropertyRow
            label={t('editor.videoSection.motionBlurShutter', { defaultValue: 'Shutter' })}
          >
            <Select
              value={String(shutter)}
              onValueChange={(value) => {
                const degrees = Number(value)
                if (isShutterDegrees(degrees)) setMotionBlur(ids, settingsWith({ shutterDegrees: degrees }))
              }}
            >
              <SelectTrigger className="h-7 text-xs" data-testid="motion-blur-shutter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHUTTER_DEGREES.map((degrees) => (
                  <SelectItem key={degrees} value={String(degrees)} className="text-xs">
                    {t('editor.videoSection.motionBlurDegrees', {
                      degrees,
                      defaultValue: '{{degrees}}°',
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyRow>
          <PropertyRow
            label={t('editor.videoSection.motionBlurBlendSlow', { defaultValue: 'Smooth slow motion' })}
          >
            <Switch
              checked={blend}
              onCheckedChange={(checked) => setMotionBlur(ids, settingsWith({ blendSlowMotion: checked }))}
              aria-label={t('editor.videoSection.motionBlurBlendSlow', { defaultValue: 'Smooth slow motion' })}
              data-testid="motion-blur-blend-slow"
            />
          </PropertyRow>
          {fastest <= 1 && !blend && (
            <p className="text-xs text-muted-foreground" data-testid="motion-blur-identity">
              {t('editor.videoSection.motionBlurIdentity', {
                defaultValue: 'No effect at this speed',
              })}
            </p>
          )}
        </>
      )}
    </div>
  )
}
