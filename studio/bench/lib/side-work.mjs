// Helpers of the import side-work measurement (task 8.7): what the editor starts after an import, how long each
// kind takes, and how many cores it keeps busy while it runs. Pure functions and two small file helpers; the
// browser part is bench/page/side-work.ts.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './config.mjs'

const round = (value, digits = 2) => Number(value.toFixed(digits))

/**
 * The gyro engine's worker and package, where the app serves them (`/gyroflow/wasm/js` and `/gyroflow/wasm/pkg`),
 * copied into the built benchmark page. A package that was not built is a reason, never a silent skip.
 */
export function copyGyroPackage(distDir, repoRoot = REPO_ROOT) {
  const source = path.resolve(repoRoot, '..', 'gyroflow', 'wasm')
  const wasm = path.join(source, 'pkg', 'gyroflow_wasm_bg.wasm')
  if (!fs.existsSync(wasm)) {
    return {
      available: false,
      reason: `the gyro package is not built (${wasm}): run gyroflow/wasm/build.sh`,
    }
  }
  for (const folder of ['js', 'pkg']) {
    const target = path.join(distDir, 'gyroflow', 'wasm', folder)
    fs.mkdirSync(target, { recursive: true })
    for (const name of fs.readdirSync(path.join(source, folder))) {
      const from = path.join(source, folder, name)
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(target, name))
    }
  }
  return { available: true }
}

/** Stream types of a file, from ffprobe's headers read (no decode): says whether a clip has audio. */
export function probeStreamTypes(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file],
    { encoding: 'utf8', maxBuffer: 8 << 20 },
  )
  if (result.status !== 0) return { error: result.stderr.trim() || 'ffprobe failed' }
  const streams = JSON.parse(result.stdout).streams ?? []
  return {
    streams: streams.map((s) => `${s.codec_type}:${s.codec_name}`),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  }
}

/** The machine's load in a window, as the numbers 8.7 is judged on: cores kept busy, GPU busy, memory. */
export function loadOf(samplerSummary) {
  const cores = samplerSummary.cpu.coreCount
  const overall = samplerSummary.cpu.overallPercent
  const perCore = samplerSummary.cpu.perCorePercent.map((c) => c?.mean ?? 0)
  return {
    samples: samplerSummary.samples,
    coreCount: cores,
    busyCoresMean: overall ? round((overall.mean / 100) * cores) : null,
    busyCoresPeak: overall ? round((overall.peak / 100) * cores) : null,
    coresOver50PercentMean: perCore.filter((v) => v > 50).length,
    overallCpuPercent: overall,
    perCoreMeanPercent: perCore.map((v) => round(v, 0)),
    gpuBusyPercent: samplerSummary.gpu.busyPercent,
    browserPeakBytes: samplerSummary.browserMemory?.peakBytes ?? null,
  }
}

/**
 * What the phases add up to. `serialSeconds` is every kind one after another (import, then each kind alone);
 * `togetherSeconds` is the same work started all at once through the editor's own queues. The saving is what
 * the editor already gets from overlap; the rest is what its queues (one proxy, one or two filmstrips, one
 * background job) leave on the table.
 */
export function summariseSideWork({ importSeconds, kindSeconds, togetherSeconds }) {
  const sideSerial = Object.values(kindSeconds).reduce((sum, s) => sum + s, 0)
  const serialSeconds = round(importSeconds + sideSerial, 1)
  const longestKind = Object.entries(kindSeconds).sort((a, b) => b[1] - a[1])[0] ?? null
  return {
    importSeconds,
    kindSeconds,
    sideWorkSerialSeconds: round(sideSerial, 1),
    serialSeconds,
    togetherSeconds: togetherSeconds ?? null,
    togetherSavedSeconds:
      togetherSeconds == null ? null : round(serialSeconds - importSeconds - togetherSeconds, 1),
    longestKind: longestKind && {
      kind: longestKind[0],
      seconds: longestKind[1],
    },
    longestKindShare: longestKind && sideSerial > 0 ? round(longestKind[1] / sideSerial, 2) : null,
    /** Half of today's serial time: the plan's bar for task 8.7 */
    halfOfSerialSeconds: round(serialSeconds / 2, 1),
  }
}

/** `ps` TIME ("1:02.34", "1:02:03.45", "0:00.05") -> seconds. */
export function parsePsTime(text) {
  const parts = String(text).trim().split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p)))
    return null
  return parts.reduce((sum, part) => sum * 60 + Number(part), 0)
}

/**
 * CPU seconds the benchmark's browser (every process of the tree whose root has this profile folder) has used so
 * far, from `ps`. The whole-machine sampler also counts other programs; this is the browser's own work.
 */
export function browserCpuSeconds(profileDir) {
  const out = spawnSync('ps', ['-axo', 'pid=,ppid=,time=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  }).stdout
  const rows = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m)
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        seconds: parsePsTime(m[3]),
        command: m[4],
      })
  }
  const root = rows.find(
    (r) => r.command.includes(`--user-data-dir=${profileDir}`) && !r.command.includes('--type='),
  )
  if (!root) return null
  const inTree = new Set([root.pid])
  for (let grew = true; grew;) {
    grew = false
    for (const r of rows) {
      if (!inTree.has(r.pid) && inTree.has(r.ppid)) {
        inTree.add(r.pid)
        grew = true
      }
    }
  }
  return rows.filter((r) => inTree.has(r.pid)).reduce((sum, r) => sum + (r.seconds ?? 0), 0)
}

/** Cores the browser kept busy over a stretch: its CPU seconds used, over the wall seconds. */
export function busyCoresOf(cpuBefore, cpuAfter, wallSeconds) {
  if (cpuBefore == null || cpuAfter == null || wallSeconds <= 0) return null
  return round(Math.max(0, cpuAfter - cpuBefore) / wallSeconds)
}
