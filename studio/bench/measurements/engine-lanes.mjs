// 11. Engine lanes (task 8.7, slice E1): how many parallel streams the media engine sustains on this machine, as the
// editor's own probe (`src/studio/side-work/engine-probe.ts`) measures them: hardware encode + decode ("transcode",
// what a proxy is), 1, 2, 3 ... streams at once, on synthetic 1080p frames. No footage and no file are needed. The probe is run RUNS times with the cache bypassed (its
// run-to-run spread), then once through the cache (it must answer from it, in no time).
//
// The probe's source file is loaded into a bare page with its types stripped (it imports nothing from the app), so the
// number is the one the app gets from the file itself, not from a copy.
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { openBenchPage } from '../lib/browser.mjs'
import { REPO_ROOT } from '../lib/config.mjs'

export const name = 'engine-lanes'

const RUNS = 5
const TIME_LIMIT_MS = 2000

export async function measure(ctx) {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'studio', 'side-work', 'engine-probe.ts'),
    'utf8',
  )
  const js = stripTypeScriptTypes(source, { mode: 'strip' })
  const run = await openBenchPage({
    cache: ctx.config.cache,
    media: {},
    pagePath: '/bench/page/side-work.html',
    requireGpu: false,
  })
  try {
    const out = await run.page.evaluate(
      async ({ code, runs }) => {
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
        const probe = await import(/* @vite-ignore */ url)
        try {
          localStorage.clear()
        } catch {
          // none
        }
        const measured = []
        for (let i = 0; i < runs; i++) measured.push(await probe.probeEngineLanes({ force: true }))
        const cached = await probe.probeEngineLanes()
        return {
          measured,
          cached,
          hardwareConcurrency: navigator.hardwareConcurrency,
          userAgent: navigator.userAgent,
        }
      },
      { code: js, runs: RUNS },
    )
    const widths = out.measured.map((m) => String(m.transcode))
    const slowest = Math.max(...out.measured.map((m) => m.probeMs))
    const mode = (values) =>
      [...values].sort(
        (a, b) => values.filter((v) => v === b).length - values.filter((v) => v === a).length,
      )[0]
    const transcode = mode(out.measured.map((m) => m.transcode))
    console.log(`   transcode width per run: ${widths.join('  ')}; slowest probe ${slowest} ms`)
    return {
      ...(await ctx.header(name, {})),
      browser: { chromeVersion: run.chromeVersion, userAgent: out.userAgent },
      parameters: {
        how: 'engine-probe.ts probeEngineLanes({ force: true }) in a bare page, then once more through the cache',
        runs: RUNS,
        timeLimitMs: TIME_LIMIT_MS,
      },
      result: {
        hardwareConcurrency: out.hardwareConcurrency,
        widthTranscode: transcode,
        runs: out.measured,
        slowestProbeMs: slowest,
        underTimeLimit: slowest < TIME_LIMIT_MS,
        cachedAnswer: out.cached,
        cachedAnswerFromCache: out.cached.source === 'cached' && out.cached.probeMs === 0,
        pageErrors: run.pageErrors,
      },
    }
  } finally {
    await run.close()
  }
}
