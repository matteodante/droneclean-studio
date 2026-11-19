export interface SourcePlayerMethods {
  toggle: () => void
  /**
   * Unconditional pause — no-ops when already paused. Exposed so callers
   * outside the source monitor (e.g. scene browser clicks) can stop the
   * current scene synchronously before queueing a seek, instead of
   * waiting for the seek-consume effect and racing with the video
   * element still decoding the old frame.
   */
  pause: () => void
  isPlaying: () => boolean
  shuttleForward: () => void
  shuttleReverse: () => void
  seek: (frame: number) => void
  frameBack: (frames: number) => void
  frameForward: (frames: number) => void
  getDurationInFrames: () => number
}

/** The marks remembered for one file or subclip: whole source frames of the file, out exclusive. */
export interface SourceMarkPair {
  in: number | null
  out: number | null
}

/** The frames of the file the source monitor plays and marks inside: `[start, end)`. */
export interface SourceWindow {
  start: number
  end: number
}

export interface SourcePlayerState {
  hoveredPanel: 'source' | null
  playerMethods: SourcePlayerMethods | null
  currentMediaId: string | null
  currentSourceFrame: number
  previewSourceFrame: number | null
  inPoint: number | null
  outPoint: number | null
  /**
   * In/out marks remembered per key, `activeSubclipId ?? mediaId` (design 1.6, D5). `inPoint` and
   * `outPoint` mirror the pair of the open key; every write goes to both. Saved with the project.
   */
  marksByKey: Record<string, SourceMarkPair>
  /** The subclip open in the monitor (its parent is `currentMediaId`), or null for the whole file. */
  activeSubclipId: string | null
  /** The range of the open subclip, or null for the whole file. */
  activeWindow: SourceWindow | null
  pendingSeekFrame: number | null
  /**
   * When true, the source monitor starts playback after consuming the
   * next `pendingSeekFrame`. The monitor always pauses before seeking,
   * so scene-browser single-click just queues a seek (leaves paused)
   * while double-click queues `pendingPlay: true` to play from the new
   * scene.
   */
  pendingPlay: boolean
  setHoveredPanel: (panel: 'source' | null) => void
  setPlayerMethods: (methods: SourcePlayerMethods | null) => void
  setCurrentMediaId: (id: string | null) => void
  releaseCurrentMediaId: (id: string) => void
  setCurrentSourceFrame: (frame: number) => void
  setPreviewSourceFrame: (frame: number | null) => void
  setInPoint: (frame: number | null) => void
  setOutPoint: (frame: number | null) => void
  clearInOutPoints: () => void
  /** Opens a subclip of the current media (or, with nulls, the whole file) and restores its marks. */
  setActiveSubclip: (id: string | null, window: SourceWindow | null) => void
  /** Replaces the remembered marks (project open) and refreshes the open key's pair. */
  setMarksByKey: (marks: Record<string, SourceMarkPair>) => void
  setPendingSeekFrame: (frame: number | null) => void
  setPendingPlay: (play: boolean) => void
}

/** The marks' key: the subclip when one is open, else the file. */
export function getSourceMarksKey(
  state: Pick<SourcePlayerState, 'currentMediaId' | 'activeSubclipId'>,
): string | null {
  return state.activeSubclipId ?? state.currentMediaId
}

/** The frames the monitor plays inside: the open subclip's range, or the whole file. */
export function getSourceWindow(
  state: Pick<SourcePlayerState, 'activeWindow'>,
  fileFrameCount: number,
): SourceWindow {
  return state.activeWindow ?? { start: 0, end: fileFrameCount }
}
