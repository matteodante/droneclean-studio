/**
 * The two rows under "Smooth slow motion" while it is on Optical flow (design 11.24, Matteo's option 2b): "Motion detail"
 * (normal, high) and "Hard edges" (mix the frames, nearest frame). `MotionBlurRows` draws them and stores each choice
 * through `setMotionBlur`, so one choice is one undo step for every selected clip; the defaults are the first entries,
 * which a clip stores as nothing.
 */

import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PropertyRow } from '@/shared/ui/property-controls'
import { FLOW_DETAILS, FLOW_EDGES, isFlowDetail, isFlowEdges } from '../settings'
import type { FlowDetail, FlowEdges } from '../types'

interface OpticalFlowRowsProps {
  /** The motion detail the rows show (the first selected clip's) */
  detail: FlowDetail
  /** The hard edges choice the rows show */
  edges: FlowEdges
  onDetail: (detail: FlowDetail) => void
  onEdges: (edges: FlowEdges) => void
}

export function OpticalFlowRows({ detail, edges, onDetail, onEdges }: OpticalFlowRowsProps) {
  const { t } = useTranslation()
  const detailLabels: Record<FlowDetail, string> = {
    normal: t('editor.videoSection.flowDetailNormal', { defaultValue: 'Normal' }),
    high: t('editor.videoSection.flowDetailHigh', { defaultValue: 'High' }),
  }
  const edgesLabels: Record<FlowEdges, string> = {
    mix: t('editor.videoSection.flowEdgesMix', { defaultValue: 'Mix frames' }),
    nearest: t('editor.videoSection.flowEdgesNearest', { defaultValue: 'Nearest frame' }),
  }
  const detailLabel = t('editor.videoSection.flowDetail', { defaultValue: 'Motion detail' })
  const edgesLabel = t('editor.videoSection.flowEdges', { defaultValue: 'Hard edges' })
  return (
    <>
      <PropertyRow
        label={detailLabel}
        tooltip={t('editor.videoSection.flowDetailTitle', {
          defaultValue: 'How finely optical flow follows the motion. High follows small and thin moving things more closely, and takes longer.',
        })}
      >
        <Select value={detail} onValueChange={(value) => isFlowDetail(value) && onDetail(value)}>
          <SelectTrigger className="h-7 text-xs" aria-label={detailLabel} data-testid="motion-blur-flow-detail">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FLOW_DETAILS.map((choice) => (
              <SelectItem key={choice} value={choice} className="text-xs">
                {detailLabels[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>
      <PropertyRow
        label={edgesLabel}
        tooltip={t('editor.videoSection.flowEdgesTitle', {
          defaultValue:
            'Where the motion cannot be followed (a branch near the lens, something entering the frame): mix the two frames there (a soft halo at worst) or take the nearer one (no halo, a small jump).',
        })}
      >
        <Select value={edges} onValueChange={(value) => isFlowEdges(value) && onEdges(value)}>
          <SelectTrigger className="h-7 text-xs" aria-label={edgesLabel} data-testid="motion-blur-flow-edges">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FLOW_EDGES.map((choice) => (
              <SelectItem key={choice} value={choice} className="text-xs">
                {edgesLabels[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>
    </>
  )
}
