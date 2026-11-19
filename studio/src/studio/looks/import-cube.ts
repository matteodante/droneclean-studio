/**
 * Reading a user's `.cube` file into the looks library (design 5.1 §4.4, §6 slice 5.2b).
 *
 * `parseCube` of `src/studio/color/cube.ts` does the format work; this module is the import's
 * product rules on top of it:
 *
 * - **65 points per side at most**, as the float look texture is `rgba16float` (design 5.1
 *   §4.4). A larger table is refused with its size, before the parser allocates it.
 * - **`LUT_1D_INPUT_RANGE` / `LUT_3D_INPUT_RANGE` other than 0…1 are refused.** 5.1b's parser
 *   ignores Resolve's range keywords, so a file that declares `0 2` would be read as if it said
 *   `0 1` and produce wrong colours in silence. Refusing is the honest answer: the look cannot be
 *   applied as it was authored. `DOMAIN_MIN` / `DOMAIN_MAX` are a different thing — they are the
 *   table's input domain and the parser applies them — so they are accepted.
 * - **A file with only a 1D shaper is not a look.** It has no grid to look up.
 *
 * The result is the parsed tables plus what the library index records (size, shaper, title); the
 * failures are codes with their values, which the library dialog turns into plain words in the
 * user's language.
 */

import { CUBE_MAX_SIZE, parseCube, type CubeEntryOrder, type ParsedCube } from '@/studio/color/cube'

/** Why a `.cube` file could not become a look. */
export type LookImportFailure =
  | {
      /** The file's input range is not 0…1, so its rows cannot be read as the pass reads them. */
      readonly code: 'range'
      readonly keyword: string
      readonly min: string
      readonly max: string
    }
  | {
      /** The grid is larger than a look may be (65 points per side). */
      readonly code: 'too-large'
      readonly size: number
    }
  | {
      /** The file holds a 1D shaper only: there is no grid to look up. */
      readonly code: 'no-grid'
    }
  | {
      /** The file is not a valid `.cube` file; `detail` is the parser's own message. */
      readonly code: 'invalid'
      readonly detail: string
    }

/** A `.cube` file that can become a look. */
export interface ImportedLook {
  /** The parsed tables, as the float look stage uploads them. */
  readonly parsed: ParsedCube
  /** Points per side of the 3D grid. */
  readonly size: number
  /** Whether the file also holds a `LUT_1D_SIZE` shaper. */
  readonly hasShaper: boolean
  /** What the file calls itself, or null when it has no `TITLE`. */
  readonly title: string | null
}

/** `parseLookText`'s result: the look, or why there is none. */
export type LookImportResult =
  | { readonly ok: true; readonly look: ImportedLook }
  | { readonly ok: false; readonly failure: LookImportFailure }

const INPUT_RANGE_LINE = /^(LUT_1D_INPUT_RANGE|LUT_3D_INPUT_RANGE)\s+(.*)$/
const LUT_3D_SIZE_LINE = /^LUT_3D_SIZE\s+(.*)$/
const FIRST_TOKEN = /^\S+/

/** The input-range line's two values, or null when they are not two numbers. */
function readRangeValues(rest: string): [string, string] | null {
  const values = rest
    .trim()
    .split(/\s+/)
    .filter((value) => value.length > 0)
  if (values.length < 2) return null
  return [values[0] as string, values[1] as string]
}

/** The integer after `LUT_3D_SIZE`, or null when the line does not hold one. */
function readDeclaredSize(rest: string): number | null {
  const token = FIRST_TOKEN.exec(rest.trim())?.[0]
  if (token === undefined || !/^\d+$/.test(token)) return null
  return Number(token)
}

/** The failure a `LUT_*_INPUT_RANGE` line declares, or null for a 0…1 range (or no such line). */
function checkRangeLine(trimmed: string): LookImportFailure | null {
  const range = INPUT_RANGE_LINE.exec(trimmed)
  if (range === null) return null
  const keyword = range[1] as string
  const values = readRangeValues(range[2] as string)
  if (values === null) {
    return { code: 'invalid', detail: `${keyword} does not hold two numbers` }
  }
  const [min, max] = values
  return min === '0' && max === '1' ? null : { code: 'range', keyword, min, max }
}

/** The failure a `LUT_3D_SIZE` line declares, or null when the grid fits (or there is no line). */
function checkSizeLine(trimmed: string): LookImportFailure | null {
  const size = LUT_3D_SIZE_LINE.exec(trimmed)
  if (size === null) return null
  const declared = readDeclaredSize(size[1] as string)
  return declared !== null && declared > CUBE_MAX_SIZE
    ? { code: 'too-large', size: declared }
    : null
}

/**
 * The failure a file's header lines already decide, or null when the header says nothing a look
 * cannot have. One pass, before the parser allocates the table: a 66³ file is refused by its
 * size rather than by the parser's generic message.
 */
function checkHeader(text: string): LookImportFailure | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const failure = checkRangeLine(trimmed) ?? checkSizeLine(trimmed)
    if (failure !== null) return failure
  }
  return null
}

/**
 * Reads one `.cube` file's text as a look: its header is checked for what a look cannot have, the
 * tables are parsed in the given row order, and the result carries what the library index needs.
 *
 * @param entryOrder the order of the file's data rows; red-fastest unless the file is one of the
 *   blue-fastest writers, in which case the user retries with `'blue-fastest'`.
 */
export function parseLookText(
  text: string,
  entryOrder: CubeEntryOrder = 'red-fastest',
): LookImportResult {
  const headerFailure = checkHeader(text)
  if (headerFailure !== null) return { ok: false, failure: headerFailure }

  let parsed: ParsedCube
  try {
    parsed = parseCube(text, { entryOrder })
  } catch (error) {
    return { ok: false, failure: { code: 'invalid', detail: (error as Error).message } }
  }

  const table = parsed.lut3d
  if (table === null) return { ok: false, failure: { code: 'no-grid' } }

  return {
    ok: true,
    look: {
      parsed,
      size: table.size,
      hasShaper: parsed.shaper !== null,
      title: parsed.title,
    },
  }
}

/**
 * The name a look starts with: the file's `TITLE` when it has one, else its file name without the
 * `.cube` extension.
 */
export function lookDisplayName(fileName: string, title: string | null): string {
  const trimmedTitle = title?.trim() ?? ''
  if (trimmedTitle.length > 0) return trimmedTitle
  const trimmedName = fileName.trim()
  const withoutExtension = trimmedName.replace(/\.cube$/i, '')
  return withoutExtension.length > 0 ? withoutExtension : fileName
}
