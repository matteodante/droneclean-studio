/**
 * Adapter exports for timeline utility dependencies.
 * Preview modules should import timeline utility helpers from here.
 */

export { resolveEffectiveTrackStates } from './timeline-contract'
export {
  findBestCanvasDropPlacement,
  buildDroppedMediaTimelineItem,
  createClassicTrack,
  createOverlayLayerTrack,
  createTimelineTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
  getDroppedMediaDurationInFrames,
  getTrackKind,
  isTimelineTemplateDragData,
  readDroppedSourceRange,
  type DroppableMediaType,
  type DroppedSourceRange,
} from './timeline-contract'
export { createScrubThrottleState, shouldCommitScrubFrame } from './timeline-contract'
export { timelineToSourceFrames } from './timeline-contract'
export { useWaveform } from './timeline-contract'
