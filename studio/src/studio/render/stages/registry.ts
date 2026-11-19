// The stage registry (design 3.6 section 2.2): the order is the array's, fixed in one place. Slice 1 builds
// `SOURCE_STAGES = createStageRegistry([stabilize, inputColour, look])` from the adapters; this file owns the order
// and the checks on it, so a stage listed out of order is a thrown error at start-up, not a wrong picture.

import type { VideoItem } from '@/types/timeline'
import type { SourceStage, StageId, StageScope } from './types'

/** The pipeline's order (PLAN section 4): stabilize on the source frame, then input colour, then the look. */
export const STAGE_ORDER: readonly StageId[] = ['stabilize', 'input-colour', 'look']

/**
 * The scope each stage must declare: the stabilization warps one source frame and the input transform depends on the
 * source (D-Log to Rec.709), so both run on each sample before the motion-blur gather; the look acts on the output.
 */
const STAGE_SCOPE: Record<StageId, StageScope> = {
  stabilize: 'source-frame',
  'input-colour': 'source-frame',
  look: 'output-frame',
}

/** The stages in their fixed order, with the two questions the pipeline asks of them. */
export interface StageRegistry {
  /** Every stage, in pipeline order. */
  readonly stages: readonly SourceStage[]
  /** The stages that change this clip's pixels, in pipeline order. */
  activeStages(item: VideoItem): SourceStage[]
  /** The active stages of one scope, in pipeline order. */
  activeStagesOf(item: VideoItem, scope: StageScope): SourceStage[]
}

/**
 * Builds a registry from the stages, which must be exactly `STAGE_ORDER`'s ids in that order, each with its scope.
 *
 * @throws Error naming the stage that is missing, repeated, out of order or in the wrong scope.
 */
export function createStageRegistry(stages: readonly SourceStage[]): StageRegistry {
  const ids = stages.map((stage) => stage.id)
  if (ids.length !== STAGE_ORDER.length || ids.some((id, index) => id !== STAGE_ORDER[index])) {
    throw new Error(
      `The stage registry must list ${STAGE_ORDER.join(', ')} in that order, got ${ids.join(', ') || 'nothing'}`,
    )
  }
  for (const stage of stages) {
    if (stage.scope !== STAGE_SCOPE[stage.id]) {
      throw new Error(
        `Stage '${stage.id}' must have scope '${STAGE_SCOPE[stage.id]}', got '${stage.scope}'`,
      )
    }
  }
  const ordered = [...stages]
  const activeStages = (item: VideoItem): SourceStage[] =>
    ordered.filter((stage) => stage.active(item))
  return {
    stages: ordered,
    activeStages,
    activeStagesOf: (item, scope) => activeStages(item).filter((stage) => stage.scope === scope),
  }
}
