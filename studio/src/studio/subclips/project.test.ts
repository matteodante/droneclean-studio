// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import {
  buildSubclipTimelineFields,
  reconcileSubclipsWithMedia,
  restoreSubclipTimelineFields,
} from './project'
import { remapSubclipFields } from './remap'
import { useSubclipsStore } from './store'

function reset() {
  useSubclipsStore.getState().reset()
  useSourcePlayerStore.setState({
    currentMediaId: null,
    activeSubclipId: null,
    activeWindow: null,
    inPoint: null,
    outPoint: null,
    marksByKey: {},
  })
}

describe('subclips in a project file', () => {
  beforeEach(reset)

  it('writes nothing for a project without subclips or marks', () => {
    expect(buildSubclipTimelineFields()).toEqual({})
  })

  it('saves and reopens the same records and marks', () => {
    const sub = useSubclipsStore
      .getState()
      .create({ mediaId: 'm1', name: 'A', startFrame: 10, endFrame: 90, sourceFps: 59.94 })
    const player = useSourcePlayerStore.getState()
    player.setCurrentMediaId('m1')
    player.setInPoint(20)
    player.setOutPoint(60)
    player.setActiveSubclip(sub.id, { start: 10, end: 90 })
    player.setInPoint(30)

    const saved = JSON.parse(JSON.stringify(buildSubclipTimelineFields()))
    reset()
    restoreSubclipTimelineFields(saved)

    expect(useSubclipsStore.getState().subclips).toEqual([sub])
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({
      m1: { in: 20, out: 60 },
      [sub.id]: { in: 30, out: null },
    })
    useSourcePlayerStore.getState().setCurrentMediaId('m1')
    expect(useSourcePlayerStore.getState()).toMatchObject({ inPoint: 20, outPoint: 60 })
  })

  it('opens an old project, without the fields, with empty stores', () => {
    useSubclipsStore.getState().create({
      mediaId: 'm1',
      name: 'A',
      startFrame: 0,
      endFrame: 5,
      sourceFps: 30,
    })
    restoreSubclipTimelineFields({})
    expect(useSubclipsStore.getState().subclips).toEqual([])
    restoreSubclipTimelineFields(undefined)
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({})
  })

  it('ignores damaged marks', () => {
    restoreSubclipTimelineFields({
      sourceMarks: { a: { in: -1, out: 1.5 }, b: { in: 4, out: null }, c: null as never },
    })
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({ b: { in: 4, out: null } })
  })

  it('on load drops subclips and marks of deleted media, keeps a shorter parent', () => {
    restoreSubclipTimelineFields({
      subclips: [
        {
          id: 's1',
          mediaId: 'gone',
          name: 'x',
          startFrame: 0,
          endFrame: 10,
          sourceFps: 30,
          createdAt: 0,
        },
        {
          id: 's2',
          mediaId: 'short',
          name: 'y',
          startFrame: 0,
          endFrame: 500,
          sourceFps: 30,
          createdAt: 0,
        },
      ],
      sourceMarks: {
        gone: { in: 1, out: 2 },
        s1: { in: 1, out: 2 },
        s2: { in: 1, out: 2 },
        short: { in: 1, out: 2 },
        far: { in: 5, out: 4000 },
        ok: { in: 5, out: 40 },
      },
    })
    reconcileSubclipsWithMedia([
      { id: 'short', duration: 10, fps: 30 },
      { id: 'far', duration: 10, fps: 30 },
      { id: 'ok', duration: 10, fps: 30 },
    ])
    expect(useSubclipsStore.getState().subclips.map((s) => s.id)).toEqual(['s2'])
    expect(Object.keys(useSourcePlayerStore.getState().marksByKey).sort()).toEqual([
      'ok',
      's2',
      'short',
    ])
  })

  it('a relink keeps the id, so nothing is dropped or changed', () => {
    useSubclipsStore
      .getState()
      .setSubclips([
        {
          id: 's1',
          mediaId: 'm1',
          name: 'x',
          startFrame: 0,
          endFrame: 10,
          sourceFps: 30,
          createdAt: 0,
        },
      ])
    reconcileSubclipsWithMedia([{ id: 'm1', duration: 20, fps: 30 }])
    expect(useSubclipsStore.getState().subclips).toHaveLength(1)
  })

  it('follows new media ids when imported elsewhere', () => {
    const fields = {
      subclips: [
        {
          id: 's1',
          mediaId: 'old',
          name: 'x',
          startFrame: 0,
          endFrame: 10,
          sourceFps: 30,
          createdAt: 0,
        },
        {
          id: 's2',
          mediaId: 'lost',
          name: 'y',
          startFrame: 0,
          endFrame: 10,
          sourceFps: 30,
          createdAt: 0,
        },
      ],
      sourceMarks: {
        old: { in: 1, out: 2 },
        s1: { in: 3, out: 4 },
        s2: { in: 1, out: 2 },
        lost: { in: 1, out: 2 },
      },
    }
    const out = remapSubclipFields(fields, new Map([['old', 'new']]))
    expect(out.subclips).toEqual([{ ...fields.subclips[0], mediaId: 'new' }])
    expect(out.sourceMarks).toEqual({ new: { in: 1, out: 2 }, s1: { in: 3, out: 4 } })
    expect(remapSubclipFields({}, new Map())).toEqual({})
  })
})
