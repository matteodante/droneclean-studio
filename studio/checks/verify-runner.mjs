#!/usr/bin/env node
// `npm run verify`, with its independent steps side by side when the run holds the whole Mac.
//
//   node checks/verify-runner.mjs [--after-quick] [--serial] [--fresh] [--jobs N] [--max-gb N] [--only id,id] [--list]
//
//   --after-quick  skip the 16 quick checks (`npm run verify` runs `npm run check:quick` before this)
//   --serial       one step at a time, in the old order: the same work as `npm run verify:serial`, with the timing table
//   --fresh        do not reuse a cached build (checks/build-cache.mjs)
//   --jobs N       most steps at once (default: as many as the memory budget allows when `heavy.sh` set
//                  DRONECLEAN_HEAVY=1, otherwise 1: outside the queue the run stays gentle)
//   --max-gb N     memory budget for all steps together (default: DRONECLEAN_HEAVY_MAX_GB from heavy.sh, else 10)
//
// Every step is a command that `verify:serial` (the old one-line verify) also runs; the test beside this file
// checks that the two lists are the same. The run stops at the first failure: the other steps are killed, the
// failing step's log is printed and named. Each step's full output is in out/verify-logs/<id>.log.
// A step starts only when the steps it needs have passed and the measured and estimated memory of the running
// steps plus its own estimate fit the budget, so two steps that together would pass it never overlap.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUICK_CHECKS } from './quick.mjs'

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOGS = path.join(STUDIO, 'out', 'verify-logs')

// Measured on 19 Nov 2026 (AGENTS.md, Checks): the type-aware lint is the big one, changed-health the second
const QUICK_MB = { check: 3300, 'check:changed-health': 1400, 'check:checks': 700 }

/**
 * `run` is what is executed; `leaf` is the command of `verify:serial` it stands for (default: the same).
 * `needs` are step ids; `avoid` are steps this one never runs beside (a timing-sensitive test and the CPU-hungry unit suite); `mb` is the step's expected peak memory (measured, see AGENTS.md "Checks").
 */
// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
export function buildSteps({ withQuick = true, fresh = false } = {}) {
  const steps = []
  const freshFlag = fresh ? ' --fresh' : ''
  // The order is the priority: the build comes first because it needs the whole memory budget by itself, and a step that
  // does not fit in memory holds back every step after it
  steps.push({ id: 'build', run: `node checks/build-cache.mjs studio-dist${freshFlag}`, leaf: 'vp build', needs: [], mb: 7000 })
  if (withQuick) {
    let previous = null
    for (const [runner, script] of QUICK_CHECKS) {
      const run = runner === 'vp' ? `vp run ${script}` : `npm run ${script}`
      // The quick checks stay in their order and one at a time, as `check:quick` runs them (type-aware lint is
      // the big one); what overlaps with them is the rest of the run.
      steps.push({ id: `quick:${script}`, run, leaf: 'npm run check:quick', needs: previous ? [previous] : [], mb: QUICK_MB[script] ?? 600 })
      previous = `quick:${script}`
    }
  }
  steps.push({ id: 'unit', run: 'vp test run', needs: [], mb: 3700 })
  steps.push({ id: 'network', run: 'npm run check:network', needs: ['build'], mb: 1500 })
  steps.push({ id: 'desktop:check', run: 'npm run desktop:check', needs: [], mb: 300 })
  // workspace-lock-race.test.mjs starts two processes 3 ms apart; it failed ("Unexpected end of JSON input") when the
  // unit suite had the CPU, on 19 Nov 2026, so this step never runs beside `unit`
  steps.push({ id: 'desktop:test', run: 'npm run desktop:test', needs: [], mb: 1000, avoid: ['unit'] })
  steps.push({ id: 'headless:node', run: 'node --test headless/*.test.mjs', needs: [], mb: 500 })
  let previous = null
  for (const command of [
    'node headless/test.mjs --skip-build',
    'node headless/edit-operations.mjs',
    'node headless/lifecycle-e2e.mjs',
    'node headless/export-media-video.mjs',
    'node headless/subclips-e2e.mjs',
  ]) {
    const id = `headless:${command.split('/')[1].split('.')[0]}`
    steps.push({ id, run: command, needs: ['build', ...(previous ? [previous] : [])], mb: 1400 })
    previous = id
  }
  steps.push({ id: 'headless:media', run: 'node headless/media-test.mjs', needs: ['build'], mb: 300 })
  return steps
}

// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const args = { afterQuick: false, serial: false, fresh: false, jobs: null, maxGb: null, only: null, list: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--after-quick') args.afterQuick = true
    else if (t === '--serial') args.serial = true
    else if (t === '--fresh') args.fresh = true
    else if (t === '--list') args.list = true
    else if (t === '--jobs') args.jobs = Number(argv[++i])
    else if (t === '--max-gb') args.maxGb = Number(argv[++i])
    else if (t === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean)
    else throw new Error(`Unknown argument: ${t}`)
  }
  return args
}

/**
 * Resident memory (MB) of the process tree under each given root pid, from one `ps`.
 * The steps stay in the process group of `heavy.sh` (no `detached`), because its memory guard measures that group.
 */
// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
function sampleTrees(roots) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
  const children = new Map()
  const rss = new Map()
  for (const line of result.stdout.split('\n')) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number)
    if (!Number.isFinite(pid)) continue
    rss.set(pid, kb / 1024)
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid).push(pid)
  }
  const trees = new Map()
  for (const root of roots) {
    const pids = []
    const queue = [root]
    while (queue.length) {
      const pid = queue.pop()
      pids.push(pid)
      queue.push(...(children.get(pid) ?? []))
    }
    trees.set(root, { pids, mb: pids.reduce((sum, pid) => sum + (rss.get(pid) ?? 0), 0) })
  }
  return trees
}

function parseTime(text) {
  // /usr/bin/time -l: "  12.34 real  45.67 user  8.90 sys"
  const match = /([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/.exec(text)
  return match ? { real: Number(match[1]), cpu: Number(match[2]) + Number(match[3]) } : null
}

function tail(file, lines) {
  const all = fs.readFileSync(file, 'utf8').split('\n')
  return all.slice(-lines).join('\n')
}

// The scheduler is the whole point of this file; splitting it would only scatter its state.
// fallow-ignore-next-line complexity
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const steps = buildSteps({ withQuick: !args.afterQuick, fresh: args.fresh })
  if (args.list) {
    for (const s of steps) console.log(`${s.id.padEnd(34)} ${String(s.mb).padStart(5)} MB  needs: ${s.needs.join(', ') || '-'}  ${s.run}`)
    return 0
  }
  const inHeavy = process.env.DRONECLEAN_HEAVY === '1'
  const maxGb = args.maxGb ?? Number(process.env.DRONECLEAN_HEAVY_MAX_GB ?? 10)
  const budget = Math.max(1, maxGb * 1024 - 700) // headroom for this process and the shell
  const jobs = args.serial ? 1 : (args.jobs ?? (inHeavy ? 99 : 1))
  if (!inHeavy && !args.serial && args.jobs == null) console.log('verify-runner: not inside scripts/heavy.sh, so one step at a time (run it through the queue to overlap steps)')
  const chosen = args.only ? steps.filter((s) => args.only.includes(s.id)) : steps
  const ids = new Set(chosen.map((s) => s.id))
  for (const s of chosen) s.needs = s.needs.filter((n) => ids.has(n))
  fs.rmSync(LOGS, { recursive: true, force: true })
  fs.mkdirSync(LOGS, { recursive: true })

  const state = new Map(chosen.map((s) => [s.id, { step: s, status: 'pending', peak: 0 }]))
  const running = new Set()
  const started = Date.now()
  let failed = null
  let overallPeak = 0

// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
  // 'ok', or why not: 'jobs' and 'avoid' let a later step go first, 'mem' does not (a big step must not be starved)
  const fits = (s) => {
    if (running.size === 0) return 'ok'
    if (running.size >= jobs) return 'jobs'
    for (const id of running) {
      if (s.avoid?.includes(id) || state.get(id).step.avoid?.includes(s.id)) return 'avoid'
    }
    const trees = sampleTrees([...running].map((id) => state.get(id).pid))
    let reserved = 0
    for (const id of running) {
      const st = state.get(id)
      reserved += Math.max(st.step.mb, trees.get(st.pid)?.mb ?? 0)
    }
    return reserved + s.mb <= budget ? 'ok' : 'mem'
  }

  const launch = (st) => {
    const { step } = st
    const logFile = path.join(LOGS, `${step.id.replace(/[^\w.-]/g, '_')}.log`)
    st.logFile = logFile
    const out = fs.openSync(logFile, 'w')
    // /usr/bin/time -l reports the CPU time of the step and its children; the shell's PATH gets node_modules/.bin like npm run does
    const env = { ...process.env, PATH: `${path.join(STUDIO, 'node_modules', '.bin')}:${process.env.PATH}` }
    const timed = process.platform === 'darwin'
    const child = timed
      ? spawn('/usr/bin/time', ['-l', '/bin/sh', '-c', step.run], { cwd: STUDIO, env, stdio: ['ignore', out, out] })
      : spawn('/bin/sh', ['-c', step.run], { cwd: STUDIO, env, stdio: ['ignore', out, out] })
    fs.closeSync(out)
    st.pid = child.pid
    st.status = 'running'
    st.startedAt = Date.now()
    running.add(step.id)
    console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s] start ${step.id}`)
    return new Promise((resolve) => {
// Build tooling run by npm run verify and exercised end to end by it; its logic is a handful of branches over process state
// fallow-ignore-next-line complexity
      child.on('exit', (code, signal) => {
        st.endedAt = Date.now()
        running.delete(step.id)
        const time = timed ? parseTime(fs.readFileSync(logFile, 'utf8')) : null
        st.cpu = time?.cpu ?? null
        if (st.status === 'killed') return resolve()
        st.status = code === 0 ? 'ok' : 'failed'
        const secs = ((st.endedAt - st.startedAt) / 1000).toFixed(1)
        console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s] ${st.status === 'ok' ? 'ok   ' : 'FAIL '} ${step.id} (${secs} s)`)
        if (st.status === 'ok') {
          console.log(`    ${tail(logFile, 6).replace(/\n/g, '\n    ').trimEnd()}`)
        } else if (!failed) {
          failed = { st, code, signal }
        }
        resolve()
      })
    })
  }

  const killTree = (st, signal) => {
    st.tree ??= sampleTrees([st.pid]).get(st.pid).pids // taken once, before the first signal orphans the grandchildren
    for (const pid of st.tree) {
      try {
        process.kill(pid, signal)
      } catch {
        /* already gone */
      }
    }
  }

  const sampler = setInterval(() => {
    const trees = sampleTrees([...running].map((id) => state.get(id).pid))
    let total = 0
    for (const id of running) {
      const st = state.get(id)
      const mb = trees.get(st.pid)?.mb ?? 0
      st.peak = Math.max(st.peak, mb)
      total += mb
    }
    overallPeak = Math.max(overallPeak, total)
  }, 1000)

  const waiting = new Set()
  while (!failed) {
    const pending = [...state.values()].filter((st) => st.status === 'pending')
    if (pending.length === 0 && running.size === 0) break
    for (const st of pending) {
      if (failed) break
      if (!st.step.needs.every((n) => state.get(n).status === 'ok')) continue
      const room = fits(st.step)
      if (room === 'mem') break
      if (room !== 'ok') continue
      const promise = launch(st)
      waiting.add(promise)
      promise.then(() => waiting.delete(promise))
    }
    if (failed) break
    if (running.size === 0 && pending.length > 0) {
      // nothing can start: a needed step is not ok (cannot happen without a failure) or the plan is cyclic
      console.error('verify-runner: no step can start; check the needs of the steps')
      failed = { st: pending[0], code: 'stuck' }
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  if (failed) {
    for (const id of running) {
      const st = state.get(id)
      st.status = 'killed'
      killTree(st, 'SIGTERM')
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
    for (const st of state.values()) if (st.status === 'killed') killTree(st, 'SIGKILL')
  } else {
    await Promise.all(waiting)
  }
  clearInterval(sampler)

  const total = (Date.now() - started) / 1000
  const rows = [...state.values()].filter((st) => st.startedAt)
  console.log('\nstep'.padEnd(36) + 'start s'.padStart(8) + 'wall s'.padStart(8) + 'cpu s'.padStart(8) + 'cores'.padStart(7) + 'peak MB'.padStart(9) + '  result')
  for (const st of rows) {
    const wall = ((st.endedAt ?? Date.now()) - st.startedAt) / 1000
    const cores = st.cpu != null ? (st.cpu / Math.max(wall, 0.1)).toFixed(1) : '-'
    console.log(
      st.step.id.padEnd(35) +
        ((st.startedAt - started) / 1000).toFixed(0).padStart(8) +
        wall.toFixed(1).padStart(8) +
        (st.cpu != null ? st.cpu.toFixed(1) : '-').padStart(8) +
        cores.padStart(7) +
        st.peak.toFixed(0).padStart(9) +
        `  ${st.status}`,
    )
  }
  console.log(`total ${total.toFixed(1)} s, peak memory of all steps together ${overallPeak.toFixed(0)} MB (budget ${budget.toFixed(0)} MB), ${jobs === 1 ? 'serial' : 'overlapping'}`)
  const notRun = [...state.values()].filter((st) => st.status === 'pending').map((st) => st.step.id)
  if (failed) {
    const { st, code } = failed
    console.error(`\n--- ${st.step.id}: last lines of ${path.relative(STUDIO, st.logFile ?? '')} ---`)
    if (st.logFile) console.error(tail(st.logFile, 80))
    console.error(`\nverify FAILED at step ${st.step.id} (${st.step.run}), exit ${code}. Not run: ${notRun.join(', ') || 'none'}`)
    return 1
  }
  console.log(`\nverify OK: ${rows.length} steps`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error)
      process.exit(2)
    },
  )
}
