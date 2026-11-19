// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { updateItem } from '@/features/timeline/stores/actions/item-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { StudioError } from '../errors'
import { createPlaybackApi } from './playback'
import { createProjectApi } from './project'

const playback = createPlaybackApi()

/** One 240-frame clip on V1, so frames 0..239 belong to the timeline. */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: 'v1',
      from: 0,
      durationInFrames: 240,
      sourceEnd: 240,
      sourceDuration: 240,
    }),
  ])
}

/** The transport at rest, whatever another test file left in the shared store. */
function resetTransport(): void {
  usePlaybackStore.setState({
    currentFrame: 0,
    currentFrameEpoch: 0,
    isPlaying: false,
    playbackRate: 1,
    transportMode: 'normal',
    playbackScrubResumeTransport: null,
    loop: false,
    previewFrame: null,
    previewFrameEpoch: 0,
    frameUpdateEpoch: 0,
    previewItemId: null,
    compositionVisualFrozen: false,
  })
}

/** An undo entry to protect: playback calls must leave the history alone. */
function seedUndoEntry(): void {
  updateItem('c1', { volume: -3 })
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

/** Run `call` and check it left the undo and redo stacks untouched. */
function expectNoUndoStep(call: () => void): void {
  const before = useTimelineCommandStore.getState()
  call()
  const after = useTimelineCommandStore.getState()
  expect(after.undoStack).toBe(before.undoStack)
  expect(after.redoStack).toBe(before.redoStack)
  expect(after.undoStack.length).toBe(before.undoStack.length)
  expect(after.getLastCommandType()).toBe('UPDATE_ITEM')
}

function catchError(call: () => unknown): StudioError {
  try {
    call()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

describe('playback.get', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('reports the transport at rest', () => {
    expect(playback.get()).toEqual({ frame: 0, playing: false, rate: 1, loop: false })
  })

  it('reads the playback store field by field', () => {
    usePlaybackStore.setState({ currentFrame: 42, isPlaying: true, playbackRate: 2, loop: true })

    expect(playback.get()).toEqual({ frame: 42, playing: true, rate: 2, loop: true })
  })

  it('returns a copy, not the store state', () => {
    const info = playback.get()

    expect(info).not.toBe(usePlaybackStore.getState())
    expect(playback.get()).not.toBe(playback.get())

    info.frame = 999
    info.playing = true
    expect(playback.get()).toEqual({ frame: 0, playing: false, rate: 1, loop: false })
  })
})

describe('playback.seek', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('moves the playhead to a frame of the timeline', () => {
    playback.seek(120)

    expect(playback.get().frame).toBe(120)
    expect(usePlaybackStore.getState().currentFrame).toBe(120)
  })

  it('accepts the first and the last frame', () => {
    playback.seek(239)
    expect(playback.get().frame).toBe(239)

    playback.seek(0)
    expect(playback.get().frame).toBe(0)
  })

  it('names the last valid frame when the frame is past the end', () => {
    const error = catchError(() => playback.seek(240))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('frame')
    expect(error.message).toBe(
      'playback.seek: "frame" must be an integer frame from 0 to 239 on the main timeline ' +
        '(got 240)',
    )
    expect(playback.get().frame).toBe(0)
  })

  it('rejects a negative or fractional frame', () => {
    for (const frame of [-1, 1.5]) {
      const error = catchError(() => playback.seek(frame))
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('frame')
      expect(error.message).toContain('an integer frame from 0 to 239 on the main timeline')
    }

    expect(catchError(() => playback.seek(Number.NaN)).message).toContain(
      'an integer frame from 0 to 239 on the main timeline',
    )
    expect(playback.get().frame).toBe(0)
  })

  it('allows the single frame 0 of an empty timeline', () => {
    useItemsStore.getState().setItems([])

    playback.seek(0)
    expect(playback.get().frame).toBe(0)

    const error = catchError(() => playback.seek(1))
    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.message).toContain('an integer frame from 0 to 0 on the main timeline')
  })

  it('uses the length project.duration() reports', () => {
    const project = createProjectApi()

    expect(project.duration()).toBe(240)
    playback.seek(project.duration() - 1)
    expect(playback.get().frame).toBe(239)

    const error = catchError(() => playback.seek(project.duration()))
    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.message).toContain('an integer frame from 0 to 239 on the main timeline')
  })
})

describe('playback.play and playback.pause', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('starts and stops the transport', () => {
    playback.play()
    expect(playback.get().playing).toBe(true)

    playback.pause()
    expect(playback.get().playing).toBe(false)
  })

  it('keeps a rate set after play', () => {
    playback.play()
    playback.setRate(0.5)

    expect(playback.get()).toMatchObject({ playing: true, rate: 0.5 })
  })

  it('keeps the rate set before play', () => {
    playback.setRate(0.5)
    playback.play()

    expect(playback.get()).toMatchObject({ playing: true, rate: 0.5 })
  })
})

describe('playback.setRate', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('sets the playback rate multiplier', () => {
    playback.setRate(0.5)
    expect(playback.get().rate).toBe(0.5)

    playback.setRate(2)
    expect(playback.get().rate).toBe(2)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the rate %s', (rate) => {
    const error = catchError(() => playback.setRate(rate))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('rate')
    expect(error.message).toContain('"rate" must be a positive number')
    expect(playback.get().rate).toBe(1)
  })
})

describe('playback.setLoop', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('turns looping on and off', () => {
    playback.setLoop(true)
    expect(playback.get().loop).toBe(true)

    playback.setLoop(false)
    expect(playback.get().loop).toBe(false)
  })

  it('sets the value instead of toggling it', () => {
    playback.setLoop(true)
    playback.setLoop(true)

    expect(playback.get().loop).toBe(true)
  })

  it('leaves the store untouched when the value does not change', () => {
    const before = usePlaybackStore.getState()

    playback.setLoop(false)

    expect(usePlaybackStore.getState()).toBe(before)
  })

  it('rejects a value that is not a boolean', () => {
    const before = usePlaybackStore.getState()

    const error = catchError(() => playback.setLoop('true' as unknown as boolean))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('on')
    expect(error.message).toContain('"on" must be true or false')
    expect(usePlaybackStore.getState()).toBe(before)
  })
})

describe('playback is never an undo step', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('leaves the undo history alone for every method', () => {
    expect(undoDepth()).toBe(1)

    expectNoUndoStep(() => playback.get())
    expectNoUndoStep(() => playback.seek(120))
    expectNoUndoStep(() => playback.play())
    expectNoUndoStep(() => playback.pause())
    expectNoUndoStep(() => playback.setRate(0.5))
    expectNoUndoStep(() => playback.setLoop(true))
    expectNoUndoStep(() => playback.setLoop(false))

    expect(undoDepth()).toBe(1)
  })
})

describe('playback examples', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    resetTransport()
  })

  it('runs every documented example as written', () => {
    const studio = { playback: createPlaybackApi() }

    expect(studio.playback.get()).toEqual({ frame: 0, playing: false, rate: 1, loop: false })

    studio.playback.seek(120)
    expect(studio.playback.get().frame).toBe(120)

    studio.playback.play()
    expect(studio.playback.get().playing).toBe(true)

    studio.playback.pause()
    expect(studio.playback.get().playing).toBe(false)

    studio.playback.setRate(0.5)
    expect(studio.playback.get().rate).toBe(0.5)

    studio.playback.setLoop(true)
    expect(studio.playback.get().loop).toBe(true)
  })
})
