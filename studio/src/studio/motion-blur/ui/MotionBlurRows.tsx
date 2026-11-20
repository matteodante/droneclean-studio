/**
 * The rows of the clip panel's Playback section that set motion blur (design 7.2, section 4.7; design 9.2, section
 * 7): a switch, and while it is on the amount (a slider in RSMB's units, 0.5 = 180 degrees) and the smooth slow
 * motion. `video-section.tsx` draws them with one line, so the fork needs no other element in the clip panel.
 *
 * They are hidden while the `motionBlur` feature switch is off, and for a selection with no clip that can carry blur.
 * Every change goes through `setMotionBlur`, so the switch, each amount and each smooth slow motion choice (off, frame
 * blending, optical flow: task 11.12) are one undo step however many clips are selected; the slider stores once, on
 * release. With optical flow, `OpticalFlowRows` adds its motion detail and hard edges (design 11.24).
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
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { isFeatureShown } from '@/studio/feature-switches'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { setMotionBlur } from './actions'
import { OpticalFlowRows } from './OpticalFlowRows'
import {
  amountOfShutter,
  AMOUNT_STEP,
  canHoldMotionBlur,
  DEFAULT_SHUTTER_DEGREES,
  flowSettingsOf,
  isSmoothSlowMotion,
  shutterOfAmount,
  SMOOTH_SLOW_MOTION,
} from '../settings'
import type { FlowDetail, FlowEdges, MotionBlurSettings, ShutterDegrees, SmoothSlowMotion } from '../types'

/** The select's value for "off": smooth slow motion is absent from the settings */
const SMOOTH_OFF = 'off'

/** The smooth slow motion select's choices, in its order */
const SMOOTH_CHOICES: readonly (SmoothSlowMotion | typeof SMOOTH_OFF)[] = [SMOOTH_OFF, ...SMOOTH_SLOW_MOTION]

/** The slider stores on release only: a drag previews nothing (each stored value is a blur the renderer must redo) */
const NO_LIVE_CHANGE = () => {}

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
  const shown = targets.find((item) => item.motionBlur !== undefined)?.motionBlur
  const smooth: SmoothSlowMotion | undefined = shown?.smoothSlowMotion
  const flowDetail: FlowDetail = shown?.flowDetail ?? 'normal'
  const flowEdges: FlowEdges = shown?.flowEdges ?? 'mix'
  const smoothLabels: Record<SmoothSlowMotion | typeof SMOOTH_OFF, string> = {
    off: t('editor.videoSection.smoothSlowMotionOff', { defaultValue: 'Off' }),
    blend: t('editor.videoSection.smoothSlowMotionBlend', { defaultValue: 'Frame blending' }),
    'optical-flow': t('editor.videoSection.smoothSlowMotionFlow', { defaultValue: 'Optical flow' }),
  }
  /** The blur settings the rows show (shutter, smooth slow motion, optical flow's two), one of them changed. */
  const settingsWith = (change: {
    shutterDegrees?: ShutterDegrees
    smoothSlowMotion?: SmoothSlowMotion | typeof SMOOTH_OFF
    flowDetail?: FlowDetail
    flowEdges?: FlowEdges
  }): MotionBlurSettings => {
    const shutterDegrees = change.shutterDegrees ?? shutter
    const mode = change.smoothSlowMotion ?? smooth ?? SMOOTH_OFF
    if (mode === SMOOTH_OFF) return { shutterDegrees }
    const flow = flowSettingsOf(mode, {
      flowDetail: change.flowDetail ?? flowDetail,
      flowEdges: change.flowEdges ?? flowEdges,
    })
    return { shutterDegrees, smoothSlowMotion: mode, ...flow }
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
          <PropertyRow label={t('editor.videoSection.motionBlurAmount', { defaultValue: 'Amount' })}>
            <div className="flex-1 min-w-0" data-testid="motion-blur-amount">
              <SliderInput
                value={amountOfShutter(shutter)}
                min={0}
                max={1}
                step={AMOUNT_STEP}
                onLiveChange={NO_LIVE_CHANGE}
                onChange={(amount) => setMotionBlur(ids, settingsWith({ shutterDegrees: shutterOfAmount(amount) }))}
                formatValue={(amount) =>
                  t('editor.videoSection.motionBlurAmountValue', {
                    amount: amount.toFixed(2),
                    degrees: Math.round(shutterOfAmount(amount)),
                    defaultValue: '{{amount}} · {{degrees}}°',
                  })
                }
                className="flex-1 min-w-0"
              />
            </div>
          </PropertyRow>
          <PropertyRow
            label={t('editor.videoSection.motionBlurBlendSlow', { defaultValue: 'Smooth slow motion' })}
          >
            <Select
              value={smooth ?? SMOOTH_OFF}
              onValueChange={(value) => {
                if (value === SMOOTH_OFF || isSmoothSlowMotion(value)) {
                  setMotionBlur(ids, settingsWith({ smoothSlowMotion: value }))
                }
              }}
            >
              <SelectTrigger
                className="h-7 text-xs"
                aria-label={t('editor.videoSection.motionBlurBlendSlow', { defaultValue: 'Smooth slow motion' })}
                data-testid="motion-blur-smooth-slow"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SMOOTH_CHOICES.map((mode) => (
                  <SelectItem key={mode} value={mode} className="text-xs">
                    {smoothLabels[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyRow>
          {smooth === 'optical-flow' && (
            <OpticalFlowRows
              detail={flowDetail}
              edges={flowEdges}
              onDetail={(detail) => setMotionBlur(ids, settingsWith({ flowDetail: detail }))}
              onEdges={(edges) => setMotionBlur(ids, settingsWith({ flowEdges: edges }))}
            />
          )}
        </>
      )}
    </div>
  )
}
