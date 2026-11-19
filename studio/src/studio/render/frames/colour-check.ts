// The colour gate of the source frames (design 3.6 section 2.18 (a), finding R8): a source that is not BT.709 is
// refused with a message naming its tags, instead of being drawn with colours that are wrong. BT.2020, PQ and HLG
// sources need an input transform that does not exist yet; until it does, a wrong picture is worse than an error.
//
// The decoder's report is read in either vocabulary: WebCodecs' (`pq`, `hlg`, `bt2020-ncl`) and FFmpeg's
// (`smpte2084`, `arib-std-b67`, `bt2020nc`), both seen in the code base. A field that is absent, null or `unknown` is
// untagged and is read as BT.709, exactly as `resolveSourceColourTags` does for the decoder (`precise/contract.ts`).
// The SD matrices (BT.601, tagged `smpte170m` or `bt470bg`) pass: the decoder converts them with their own matrix, which
// is right, and they are not wide gamut or high dynamic range.

/** What a decoder reported about a source's colour: any field may be missing (an untagged file). */
export interface SourceColourReport {
  readonly primaries?: string | null
  readonly transfer?: string | null
  readonly matrix?: string | null
}

/** The values of each field the picture is drawn right for: BT.709, and BT.601 which the decoder converts itself. */
const ACCEPTED = {
  primaries: new Set(['bt709', 'bt470bg', 'smpte170m']),
  transfer: new Set(['bt709', 'smpte170m']),
  matrix: new Set(['bt709', 'bt470bg', 'smpte170m']),
} as const

type Field = keyof typeof ACCEPTED

function isUntagged(value: string | null | undefined): boolean {
  return value === undefined || value === null || value === '' || value === 'unknown' || value === 'unspecified'
}

/** The tags that are not BT.709 (or BT.601), as `field value` pairs; empty when the source is drawn right. */
function offendingTags(report: SourceColourReport): string[] {
  const offending: string[] = []
  for (const field of ['primaries', 'transfer', 'matrix'] as const satisfies readonly Field[]) {
    const value = report[field]
    if (isUntagged(value)) continue
    if (!ACCEPTED[field].has(value as string)) offending.push(`${field} ${value}`)
  }
  return offending
}

/**
 * Why a source cannot be drawn yet, as a sentence for the pilot, or `null` when its colour is BT.709 (or untagged,
 * which is read as BT.709). The sentence names every tag that is not BT.709.
 */
export function sourceColourProblem(report: SourceColourReport | undefined): string | null {
  if (report === undefined) return null
  const offending = offendingTags(report)
  if (offending.length === 0) return null
  return (
    `its source is not BT.709 (${offending.join(', ')}). HDR and BT.2020 sources are not supported yet: ` +
    'the colours would be wrong. Convert the clip to BT.709 first, or remove it.'
  )
}
