// What a pilot can still be told when a file cannot be cut: the reason as a code, so the panel says it in the
// pilot's language, and the same reason as plain English for everything that only reads `message` (the SDK, logs).

/** Why a file has no piece to cut: no video the editor can read, or no frame to start decoding from. */
export type ShadowCutErrorCode = 'no-video' | 'no-keyframe'

const MESSAGES: Record<ShadowCutErrorCode, string> = {
  'no-video': 'This file has no video the editor can read, so the shadow cannot be followed in it.',
  'no-keyframe':
    'This video has no keyframe to start from, so the shadow cannot be followed in it. Convert it to a standard MP4 first.',
}

/** A file the cutter cannot take a piece from, nothing wrong with the request itself. */
export class ShadowCutError extends Error {
  readonly code: ShadowCutErrorCode

  constructor(code: ShadowCutErrorCode) {
    super(MESSAGES[code])
    this.name = 'ShadowCutError'
    this.code = code
  }
}
