// 10. Import side work: the six clips of 15 Nov dropped on the library (the editor's own drop path, as measurement 6),
// then the work an import leads to, each timed on its own and then all at once:
//   probing and thumbnails (inside the import call), filmstrips, proxies, the clips' motion data (gyro engine open),
//   and the recompute after a stabilization setting (clip 0020). Waveforms: the clips carry no audio, so the editor
//   starts none (checked with ffprobe and the library's own audioCodec).
// Every phase has the machine's load during it (the bench sampler). Needs the built gyro package for the motion
// data (gyroflow/wasm/build.sh); without it the motion phases say so and the rest runs.
//
// Environment: BENCH_SIDE_WORK_CLIPS=N limits the clips of the side work (not the import; for a quick try),
// BENCH_SIDE_WORK_SKIP=proxies,together leaves phases out.
import path from 'node:path'
import { openBenchPage } from '../lib/browser.mjs'
import { resolveImportClips } from '../lib/imports.mjs'
import {
  browserCpuSeconds,
  busyCoresOf,
  copyGyroPackage,
  loadOf,
  probeStreamTypes,
  summariseSideWork,
} from '../lib/side-work.mjs'

export const name = 'import-side-work'

async function dropFiles(context, page, files) {
  const cdp = await context.newCDPSession(page)
  const data = { items: [], files, dragOperationsMask: 1 }
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', {
      type,
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
      data,
    })
  }
}

function skipSet() {
  return new Set(
    (process.env.BENCH_SIDE_WORK_SKIP ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

/** A fresh browser, the clips imported by the drop path. The sampler window of the import is returned. */
async function openAndImport(ctx, clips) {
  const run = await openBenchPage({
    cache: ctx.config.cache,
    media: {},
    pagePath: '/bench/page/side-work.html',
    requireGpu: false,
  })
  const gyro = copyGyroPackage(path.join(ctx.config.cache, 'page-dist'))
  await run.page.evaluate(() => window.benchImport.prepare())
  const since = ctx.sampler.now()
  await dropFiles(
    run.context,
    run.page,
    clips.map((clip) => clip.path),
  )
  await run.page.waitForFunction(
    () => ['done', 'failed'].includes(window.benchImport?.getState().phase),
    null,
    { timeout: 180_000 },
  )
  const until = ctx.sampler.now()
  const state = await run.page.evaluate(() => window.benchImport.getState())
  if (state.phase === 'failed') {
    await run.close()
    throw new Error(`the import failed: ${state.error}`)
  }
  return { run, gyro, state, window: { since, until } }
}

/** Run something in the page and say how loaded the machine and the browser were meanwhile. */
async function withLoad(ctx, run, work) {
  const since = ctx.sampler.now()
  const cpuBefore = browserCpuSeconds(run.profileDir)
  const wallStart = performance.now()
  const result = await work()
  const wallSeconds = (performance.now() - wallStart) / 1000
  const cpuAfter = browserCpuSeconds(run.profileDir)
  const until = ctx.sampler.now()
  return {
    result,
    load: {
      ...loadOf(ctx.sampler.summarise({ since, until })),
      browserCpuSeconds:
        cpuBefore == null || cpuAfter == null
          ? null
          : Math.round((cpuAfter - cpuBefore) * 100) / 100,
      browserBusyCores: busyCoresOf(cpuBefore, cpuAfter, wallSeconds),
    },
  }
}

async function timedPhase(ctx, run, phase, clipLimit) {
  const { result, load } = await withLoad(ctx, run, () =>
    run.page.evaluate(([p, limit]) => window.benchSideWork.runPhase(p, limit), [phase, clipLimit]),
  )
  return { ...result, load }
}

export async function measure(ctx) {
  const clips = resolveImportClips(ctx.config.importDir)
  const skip = skipSet()
  const clipLimit = process.env.BENCH_SIDE_WORK_CLIPS
    ? Number(process.env.BENCH_SIDE_WORK_CLIPS)
    : undefined
  const streams = clips.map((clip) => ({
    fileName: clip.fileName,
    ...probeStreamTypes(clip.path),
  }))

  // The machine before anything of ours runs: other programs' load, to read the phases' numbers against.
  const idleSince = ctx.sampler.now()
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const idleMachine = loadOf(ctx.sampler.summarise({ since: idleSince, until: ctx.sampler.now() }))

  // ---- run A: import, then each kind alone, one after another
  const a = await openAndImport(ctx, clips)
  const phases = {}
  let motion = null
  let browser
  let library
  try {
    browser = { chromeVersion: a.run.chromeVersion }
    library = await a.run.page.evaluate(() => ({
      clips: window.benchSideWork.clips(),
      hardwareConcurrency: window.benchSideWork.hardwareConcurrency(),
    }))
    const importLoad = loadOf(ctx.sampler.summarise(a.window))
    const importSeconds = a.state.totalSeconds
    const kinds = [
      ['filmstrips', 'filmstrips'],
      ['proxies', 'proxies'],
      ['motion-data', 'motion-data'],
    ]
    for (const [kind, phase] of kinds) {
      if (skip.has(kind)) {
        phases[kind] = {
          ran: false,
          reason: `left out by BENCH_SIDE_WORK_SKIP`,
        }
        continue
      }
      if (kind === 'motion-data' && !a.gyro.available) {
        phases[kind] = { ran: false, reason: a.gyro.reason }
        continue
      }
      console.log(`   phase ${phase} (alone)`)
      phases[kind] = {
        ran: true,
        ...(await timedPhase(ctx, a.run, phase, clipLimit)),
      }
    }
    phases.filmstripMetrics = await a.run.page.evaluate(() =>
      window.benchSideWork.filmstripMetrics(),
    )
    if (a.gyro.available && !skip.has('motion-data')) {
      console.log('   gyro open and recompute on clip 0020')
      const clip0020 = library.clips.find((c) => c.fileName.includes('_0020_'))
      const { result, load } = await withLoad(ctx, a.run, () =>
        a.run.page.evaluate((id) => window.benchSideWork.motionRecompute(id), clip0020.id),
      )
      motion = { ...result, load }
    }
    phases.import = {
      seconds: importSeconds,
      perClip: a.state.timings,
      load: importLoad,
    }
  } finally {
    await a.run.close()
  }

  // ---- run B: a fresh browser, everything started at once
  let together = { ran: false, reason: 'left out by BENCH_SIDE_WORK_SKIP' }
  if (!skip.has('together')) {
    const b = await openAndImport(ctx, clips)
    try {
      console.log('   phase together (all kinds at once)')
      together = {
        ran: true,
        gyroAvailable: b.gyro.available,
        ...(await timedPhase(ctx, b.run, 'together', clipLimit)),
      }
    } finally {
      await b.run.close()
    }
  }

  const kindSeconds = Object.fromEntries(
    ['filmstrips', 'proxies', 'motion-data']
      .filter((k) => phases[k]?.ran)
      .map((k) => [k, phases[k].seconds]),
  )
  return {
    ...(await ctx.header(name, {
      importFolder: ctx.config.importDir,
      clips: clips.map((c) => ({ fileName: c.fileName, bytes: c.bytes })),
    })),
    browser: { ...browser, webgpuAdapter: null },
    parameters: {
      how: "the app's own drop path, then filmstripCache.getFilmstrip, proxyService.generateProxy and createStabilizationClient().open for the clips left in the library; each phase starts every clip at once and the editor's own queues decide what runs together (the motion data is the exception: one clip after another, an engine each, because six engines at once hold about 10 GB)",
      clipLimit: clipLimit ?? null,
      skipped: [...skip],
      workspace: 'OPFS directory (as measurement 6)',
    },
    result: {
      hardwareConcurrency: library?.hardwareConcurrency,
      idleMachineBeforeRun: idleMachine,
      audio: {
        streams,
        anyClipHasAudio: streams.some((s) => s.hasAudio),
        libraryAudioCodecs: library?.clips.map((c) => c.audioCodec),
        waveformJobs: 'none: no clip has an audio track, so the editor starts no waveform job',
      },
      library: library?.clips,
      phases,
      motionRecompute: motion,
      together,
      summary: summariseSideWork({
        importSeconds: phases.import.seconds,
        kindSeconds,
        togetherSeconds: together.ran ? together.seconds : null,
      }),
      notReached: [
        'probing and thumbnails are inside the import call and are not timed apart',
        'preview audio conform and waveform generation (no audio on these clips)',
        'a second run: one run per figure, read machineBusyAtStart',
      ],
    },
  }
}
