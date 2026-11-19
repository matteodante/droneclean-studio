// The subclip core: the record, its store, its checks and how it lives in a project file.
// Design: docs/designs/1.6-subclips.md.

export type { Subclip, SubclipInvalidReason } from './model'
export {
  countSubclipsForMedia,
  useSubclipsStore,
  type CreateSubclipInput,
} from './store'
export { getParentFrameCount, getRangeError, getSubclipValidity } from './validate'
export {
  buildSubclipTimelineFields,
  reconcileSubclipsWithMedia,
  restoreSubclipTimelineFields,
} from './project'
