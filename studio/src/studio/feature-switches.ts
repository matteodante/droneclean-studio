/**
 * The switches for DroneClean's own features, and the only place a surface asks whether one of them is shown.
 *
 * Every entry is one of our features: it names the PLAN.md task that finished it, and it was `false` until a slice
 * of that task proved the flow end to end. Every one is on today; the switch stays as the one place that can hide
 * the surface again — `colorPresets` since the render
 * seat landed (slice 5.1c: one press changes the picture). Every entry must be read by app code
 * (`feature-switches.test.ts` fails for one that is not). Nothing
 * of FreeCut's is listed here: no FreeCut feature is ever hidden (PLAN.md decision D4), so a
 * missing switch means "shown", never "hidden by default".
 */

export const FEATURE_SWITCHES = {
  /**
   * Removing the drone's shadow from a clip through the live cloud (PLAN.md task 4.6, with 4.3).
   * On since 19 Nov 2026: the packaged app signed in, tracked, quoted and cleaned a clip through the
   * live service and played the cleaned piece in place (the owner's call: switch everything on).
   */
  shadowRemovalClean: true,
  /**
   * The looks library and a clip's creative `.cube` look (PLAN.md task 5.2). The library and the
   * per-clip choice are stored with the project, and the look stage draws them (float golden cases
   * `float-look-*`; preview 66.5 fps at 3840x2880 with a 65-point look). On since the packaged
   * end-to-end test (`desktop/test/e2e.mjs`) adds a look to the library, chooses it on a clip, reads the
   * preview's pixels, exports, reads the exported frame's colour and undoes the choice.
   */
  looks: true,
  /**
   * The clip panel's stabilization section: on or off per clip, smoothness, horizon lock, zoom
   * (PLAN.md task 6.4). On since 19 Nov 2026: the render redesign fixed the preview (exact frames, staged
   * pipeline), a 60 s stabilized export of clip 0020 runs at the encoder's ceiling with the motion cache warm,
   * and the controls were driven with a mouse against the real engine (`bench/measurements/stabilization-controls.mjs`).
   */
  stabilization: true,
  /**
   * The clip panel's colour preset section: the input colour profile a clip is set to
   * (PLAN.md task 5.2). On, because slice 5.1c seats the input transform in the renderer:
   * one press on the clip's preset changes the picture.
   */
  colorPresets: true,
  /**
   * The clip panel's motion blur switch and shutter select (PLAN.md task 7.2). On since 19 Nov 2026: the export
   * blends every source frame once, within 0.26 levels of 1023 of the linear mean on clip 0020; the 4x preview plays
   * at about half speed (32-37 fps), which the owner judges in the preview build.
   */
  motionBlur: true,
} as const

export type FeatureSwitchId = keyof typeof FEATURE_SWITCHES

/** What a test or the golden kit turned on or off, over the switches' own values */
const overrides: Partial<Record<FeatureSwitchId, boolean>> = {}

/**
 * Turns a switch on or off for a test or the golden kit, which prove a feature before its switch is turned on; `undefined`
 * gives the switch its own value back. The app never calls it.
 */
export function setFeatureOverride(id: FeatureSwitchId, shown: boolean | undefined): void {
  if (shown === undefined) delete overrides[id]
  else overrides[id] = shown
}

/** Whether a surface of a DroneClean feature is shown; a switch's value, or a test's override of it, is the answer. */
export function isFeatureShown(id: FeatureSwitchId): boolean {
  return overrides[id] ?? FEATURE_SWITCHES[id]
}
