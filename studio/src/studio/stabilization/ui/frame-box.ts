// A stabilized clip is made at the project's aspect (`engine-key.ts`), so a clip whose file has another aspect changes
// shape when it is stabilized: a 4:3 clip in a 9:16 project becomes a 9:16 picture. Its box (`item.transform`, locked
// at the file's fit-to-frame size when the clip was placed: `computeInitialTransform`) would then hold the 9:16 picture
// inside a 4:3 box, a small strip in the middle of the frame (found on 19 Nov 2026, on a vertical cut).
//
// So switching the stabilization on or off moves a box the pilot never touched to the fit of the picture it now shows:
// the file's fit becomes the whole frame, and back. A box the pilot sized or placed is theirs and is left alone.

import { computeInitialTransform } from '@/features/timeline/utils/transform-init'
import type { TransformProperties } from '@/types/transform'

interface Size {
  width: number
  height: number
}

/**
 * The box a clip should have once its stabilization is `on`, or `null` when its box stays as it is: no box stored
 * (the layout fits the staged picture itself), a box the pilot changed, or a file of the project's own aspect.
 */
export function boxForStabilization(
  transform: TransformProperties | undefined,
  on: boolean,
  file: Size | undefined,
  frame: Size | undefined,
): TransformProperties | null {
  if (!transform || !file || !frame || file.width <= 0 || file.height <= 0) return null
  const fileFit = computeInitialTransform(file.width, file.height, frame.width, frame.height)
  const frameFit = { width: frame.width, height: frame.height }
  if (fileFit.width === frameFit.width && fileFit.height === frameFit.height) return null
  const from = on ? fileFit : frameFit
  const to = on ? frameFit : fileFit
  if (transform.width !== from.width || transform.height !== from.height) return null
  if ((transform.x ?? 0) !== 0 || (transform.y ?? 0) !== 0 || (transform.rotation ?? 0) !== 0) return null
  return { ...transform, width: to.width, height: to.height }
}
