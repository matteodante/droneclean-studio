// The clip panel's stabilization section (task 6.4): the switch, and while it is on the controls of design 6.3
// section 4.7 - smoothness, horizon lock (amount and roll), zoom (field of view and the adaptive window) and the
// lens profile's name. A clip with no motion data or no lens profile gets a plain message where the controls would
// be. Everything the controls accept comes from the engine's own limits and the stored format's (`changes.ts`).
//
// The section is behind the `stabilization` feature switch. Each change is one `updateItem`, so one undo step;
// the sliders store when released, never while they move.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Move3d } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { PropertyRow, PropertySection, SliderInput } from '@/shared/ui/property-controls'
import { NumberInput } from '@/shared/ui/property-controls/number-input'
import { isFeatureShown } from '@/studio/feature-switches'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import {
  HORIZON_LOCK_PERCENT_RANGE,
  HORIZON_LOCK_ROLL_RANGE,
  smoothnessParameter,
  type StabilizationChange,
} from './changes'
import { pageEngine, type StabilizationEngine } from './engine'
import {
  useStabilizationControls,
  type StabilizationControls,
  type StabilizationPhase,
} from './use-stabilization-controls'

interface StabilizationSectionProps {
  /** The selected items; the section works on the first video clip among them */
  items: TimelineItem[]
  /** The engine the section asks; the default is the page's */
  engine?: StabilizationEngine
}

/** A slider drags without storing: the one store is on release */
const NO_LIVE_CHANGE = () => {}

/** What is happening or wrong, in plain words */
function PhaseNote({ phase }: { phase: StabilizationPhase }) {
  const { t } = useTranslation()
  switch (phase.kind) {
    case 'idle':
      return null
    case 'checking': {
      const progress = phase.progress
      return (
        <p className="text-xs text-muted-foreground" data-testid="stabilization-checking">
          {progress && progress.phase === 'reading'
            ? t('editor.stabilization.progress.reading', {
                read: Math.round(progress.bytesRead / 1_000_000),
                total: Math.round(progress.fileSize / 1_000_000),
              })
            : progress
              ? t('editor.stabilization.progress.smoothing')
              : t('editor.stabilization.progress.starting')}
        </p>
      )
    }
    case 'no-motion-data':
      return (
        <p className="text-xs text-muted-foreground" data-testid="stabilization-no-motion-data">
          {t('editor.stabilization.noMotionData')}
        </p>
      )
    case 'no-lens-profile':
      return (
        <p className="text-xs text-muted-foreground" data-testid="stabilization-no-lens-profile">
          {t('editor.stabilization.noLensProfile')}
        </p>
      )
    case 'failed':
      return (
        <p className="text-xs text-destructive" data-testid="stabilization-failed">
          {t('editor.stabilization.failed', { reason: phase.reason })}
        </p>
      )
  }
}

/**
 * A number typed or scrubbed into a box is stored on commit. A refused value (outside the allowed range) leaves the
 * stored one, and the box is redrawn with it: the key changes with each refusal.
 */
function NumberControl({
  label,
  testId,
  value,
  step,
  min,
  unit,
  onCommit,
}: {
  label: string
  testId: string
  value: number
  step: number
  min?: number
  unit?: string
  onCommit: (value: number) => boolean
}) {
  const [refusals, setRefusals] = useState(0)
  return (
    <PropertyRow label={label}>
      <div className="flex-1 min-w-0" data-testid={testId}>
        <NumberInput
          key={refusals}
          value={value}
          step={step}
          min={min}
          unit={unit}
          onChange={(next) => {
            if (!onCommit(next)) setRefusals((count) => count + 1)
          }}
        />
      </div>
    </PropertyRow>
  )
}

/** The controls of a clip that is switched on */
function Controls({
  item,
  controls,
}: {
  item: VideoItem
  controls: StabilizationControls
}) {
  const { t } = useTranslation()
  const settings = item.stabilization
  if (!settings || !controls.methods) return null
  const smoothness = smoothnessParameter(settings, controls.methods)
  const smoothnessValue = settings.params.smoothness
  const set = (kind: StabilizationChange['kind']) => (value: number) =>
    controls.change({ kind, value })
  return (
    <div className="space-y-1" data-testid="stabilization-controls">
      {smoothness && smoothness.min !== null && smoothness.max !== null && smoothnessValue !== undefined && (
        <PropertyRow label={t('editor.stabilization.smoothness')}>
          <div className="flex-1 min-w-0" data-testid="stabilization-smoothness">
            <SliderInput
              value={smoothnessValue}
              min={smoothness.min}
              max={smoothness.max}
              step={0.01}
              onLiveChange={NO_LIVE_CHANGE}
              onChange={(value) =>
                controls.change({
                  kind: 'smoothness',
                  value: Math.min(smoothness.max as number, Math.max(smoothness.min as number, value)),
                })
              }
            />
          </div>
        </PropertyRow>
      )}
      <PropertyRow label={t('editor.stabilization.horizonLock')}>
        <div className="flex-1 min-w-0" data-testid="stabilization-horizon-percent">
          <SliderInput
            value={settings.horizonLockPercent}
            min={HORIZON_LOCK_PERCENT_RANGE.min}
            max={HORIZON_LOCK_PERCENT_RANGE.max}
            step={1}
            unit="%"
            onLiveChange={NO_LIVE_CHANGE}
            onChange={set('horizonLockPercent')}
          />
        </div>
      </PropertyRow>
      <PropertyRow label={t('editor.stabilization.horizonRoll')}>
        <div className="flex-1 min-w-0" data-testid="stabilization-horizon-roll">
          <SliderInput
            value={settings.horizonLockRoll}
            min={HORIZON_LOCK_ROLL_RANGE.min}
            max={HORIZON_LOCK_ROLL_RANGE.max}
            step={1}
            unit="°"
            onLiveChange={NO_LIVE_CHANGE}
            onChange={set('horizonLockRoll')}
          />
        </div>
      </PropertyRow>
      <NumberControl
        label={t('editor.stabilization.zoom')}
        testId="stabilization-fov"
        value={settings.fov}
        step={0.05}
        onCommit={set('fov')}
      />
      <NumberControl
        label={t('editor.stabilization.adaptiveZoom')}
        testId="stabilization-adaptive-zoom"
        value={settings.adaptiveZoomSeconds}
        step={0.5}
        min={0}
        unit="s"
        onCommit={set('adaptiveZoomSeconds')}
      />
      {controls.lensName && (
        <PropertyRow label={t('editor.stabilization.lens')}>
          <span className="text-xs truncate" data-testid="stabilization-lens" title={controls.lensName}>
            {controls.lensName}
          </span>
        </PropertyRow>
      )}
    </div>
  )
}

function StabilizationControlsGroup({
  item,
  engine,
}: {
  item: VideoItem
  engine: StabilizationEngine
}) {
  const { t } = useTranslation()
  const controls = useStabilizationControls(item, engine)
  const enabled = item.stabilization?.enabled === true
  const checking = controls.phase.kind === 'checking'
  return (
    <PropertySection title={t('editor.stabilization.title')} icon={Move3d}>
      <div className="space-y-2 text-xs" data-testid="stabilization-section">
        <PropertyRow label={t('editor.stabilization.enable')}>
          <Switch
            checked={enabled}
            disabled={checking}
            onCheckedChange={controls.setEnabled}
            aria-label={t('editor.stabilization.enable')}
            data-testid="stabilization-enabled"
          />
        </PropertyRow>
        <PhaseNote phase={controls.phase} />
        {enabled && <Controls item={item} controls={controls} />}
      </div>
    </PropertySection>
  )
}

/**
 * The clip panel's one stabilization hook. Renders nothing while the `stabilization` switch is off, and nothing for
 * a selection without a video clip. Keyed by the clip, so one clip's message or progress is never another's.
 */
export function StabilizationSection({ items, engine = pageEngine }: StabilizationSectionProps) {
  if (!isFeatureShown('stabilization')) return null
  const item = items.find((candidate): candidate is VideoItem => candidate.type === 'video')
  if (!item) return null
  return <StabilizationControlsGroup key={item.id} item={item} engine={engine} />
}
