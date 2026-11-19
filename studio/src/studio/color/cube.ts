/**
 * Parser for the Iridas/Adobe `.cube` LUT format, in float and up to 65 points per side, for the
 * precise float look path (design 5.1 §4.4, §6).
 *
 * FreeCut's 8-bit parser (`src/infrastructure/gpu-effects/lut/cube-lut.ts`) stays untouched: it
 * feeds the effect path the golden frames pin. This file reads the same format with the things a
 * float look needs:
 *
 * - **Float entries**, not bytes: values are kept as float32 (what an `rgba16float` texture
 *   stores), with no quantisation on the way in.
 * - **Up to 65 points per side** (`rgba16float` 3D textures; the design's table sizes are 33 and
 *   65). A 66³ file is rejected.
 * - **`DOMAIN_MIN` / `DOMAIN_MAX` are the input domain**, not a rescaling of the table (design 5.1
 *   §4.4): the sampler maps the input through them, so `DOMAIN_MIN 0 0 0` /
 *   `DOMAIN_MAX 2 2 2` reads the last point at input 2.0. The table keeps the values the file
 *   gives.
 * - **`LUT_1D_SIZE` is a shaper**: a 1D table applied before the 3D one when a file has both
 *   (Resolve writes such files; its data rows are the 1D entries first, then the 3D grid). A file
 *   with only a 1D table is read as a shaper with no grid.
 * - **Both entry orders found in the wild**: the format says the rows run red fastest; some
 *   writers emit a table that runs blue fastest instead. The caller says which through
 *   `entryOrder`; the parser never guesses.
 * - **Comment lines (`#`), `TITLE`, CRLF/LF, and unknown keywords** are accepted; unknown
 *   keywords are ignored, as FreeCut's parser does. Resolve's `LUT_1D_INPUT_RANGE` /
 *   `LUT_3D_INPUT_RANGE` keywords are ignored too, so a combined file whose ranges are not 0…1
 *   reads with the default domain.
 */

/** The smallest table the format allows: one cell per axis. */
export const CUBE_MIN_SIZE = 2

/** The largest table a look may have: 65 points per side (design 5.1 §4.4). */
export const CUBE_MAX_SIZE = 65

/** Resolve's limit for a 1D shaper: a curve longer than this is a file error, not a look. */
export const CUBE_MAX_SHAPER_SIZE = 65536

/**
 * The order of the data rows through the 3D grid: the format's red-fastest order (entry
 * `r + g·size + b·size²`), or the blue-fastest variant some writers emit (entry
 * `b + g·size + r·size²`). The parser stores the grid red-fastest either way.
 */
export type CubeEntryOrder = 'red-fastest' | 'blue-fastest'

/** A three-component corner of the table's input domain. */
export type CubeDomain = readonly [number, number, number]

interface CubeTable {
  /** Points per side for a 3D grid, entries for a 1D shaper. */
  readonly size: number
  /** `size³ × 3` floats for a 3D grid, `size × 3` for a 1D shaper: r, g, b per entry. */
  readonly data: Float32Array
}

/** The 3D grid of a `.cube` file. */
export interface CubeLut3D extends CubeTable {
  /** The input value that reads the grid's first point, per channel. */
  readonly domainMin: CubeDomain
  /** The input value that reads the grid's last point, per channel. */
  readonly domainMax: CubeDomain
}

/** The 1D shaper of a `.cube` file, applied before its 3D grid. */
export interface CubeLut1D extends CubeTable {
  /** The input value that reads the shaper's first entry, per channel. */
  readonly domainMin: CubeDomain
  /** The input value that reads the shaper's last entry, per channel. */
  readonly domainMax: CubeDomain
}

/** One `.cube` file: its 3D grid, its 1D shaper, or both. */
export interface ParsedCube {
  /** The file's `TITLE`, or null when it has none. */
  readonly title: string | null
  /** The 3D grid, or null for a file that holds only a 1D shaper. */
  readonly lut3d: CubeLut3D | null
  /** The 1D shaper to apply before `lut3d`, or null when the file has none. */
  readonly shaper: CubeLut1D | null
}

export interface ParseCubeOptions {
  /** The order of the data rows; the format's red-fastest order by default. */
  readonly entryOrder?: CubeEntryOrder
}

interface CubeParseState {
  title: string | null
  shaper: CubeTable | null
  table: CubeTable | null
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** Entries written so far, across the shaper and the grid. */
  written: number
  dataStarted: boolean
  blueFastest: boolean
}

const CHAR_TAB = 9
const CHAR_CARRIAGE_RETURN = 13
const CHAR_SPACE = 32
const CHAR_HASH = 35
const CHAR_QUOTE = 34
const CHAR_BOM = 0xfeff
const CHAR_PLUS = 43
const CHAR_MINUS = 45
const CHAR_DOT = 46
const CHAR_DIGIT_ZERO = 48
const CHAR_DIGIT_NINE = 57
const CHAR_UPPER_A = 65
const CHAR_UPPER_Z = 90
const CHAR_LOWER_A = 97
const CHAR_LOWER_Z = 122
const CHAR_UNDERSCORE = 95

function isSpaceCode(code: number): boolean {
  // A UTF-8 BOM survives a text read on some platforms; JavaScript's trim() skips it too.
  return (
    code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_CARRIAGE_RETURN || code === CHAR_BOM
  )
}

function isDigitCode(code: number): boolean {
  return code >= CHAR_DIGIT_ZERO && code <= CHAR_DIGIT_NINE
}

function isAsciiLetter(code: number): boolean {
  return (
    (code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z) || (code >= CHAR_LOWER_A && code <= CHAR_LOWER_Z)
  )
}

/** Data lines start with a digit, a sign or a dot, as in FreeCut's parser. */
function isDataStart(code: number): boolean {
  return isDigitCode(code) || code === CHAR_MINUS || code === CHAR_PLUS || code === CHAR_DOT
}

/** A sign code, or false for a character outside the line (`NaN`). */
function isSignCode(code: number): boolean {
  return code === CHAR_MINUS || code === CHAR_PLUS
}

/** A dot, the start of a fraction, or false outside the line. */
function isDotCode(code: number): boolean {
  return code === CHAR_DOT
}

/** An exponent marker (`e`/`E`), or false outside the line. */
function isExponentCode(code: number): boolean {
  return code === 101 || code === 69
}

/** The first index at or after `start` that is not a space character (or `end`). */
function skipSpaces(text: string, start: number, end: number): number {
  let index = start
  while (index < end && isSpaceCode(text.charCodeAt(index))) index++
  return index
}

/** The first index at or after `start` that is not a digit (or `end`). */
function scanDigits(text: string, start: number, end: number): number {
  let index = start
  while (index < end && isDigitCode(text.charCodeAt(index))) index++
  return index
}

/**
 * The first index after the decimal number starting at `start`: an optional sign, digits, an
 * optional fraction and an optional exponent. `start` itself when no number starts there. A read
 * past `end` sees a newline, the text's end or a comment marker — never a digit, a sign or a dot —
 * so the scan stops there.
 */
function scanNumber(text: string, start: number, end: number): number {
  let index = start
  if (isSignCode(text.charCodeAt(index))) index++
  index = scanDigits(text, index, end)
  if (isDotCode(text.charCodeAt(index))) index = scanDigits(text, index + 1, end)
  if (isExponentCode(text.charCodeAt(index))) {
    let after = index + 1
    if (isSignCode(text.charCodeAt(after))) after++
    index = scanDigits(text, after, end)
  }
  return index
}

interface NumberToken {
  readonly value: number
  readonly next: number
}

/**
 * Reads the float starting at `start` and returns its value and the first index after it. Leading
 * spaces/tabs are skipped; a token that is not a finite decimal number is a file error.
 */
function readNumber(text: string, start: number, end: number, lineNumber: number): NumberToken {
  const from = skipSpaces(text, start, end)
  const next = scanNumber(text, from, end)
  if (next === from) {
    throw new Error(
      `Invalid .cube file: expected a number on line ${lineNumber}, got "${text.slice(from, end).trim()}"`,
    )
  }
  const token = text.slice(from, next)
  const value = Number(token)
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid .cube file: "${token}" on line ${lineNumber} is not a finite number`)
  }
  if (next < end && !isSpaceCode(text.charCodeAt(next))) {
    throw new Error(
      `Invalid .cube file: unexpected "${text.slice(next, end).trim()}" after a number on line ${lineNumber}`,
    )
  }
  return { value, next }
}

/** Reads a whole-number token (a table size): digits only, one token to the end of the line. */
function readSize(text: string, start: number, end: number, lineNumber: number): NumberToken {
  const from = skipSpaces(text, start, end)
  const next = scanDigits(text, from, end)
  if (next === from) {
    throw new Error(
      `Invalid .cube file: expected an integer on line ${lineNumber}, got "${text.slice(from, end).trim()}"`,
    )
  }
  return { value: Number(text.slice(from, next)), next }
}

/** Fails when anything but spaces is left on the line. */
function expectLineEnd(text: string, next: number, end: number, lineNumber: number): void {
  const index = skipSpaces(text, next, end)
  if (index < end) {
    throw new Error(
      `Invalid .cube file: unexpected "${text.slice(index, end).trim()}" on line ${lineNumber}`,
    )
  }
}

/** Where a trailing `#` comment begins, or `end` when the line has none. */
function commentStart(text: string, start: number, end: number): number {
  for (let index = start; index < end; index++) {
    if (text.charCodeAt(index) === CHAR_HASH) return index
  }
  return end
}

function describeSizes(state: CubeParseState): string {
  const parts: string[] = []
  if (state.shaper !== null) parts.push(`LUT_1D_SIZE ${state.shaper.size}`)
  if (state.table !== null) parts.push(`LUT_3D_SIZE ${state.table.size}`)
  return parts.join(' and ')
}

function applyTitle(state: CubeParseState, text: string, keywordEnd: number, end: number): void {
  const index = skipSpaces(text, keywordEnd, end)
  if (index < end && text.charCodeAt(index) === CHAR_QUOTE) {
    const close = text.lastIndexOf('"', end - 1)
    state.title = close > index ? text.slice(index + 1, close) : text.slice(index + 1, end).trim()
    return
  }
  state.title = text.slice(index, end).trim()
}

function applySize(
  state: CubeParseState,
  text: string,
  keywordEnd: number,
  end: number,
  lineNumber: number,
  is1d: boolean,
): void {
  const keyword = is1d ? 'LUT_1D_SIZE' : 'LUT_3D_SIZE'
  const contentEnd = commentStart(text, keywordEnd, end)
  const parsed = readSize(text, keywordEnd, contentEnd, lineNumber)
  expectLineEnd(text, parsed.next, contentEnd, lineNumber)
  if (state.dataStarted) {
    throw new Error(`Invalid .cube file: ${keyword} appears after the data, on line ${lineNumber}`)
  }
  const limit = is1d ? CUBE_MAX_SHAPER_SIZE : CUBE_MAX_SIZE
  if (parsed.value < CUBE_MIN_SIZE || parsed.value > limit) {
    throw new Error(
      `Invalid .cube file: ${keyword} must be an integer between ${CUBE_MIN_SIZE} and ${limit}, got ${parsed.value}`,
    )
  }
  if (is1d) {
    if (state.shaper !== null) {
      throw new Error(`Invalid .cube file: ${keyword} appears twice`)
    }
    state.shaper = { size: parsed.value, data: new Float32Array(parsed.value * 3) }
    return
  }
  if (state.table !== null) {
    throw new Error(`Invalid .cube file: ${keyword} appears twice`)
  }
  const entries = parsed.value * parsed.value * parsed.value
  state.table = { size: parsed.value, data: new Float32Array(entries * 3) }
}

function applyDomain(
  text: string,
  keywordEnd: number,
  end: number,
  lineNumber: number,
  target: [number, number, number],
): void {
  const contentEnd = commentStart(text, keywordEnd, end)
  let index = keywordEnd
  for (let channel = 0; channel < 3; channel++) {
    const parsed = readNumber(text, index, contentEnd, lineNumber)
    target[channel] = parsed.value
    index = parsed.next
  }
  expectLineEnd(text, index, contentEnd, lineNumber)
}

/** The first index after the keyword starting at `start`. */
function scanKeyword(text: string, start: number, end: number): number {
  let index = start
  while (index < end) {
    const code = text.charCodeAt(index)
    if (isAsciiLetter(code) || isDigitCode(code) || code === CHAR_UNDERSCORE) index++
    else break
  }
  return index
}

function handleKeyword(
  state: CubeParseState,
  text: string,
  start: number,
  end: number,
  lineNumber: number,
): void {
  const keywordEnd = scanKeyword(text, start, end)
  switch (text.slice(start, keywordEnd)) {
    case 'TITLE':
      applyTitle(state, text, keywordEnd, end)
      return
    case 'LUT_1D_SIZE':
      applySize(state, text, keywordEnd, end, lineNumber, true)
      return
    case 'LUT_3D_SIZE':
      applySize(state, text, keywordEnd, end, lineNumber, false)
      return
    case 'DOMAIN_MIN':
      applyDomain(text, keywordEnd, end, lineNumber, state.domainMin)
      return
    case 'DOMAIN_MAX':
      applyDomain(text, keywordEnd, end, lineNumber, state.domainMax)
      return
    default:
      // Unknown keywords (LUT_1D_INPUT_RANGE, LUT_3D_INPUT_RANGE, ...) are ignored, as FreeCut's
      // parser does.
      return
  }
}

/** The red-fastest grid index of an entry written blue fastest. */
function blueFastestToRedFastest(index: number, size: number): number {
  const blue = index % size
  const green = Math.floor(index / size) % size
  const red = Math.floor(index / (size * size))
  return (blue * size + green) * size + red
}

function writeEntry(
  state: CubeParseState,
  rgb: readonly [number, number, number],
  lineNumber: number,
): void {
  const shaper = state.shaper
  if (shaper !== null && state.written < shaper.size) {
    const offset = state.written * 3
    shaper.data[offset] = rgb[0]
    shaper.data[offset + 1] = rgb[1]
    shaper.data[offset + 2] = rgb[2]
    state.written++
    return
  }
  const table = state.table
  const shaperEntries = shaper === null ? 0 : shaper.size
  if (table === null) {
    throw new Error(
      `Invalid .cube file: expected ${shaperEntries} data entries for ${describeSizes(state)}, got more`,
    )
  }
  const index = state.written - shaperEntries
  const entries = table.size * table.size * table.size
  if (index >= entries) {
    throw new Error(
      `Invalid .cube file: expected ${shaperEntries + entries} data entries for ${describeSizes(state)}, got more (line ${lineNumber})`,
    )
  }
  const target = state.blueFastest ? blueFastestToRedFastest(index, table.size) : index
  const offset = target * 3
  table.data[offset] = rgb[0]
  table.data[offset + 1] = rgb[1]
  table.data[offset + 2] = rgb[2]
  state.written++
}

function parseDataLine(
  state: CubeParseState,
  text: string,
  start: number,
  end: number,
  lineNumber: number,
): void {
  if (state.shaper === null && state.table === null) {
    throw new Error(
      `Invalid .cube file: data before LUT_1D_SIZE or LUT_3D_SIZE, on line ${lineNumber}`,
    )
  }
  state.dataStarted = true
  const contentEnd = commentStart(text, start, end)
  const rgb: [number, number, number] = [0, 0, 0]
  let index = start
  let values = 0
  while (true) {
    const next = skipSpaces(text, index, contentEnd)
    if (next >= contentEnd) break
    const parsed = readNumber(text, next, contentEnd, lineNumber)
    rgb[values % 3] = parsed.value
    values++
    index = parsed.next
    if (values % 3 === 0) writeEntry(state, rgb, lineNumber)
  }
  if (values % 3 !== 0) {
    throw new Error(
      `Invalid .cube file: line ${lineNumber} holds ${values} values, not a multiple of three`,
    )
  }
}

/** The keywords, sizes and data lines of the file, in order. */
function parseLines(state: CubeParseState, text: string): void {
  const length = text.length
  let lineNumber = 0
  let lineStart = 0
  while (lineStart <= length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? length : newline
    lineNumber++
    const start = skipSpaces(text, lineStart, lineEnd)
    if (start < lineEnd && text.charCodeAt(start) !== CHAR_HASH) {
      const first = text.charCodeAt(start)
      if (isAsciiLetter(first)) {
        handleKeyword(state, text, start, lineEnd, lineNumber)
      } else if (isDataStart(first)) {
        parseDataLine(state, text, start, lineEnd, lineNumber)
      }
    }
    if (newline === -1) return
    lineStart = newline + 1
  }
}

/** The parsed file, after checking that the data fills the declared tables. */
function finishCube(state: CubeParseState): ParsedCube {
  if (state.shaper === null && state.table === null) {
    throw new Error('Invalid .cube file: missing LUT_3D_SIZE or LUT_1D_SIZE')
  }
  const shaperEntries = state.shaper === null ? 0 : state.shaper.size
  const gridEntries =
    state.table === null ? 0 : state.table.size * state.table.size * state.table.size
  if (state.written !== shaperEntries + gridEntries) {
    throw new Error(
      `Invalid .cube file: expected ${shaperEntries + gridEntries} data entries for ${describeSizes(state)}, got ${state.written}`,
    )
  }

  const domainMin: CubeDomain = [state.domainMin[0], state.domainMin[1], state.domainMin[2]]
  const domainMax: CubeDomain = [state.domainMax[0], state.domainMax[1], state.domainMax[2]]
  const shaper: CubeLut1D | null =
    state.shaper === null
      ? null
      : { size: state.shaper.size, data: state.shaper.data, domainMin, domainMax }
  const lut3d: CubeLut3D | null =
    state.table === null
      ? null
      : { size: state.table.size, data: state.table.data, domainMin, domainMax }

  return { title: state.title, lut3d, shaper }
}

/**
 * Parses a `.cube` file. The returned tables are float32 and red-fastest; the shaper's rows (when
 * the file has both sizes) come first in the file, and the parser splits them from the grid.
 *
 * @throws Error when the file is not a valid `.cube` file: a missing or out-of-range size, a
 * second size keyword, data before a size, a data line that is not a multiple of three values, or
 * a data count that does not fill the declared tables.
 */
export function parseCube(text: string, options: ParseCubeOptions = {}): ParsedCube {
  const state: CubeParseState = {
    title: null,
    shaper: null,
    table: null,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    written: 0,
    dataStarted: false,
    blueFastest: options.entryOrder === 'blue-fastest',
  }
  parseLines(state, text)
  return finishCube(state)
}
