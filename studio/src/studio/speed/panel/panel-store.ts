/**
 * Which clip's speed curve the dock is showing, if any (design 7.1, section 4.8).
 *
 * The panel has its own open flag, like the keyframe editor's: "Curve…" in the clip panel opens it
 * for one clip, its close button (or Escape) closes it. Keeping the flag here — beside the panel
 * rather than in a FreeCut store — means the dock, the button and the panel's tests share one small
 * piece of state and no new field appears in the editor's selection store.
 */

import { create } from 'zustand'

interface SpeedCurvePanelState {
  /** The clip whose curve the dock shows, or null when the dock is closed. */
  readonly itemId: string | null
  /** Open the dock for a clip; a second call with another id switches clips. */
  open: (itemId: string) => void
  /** Close the dock. */
  close: () => void
}

export const useSpeedCurvePanelStore = create<SpeedCurvePanelState>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}))
