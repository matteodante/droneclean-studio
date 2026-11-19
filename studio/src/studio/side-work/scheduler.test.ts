import { describe, expect, it } from 'vite-plus/test'
import {
  cpuLaneWidth,
  decodeLaneWidth,
  JobCancelledError,
  motionLaneWidth,
  SideWorkScheduler,
  type JobContext,
} from './scheduler'

/** A job the test finishes by hand. */
function manual() {
  let finish: (value?: string) => void = () => {}
  let context: JobContext | null = null
  const started: string[] = []
  const work = (name: string) => (ctx: JobContext) => {
    started.push(name)
    context = ctx
    return new Promise<string>((resolve) => {
      finish = () => resolve(name)
    })
  }
  return { work, finish: () => finish(), started, context: () => context }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('lane width', () => {
  it('runs at most `width` jobs of one priority at once', async () => {
    const scheduler = new SideWorkScheduler({ decode: 2 })
    const gates: Array<() => void> = []
    const started: number[] = []
    const jobs = [0, 1, 2, 3].map((i) =>
      scheduler.run({ lane: 'decode', priority: 'import' }, () => {
        started.push(i)
        return new Promise<void>((resolve) => gates.push(resolve))
      }),
    )
    expect(started).toEqual([0, 1])
    expect(scheduler.stats().decode).toMatchObject({ running: 2, queued: 2, width: 2 })
    gates[0]!()
    await tick()
    expect(started).toEqual([0, 1, 2])
    gates[1]!()
    gates[2]!()
    await tick()
    gates[3]!()
    await Promise.all(jobs)
    expect(scheduler.stats().decode.running).toBe(0)
  })

  it('a wider lane starts the jobs that were waiting', async () => {
    const scheduler = new SideWorkScheduler({ transcode: 1 })
    const gate = manual()
    void scheduler.run({ lane: 'transcode', priority: 'background' }, gate.work('a'))
    void scheduler.run({ lane: 'transcode', priority: 'background' }, gate.work('b'))
    expect(gate.started).toEqual(['a'])
    let notified = 0
    scheduler.subscribe(() => notified++)
    scheduler.setWidth('transcode', 2)
    expect(gate.started).toEqual(['a', 'b'])
    expect(notified).toBeGreaterThan(0)
  })

  it('never has a width under 1, and reads a width given as a function each time', () => {
    let width = 3
    const scheduler = new SideWorkScheduler({ cpu: () => width })
    expect(scheduler.width('cpu')).toBe(3)
    width = 0
    expect(scheduler.width('cpu')).toBe(1)
    width = Number.NaN
    expect(scheduler.width('cpu')).toBe(1)
  })

  it('sizes the cpu lane by cores and memory, and the decode lane by cores', () => {
    expect(cpuLaneWidth(10, 8)).toBe(2)
    expect(cpuLaneWidth(10, 64)).toBe(8)
    expect(cpuLaneWidth(2, 64)).toBe(1)
    expect(cpuLaneWidth(4, 4)).toBe(1)
    expect(decodeLaneWidth(4)).toBe(2)
    expect(decodeLaneWidth(10)).toBe(3)
    expect(decodeLaneWidth(32)).toBe(4)
  })
})

describe('priority', () => {
  it('starts interactive before import before background, then by order, then in the order queued', async () => {
    const scheduler = new SideWorkScheduler({ cpu: 1 })
    const blocker = manual()
    const order: string[] = []
    const done = (name: string) => async () => {
      order.push(name)
    }
    void scheduler.run({ lane: 'cpu', priority: 'interactive' }, blocker.work('blocker'))
    const queued = [
      scheduler.run({ lane: 'cpu', priority: 'background' }, done('background')),
      scheduler.run({ lane: 'cpu', priority: 'import', order: 2 }, done('import-2')),
      scheduler.run({ lane: 'cpu', priority: 'import', order: 1 }, done('import-1')),
      scheduler.run({ lane: 'cpu', priority: 'import', order: 1 }, done('import-1b')),
      scheduler.run({ lane: 'cpu', priority: 'interactive' }, done('interactive')),
    ]
    blocker.finish()
    await Promise.all(queued)
    expect(order).toEqual(['interactive', 'import-1', 'import-1b', 'import-2', 'background'])
  })

  it('a running background job does not keep a more urgent job from starting', () => {
    const scheduler = new SideWorkScheduler({ transcode: 1 })
    const proxy = manual()
    const filmstrip = manual()
    void scheduler.run({ lane: 'transcode', priority: 'background' }, proxy.work('proxy'))
    void scheduler.run({ lane: 'transcode', priority: 'interactive' }, filmstrip.work('film'))
    expect(proxy.started).toEqual(['proxy'])
    expect(filmstrip.started).toEqual(['film'])
    expect(scheduler.stats().transcode.runningByPriority).toEqual({
      interactive: 1,
      import: 0,
      background: 1,
    })
  })

  it('a more urgent job running does keep a less urgent one waiting', () => {
    const scheduler = new SideWorkScheduler({ transcode: 1 })
    const a = manual()
    const b = manual()
    void scheduler.run({ lane: 'transcode', priority: 'interactive' }, a.work('a'))
    void scheduler.run({ lane: 'transcode', priority: 'background' }, b.work('b'))
    expect(b.started).toEqual([])
  })

  it('keeps the lanes apart', () => {
    const scheduler = new SideWorkScheduler({ transcode: 1, cpu: 1 })
    const a = manual()
    const b = manual()
    void scheduler.run({ lane: 'transcode', priority: 'import' }, a.work('a'))
    void scheduler.run({ lane: 'cpu', priority: 'import' }, b.work('b'))
    expect(a.started).toEqual(['a'])
    expect(b.started).toEqual(['b'])
  })
})

describe('yielding', () => {
  it('a held scheduler starts only interactive jobs and tells running jobs to yield', async () => {
    const scheduler = new SideWorkScheduler({ decode: 2 })
    const running = manual()
    const queuedImport = manual()
    const interactive = manual()
    void scheduler.run({ lane: 'decode', priority: 'import' }, running.work('running'))
    const release = scheduler.hold('playback')
    expect(scheduler.isHeld()).toBe(true)
    expect(running.context()?.shouldYield()).toBe(true)
    void scheduler.run({ lane: 'decode', priority: 'import' }, queuedImport.work('import'))
    void scheduler.run({ lane: 'decode', priority: 'interactive' }, interactive.work('now'))
    expect(queuedImport.started).toEqual([])
    expect(interactive.started).toEqual(['now'])
    expect(interactive.context()?.shouldYield()).toBe(false)
    interactive.finish()
    await tick()
    release()
    expect(scheduler.isHeld()).toBe(false)
    expect(queuedImport.started).toEqual(['import'])
    expect(running.context()?.shouldYield()).toBe(false)
  })

  it('holds are named: playback and export release separately, and a release counts once', () => {
    const scheduler = new SideWorkScheduler()
    scheduler.setHeld('playback', true)
    scheduler.setHeld('export', true)
    scheduler.setHeld('playback', false)
    expect(scheduler.isHeld()).toBe(true)
    scheduler.setHeld('export', false)
    expect(scheduler.isHeld()).toBe(false)
    const release = scheduler.hold('x')
    release()
    release()
    expect(scheduler.isHeld()).toBe(false)
  })

  it('a job is told to yield while a more urgent job waits in its lane, and not otherwise', () => {
    const scheduler = new SideWorkScheduler({ transcode: 1 })
    const proxy = manual()
    const other = manual()
    void scheduler.run({ lane: 'transcode', priority: 'import' }, proxy.work('proxy'))
    expect(proxy.context()?.shouldYield()).toBe(false)
    // an interactive job also starts at once (own priority class), so use a held lane to make it wait? No:
    // a more urgent job waits only when the lane is full of equally urgent ones.
    void scheduler.run({ lane: 'transcode', priority: 'interactive' }, other.work('other'))
    expect(other.started).toEqual(['other'])
    expect(proxy.context()?.shouldYield()).toBe(false)
    const second = manual()
    void scheduler.run({ lane: 'transcode', priority: 'interactive' }, second.work('second'))
    // the lane's one interactive slot is taken: `second` waits, and the import job should give way to it
    expect(second.started).toEqual([])
    expect(proxy.context()?.shouldYield()).toBe(true)
  })
})

describe('cancellation', () => {
  it('a job cancelled before it started never runs and rejects', async () => {
    const scheduler = new SideWorkScheduler({ cpu: 1 })
    const blocker = manual()
    void scheduler.run({ lane: 'cpu', priority: 'import' }, blocker.work('blocker'))
    const controller = new AbortController()
    const never = manual()
    const queued = scheduler.run(
      { lane: 'cpu', priority: 'import', signal: controller.signal },
      never.work('never'),
    )
    controller.abort()
    await expect(queued).rejects.toBeInstanceOf(JobCancelledError)
    blocker.finish()
    await tick()
    expect(never.started).toEqual([])
    expect(scheduler.stats().cpu).toMatchObject({ running: 0, queued: 0 })
  })

  it('a signal that is already aborted rejects at once', async () => {
    const scheduler = new SideWorkScheduler()
    const controller = new AbortController()
    controller.abort()
    await expect(
      scheduler.run({ lane: 'cpu', priority: 'import', signal: controller.signal }, async () => 1),
    ).rejects.toBeInstanceOf(JobCancelledError)
  })

  it('a running job gets the abort signal and keeps its slot until it settles', async () => {
    const scheduler = new SideWorkScheduler({ cpu: 1 })
    const controller = new AbortController()
    let seen: AbortSignal | null = null
    let finish: () => void = () => {}
    const running = scheduler.run(
      { lane: 'cpu', priority: 'import', signal: controller.signal },
      (ctx) => {
        seen = ctx.signal
        return new Promise<string>((resolve) => {
          finish = () => resolve('stopped')
        })
      },
    )
    const next = manual()
    void scheduler.run({ lane: 'cpu', priority: 'import' }, next.work('next'))
    controller.abort()
    expect(seen).not.toBeNull()
    expect((seen as unknown as AbortSignal).aborted).toBe(true)
    expect(next.started).toEqual([])
    finish()
    await expect(running).resolves.toBe('stopped')
    expect(next.started).toEqual(['next'])
  })

  it('a job that throws frees its slot and rejects', async () => {
    const scheduler = new SideWorkScheduler({ cpu: 1 })
    const failing = scheduler.run({ lane: 'cpu', priority: 'import' }, async () => {
      throw new Error('boom')
    })
    const after = manual()
    void scheduler.run({ lane: 'cpu', priority: 'import' }, after.work('after'))
    await expect(failing).rejects.toThrow('boom')
    await tick()
    expect(after.started).toEqual(['after'])
    after.finish()
    const sync = scheduler.run({ lane: 'cpu', priority: 'import' }, () => {
      throw new Error('sync boom')
    })
    await expect(sync).rejects.toThrow('sync boom')
  })
})

describe('motionLaneWidth', () => {
  it('allows one gyro open per 8 GB of memory, between 1 and 4', () => {
    expect(motionLaneWidth(4)).toBe(1)
    expect(motionLaneWidth(8)).toBe(1)
    expect(motionLaneWidth(16)).toBe(2)
    expect(motionLaneWidth(32)).toBe(4)
    expect(motionLaneWidth(128)).toBe(4)
    expect(motionLaneWidth(Number.NaN)).toBe(1)
  })
})
