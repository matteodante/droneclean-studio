// A video source an export cannot open or decode. FreeCut's own video path draws nothing for such a clip and goes on:
// the export finishes at full speed with black frames and no error (found moving the export into a worker, task 8.3:
// a `blob:` URL the worker did not hold gave a 398 KB file instead of 63.8 MB). An export stops instead, with this
// error, and its message names the clip so the pilot knows which file to look at. Staged clips fail with the
// pipeline's `StageError`; this is the unstaged video path's counterpart.
//
// Nothing here touches a GPU, a store or the DOM (the element is read through a structural type).

export interface SourceErrorInit {
  /** The clip as the pilot knows it: its label, else its id */
  readonly clip: string
  /** The media library's id for the file behind the clip, when the clip has one */
  readonly mediaId?: string
  /** Why the file could not be read, in words the pilot can act on */
  readonly reason: string
  /** The timeline frame where the export found out */
  readonly frame?: number
  readonly cause?: unknown
}

export class SourceError extends Error {
  readonly clip: string
  readonly mediaId: string | undefined
  readonly reason: string
  readonly frame: number | undefined

  constructor(init: SourceErrorInit) {
    super(sourceErrorMessage(init), { cause: init.cause })
    this.name = 'SourceError'
    this.clip = init.clip
    this.mediaId = init.mediaId
    this.reason = init.reason
    this.frame = init.frame
  }
}

/** The message, from the fields alone: the export worker rebuilds an error from them on the page */
function sourceErrorMessage(init: SourceErrorInit): string {
  const media = init.mediaId === undefined ? '' : ` (media ${init.mediaId})`
  const frame = init.frame === undefined ? '' : ` at frame ${init.frame}`
  return `The export stopped: the video of clip '${init.clip}'${media} could not be read${frame}: ${init.reason}`
}

/** What a clip's source reads like to the part of the renderer that has to say why it is unreadable */
export interface UnreadableSourceFacts {
  readonly hasExtractor: boolean
  readonly extractorOpened: boolean
  readonly extractorDisabled: boolean
  /** The fallback `<video>` element's error, when there is an element and it failed */
  readonly elementError?: { readonly code: number; readonly message: string } | null
  readonly hasElement: boolean
}

const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

const MOVED = 'the file may have been moved, renamed or deleted since it was imported'

/** What the fallback element's own error says, when it has one */
function elementReason(error: UnreadableSourceFacts['elementError']): string | null {
  switch (error?.code) {
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `the file cannot be opened (${MOVED}) or its format is not supported by this browser`
    case MEDIA_ERR_NETWORK:
      return `the file cannot be reached (${MOVED})`
    case MEDIA_ERR_DECODE:
      return 'the file is damaged or uses a codec that cannot be decoded'
    default:
      return null
  }
}

/** The reason, from what the renderer knows about the clip's decoder and fallback element */
export function unreadableSourceReason(facts: UnreadableSourceFacts): string {
  const fromElement = elementReason(facts.elementError)
  if (fromElement !== null) return fromElement
  if (!facts.hasExtractor && !facts.hasElement) return `the file was never opened (${MOVED})`
  if (facts.extractorDisabled) return 'decoding it failed repeatedly, so the export gave up on it'
  if (!facts.extractorOpened) return `the decoder could not open the file (${MOVED})`
  return 'the decoder returned no picture for this frame'
}
