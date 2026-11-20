/**
 * The page side of `frame` (task 2.2 slice 3): the rules and the geometry,
 * with the renderer behind the `FrameEnvironment` seam.
 *
 * What is pinned here is everything the page decides without a GPU: the long
 * edge of a frame, the grid and cell size of a sheet, which frames are refused
 * because the timeline is shorter, the base64 encoding, the written path, and
 * how a failure becomes a `StudioError` JSON. The pixels themselves are
 * measured in Chrome against the dev server (the slice's report), because a
 * renderer needs the GPU the rest of the editor's tests also run in Chrome.
 */
import { describe, expect, it } from 'vite-plus/test'
import type { ContactSheetPlan, FrameEnvironment, SingleFramePlan } from './frame'
import { installAgentFrame, renderFramePlan } from './frame'

/** A PNG blob of four bytes, enough to check the base64 round trip. */
function pngBlob(bytes = [0x89, 0x50, 0x4e, 0x47]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' })
}

/** What the fake environment was asked to do. */
interface Faked {
  renders: Array<{ frames: readonly number[]; width: number; height: number }>
  writes: Array<{ projectId: string; fileName: string; bytes: number }>
  compositions: Array<{ cells: number; columns: number; rows: number; cellWidth: number; cellHeight: number }>
}

/** A 1920 × 1080 project 300 frames long, with a fake renderer. */
function fakeEnvironment(
  overrides: Partial<FrameEnvironment> = {},
): { environment: FrameEnvironment; faked: Faked } {
  const faked: Faked = { renders: [], writes: [], compositions: [] }
  const environment: FrameEnvironment = {
    sequence: () => ({ projectId: 'p1', frames: 300, width: 1920, height: 1080 }),
    render: (frames, width, height) => {
      faked.renders.push({ frames, width, height })
      return Promise.resolve(frames.map(() => pngBlob()))
    },
    write: (projectId, fileName, png) => {
      faked.writes.push({ projectId, fileName, bytes: png.size })
      return Promise.resolve(`projects/${projectId}/frames/${fileName}`)
    },
    compose: (cells, columns, rows, cellWidth, cellHeight) => {
      faked.compositions.push({ cells: cells.length, columns, rows, cellWidth, cellHeight })
      return Promise.resolve(pngBlob([1, 2, 3, 4, 5, 6, 7]))
    },
    ...overrides,
  }
  return { environment, faked }
}

const SINGLE: SingleFramePlan = { kind: 'frame', frame: 120, width: 1280, full: false }

describe('renderFramePlan: one frame', () => {
  it('renders at a 1280 px long edge and answers base64 with its size', async () => {
    const { environment, faked } = fakeEnvironment()
    const answer = await renderFramePlan(SINGLE, environment)
    expect('result' in answer).toBe(true)
    if (!('result' in answer)) return
    expect(faked.renders).toEqual([{ frames: [120], width: 1280, height: 720 }])
    expect(answer.result).toMatchObject({ bytes: 4, width: 1280, height: 720 })
    if (!('png' in answer.result)) throw new Error('expected base64')
    expect(answer.result.png).toBe(btoa('\u0089PNG'))
    expect(typeof answer.durationMs).toBe('number')
  })

  it('keeps a 4:3 project at 1280 × 960, and a portrait project at 720 × 1280', async () => {
    const fourThree = fakeEnvironment({
      sequence: () => ({ projectId: 'p1', frames: 300, width: 3840, height: 2880 }),
    })
    const atFourThree = await renderFramePlan(SINGLE, fourThree.environment)
    expect(fourThree.faked.renders[0]).toEqual({ frames: [120], width: 1280, height: 960 })

    const portrait = fakeEnvironment({
      sequence: () => ({ projectId: 'p1', frames: 300, width: 1080, height: 1920 }),
    })
    await renderFramePlan(SINGLE, portrait.environment)
    expect(portrait.faked.renders[0]).toEqual({ frames: [120], width: 720, height: 1280 })
    expect('result' in atFourThree).toBe(true)
  })

  it('full renders the project’s own size and answers the written path', async () => {
    const { environment, faked } = fakeEnvironment()
    const answer = await renderFramePlan({ ...SINGLE, frame: 42, full: true }, environment)
    expect(faked.renders).toEqual([{ frames: [42], width: 1920, height: 1080 }])
    expect(faked.writes).toEqual([
      { projectId: 'p1', fileName: expect.stringMatching(/^frame-42-[0-9a-z]+-\d+\.png$/), bytes: 4 },
    ])
    if (!('result' in answer)) throw new Error('expected a result')
    expect(answer.result).toEqual({
      path: `projects/p1/frames/${faked.writes[0]?.fileName}`,
      bytes: 4,
      width: 1920,
      height: 1080,
    })
  })

  it('full keeps every render: the same frame twice writes two files', async () => {
    const { environment, faked } = fakeEnvironment()
    const plan = { ...SINGLE, frame: 42, full: true }
    const first = await renderFramePlan(plan, environment)
    const second = await renderFramePlan(plan, environment)
    if (!('result' in first) || !('result' in second)) throw new Error('expected results')
    expect(faked.writes).toHaveLength(2)
    expect(faked.writes[0]?.fileName).not.toBe(faked.writes[1]?.fileName)
    expect('path' in first.result && 'path' in second.result && first.result.path).not.toBe(
      'path' in second.result ? second.result.path : undefined,
    )
  })

  it('accepts the last frame and refuses one past it, naming frame', async () => {
    const { environment, faked } = fakeEnvironment()
    expect('result' in await renderFramePlan({ ...SINGLE, frame: 299 }, environment)).toBe(true)
    const refused = await renderFramePlan({ ...SINGLE, frame: 300 }, environment)
    expect('error' in refused).toBe(true)
    if (!('error' in refused)) return
    expect(refused.error.code).toBe('INVALID_ARGUMENT')
    expect(refused.error.argument).toBe('frame')
    expect(refused.error.message).toContain('0 to 299')
    expect(faked.renders.length).toBe(1) // the refused frame never reaches the renderer
  })

  it('refuses every frame of an empty timeline', async () => {
    const { environment } = fakeEnvironment({
      sequence: () => ({ projectId: 'p1', frames: 0, width: 1920, height: 1080 }),
    })
    const answer = await renderFramePlan(SINGLE, environment)
    if (!('error' in answer)) throw new Error('expected an error')
    expect(answer.error.code).toBe('INVALID_ARGUMENT')
    expect(answer.error.argument).toBe('frame')
    expect(answer.error.hint).toContain('timeline is empty')
  })

  it('answers NOT_FOUND when no project is open', async () => {
    const { environment } = fakeEnvironment({
      sequence: () => ({ projectId: null, frames: 0, width: 0, height: 0 }),
    })
    const answer = await renderFramePlan(SINGLE, environment)
    if (!('error' in answer)) throw new Error('expected an error')
    expect(answer.error.code).toBe('NOT_FOUND')
    expect(answer.error.message).toContain('no project is open')
  })
})

describe('renderFramePlan: a contact sheet', () => {
  const SHEET: ContactSheetPlan = {
    kind: 'sheet',
    frames: [0, 10, 20, 30, 40, 50],
    columns: 3,
    rows: 2,
    width: 1280,
    full: false,
  }

  it('full writes the sheet into the frames folder and answers its path, one file per render', async () => {
    const { environment, faked } = fakeEnvironment()
    const plan = { ...SHEET, full: true }
    const first = await renderFramePlan(plan, environment)
    const second = await renderFramePlan(plan, environment)
    if (!('result' in first) || !('result' in second)) throw new Error('expected results')
    expect(faked.writes).toHaveLength(2)
    expect(faked.writes[0]).toMatchObject({ projectId: 'p1', bytes: 7 })
    expect(faked.writes[0]?.fileName).toMatch(/^frame-0-[0-9a-z]+-\d+\.png$/)
    expect(faked.writes[0]?.fileName).not.toBe(faked.writes[1]?.fileName)
    expect('png' in first.result).toBe(false)
    expect(first.result).toMatchObject({ bytes: 7, width: 1278, height: 480 })
    if (!('path' in first.result)) throw new Error('expected a path')
    expect(first.result.path).toMatch(/^projects\/p1\/frames\/frame-0-/)
  })

  it('tiles six frames as 3 × 2 cells of a 1278 × 480 sheet', async () => {
    const { environment, faked } = fakeEnvironment()
    const answer = await renderFramePlan(SHEET, environment)
    expect(faked.renders).toEqual([{ frames: [0, 10, 20, 30, 40, 50], width: 426, height: 240 }])
    expect(faked.compositions).toEqual([
      { cells: 6, columns: 3, rows: 2, cellWidth: 426, cellHeight: 240 },
    ])
    if (!('result' in answer)) throw new Error('expected a result')
    expect(answer.result).toMatchObject({ bytes: 7, width: 1278, height: 480 })
    if (!('png' in answer.result)) throw new Error('expected base64')
    expect(answer.result.png).toBe(btoa('\u0001\u0002\u0003\u0004\u0005\u0006\u0007'))
  })

  it('shrinks a tall grid so the sheet’s long edge is the requested width', async () => {
    const { environment, faked } = fakeEnvironment({
      sequence: () => ({ projectId: 'p1', frames: 300, width: 1080, height: 1920 }),
    })
    const answer = await renderFramePlan(SHEET, environment)
    expect(faked.renders[0]).toMatchObject({ width: 360, height: 640 })
    expect(faked.compositions[0]).toMatchObject({ cellWidth: 360, cellHeight: 640 })
    if (!('result' in answer)) throw new Error('expected a result')
    expect(answer.result).toMatchObject({ width: 1080, height: 1280 })
  })

  it('refuses a sampled frame past the timeline, naming contactSheet', async () => {
    const { environment, faked } = fakeEnvironment()
    const answer = await renderFramePlan({ ...SHEET, frames: [0, 400] }, environment)
    if (!('error' in answer)) throw new Error('expected an error')
    expect(answer.error.code).toBe('INVALID_ARGUMENT')
    expect(answer.error.argument).toBe('contactSheet')
    expect(faked.renders).toHaveLength(0)
  })
})

describe('renderFramePlan: failures', () => {
  it('reports a renderer that answers the wrong number of PNGs', async () => {
    const { environment } = fakeEnvironment({
      render: () => Promise.resolve([pngBlob()]),
    })
    const answer = await renderFramePlan(
      { kind: 'sheet', frames: [0, 1], columns: 2, rows: 1, width: 1280, full: false },
      environment,
    )
    if (!('error' in answer)) throw new Error('expected an error')
    expect(answer.error.code).toBe('INTERNAL')
    expect(answer.error.message).toContain('1 PNGs for 2 sampled frames')
  })

  it('turns a thrown error into an INTERNAL StudioError JSON', async () => {
    const { environment } = fakeEnvironment({
      render: () => Promise.reject(new Error('the media is gone')),
    })
    const answer = await renderFramePlan(SINGLE, environment)
    if (!('error' in answer)) throw new Error('expected an error')
    expect(answer.error.name).toBe('StudioError')
    expect(answer.error.code).toBe('INTERNAL')
    expect(answer.error.message).toBe('the media is gone')
  })

  it('turns a StudioError into its JSON, code and argument kept', async () => {
    const { environment } = fakeEnvironment({
      render: () => Promise.reject(Object.assign(new Error('frame: no workspace folder'), {
        name: 'StudioError',
        toJSON: () => ({
          name: 'StudioError',
          code: 'UNSUPPORTED',
          message: 'frame: no workspace folder is open, so the PNG has nowhere to go',
        }),
      })),
    })
    const answer = await renderFramePlan({ ...SINGLE, full: true }, environment)
    if (!('error' in answer)) throw new Error('expected an error')
    expect(answer.error.code).toBe('UNSUPPORTED')
    expect(answer.error.message).toContain('no workspace folder')
  })
})

describe('installAgentFrame', () => {
  it('puts render() on the page global, answering a typed error without a project', async () => {
    const installed = installAgentFrame()
    expect(globalThis.studioAgentFrame).toBe(installed)
    const answer = await installed.render(SINGLE)
    expect('error' in answer).toBe(true)
    if (!('error' in answer)) return
    expect(answer.error.name).toBe('StudioError')
  })
})
