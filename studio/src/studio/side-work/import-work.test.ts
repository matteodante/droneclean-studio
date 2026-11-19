import { describe, expect, it, vi } from 'vite-plus/test'
import { createImportWork, type ImportWorkOptions } from './import-work'
import { SideWorkScheduler, type JobSpec } from './scheduler'

interface Clip {
  id: string
  video?: boolean
  gyro?: boolean
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const six: Clip[] = ['0019', '0020', '0021', '0022', '0023', '0024'].map((id) => ({
  id,
  gyro: true,
}))

/** Runners that finish when the test says so, and remember what started in which order. */
function gatedRunners() {
  const started: string[] = []
  const gates = new Map<string, () => void>()
  const gated = (kind: string) => (clip: Clip) => {
    started.push(`${kind}:${clip.id}`)
    return new Promise<void>((resolve) => gates.set(`${kind}:${clip.id}`, resolve))
  }
  return {
    started,
    gates,
    release: (name: string) => gates.get(name)?.(),
    runners: { filmstrip: gated('filmstrip'), motionData: gated('motion') },
  }
}

function options(
  scheduler: SideWorkScheduler,
  runners: ImportWorkOptions<Clip>['runners'],
  extra: Partial<ImportWorkOptions<Clip>> = {},
): ImportWorkOptions<Clip> {
  return {
    scheduler,
    runners,
    isVideo: (clip) => clip.video !== false,
    canStabilize: (clip) => clip.gyro === true,
    wantsFilmstrips: () => true,
    nameOf: (clip) => clip.id,
    ...extra,
  }
}

/** A scheduler that only records what is queued, so a test reads the jobs and not their running. */
function recordingScheduler() {
  const specs: JobSpec[] = []
  const scheduler = {
    run: vi.fn((spec: JobSpec) => {
      specs.push(spec)
      return new Promise<never>(() => {})
    }),
  } as unknown as SideWorkScheduler
  return { scheduler, specs }
}

const summary = (specs: JobSpec[]) =>
  specs.map((spec) => `${spec.label} ${spec.lane}/${spec.priority}`)

describe('queueing the work of an import', () => {
  it('queues, for six clips, the first one interactive and the other five at import priority', () => {
    const { scheduler, specs } = recordingScheduler()
    const work = createImportWork(options(scheduler, gatedRunners().runners))
    for (const clip of six) work.queue(clip)

    expect(summary(specs)).toEqual([
      'filmstrip:0019 decode/interactive',
      'motion-data:0019 motion/interactive',
      ...six
        .slice(1)
        .flatMap((clip) => [
          `filmstrip:${clip.id} decode/import`,
          `motion-data:${clip.id} motion/import`,
        ]),
    ])
    expect(specs).toHaveLength(12)
  })

  it('gives a clip without gyro data no motion job, and leaves out filmstrips the user switched off', () => {
    const { scheduler, specs } = recordingScheduler()
    const work = createImportWork(
      options(scheduler, gatedRunners().runners, {
        wantsFilmstrips: () => false,
      }),
    )
    work.queue({ id: 'phone', gyro: false })
    work.queue({ id: 'dji', gyro: true })
    // The phone clip has no job, so the DJI clip is the first one with work: interactive
    expect(summary(specs)).toEqual(['motion-data:dji motion/interactive'])

    const second = recordingScheduler()
    const withFilmstrips = createImportWork(options(second.scheduler, gatedRunners().runners))
    withFilmstrips.queue({ id: 'phone', gyro: false })
    expect(summary(second.specs)).toEqual(['filmstrip:phone decode/interactive'])
  })

  it('queues nothing for a file that is not a video', () => {
    const { scheduler, specs } = recordingScheduler()
    const work = createImportWork(options(scheduler, gatedRunners().runners))
    work.queue({ id: 'song', video: false })
    expect(specs).toEqual([])
  })

  it('numbers the clips so a lane takes them in the order they were imported', () => {
    const { scheduler, specs } = recordingScheduler()
    const work = createImportWork(options(scheduler, gatedRunners().runners))
    for (const clip of six) work.queue(clip)
    const filmstrips = specs.filter((spec) => spec.lane === 'decode')
    expect(filmstrips.map((spec) => spec.order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('treats the next clip as first once the earlier clips have no work left', async () => {
    const real = new SideWorkScheduler()
    const priorities: string[] = []
    const run = real.run.bind(real)
    real.run = ((spec: JobSpec, work: Parameters<typeof run>[1]) => {
      if (spec.lane === 'motion') priorities.push(`${spec.label} ${spec.priority}`)
      return run(spec, work)
    }) as typeof real.run
    const fast = { filmstrip: async () => {}, motionData: async () => {} }
    const work = createImportWork(options(real, fast))
    work.queue(six[0]!)
    work.queue(six[1]!)
    await work.idle()
    work.queue(six[2]!)
    await work.idle()
    expect(priorities).toEqual([
      'motion-data:0019 interactive',
      'motion-data:0020 import',
      'motion-data:0021 interactive',
    ])
  })
})

describe('running the work through a real scheduler', () => {
  it('starts the first clip first in each lane, then the others in import order', async () => {
    const scheduler = new SideWorkScheduler({ decode: 1, motion: 1 })
    const gate = gatedRunners()
    const work = createImportWork(options(scheduler, gate.runners))
    for (const clip of six) work.queue(clip)
    await tick()

    expect(gate.started).toEqual(['filmstrip:0019', 'motion:0019'])

    gate.release('filmstrip:0019')
    await tick()
    gate.release('motion:0019')
    await tick()
    expect(gate.started).toEqual(['filmstrip:0019', 'motion:0019', 'filmstrip:0020', 'motion:0020'])

    const finish = async (name: string) => {
      for (let i = 0; i < 50 && !gate.gates.has(name); i++) await tick()
      gate.release(name)
      await tick()
    }
    for (const id of ['0020', '0021', '0022', '0023', '0024']) {
      await finish(`filmstrip:${id}`)
      await finish(`motion:${id}`)
    }
    expect(gate.started.filter((name) => name.startsWith('filmstrip'))).toEqual(
      six.map((clip) => `filmstrip:${clip.id}`),
    )
    expect(gate.started.filter((name) => name.startsWith('motion'))).toEqual(
      six.map((clip) => `motion:${clip.id}`),
    )
    await work.idle()
  })

  it('does not start import work while the pilot plays, but still starts the first clip', async () => {
    const scheduler = new SideWorkScheduler({ decode: 2, motion: 2 })
    const release = scheduler.hold('playback')
    const gate = gatedRunners()
    const work = createImportWork(options(scheduler, gate.runners))
    work.queue(six[0]!)
    work.queue(six[1]!)
    await tick()
    expect(gate.started).toEqual(['filmstrip:0019', 'motion:0019'])
    release()
    await tick()
    expect(gate.started).toEqual(['filmstrip:0019', 'motion:0019', 'filmstrip:0020', 'motion:0020'])
  })

  it('logs a job that fails and goes on with the others', async () => {
    const scheduler = new SideWorkScheduler()
    const ran: string[] = []
    const work = createImportWork(
      options(scheduler, {
        filmstrip: async (clip) => {
          ran.push(`filmstrip:${clip.id}`)
          throw new Error('no decoder')
        },
        motionData: async (clip) => {
          ran.push(`motion:${clip.id}`)
        },
      }),
    )
    work.queue(six[0]!)
    await work.idle()
    expect(ran.sort()).toEqual(['filmstrip:0019', 'motion:0019'])
  })
})
