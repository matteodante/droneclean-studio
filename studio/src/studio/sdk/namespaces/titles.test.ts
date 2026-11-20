// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { TextItem } from '@/types/timeline'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { createDefaultTextItem } from '@/features/timeline/utils/generated-layer-items'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { StudioError } from '../errors'
import type { ClipInfo, TitleAddInput, TitleStyle } from '../types'
import { createTitlesApi } from './titles'

/** Two video tracks and one audio track, the stack the tests write to. */
function seedTracks(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
    ])
}

/** A text item shaped like the editor's default, with a stable id. */
function makeTextItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    ...createDefaultTextItem({
      trackId: 'v1',
      from: 0,
      durationInFrames: 90,
      canvasWidth: 1920,
      canvasHeight: 1080,
      text: 'Your Text Here',
    }),
    id: 't1',
    ...overrides,
  }
}

/** The stored clip with this id. */
function storedItem(id: string): TextItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item || item.type !== 'text') throw new Error(`no text clip ${id}`)
  return item
}

/** The first value of a non-empty list. */
function first<T>(values: T[]): T {
  const [value] = values
  if (value === undefined) throw new Error('expected at least one value')
  return value
}

/** Run a call that must throw, and return its `StudioError`. */
function captureError(run: () => unknown): StudioError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(StudioError)
    return error as StudioError
  }
  throw new Error('expected the call to throw a StudioError')
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Flight',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 3840, height: 2160, fps: 30 },
    ...overrides,
  }
}

describe('titles', () => {
  const titles = createTitlesApi()

  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    seedTracks()
  })

  describe('list', () => {
    it('returns the text clips, top of the stack first and then in timeline order', () => {
      useItemsStore
        .getState()
        .setItems([
          makeTextItem({ id: 'v2-late', trackId: 'v2', from: 120 }),
          makeTimelineVideoItem({ id: 'clip-1', trackId: 'v1' }),
          makeTextItem({ id: 'v1-late', trackId: 'v1', from: 90 }),
          makeTextItem({ id: 'v1-early', trackId: 'v1', from: 0 }),
        ])

      expect(titles.list().map((title) => title.id)).toEqual(['v1-early', 'v1-late', 'v2-late'])
    })

    it('returns an empty list when the timeline holds no text clip', () => {
      useItemsStore.getState().setItems([makeTimelineVideoItem({ id: 'clip-1' })])

      expect(titles.list()).toEqual([])
    })

    it('returns plain copies built field by field', () => {
      useItemsStore.getState().setItems([makeTextItem()])

      const listed = titles.list()
      const title = first(listed)

      expect(title).toEqual<ClipInfo>({
        id: 't1',
        trackId: 'v1',
        type: 'text',
        from: 0,
        durationInFrames: 90,
        label: 'Text',
        transform: { x: 0, y: 0, width: 1536, height: 324, rotation: 0, opacity: 1 },
        text: 'Your Text Here',
        color: '#ffffff',
      })
      expect(JSON.parse(JSON.stringify(listed))).toEqual(listed)

      title.text = 'changed'
      title.transform!.x = 999
      title.color = '#000000'
      listed.length = 0

      const stored = storedItem('t1')
      expect(stored.text).toBe('Your Text Here')
      expect(stored.transform?.x).toBe(0)
      expect(stored.color).toBe('#ffffff')
      expect(useItemsStore.getState().items).toHaveLength(1)
    })

    it('omits a transform the item does not carry', () => {
      useItemsStore.getState().setItems([makeTextItem({ transform: undefined })])

      expect(first(titles.list()).transform).toBeUndefined()
    })

    it('returns only the transform fields the item sets', () => {
      useItemsStore.getState().setItems([makeTextItem({ transform: { x: 10 } })])

      expect(first(titles.list()).transform).toEqual({ x: 10 })
    })
  })

  describe('add', () => {
    it('adds a text clip with the editor defaults', () => {
      const id = titles.add({
        trackId: 'v1',
        from: 30,
        durationInFrames: 90,
        text: 'Cinque Terre',
      })

      expect(storedItem(id)).toMatchObject({
        id,
        type: 'text',
        trackId: 'v1',
        from: 30,
        durationInFrames: 90,
        label: 'Text',
        text: 'Cinque Terre',
        fontSize: 60,
        fontFamily: 'Inter',
        fontWeight: 'normal',
        fontStyle: 'normal',
        underline: false,
        color: '#ffffff',
        textAlign: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
        transform: { x: 0, y: 0, width: 1536, height: 324, rotation: 0, opacity: 1 },
      })
    })

    it('applies every style field of the input', () => {
      const id = titles.add({
        trackId: 'v1',
        from: 0,
        durationInFrames: 90,
        text: 'Riomaggiore',
        style: {
          fontSize: 120,
          fontFamily: 'Montserrat',
          fontWeight: 'bold',
          fontStyle: 'italic',
          underline: true,
          color: '#ff0000',
          letterSpacing: 4,
          backgroundColor: '#000000',
          backgroundRadius: 12,
          textAlign: 'left',
          verticalAlign: 'bottom',
          lineHeight: 1.6,
          textPadding: 24,
          textShadow: { offsetX: 2, offsetY: 3, blur: 8, color: '#000000' },
          stroke: { width: 2, color: '#ffffff' },
        },
      })

      expect(storedItem(id)).toMatchObject({
        fontSize: 120,
        fontFamily: 'Montserrat',
        fontWeight: 'bold',
        fontStyle: 'italic',
        underline: true,
        color: '#ff0000',
        letterSpacing: 4,
        backgroundColor: '#000000',
        backgroundRadius: 12,
        textAlign: 'left',
        verticalAlign: 'bottom',
        lineHeight: 1.6,
        textPadding: 24,
        textShadow: { offsetX: 2, offsetY: 3, blur: 8, color: '#000000' },
        stroke: { width: 2, color: '#ffffff' },
      })
    })

    it('sizes the text box and the font to the open project canvas', () => {
      useProjectStore.setState({ currentProject: makeProject() })

      const id = titles.add({ trackId: 'v1', from: 0, durationInFrames: 90, text: 'Manarola' })

      expect(storedItem(id).transform).toMatchObject({ width: 3072, height: 648 })
      expect(storedItem(id)).toMatchObject({ fontSize: 120 })
    })

    it('commits one undo entry that restores the timeline', () => {
      const before = buildTimelineFromStores()
      const depthBefore = undoDepth()

      titles.add({ trackId: 'v1', from: 10, durationInFrames: 90, text: 'Vernazza' })

      expect(undoDepth()).toBe(depthBefore + 1)
      expect(useTimelineCommandStore.getState().undoStack.at(-1)?.command.type).toBe('TITLES_ADD')

      useTimelineCommandStore.getState().undo()

      expect(undoDepth()).toBe(depthBefore)
      expect(buildTimelineFromStores()).toEqual(before)
    })

    it('rejects a title over a clip of its track with CONFLICT, instead of moving it after the clip', () => {
      useItemsStore.getState().setItems([makeTimelineVideoItem({ id: 'clip-1', trackId: 'v1', from: 0, durationInFrames: 300 })])
      const before = buildTimelineFromStores()

      const error = captureError(() =>
        titles.add({ trackId: 'v1', from: 30, durationInFrames: 90, text: 'Riomaggiore' }),
      )

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('from')
      expect(error.entity).toEqual({ kind: 'clip', id: 'clip-1' })
      expect(error.message).toBe(
        'titles.add: a title of 90 frames at frame 30 overlaps clip "clip-1" (frames 0..300) on track "v1"; the first free frame where it fits is 300',
      )
      expect(error.hint).toContain("studio.tracks.add({ kind: 'video', name: 'Titles', position: 0 })")
      expect(buildTimelineFromStores()).toEqual(before)
      expect(undoDepth()).toBe(0)
    })

    it('rejects a missing track with NOT_FOUND', () => {
      const before = buildTimelineFromStores()

      const error = captureError(() =>
        titles.add({ trackId: 'v9', from: 0, durationInFrames: 90, text: 'Corniglia' }),
      )

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('trackId')
      expect(error.entity).toEqual({ kind: 'track', id: 'v9' })
      expect(error.message).toBe(
        'titles.add: "trackId" must be an existing track id on the main timeline (got "v9"); valid: "v1", "v2", "a1"',
      )
      expect(buildTimelineFromStores()).toEqual(before)
      expect(undoDepth()).toBe(0)
    })

    it('rejects a missing text with INVALID_ARGUMENT', () => {
      const input = { trackId: 'v1', from: 0, durationInFrames: 90 } as unknown as TitleAddInput

      const error = captureError(() => titles.add(input))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('text')
      expect(error.message).toBe('titles.add: "text" must be a string (got undefined)')
    })

    it('rejects an audio track with INVALID_ARGUMENT', () => {
      const error = captureError(() =>
        titles.add({ trackId: 'a1', from: 0, durationInFrames: 90, text: 'Monterosso' }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('trackId')
      expect(error.valid).toEqual(['v1', 'v2'])
      expect(error.message).toBe(
        'titles.add: "trackId" must be a video track that can hold a title (got "a1"); valid: "v1", "v2"',
      )
    })

    it('rejects a legacy audio track that only its name marks as audio', () => {
      useItemsStore.getState().setTracks([makeTimelineTrack({ id: 'a1', name: 'A1', order: 0 })])

      const error = captureError(() =>
        titles.add({ trackId: 'a1', from: 0, durationInFrames: 90, text: 'Corniglia' }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('trackId')
      expect(error.message).toBe(
        'titles.add: "trackId" must be a video track that can hold a title (got "a1")',
      )
    })

    it('rejects a layer group track', () => {
      useItemsStore.getState().setTracks([
        makeTimelineTrack({ id: 'group-1', name: 'Layer Group', order: 0, isGroup: true }),
        makeTimelineTrack({
          id: 'v1',
          name: 'V1',
          kind: 'video',
          order: 1,
          parentTrackId: 'group-1',
        }),
      ])

      const error = captureError(() =>
        titles.add({ trackId: 'group-1', from: 0, durationInFrames: 90, text: 'Corniglia' }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('trackId')
      expect(error.valid).toEqual(['v1'])
      expect(error.hint).toContain('is a layer group')
    })

    it('rejects a from that is not an integer frame >= 0', () => {
      const error = captureError(() =>
        titles.add({ trackId: 'v1', from: -1, durationInFrames: 90, text: 'Levanto' }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('from')
      expect(error.message).toBe('titles.add: "from" must be an integer frame >= 0 (got -1)')
      expect(useItemsStore.getState().items).toHaveLength(0)
    })

    it('rejects a duration that is not a positive integer', () => {
      const error = captureError(() =>
        titles.add({ trackId: 'v1', from: 0, durationInFrames: 0, text: 'Levanto' }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('durationInFrames')
      expect(error.message).toBe(
        'titles.add: "durationInFrames" must be a positive integer frame count (got 0)',
      )
    })

    it('rejects a font family that is not in the font catalogue', () => {
      const error = captureError(() =>
        titles.add({
          trackId: 'v1',
          from: 0,
          durationInFrames: 90,
          text: 'Portovenere',
          style: { fontFamily: 'Comic Sans' },
        }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('style.fontFamily')
      expect(error.message).toContain(
        'titles.add: "style.fontFamily" must be a font family from the font catalogue (got "Comic Sans"); valid: "Roboto"',
      )
      expect(error.valid?.[0]).toBe('Roboto')
    })

    it('rejects a style number outside the text inspector range', () => {
      const error = captureError(() =>
        titles.add({
          trackId: 'v1',
          from: 0,
          durationInFrames: 90,
          text: 'Portovenere',
          style: { fontSize: 4 },
        }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('style.fontSize')
      expect(error.message).toBe(
        'titles.add: "style.fontSize" must be a number between 8 and 500 (got 4)',
      )
    })

    it('rejects a style field the type does not declare', () => {
      const style = { fontsize: 12 } as unknown as TitleStyle

      const error = captureError(() =>
        titles.add({ trackId: 'v1', from: 0, durationInFrames: 90, text: 'Riomaggiore', style }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('style')
      expect(error.message).toContain(
        'titles.add: "style" must be an object with only the fields it declares (got "fontsize")',
      )
    })

    it('rejects a non-hex colour', () => {
      const error = captureError(() =>
        titles.add({
          trackId: 'v1',
          from: 0,
          durationInFrames: 90,
          text: 'Riomaggiore',
          style: { color: 'red' },
        }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('style.color')
      expect(error.message).toBe(
        'titles.add: "style.color" must be a hex colour such as "#ffffff" (got "red")',
      )
    })
  })

  describe('update', () => {
    beforeEach(() => {
      useItemsStore.getState().setItems([
        makeTextItem({
          textShadow: { offsetX: 1, offsetY: 2, blur: 3, color: '#000000' },
        }),
      ])
    })

    it('changes the text and commits one undo entry that restores it', () => {
      const depthBefore = undoDepth()

      titles.update('t1', { text: 'Riomaggiore' })

      expect(storedItem('t1').text).toBe('Riomaggiore')
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(useTimelineCommandStore.getState().undoStack.at(-1)?.command.type).toBe(
        'TITLES_UPDATE',
      )

      useTimelineCommandStore.getState().undo()

      expect(storedItem('t1').text).toBe('Your Text Here')
      expect(undoDepth()).toBe(depthBefore)
    })

    it('merges the style fields into the title', () => {
      titles.update('t1', {
        style: {
          color: '#00ff00',
          fontSize: 32,
          textShadow: { offsetX: 4, offsetY: 5, blur: 6, color: '#111111' },
        },
      })

      expect(storedItem('t1')).toMatchObject({
        color: '#00ff00',
        fontSize: 32,
        fontFamily: 'Inter',
        lineHeight: 1.2,
        textShadow: { offsetX: 4, offsetY: 5, blur: 6, color: '#111111' },
      })
    })

    it('clears the background colour, shadow and stroke with null, and undo restores them', () => {
      useItemsStore.getState().setItems([
        makeTextItem({
          backgroundColor: '#000000',
          textShadow: { offsetX: 1, offsetY: 2, blur: 3, color: '#000000' },
          stroke: { width: 2, color: '#ffffff' },
        }),
      ])
      const depthBefore = undoDepth()
      const clear: TitleStyle = {
        backgroundColor: null,
        textShadow: null,
        stroke: null,
      }

      titles.update('t1', { style: clear })

      expect(storedItem('t1').backgroundColor).toBeUndefined()
      expect(storedItem('t1').textShadow).toBeUndefined()
      expect(storedItem('t1').stroke).toBeUndefined()
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(useTimelineCommandStore.getState().undoStack.at(-1)?.command.type).toBe(
        'TITLES_UPDATE',
      )

      useTimelineCommandStore.getState().undo()

      expect(storedItem('t1').backgroundColor).toBe('#000000')
      expect(storedItem('t1').textShadow).toEqual({
        offsetX: 1,
        offsetY: 2,
        blur: 3,
        color: '#000000',
      })
      expect(storedItem('t1').stroke).toEqual({ width: 2, color: '#ffffff' })
    })

    it('clears only the field that is null', () => {
      useItemsStore.getState().setItems([
        makeTextItem({
          backgroundColor: '#000000',
          stroke: { width: 2, color: '#ffffff' },
        }),
      ])
      const clear: TitleStyle = { backgroundColor: null }

      titles.update('t1', { style: clear })

      expect(storedItem('t1').backgroundColor).toBeUndefined()
      expect(storedItem('t1').stroke).toEqual({ width: 2, color: '#ffffff' })
    })

    it('replaces the spans with the new text', () => {
      useItemsStore.getState().setItems([
        makeTextItem({
          textSpans: [{ text: 'Your ' }, { text: 'Text Here', fontWeight: 'bold' }],
        }),
      ])

      titles.update('t1', { text: 'Riomaggiore' })

      expect(storedItem('t1').text).toBe('Riomaggiore')
      expect(storedItem('t1').textSpans).toBeUndefined()
    })

    it('keeps the spans when the patch only changes the style', () => {
      useItemsStore.getState().setItems([
        makeTextItem({
          textSpans: [{ text: 'Your ' }, { text: 'Text Here', fontWeight: 'bold' }],
        }),
      ])

      titles.update('t1', { style: { color: '#00ff00' } })

      expect(storedItem('t1').textSpans).toHaveLength(2)
    })

    it('adds no undo entry for a patch that changes nothing', () => {
      const before = buildTimelineFromStores()
      const depthBefore = undoDepth()

      titles.update('t1', {})

      expect(undoDepth()).toBe(depthBefore)
      expect(buildTimelineFromStores()).toEqual(before)
    })

    it('rejects an id that is not a text clip with NOT_FOUND', () => {
      const error = captureError(() => titles.update('t9', { text: 'Riomaggiore' }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.entity).toEqual({ kind: 'clip', id: 't9' })
      expect(error.message).toBe(
        'titles.update: "id" must be an existing text clip id on the main timeline (got "t9"); valid: "t1"',
      )
    })

    it('rejects a clip id that belongs to a non-text clip with NOT_FOUND', () => {
      useItemsStore
        .getState()
        .setItems([makeTextItem(), makeTimelineVideoItem({ id: 'clip-1', trackId: 'v1' })])

      const error = captureError(() => titles.update('clip-1', { text: 'Riomaggiore' }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.valid).toEqual(['t1'])
    })

    it('rejects a style number outside the text inspector range', () => {
      const error = captureError(() => titles.update('t1', { style: { lineHeight: 9 } }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('style.lineHeight')
      expect(error.message).toBe(
        'titles.update: "style.lineHeight" must be a number between 0.5 and 3 (got 9)',
      )
      expect(storedItem('t1').lineHeight).toBe(1.2)
    })

    it('rejects a shadow field the type does not declare', () => {
      const style = {
        textShadow: { offsetX: 1, offsetY: 2, blur: 3, color: '#000000', spread: 4 },
      } as unknown as TitleStyle

      const error = captureError(() => titles.update('t1', { style }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('style.textShadow')
      expect(error.message).toContain(
        'titles.update: "style.textShadow" must be an object with only the fields it declares (got "spread")',
      )
    })
  })

  describe('the examples', () => {
    const studio = { titles: createTitlesApi() }

    it('runs the list example as written', () => {
      expect(studio.titles.list()).toEqual([])
    })

    it('runs the add example as written', () => {
      const id = studio.titles.add({
        trackId: 'v1',
        from: 0,
        durationInFrames: 90,
        text: 'Cinque Terre',
      })

      expect(typeof id).toBe('string')
      expect(storedItem(id).text).toBe('Cinque Terre')
    })

    it('runs the update example as written', () => {
      useItemsStore.getState().setItems([makeTextItem({ id: 't1' })])

      studio.titles.update('t1', { text: 'Riomaggiore' })

      expect(storedItem('t1').text).toBe('Riomaggiore')
    })
  })
})
