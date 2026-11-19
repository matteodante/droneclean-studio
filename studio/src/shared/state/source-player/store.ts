import { create } from 'zustand'
import { getSourceMarksKey, type SourceMarkPair, type SourcePlayerState } from './types'

const NO_MARKS: SourceMarkPair = { in: null, out: null }

function marksOf(marksByKey: Record<string, SourceMarkPair>, key: string | null): SourceMarkPair {
  return (key !== null ? marksByKey[key] : undefined) ?? NO_MARKS
}

/** Writes the pair of the open key; with nothing open the marks only live in `inPoint`/`outPoint`. */
function withMarks(
  state: SourcePlayerState,
  inPoint: number | null,
  outPoint: number | null,
): Partial<SourcePlayerState> {
  const key = getSourceMarksKey(state)
  if (key === null) return { inPoint, outPoint }
  return {
    inPoint,
    outPoint,
    marksByKey: { ...state.marksByKey, [key]: { in: inPoint, out: outPoint } },
  }
}

export const useSourcePlayerStore = create<SourcePlayerState>((set) => ({
  hoveredPanel: null,
  playerMethods: null,
  currentMediaId: null,
  currentSourceFrame: 0,
  previewSourceFrame: null,
  inPoint: null,
  outPoint: null,
  marksByKey: {},
  activeSubclipId: null,
  activeWindow: null,
  pendingSeekFrame: null,
  pendingPlay: false,
  setHoveredPanel: (panel) => set({ hoveredPanel: panel }),
  setPlayerMethods: (methods) => set({ playerMethods: methods }),
  setCurrentMediaId: (id) =>
    set((state) => {
      if (id === state.currentMediaId) return state
      const marks = marksOf(state.marksByKey, id)
      return {
        currentMediaId: id,
        activeSubclipId: null,
        activeWindow: null,
        inPoint: marks.in,
        outPoint: marks.out,
        currentSourceFrame: 0,
        previewSourceFrame: null,
        pendingSeekFrame: null,
        pendingPlay: false,
      }
    }),
  releaseCurrentMediaId: (id) =>
    set((state) => {
      if (state.currentMediaId !== id) return state
      return {
        currentMediaId: null,
        activeSubclipId: null,
        activeWindow: null,
        inPoint: null,
        outPoint: null,
        currentSourceFrame: 0,
        previewSourceFrame: null,
        pendingSeekFrame: null,
        pendingPlay: false,
      }
    }),
  setCurrentSourceFrame: (frame) => set({ currentSourceFrame: frame }),
  setPreviewSourceFrame: (frame) => set({ previewSourceFrame: frame }),
  setInPoint: (frame) =>
    set((state) => {
      if (frame !== null && state.outPoint !== null && frame >= state.outPoint) {
        return withMarks(state, frame, null)
      }
      return withMarks(state, frame, state.outPoint)
    }),
  setOutPoint: (frame) =>
    set((state) => {
      if (frame !== null && state.inPoint !== null && frame <= state.inPoint) {
        return withMarks(state, null, frame)
      }
      return withMarks(state, state.inPoint, frame)
    }),
  clearInOutPoints: () => set((state) => withMarks(state, null, null)),
  setActiveSubclip: (id, window) =>
    set((state) => {
      if (state.currentMediaId === null) return state
      const marks = marksOf(state.marksByKey, id ?? state.currentMediaId)
      return {
        activeSubclipId: id,
        activeWindow: id === null ? null : window,
        inPoint: marks.in,
        outPoint: marks.out,
      }
    }),
  setMarksByKey: (marksByKey) =>
    set((state) => {
      const marks = marksOf(marksByKey, getSourceMarksKey(state))
      return { marksByKey, inPoint: marks.in, outPoint: marks.out }
    }),
  setPendingSeekFrame: (frame) => set({ pendingSeekFrame: frame }),
  setPendingPlay: (play) => set({ pendingPlay: play }),
}))
