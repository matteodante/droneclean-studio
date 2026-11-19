// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { Subclip } from './model'
import { createPosterService, type PosterDeps } from './poster'

const subclip: Subclip = {
  id: 's1',
  mediaId: 'm1',
  name: 'A',
  startFrame: 90,
  endFrame: 300,
  sourceFps: 30,
  createdAt: 0,
}

function makeDeps(overrides: Partial<PosterDeps> = {}): PosterDeps {
  let counter = 0
  return {
    getFile: vi.fn(async () => new Blob(['x'])),
    generate: vi.fn(async () => new Blob(['poster'])),
    createUrl: vi.fn(() => `blob:poster-${++counter}`),
    revokeUrl: vi.fn(),
    ...overrides,
  }
}

describe('subclip poster service', () => {
  it('cuts the frame at the first frame of the range, in seconds of the parent', async () => {
    const deps = makeDeps()
    const posters = createPosterService(deps)
    expect(await posters.getPosterUrl(subclip)).toBe('blob:poster-1')
    expect(deps.getFile).toHaveBeenCalledWith('m1')
    expect(deps.generate).toHaveBeenCalledWith(expect.any(Blob), { timestamp: 3 })
  })

  it('uses the exact rate: frame 60 at 59.94 is 1.001 s', async () => {
    const deps = makeDeps()
    const posters = createPosterService(deps)
    await posters.getPosterUrl({ ...subclip, startFrame: 60, sourceFps: 59.94 })
    expect(deps.generate).toHaveBeenCalledWith(expect.any(Blob), { timestamp: 1.001 })
  })

  it('generates once for a range, also when asked twice at the same time', async () => {
    const deps = makeDeps()
    const posters = createPosterService(deps)
    const [a, b] = await Promise.all([posters.getPosterUrl(subclip), posters.getPosterUrl(subclip)])
    expect(a).toBe(b)
    await posters.getPosterUrl(subclip)
    expect(deps.generate).toHaveBeenCalledTimes(1)
  })

  it('makes a new poster when the range moved, and frees the old one', async () => {
    const deps = makeDeps()
    const posters = createPosterService(deps)
    const first = await posters.getPosterUrl(subclip)
    const second = await posters.getPosterUrl({ ...subclip, startFrame: 120 })
    expect(second).not.toBe(first)
    expect(deps.revokeUrl).toHaveBeenCalledWith(first)
  })

  it('answers null when the file has no readable bytes, so the caller shows the parent thumbnail', async () => {
    const deps = makeDeps({ getFile: vi.fn(async () => null) })
    const posters = createPosterService(deps)
    expect(await posters.getPosterUrl(subclip)).toBeNull()
    expect(deps.generate).not.toHaveBeenCalled()
  })

  it('answers null when the frame cannot be decoded, and tries again next time', async () => {
    const generate = vi
      .fn<PosterDeps['generate']>()
      .mockRejectedValueOnce(new Error('no frame'))
      .mockResolvedValue(new Blob(['ok']))
    const posters = createPosterService(makeDeps({ generate }))
    expect(await posters.getPosterUrl(subclip)).toBeNull()
    expect(await posters.getPosterUrl(subclip)).toBe('blob:poster-1')
  })

  it('release frees one poster and clear frees all', async () => {
    const deps = makeDeps()
    const posters = createPosterService(deps)
    const a = await posters.getPosterUrl(subclip)
    const b = await posters.getPosterUrl({ ...subclip, id: 's2' })
    posters.release('s1')
    expect(deps.revokeUrl).toHaveBeenCalledWith(a)
    posters.clear()
    expect(deps.revokeUrl).toHaveBeenCalledWith(b)
  })

  it('decodes one poster at a time', async () => {
    let running = 0
    let peak = 0
    const generate = vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return new Blob(['p'])
    })
    const posters = createPosterService(makeDeps({ generate }))
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((id) => posters.getPosterUrl({ ...subclip, id })),
    )
    expect(generate).toHaveBeenCalledTimes(4)
    expect(peak).toBe(1)
  })
})
