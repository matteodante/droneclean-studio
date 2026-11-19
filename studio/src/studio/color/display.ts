/**
 * The display end of the input transform: the sRGB transfer function, the extended Reinhard
 * shoulder, and `transform`, the pure function the GPU stage (5.1c) reproduces.
 *
 * A profile's pipeline is `encode(shoulder(M · decode(code)))`, in that order: the decode
 * curve, the gamut matrix in linear light, the shoulder in linear light, then the display
 * encode (design 5.1, sections 4.1 and 4.2).
 */

import { applyMatrix, D_GAMUT_TO_REC709, DLOG_M_TO_REC709, type Matrix3 } from './gamut'
import { decodeDLog, decodeDLogM } from './log'
import { DLOG_SHOULDER, type Shoulder } from './profiles'
import type { ColorProfileId, Rgb } from './types'

/**
 * The sRGB transfer function, linear light to code.
 *
 * Design 5.1 section 4.1 writes "OETF709" for this step, but the D-Log M curve and matrix
 * were fitted against DJI's "D-Log M to Rec.709" LUT through this transfer function, and every
 * measured number in section 5 uses it: swapping in the Rec.709 OETF moves the D-Log M
 * profile from mean 5.16 / max 60.39 to mean 38.33 / max 96.88 levels of 1023 against the same
 * LUT. This is the one place the design's label and its measurement disagree; the stage
 * outputs sRGB-encoded light on Rec.709 primaries, which is what the browser canvas shows.
 *
 * Input outside 0..1 is clamped, as the sRGB function defines no code there.
 */
export function srgbEncode(linear: number): number {
  const value = Math.min(Math.max(linear, 0), 1)
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value < 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

/**
 * The inverse sRGB transfer function, code to linear light: `code/12.92` up to 0.04045,
 * `((code + 0.055)/1.055)^2.4` above it. Input is clamped to 0..1.
 */
export function srgbDecode(encoded: number): number {
  const value = Math.min(Math.max(encoded, 0), 1)
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * Apply an extended Reinhard shoulder to one linear channel:
 * `v ← v·(1 + v/w²)/(1 + v)` after `v ← exposure·v`.
 *
 * The matrix can push a channel below 0 on out-of-gamut colours, and extended Reinhard is
 * defined on non-negative light (it has a pole at −1); a negative is clamped to 0 here, which
 * is where the display encode would clip it anyway.
 */
export function applyShoulder(linear: number, shoulder: Shoulder): number {
  const exposed = Math.max(linear, 0) * shoulder.exposure
  return (exposed * (1 + exposed / shoulder.white ** 2)) / (1 + exposed)
}

/** What one profile's pipeline needs: its decode curve, matrix and shoulder. */
interface ProfilePipeline {
  readonly decode: (code: number) => number
  readonly matrix: Matrix3
  readonly shoulder: Shoulder | null
}

/**
 * The two transforms, one shader each on the GPU. D-Log M has no shoulder: the fitted
 * Reinhard family landed on the identity for it (design 5.1, section 4.1).
 */
const PROFILE_PIPELINES: Record<Exclude<ColorProfileId, 'none'>, ProfilePipeline> = {
  dlog: { decode: decodeDLog, matrix: D_GAMUT_TO_REC709, shoulder: DLOG_SHOULDER },
  'dlog-m': { decode: decodeDLogM, matrix: DLOG_M_TO_REC709, shoulder: null },
}

/**
 * The pure input transform of design 5.1: a source code RGB (the 10-bit value divided by
 * 1023, per channel) to display-referred RGB (Rec.709 primaries, sRGB transfer).
 *
 * `none` passes the colour through untouched: a clip with no profile is already
 * display-referred. The GPU stage (5.1c) reproduces this function from the same constants;
 * this one is also the float64 reference the precise path's tests use.
 */
export function transform(code: Rgb, profile: ColorProfileId): Rgb {
  if (profile === 'none') {
    return code
  }
  const pipeline = PROFILE_PIPELINES[profile]
  const linear = [
    pipeline.decode(code[0]),
    pipeline.decode(code[1]),
    pipeline.decode(code[2]),
  ] as const
  const mapped = applyMatrix(pipeline.matrix, linear)
  const shoulder = pipeline.shoulder
  const toned = shoulder
    ? ([
        applyShoulder(mapped[0], shoulder),
        applyShoulder(mapped[1], shoulder),
        applyShoulder(mapped[2], shoulder),
      ] as const)
    : mapped
  return [srgbEncode(toned[0]), srgbEncode(toned[1]), srgbEncode(toned[2])]
}
