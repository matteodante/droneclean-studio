// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { VisualEffect } from '@/types/effects'
import type { Project } from '@/types/project'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import {
  addEffect,
  removeEffect,
  updateEffect,
} from '@/features/timeline/stores/actions/effect-actions'
import {
  addMarker,
  clearInOutPoints,
  setInPoint,
} from '@/features/timeline/stores/actions/marker-actions'
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { updateItem, removeItems } from '@/features/timeline/stores/actions/item-actions'
import { addKeyframe } from '@/features/timeline/stores/actions/keyframe-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { captureChangeBaseline, diffChangeBaselines } from './changes'
import { createStudio } from './index'
import { transaction } from './transaction'

function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'clip-1',
      trackId: 'track-v1',
      durationInFrames: 120,
      sourceEnd: 120,
      sourceDuration: 240,
      volume: 0,
    }),
  ])
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Flight',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 3840, height: 2160, fps: 60 },
    ...overrides,
  }
}

/** A brightness effect, as the effects panel adds it. */
function brightnessEffect(): VisualEffect {
  return { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount: 0.1 } }
}

/** Add a brightness effect to `clip-1` outside a transaction and return its id. */
function addStoredEffect(): string {
  addEffect('clip-1', brightnessEffect())
  const effect = useItemsStore.getState().items[0]?.effects?.[0]
  if (!effect) throw new Error('the store did not add the effect')
  return effect.id
}

/**
 * Open the composition `comp-1` for editing: it exists in the compositions
 * store and the navigation store points at it, so the SDK reads and writes the
 * composition, and Main is held aside in the stash.
 */
function openComposition(): void {
  useCompositionsStore.getState().setCompositions([
    {
      id: 'comp-1',
      name: 'Intro',
      items: [],
      tracks: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 0,
    },
  ])
  useCompositionNavigationStore.setState({
    breadcrumbs: [
      { compositionId: null, label: 'Main Timeline' },
      { compositionId: 'comp-1', label: 'Intro' },
    ],
    activeCompositionId: 'comp-1',
    stashStack: [
      {
        compositionId: null,
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        currentFrame: 0,
        markers: [],
        inPoint: null,
        outPoint: null,
      },
    ],
    mainHolder: null,
  })
}

describe('changes', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    seedTimeline()
  })

  it('reports a changed clip field', () => {
    const { changes } = transaction('CLIPS_UPDATE', () => {
      updateItem('clip-1', { volume: -6 })
    })

    expect(changes.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['volume'] }])
    expect(changes.added).toEqual([])
    expect(changes.removed).toEqual([])
    expect(changes.commands.map((command) => command.type)).toEqual(['UPDATE_ITEM'])
    expect(changes.commands[0]?.payload).toMatchObject({ id: 'clip-1' })
  })

  it('reports an added marker', () => {
    const { changes } = transaction('MARKERS_ADD', () => {
      addMarker(45, '#ff0000', 'take off')
    })

    const marker = useMarkersStore.getState().markers[0]
    expect(marker).toMatchObject({ frame: 45, label: 'take off' })
    expect(changes.added).toEqual([{ kind: 'marker', id: marker?.id }])
    expect(changes.updated).toEqual([])
    expect(changes.removed).toEqual([])
  })

  it('reports a removed clip', () => {
    const { changes } = transaction('CLIPS_REMOVE', () => {
      removeItems(['clip-1'])
    })

    expect(changes.removed).toEqual([{ kind: 'clip', id: 'clip-1' }])
    expect(changes.added).toEqual([])
    expect(changes.updated).toEqual([])
    expect(useItemsStore.getState().items).toHaveLength(0)
  })

  it('reports the in/out range when its first point is set', () => {
    const { changes } = transaction('MARKERS_SET_IN', () => {
      setInPoint(0)
    })

    expect(changes.added).toEqual([{ kind: 'range', id: 'main' }])
    expect(changes.updated).toEqual([])
    expect(changes.removed).toEqual([])
  })

  it('reports the in/out range point that moves', () => {
    transaction('MARKERS_SET_IN', () => {
      setInPoint(0)
    })

    const { changes } = transaction('MARKERS_SET_IN', () => {
      setInPoint(60)
    })

    expect(changes.updated).toEqual([{ kind: 'range', id: 'main', fields: ['inPoint'] }])
    expect(changes.added).toEqual([])
    expect(changes.removed).toEqual([])
  })

  it('reports the in/out range when its last point is cleared', () => {
    transaction('MARKERS_SET_IN', () => {
      setInPoint(0)
    })

    const { changes } = transaction('MARKERS_CLEAR_IN_OUT_POINTS', () => {
      clearInOutPoints()
    })

    expect(changes.removed).toEqual([{ kind: 'range', id: 'main' }])
    expect(changes.added).toEqual([])
    expect(changes.updated).toEqual([])
  })

  it('reports nothing for a range that did not move', () => {
    transaction('MARKERS_SET_IN', () => {
      setInPoint(0)
    })

    const { changes } = transaction('CLIPS_UPDATE', () => {
      updateItem('clip-1', { volume: -6 })
    })

    expect(changes.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['volume'] }])
    expect(changes.added).toEqual([])
    expect(changes.removed).toEqual([])
  })

  it('reports an added effect as its own entity, and its clip', () => {
    let effectId = ''
    const { changes } = transaction('EFFECTS_ADD', () => {
      addEffect('clip-1', brightnessEffect())
      effectId = useItemsStore.getState().items[0]?.effects?.[0]?.id ?? ''
    })

    expect(effectId).not.toBe('')
    expect(changes.added).toEqual([{ kind: 'effect', id: effectId, clip: 'clip-1' }])
    expect(changes.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['effects'] }])
    expect(changes.removed).toEqual([])
  })

  it("reports an effect parameter change as the effect's `effect` field", () => {
    const effectId = addStoredEffect()
    const current = useItemsStore.getState().items[0]?.effects?.[0]
    if (!current) throw new Error('the store has no effect to update')

    const { changes } = transaction('EFFECTS_UPDATE', () => {
      updateEffect('clip-1', effectId, {
        effect: { ...current.effect, params: { ...current.effect.params, amount: 0.2 } },
      })
    })

    expect(changes.updated).toEqual([
      { kind: 'clip', id: 'clip-1', fields: ['effects'] },
      { kind: 'effect', id: effectId, clip: 'clip-1', fields: ['effect'] },
    ])
    expect(changes.added).toEqual([])
    expect(changes.removed).toEqual([])
  })

  it('reports the effect switch as its `enabled` field', () => {
    const effectId = addStoredEffect()

    const { changes } = transaction('EFFECTS_UPDATE', () => {
      updateEffect('clip-1', effectId, { enabled: false })
    })

    expect(changes.updated).toEqual([
      { kind: 'clip', id: 'clip-1', fields: ['effects'] },
      { kind: 'effect', id: effectId, clip: 'clip-1', fields: ['enabled'] },
    ])
    expect(changes.added).toEqual([])
    expect(changes.removed).toEqual([])
  })

  it('reports a removed effect as its own entity, and its clip', () => {
    const effectId = addStoredEffect()

    const { changes } = transaction('EFFECTS_REMOVE', () => {
      removeEffect('clip-1', effectId)
    })

    expect(changes.removed).toEqual([{ kind: 'effect', id: effectId, clip: 'clip-1' }])
    expect(changes.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['effects'] }])
    expect(changes.added).toEqual([])
  })

  it('reports the effects of the open composition', () => {
    openComposition()

    let effectId = ''
    const added = transaction('EFFECTS_ADD', () => {
      addEffect('clip-1', brightnessEffect())
      effectId = useItemsStore.getState().items[0]?.effects?.[0]?.id ?? ''
    }).changes
    expect(added.added).toEqual([{ kind: 'effect', id: effectId, clip: 'clip-1' }])
    expect(added.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['effects'] }])

    const updated = transaction('EFFECTS_UPDATE', () => {
      updateEffect('clip-1', effectId, { enabled: false })
    }).changes
    expect(updated.updated).toContainEqual({
      kind: 'effect',
      id: effectId,
      clip: 'clip-1',
      fields: ['enabled'],
    })

    const removed = transaction('EFFECTS_REMOVE', () => {
      removeEffect('clip-1', effectId)
    }).changes
    expect(removed.removed).toEqual([{ kind: 'effect', id: effectId, clip: 'clip-1' }])
    expect(removed.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['effects'] }])
  })

  it('reports the two halves of a split as two effects, not one updated', () => {
    const effectId = addStoredEffect()
    const studio = createStudio()

    const split = transaction('CLIPS_SPLIT', () => studio.clips.split('clip-1', 60))
    const [left, right] = split.value
    expect(left).toBe('clip-1')

    // The store copies a clip's effects, so both halves carry the same effect
    // id: the right half's effect is a new entity, the left half's unchanged.
    expect(split.changes.added).toContainEqual({ kind: 'effect', id: effectId, clip: right })
    expect(split.changes.updated.filter((entity) => entity.kind === 'effect')).toEqual([])

    // An edit on one half names that half's effect alone.
    const update = transaction('EFFECTS_UPDATE', () => {
      studio.effects.update(right, effectId, { enabled: false })
    })
    expect(update.changes.updated).toContainEqual({
      kind: 'effect',
      id: effectId,
      clip: right,
      fields: ['enabled'],
    })
    expect(update.changes.updated.filter((entity) => entity.kind === 'effect')).toEqual([
      { kind: 'effect', id: effectId, clip: right, fields: ['enabled'] },
    ])
    expect(studio.effects.list(left)).toEqual([
      { id: effectId, type: 'gpu-brightness', params: { amount: 0.1 }, enabled: true },
    ])
  })

  it('reports a keyframe as its own entity', () => {
    let keyframeId = ''
    const { changes } = transaction('KEYFRAMES_ADD', () => {
      keyframeId = addKeyframe('clip-1', 'opacity', 0, 1)
    })

    expect(keyframeId).not.toBe('')
    expect(changes.added).toEqual([{ kind: 'keyframe', id: keyframeId }])
  })

  it('reports canvas metadata changes on the project entity', () => {
    useProjectStore.setState({ currentProject: makeProject() })
    const before = captureChangeBaseline()

    useProjectStore.setState({
      currentProject: makeProject({ metadata: { width: 1920, height: 2160, fps: 30 } }),
    })
    const after = captureChangeBaseline()

    expect(diffChangeBaselines(before, after)).toEqual({
      added: [],
      removed: [],
      updated: [{ kind: 'project', id: 'project-1', fields: ['width', 'fps'] }],
    })
  })

  it('names only the two projects when another one opens, not either timeline', () => {
    useProjectStore.setState({ currentProject: makeProject() })
    const before = captureChangeBaseline()

    useProjectStore.setState({ currentProject: makeProject({ id: 'project-2' }) })
    useItemsStore.getState().setItems([])
    const after = captureChangeBaseline()

    expect(diffChangeBaselines(before, after)).toEqual({
      added: [{ kind: 'project', id: 'project-2' }],
      removed: [{ kind: 'project', id: 'project-1' }],
      updated: [],
    })
  })

  it('reports the open composition, not the Main timeline', () => {
    openComposition()

    const before = captureChangeBaseline()
    updateItem('clip-1', { volume: -6 })
    const after = captureChangeBaseline()

    expect(diffChangeBaselines(before, after).updated).toEqual([
      { kind: 'clip', id: 'clip-1', fields: ['volume'] },
    ])
  })

  it('reports nothing when the state did not change', () => {
    const before = captureChangeBaseline()
    const after = captureChangeBaseline()

    expect(diffChangeBaselines(before, after)).toEqual({
      added: [],
      removed: [],
      updated: [],
    })
  })
})
