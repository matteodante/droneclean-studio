/**
 * `studio.titles`: the text clips of the active editing context (design §4.2).
 *
 * `add` builds the item with `createDefaultTextItem` — the defaults the Text tab
 * of the sidebar starts from — applies the requested text and style, and hands
 * it to `addItem`; `update` writes the text and the `TextStyleFields` through
 * `updateItem`. Both run in one transaction, so a title is one undo step.
 *
 * Arguments are validated against the editor's own ranges before a store is
 * written: the frame rules of `context.ts`, the font catalogue's families, the
 * text inspector's number ranges and enums, and hex colours. The background
 * colour, the shadow and the stroke also take `null` to clear them, the way the
 * panel's Clear button does. Reads return plain copies built field by field: no
 * store object leaves the SDK.
 */

import type { TextStyleFields } from '@/types/text'
import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { TransformProperties } from '@/types/transform'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { addItem, updateItem } from '@/features/timeline/stores/actions/item-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { createDefaultTextItem } from '@/features/timeline/utils/generated-layer-items'
import { placeItemsWithoutTimelineOverlap } from '@/features/timeline/stores/actions/item-placement'
import { isTrackCompatibleWithItemType } from '@/features/timeline/utils/track-item-compatibility'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { FONT_CATALOG } from '@/shared/typography/font-catalog'
import { getTimelineContext, requireFrame, requireTrack } from '../context'
import { invalidArgumentError, notFoundError, studioError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipId,
  ClipInfo,
  ClipTransform,
  TitleAddInput,
  TitlePatch,
  TitleShadow,
  TitleStroke,
  TitlesApi,
} from '../types'

/** Inclusive range a numeric style field accepts. */
interface NumberRange {
  /** Lowest accepted value. */
  readonly min: number
  /** Highest accepted value. */
  readonly max: number
}

/**
 * The ranges the text inspector's number inputs allow
 * (`text-typography-controls.tsx`, `text-box-controls.tsx`,
 * `text-effects-controls.tsx`, `text-color-controls.tsx`).
 */
const FONT_SIZE_RANGE: NumberRange = { min: 8, max: 500 }
const LETTER_SPACING_RANGE: NumberRange = { min: -20, max: 100 }
const LINE_HEIGHT_RANGE: NumberRange = { min: 0.5, max: 3 }
const TEXT_PADDING_RANGE: NumberRange = { min: 0, max: 160 }
const BACKGROUND_RADIUS_RANGE: NumberRange = { min: 0, max: 200 }
const SHADOW_OFFSET_RANGE: NumberRange = { min: -100, max: 100 }
const SHADOW_BLUR_RANGE: NumberRange = { min: 0, max: 160 }
const STROKE_WIDTH_RANGE: NumberRange = { min: 0, max: 24 }

/** Hex colours the editor's picker writes: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const FONT_WEIGHTS = ['normal', 'medium', 'semibold', 'bold'] as const
const FONT_STYLES = ['normal', 'italic'] as const
const TEXT_ALIGNS = ['left', 'center', 'right'] as const
const VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const

/** Font family names the FontPicker offers, in catalogue order. */
const FONT_FAMILIES: readonly string[] = FONT_CATALOG.map((font) => font.value)

/** Every field `TitleStyle` declares, in declaration order. */
const STYLE_FIELDS = [
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'underline',
  'color',
  'letterSpacing',
  'backgroundColor',
  'backgroundRadius',
  'textAlign',
  'verticalAlign',
  'lineHeight',
  'textPadding',
  'textShadow',
  'stroke',
] as const

/** Every field `TitleShadow` declares. */
const SHADOW_FIELDS = ['offsetX', 'offsetY', 'blur', 'color'] as const

/** Every field `TitleStroke` declares. */
const STROKE_FIELDS = ['width', 'color'] as const

/** The value as a plain object, for arguments a script may pass from JSON. */
function requireObject(value: unknown, argument: string, method: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  throw invalidArgumentError({ method, argument, expectation: 'an object', value })
}

/** The value as a string. */
function requireString(value: unknown, argument: string, method: string): string {
  if (typeof value === 'string') return value
  throw invalidArgumentError({ method, argument, expectation: 'a string', value })
}

/** The value as a boolean. */
function requireBoolean(value: unknown, argument: string, method: string): boolean {
  if (typeof value === 'boolean') return value
  throw invalidArgumentError({ method, argument, expectation: 'true or false', value })
}

/** The value as a finite number inside `range`. */
function requireNumberInRange(
  value: unknown,
  argument: string,
  range: NumberRange,
  method: string,
): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max
  ) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: `a number between ${range.min} and ${range.max}`,
    value,
  })
}

/** The value as one of `valid`, listed in the error so the caller can fix it. */
function requireChoice<T extends string>(
  value: unknown,
  valid: readonly T[],
  argument: string,
  method: string,
  expectation: string,
): T {
  if (typeof value === 'string' && (valid as readonly string[]).includes(value)) {
    return value as T
  }
  throw invalidArgumentError({ method, argument, expectation, valid, value })
}

/** One `rgb()` channel: 0…255, or a percentage of 255. */
function rgbChannel(text: string): number | null {
  const match = /^(\d*\.?\d+)(%?)$/.exec(text)
  if (!match) return null
  const raw = Number(match[1])
  const value = match[2] === '%' ? (raw * 255) / 100 : raw
  return value >= 0 && value <= 255 ? Math.round(value) : null
}

/** The alpha of an `rgba()` colour: 0…1, or a percentage. */
function rgbAlpha(text: string): number | null {
  const match = /^(\d*\.?\d+)(%?)$/.exec(text)
  if (!match) return null
  const raw = Number(match[1])
  const value = match[2] === '%' ? raw / 100 : raw
  return value >= 0 && value <= 1 ? value : null
}

/**
 * `rgb(r, g, b)` or `rgba(r, g, b, a)` (commas or spaces, `/` before the alpha) as the hex the editor stores: `#rrggbb`,
 * or `#rrggbbaa` when the alpha is below 1. Null when the text is not one.
 */
function rgbToHex(value: string): string | null {
  const match = /^rgba?\(\s*([^)]*?)\s*\)$/i.exec(value.trim())
  if (!match?.[1]) return null
  const parts = match[1].split(/\s*[,/]\s*|\s+/).filter((part) => part !== '')
  if (parts.length !== 3 && parts.length !== 4) return null
  const channels = parts.slice(0, 3).map(rgbChannel)
  const alpha = parts[3] === undefined ? 1 : rgbAlpha(parts[3])
  if (alpha === null || channels.some((channel) => channel === null)) return null
  const hex = (channel: number | null): string => (channel ?? 0).toString(16).padStart(2, '0')
  const base = `#${channels.map(hex).join('')}`
  return alpha < 1 ? `${base}${hex(Math.round(alpha * 255))}` : base
}

/**
 * The value as a hex colour string. `rgb()` and `rgba()` are accepted too and stored as `#rrggbb` / `#rrggbbaa`, the form
 * the editor's picker and renderer read, so an alpha is drawn.
 */
function requireColor(value: unknown, argument: string, method: string): string {
  if (typeof value === 'string') {
    if (HEX_COLOR.test(value)) return value
    const converted = rgbToHex(value)
    if (converted !== null) return converted
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'a colour such as "#ffffff", "#000000aa" or "rgba(0, 0, 0, 0.6)"',
    value,
  })
}

/** Reject fields the declared type does not have, so a typo cannot pass silently. */
function requireKnownFields(
  source: Record<string, unknown>,
  known: readonly string[],
  argument: string,
  method: string,
): void {
  for (const field of Object.keys(source)) {
    if (known.includes(field)) continue
    throw invalidArgumentError({
      method,
      argument,
      expectation: 'an object with only the fields it declares',
      value: field,
      valid: known,
    })
  }
}

/** The value as a positive integer frame count. */
function requireDuration(value: unknown, method: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  throw invalidArgumentError({
    method,
    argument: 'durationInFrames',
    expectation: 'a positive integer frame count',
    value,
  })
}

/** The validated shadow, as its own plain object. */
function shadowField(value: unknown, method: string): TitleShadow {
  const source = requireObject(value, 'style.textShadow', method)
  requireKnownFields(source, SHADOW_FIELDS, 'style.textShadow', method)
  return {
    offsetX: requireNumberInRange(
      source.offsetX,
      'style.textShadow.offsetX',
      SHADOW_OFFSET_RANGE,
      method,
    ),
    offsetY: requireNumberInRange(
      source.offsetY,
      'style.textShadow.offsetY',
      SHADOW_OFFSET_RANGE,
      method,
    ),
    blur: requireNumberInRange(source.blur, 'style.textShadow.blur', SHADOW_BLUR_RANGE, method),
    color: requireColor(source.color, 'style.textShadow.color', method),
  }
}

/** The validated stroke, as its own plain object. */
function strokeField(value: unknown, method: string): TitleStroke {
  const source = requireObject(value, 'style.stroke', method)
  requireKnownFields(source, STROKE_FIELDS, 'style.stroke', method)
  return {
    width: requireNumberInRange(source.width, 'style.stroke.width', STROKE_WIDTH_RANGE, method),
    color: requireColor(source.color, 'style.stroke.color', method),
  }
}

/** The inline typography fields of a validated style object. */
function inlineStyleFields(
  source: Record<string, unknown>,
  method: string,
): Partial<TextStyleFields> {
  const fields: Partial<TextStyleFields> = {}
  if (source.fontSize !== undefined) {
    fields.fontSize = requireNumberInRange(
      source.fontSize,
      'style.fontSize',
      FONT_SIZE_RANGE,
      method,
    )
  }
  if (source.fontFamily !== undefined) {
    fields.fontFamily = requireChoice(
      source.fontFamily,
      FONT_FAMILIES,
      'style.fontFamily',
      method,
      'a font family from the font catalogue',
    )
  }
  if (source.fontWeight !== undefined) {
    fields.fontWeight = requireChoice(
      source.fontWeight,
      FONT_WEIGHTS,
      'style.fontWeight',
      method,
      'a font weight',
    )
  }
  if (source.fontStyle !== undefined) {
    fields.fontStyle = requireChoice(
      source.fontStyle,
      FONT_STYLES,
      'style.fontStyle',
      method,
      'a font style',
    )
  }
  if (source.underline !== undefined) {
    fields.underline = requireBoolean(source.underline, 'style.underline', method)
  }
  if (source.color !== undefined) {
    fields.color = requireColor(source.color, 'style.color', method)
  }
  if (source.letterSpacing !== undefined) {
    fields.letterSpacing = requireNumberInRange(
      source.letterSpacing,
      'style.letterSpacing',
      LETTER_SPACING_RANGE,
      method,
    )
  }
  return fields
}

/** The visual fields of a validated style object that can only be set. */
function visualStyleFields(
  source: Record<string, unknown>,
  method: string,
): Partial<TextStyleFields> {
  const fields: Partial<TextStyleFields> = {}
  if (source.backgroundRadius !== undefined) {
    fields.backgroundRadius = requireNumberInRange(
      source.backgroundRadius,
      'style.backgroundRadius',
      BACKGROUND_RADIUS_RANGE,
      method,
    )
  }
  if (source.textAlign !== undefined) {
    fields.textAlign = requireChoice(
      source.textAlign,
      TEXT_ALIGNS,
      'style.textAlign',
      method,
      'a horizontal alignment',
    )
  }
  if (source.verticalAlign !== undefined) {
    fields.verticalAlign = requireChoice(
      source.verticalAlign,
      VERTICAL_ALIGNS,
      'style.verticalAlign',
      method,
      'a vertical alignment',
    )
  }
  if (source.lineHeight !== undefined) {
    fields.lineHeight = requireNumberInRange(
      source.lineHeight,
      'style.lineHeight',
      LINE_HEIGHT_RANGE,
      method,
    )
  }
  if (source.textPadding !== undefined) {
    fields.textPadding = requireNumberInRange(
      source.textPadding,
      'style.textPadding',
      TEXT_PADDING_RANGE,
      method,
    )
  }
  return fields
}

/**
 * The fields the text inspector can clear: `null` removes the field exactly as
 * the panel's Clear button does (it writes `undefined`), an absent field is
 * left alone, and any other value is validated as usual.
 */
function clearableStyleFields(
  source: Record<string, unknown>,
  method: string,
): Partial<TextStyleFields> {
  const fields: Partial<TextStyleFields> = {}
  if (source.backgroundColor === null) {
    fields.backgroundColor = undefined
  } else if (source.backgroundColor !== undefined) {
    fields.backgroundColor = requireColor(source.backgroundColor, 'style.backgroundColor', method)
  }
  if (source.textShadow === null) {
    fields.textShadow = undefined
  } else if (source.textShadow !== undefined) {
    fields.textShadow = shadowField(source.textShadow, method)
  }
  if (source.stroke === null) {
    fields.stroke = undefined
  } else if (source.stroke !== undefined) {
    fields.stroke = strokeField(source.stroke, method)
  }
  return fields
}

/**
 * The style fields to write, validated and copied into a plain object. An
 * absent style writes nothing.
 */
function styleUpdates(style: unknown, method: string): Partial<TextStyleFields> {
  if (style === undefined) return {}
  const source = requireObject(style, 'style', method)
  requireKnownFields(source, STYLE_FIELDS, 'style', method)
  return {
    ...inlineStyleFields(source, method),
    ...visualStyleFields(source, method),
    ...clearableStyleFields(source, method),
  }
}

/** Whether a track takes a title: a visual lane, not an audio track or a layer group. */
function acceptsTitle(track: TimelineTrack, items: readonly TimelineItem[]): boolean {
  return !track.isGroup && isTrackCompatibleWithItemType(track, items, 'text')
}

/** Why a track refused a title, for the error's hint. */
function describeRefusal(track: TimelineTrack): string {
  if (track.isGroup) return `Track ${JSON.stringify(track.id)} is a layer group`
  return `Track ${JSON.stringify(track.id)} is an audio track`
}

/** The track a title can go on: it exists and takes a visual item. */
function requireTitleTrack(id: string, method: string): TimelineTrack {
  const { tracks, items } = useItemsStore.getState()
  const track = requireTrack(id, method, 'trackId')
  if (acceptsTitle(track, items)) return track
  throw invalidArgumentError({
    method,
    argument: 'trackId',
    expectation: 'a video track that can hold a title',
    value: track.id,
    valid: tracks
      .filter((candidate) => acceptsTitle(candidate, items))
      .map((candidate) => candidate.id),
    validSource: 'studio.tracks.list()',
    hint: `${describeRefusal(track)}. Titles are visual layers: add a video track with studio.tracks.add({ kind: 'video' }) and place the title on it.`,
  })
}

/** The text clip with this id, or `NOT_FOUND` naming the text clips there are. */
function requireTextClip(id: string, method: string): TextItem {
  const items = useItemsStore.getState().items
  const item = items.find((candidate) => candidate.id === id)
  if (item?.type === 'text') return item
  const context = getTimelineContext()
  const placement =
    context.kind === 'main'
      ? 'on the main timeline'
      : `in composition ${JSON.stringify(context.name)}`
  throw notFoundError({
    method,
    argument: 'id',
    kind: 'clip',
    id,
    expectation: `an existing text clip id ${placement}`,
    valid: items.filter((candidate) => candidate.type === 'text').map((candidate) => candidate.id),
    hint: 'Only text clips take a title; studio.titles.list() lists them.',
  })
}

/** A clip's transform as plain JSON, with only the fields the item sets. */
function toTransformInfo(transform: TransformProperties): ClipTransform {
  const info: ClipTransform = {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    anchorX: transform.anchorX,
    anchorY: transform.anchorY,
    rotation: transform.rotation,
    flipHorizontal: transform.flipHorizontal,
    flipVertical: transform.flipVertical,
    opacity: transform.opacity,
    cornerRadius: transform.cornerRadius,
  }
  for (const field of Object.keys(info) as (keyof ClipTransform)[]) {
    if (info[field] === undefined) delete info[field]
  }
  return info
}

/** A text clip as plain JSON, built field by field. */
function toTitleInfo(item: TextItem): ClipInfo {
  return {
    id: item.id,
    trackId: item.trackId,
    type: 'text',
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: item.label,
    ...(item.transform !== undefined && { transform: toTransformInfo(item.transform) }),
    text: item.text,
    color: item.color,
  }
}

/** Text clips, top of the track stack first, then in timeline order. */
function listTitles(): ClipInfo[] {
  const { items, tracks } = useItemsStore.getState()
  const stackIndex = new Map(tracks.map((track, index) => [track.id, index]))
  const textItems = items.filter((item): item is TextItem => item.type === 'text')
  textItems.sort(
    (left, right) =>
      (stackIndex.get(left.trackId) ?? tracks.length) -
        (stackIndex.get(right.trackId) ?? tracks.length) ||
      left.from - right.from ||
      left.id.localeCompare(right.id),
  )
  return textItems.map(toTitleInfo)
}

/**
 * A title that would overlap a clip on its track is a CONFLICT, as a clip is (`clips.add`): `addItem` would have put it
 * at the first free frame without a word (20 Nov 2026: an agent's title asked for frame 30 of the video track landed
 * after the last clip, frame 1800).
 */
function requireFreeRange(item: TextItem): void {
  const firstFree = placeItemsWithoutTimelineOverlap([item])[0]?.from ?? item.from
  if (firstFree === item.from) return
  const end = item.from + item.durationInFrames
  const blocker = useItemsStore
    .getState()
    .items.find(
      (other) =>
        other.trackId === item.trackId && other.from < end && other.from + other.durationInFrames > item.from,
    )
  const where = blocker
    ? `clip "${blocker.id}" (frames ${blocker.from}..${blocker.from + blocker.durationInFrames})`
    : 'another clip'
  throw studioError({
    code: 'CONFLICT',
    method: 'titles.add',
    argument: 'from',
    message: `a title of ${item.durationInFrames} frames at frame ${item.from} overlaps ${where} on track "${item.trackId}"; the first free frame where it fits is ${firstFree}`,
    ...(blocker && { entity: { kind: 'clip' as const, id: blocker.id } }),
    hint: "A title over footage goes on a video track of its own above it: studio.tracks.add({ kind: 'video', name: 'Titles', position: 0 }).",
  })
}

/** Create a text clip from the editor's defaults plus the requested text and style. */
function addTitle(input: TitleAddInput): ClipId {
  const source = requireObject(input, 'input', 'titles.add')
  const track = requireTitleTrack(
    requireString(source.trackId, 'trackId', 'titles.add'),
    'titles.add',
  )
  const from = requireFrame(source.from, 'from', 'titles.add')
  const durationInFrames = requireDuration(source.durationInFrames, 'titles.add')
  const text = requireString(source.text, 'text', 'titles.add')
  const style = styleUpdates(source.style, 'titles.add')
  const project = useProjectStore.getState().currentProject
  const item: TextItem = {
    ...createDefaultTextItem({
      trackId: track.id,
      from,
      durationInFrames,
      canvasWidth: project?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
      canvasHeight: project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
      text,
    }),
    ...style,
  }
  requireFreeRange(item)

  return transaction('TITLES_ADD', () => {
    addItem(item)
    return item.id
  }).value
}

/** Write a text clip's text and style through `UPDATE_ITEM`. */
function updateTitle(id: ClipId, patch: TitlePatch): void {
  const clip = requireTextClip(requireString(id, 'id', 'titles.update'), 'titles.update')
  const source = requireObject(patch, 'patch', 'titles.update')
  const text =
    source.text === undefined ? undefined : requireString(source.text, 'text', 'titles.update')
  const updates: Partial<TimelineItem> = {
    // Spans win over `text` when the renderer lays the title out (`getTextItemSpans`),
    // so new text replaces them, as the text inspector's own text edit does.
    ...(text !== undefined && { text, textSpans: undefined }),
    ...styleUpdates(source.style, 'titles.update'),
  }
  if (Object.keys(updates).length === 0) return

  transaction('TITLES_UPDATE', () => {
    updateItem(clip.id, updates)
  })
}

/**
 * The `studio.titles` namespace.
 * @example const titles = createTitlesApi(); titles.list()
 */
export function createTitlesApi(): TitlesApi {
  return {
    list: () => listTitles(),
    add: (input) => addTitle(input),
    update: (id, patch) => updateTitle(id, patch),
  }
}
