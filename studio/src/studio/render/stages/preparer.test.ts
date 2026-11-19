import { describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { createDerivedSizeStore, derivedSizeKey } from './derived-sizes'
import { createPreparer } from './preparer'
import { createStageRegistry } from './registry'
import { StageError, type SourceStage, type StageId } from './types'

const DEVICE = {} as GPUDevice

function video(id: string, extra: Record<string, unknown> = {}): VideoItem {
  return { id, type: 'video', label: id, mediaId: 'm', ...extra } as unknown as VideoItem
}

/** A stage active for items with the flag of its own name; `prepare` is the test's to hold and settle */
function stage(id: StageId, scope: SourceStage['scope'], flag: string) {
  const prepares: Array<{ item: VideoItem; resolve: () => void; reject: (e: Error) => void }> = []
  const release = vi.fn(async (_key: string) => undefined)
  const built: SourceStage = {
    id,
    scope,
    active: (item) => (item as unknown as Record<string, unknown>)[flag] !== undefined,
    key: (item) => String((item as unknown as Record<string, unknown>)[flag]),
    outputSize: (_item, input) => input,
    prepare: (item) =>
      new Promise<void>((resolve, reject) => {
        prepares.push({ item, resolve, reject })
      }),
    ready: () => true,
    encode: () => {},
    release,
  }
  return { built, prepares, release }
}

function setup() {
  const sizes = createDerivedSizeStore()
  const a = stage('stabilize', 'source-frame', 'stab')
  const b = stage('input-colour', 'source-frame', 'col')
  const c = stage('look', 'output-frame', 'lk')
  const registry = createStageRegistry([a.built, b.built, c.built])
  const preparer = createPreparer({ registry, sizes, getDevice: async () => DEVICE })
  return { sizes, a, b, c, preparer }
}

const items = (...list: VideoItem[]): TimelineItem[] => list

describe('the preparer', () => {
  it('prepares each (stage, key) once however many clips use it', async () => {
    const { a, preparer } = setup()
    await preparer.sync(items(video('x', { stab: 'k1' }), video('y', { stab: 'k1' })))
    expect(a.prepares).toHaveLength(1)
    await preparer.sync(items(video('x', { stab: 'k1' }), video('y', { stab: 'k1' })))
    expect(a.prepares).toHaveLength(1)
  })

  it('tracks preparing, ready and failed, and announces each change', async () => {
    const { a, preparer } = setup()
    const heard: string[] = []
    preparer.subscribe((key) => heard.push(key))
    const clip = video('x', { stab: 'k1' })
    await preparer.sync(items(clip))
    expect(preparer.statusOf(clip, 'stabilize')).toEqual({ status: 'preparing' })
    a.prepares[0]!.resolve()
    await vi.waitFor(() =>
      expect(preparer.statusOf(clip, 'stabilize')).toEqual({ status: 'ready' }),
    )
    expect(heard.every((key) => key === derivedSizeKey('stabilize', 'k1'))).toBe(true)

    const bad = video('y', { stab: 'k2' })
    await preparer.sync(items(clip, bad))
    a.prepares[1]!.reject(new Error('no motion data'))
    await vi.waitFor(() => expect(preparer.statusOf(bad, 'stabilize')?.status).toBe('failed'))
    const state = preparer.statusOf(bad, 'stabilize')
    expect(state?.status === 'failed' && state.error).toBeInstanceOf(StageError)
  })

  it('does not retry a failure on every change; Retry does, and new settings are a new key', async () => {
    const { a, preparer } = setup()
    const clip = video('x', { stab: 'k1' })
    await preparer.sync(items(clip))
    a.prepares[0]!.reject(new Error('boom'))
    await vi.waitFor(() => expect(preparer.statusOf(clip, 'stabilize')?.status).toBe('failed'))
    await preparer.sync(items(clip, video('other')))
    expect(a.prepares).toHaveLength(1)
    await preparer.retry(clip)
    expect(a.prepares).toHaveLength(2)
    await preparer.sync(items(video('x', { stab: 'k2' })))
    expect(a.prepares).toHaveLength(3)
  })

  it('releases the old key and forgets its size when no clip wants it, after starting the new one', async () => {
    const { a, sizes, preparer } = setup()
    const order: string[] = []
    const prepare = a.built.prepare
    a.built.prepare = (item, device) => {
      order.push(`prepare ${a.built.key(item)}`)
      return prepare(item, device)
    }
    a.release.mockImplementation(async (key: string) => {
      order.push(`release ${key}`)
    })
    await preparer.sync(items(video('x', { stab: 'k1' })))
    sizes.set(derivedSizeKey('stabilize', 'k1'), { width: 10, height: 10 })
    await preparer.sync(items(video('x', { stab: 'k2' })))
    expect(order).toEqual(['prepare k1', 'prepare k2', 'release k1'])
    expect(sizes.get(derivedSizeKey('stabilize', 'k1'))).toBeUndefined()
    await preparer.sync([])
    expect(a.release).toHaveBeenCalledWith('k2')
  })

  it('prepares every active stage of a clip, and nothing for a clip with none', async () => {
    const { a, b, c, preparer } = setup()
    await preparer.sync(items(video('x', { stab: 's', col: 'dlog', lk: 'warm' }), video('plain')))
    expect([a.prepares.length, b.prepares.length, c.prepares.length]).toEqual([1, 1, 1])
  })

  it('prepares nothing until a device is known, then does', async () => {
    const sizes = createDerivedSizeStore()
    const a = stage('stabilize', 'source-frame', 'stab')
    const b = stage('input-colour', 'source-frame', 'col')
    const c = stage('look', 'output-frame', 'lk')
    let device: GPUDevice | undefined
    const preparer = createPreparer({
      registry: createStageRegistry([a.built, b.built, c.built]),
      sizes,
      getDevice: async () => device,
    })
    const list = items(video('x', { stab: 'k' }))
    await preparer.sync(list)
    expect(a.prepares).toHaveLength(0)
    device = DEVICE
    await preparer.sync(list)
    expect(a.prepares).toHaveLength(1)
  })

  it('prepareAll waits for every stage and throws the first StageError, for an export before frame 0', async () => {
    const { a, b, preparer } = setup()
    const list = items(video('x', { stab: 'k', col: 'dlog' }))
    const all = preparer.prepareAll(list, DEVICE)
    let done = false
    void all.then(
      () => (done = true),
      () => (done = true),
    )
    a.prepares[0]!.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    b.prepares[0]!.reject(new StageError({ clip: 'x', stage: 'input-colour', reason: 'no pass' }))
    await expect(all).rejects.toThrow(/Clip 'x', input colour: no pass/)
  })

  it('ensure starts what was never started, on the device it is given, and neither retries a failure nor releases', async () => {
    const { a, b, preparer } = setup()
    const kept = video('x', { stab: 'k1' })
    await preparer.sync(items(kept))
    a.prepares[0]!.reject(new Error('no motion data'))
    await vi.waitFor(() => expect(preparer.statusOf(kept, 'stabilize')?.status).toBe('failed'))

    preparer.ensure(items(kept, video('y', { col: 'dlog-m' })), DEVICE)

    expect(a.prepares).toHaveLength(1)
    expect(a.release).not.toHaveBeenCalled()
    expect(b.prepares).toHaveLength(1)
    expect(preparer.statusOf(kept, 'stabilize')?.status).toBe('failed')
  })

  it('a clip with no usable key is a failed state of its own, not a crash', async () => {
    const sizes = createDerivedSizeStore()
    const a = stage('stabilize', 'source-frame', 'stab')
    a.built.key = () => {
      throw new Error('no file')
    }
    const registry = createStageRegistry([
      a.built,
      stage('input-colour', 'source-frame', 'col').built,
      stage('look', 'output-frame', 'lk').built,
    ])
    const preparer = createPreparer({ registry, sizes, getDevice: async () => DEVICE })
    const clip = video('x', { stab: 'k' })
    await preparer.sync(items(clip))
    expect(preparer.statusOf(clip, 'stabilize')?.status).toBe('failed')
    expect(a.prepares).toHaveLength(0)
  })

  it('start follows the watched items', async () => {
    const sizes = createDerivedSizeStore()
    const a = stage('stabilize', 'source-frame', 'stab')
    let listener: ((items: readonly TimelineItem[]) => void) | undefined
    const stop = vi.fn()
    const preparer = createPreparer({
      registry: createStageRegistry([
        a.built,
        stage('input-colour', 'source-frame', 'col').built,
        stage('look', 'output-frame', 'lk').built,
      ]),
      sizes,
      getDevice: async () => DEVICE,
      watchItems: async (l) => {
        listener = l
        return stop
      },
    })
    expect(await preparer.start()).toBe(stop)
    listener!(items(video('x', { stab: 'k' })))
    await vi.waitFor(() => expect(a.prepares).toHaveLength(1))
  })
})
