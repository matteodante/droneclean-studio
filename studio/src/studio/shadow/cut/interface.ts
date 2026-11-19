// Cutting the piece that is uploaded: a window of whole source frames that starts and ends on the
// source's keyframes, cut with the encoded samples copied. Callers take the interface, not the
// implementation: the web editor cuts with mediabunny, the desktop app will cut with FFmpeg.

/** A range of source frames to clean: `[startFrame, endFrame)`, in frames from the source's first. */
export interface ShadowCutRange {
  /** The range's first source frame. */
  startFrame: number
  /** One past the range's last source frame; always greater than `startFrame`. */
  endFrame: number
}

/** The source's exact frame rate, `num / den` frames a second (59.94 is 60000/1001). */
export interface SourceRate {
  num: number
  den: number
}

/**
 * The part of the source that is cut and uploaded: whole source frames `startFrame` to `endFrame`
 * (exclusive), widened to start on a keyframe and to end on the next keyframe or the track's end.
 * The piece's frame `j` is source frame `startFrame + j`.
 */
export interface ShadowCutWindow {
  /** The window's first source frame: a keyframe of the source. */
  startFrame: number
  /** One past the window's last source frame; `endFrame - startFrame` is the piece's frame count. */
  endFrame: number
  /** The source time of `startFrame`: the keyframe's presentation time. */
  startSeconds: number
  /** The source time just past the window's last frame: the next keyframe's, or the track's end. */
  endSeconds: number
}

/**
 * The clip's source as the cutter reads it: a Blob (a linked file's `File`, the workspace copy), or the URL the
 * desktop shell serves a path-linked file at (`droneclean://app/...`), read in ranges so a 4 GB file is never loaded.
 */
export type ShadowSource = Blob | { readonly url: string }

/** Cuts a piece for a range of source frames; each shell supplies its own implementation. */
export interface ShadowCutter {
  plan(file: ShadowSource, range: ShadowCutRange, sourceRate: SourceRate): Promise<ShadowCutWindow>
  cut(file: ShadowSource, window: ShadowCutWindow): Promise<Blob>
}
