// Who ran the measurement: commit, date, machine, GPU, tools. Also how busy the machine was, because timings taken
// next to another browser or encoder are only indicative.
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { REPO_ROOT } from './config.mjs'

function sh(command, args, { trim = true } = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 << 20 })
  if (r.status !== 0) return null
  return trim ? r.stdout.trim() : r.stdout
}

export function gitState() {
  const status = sh('git', ['status', '--porcelain'], { trim: false }) ?? ''
  // The kit's own results and cache do not count as a modified editor.
  const dirty = status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((file) => !file.startsWith('bench/baseline/') && !file.startsWith('bench/.cache/'))
  return {
    commit: sh('git', ['rev-parse', 'HEAD']),
    shortCommit: sh('git', ['rev-parse', '--short', 'HEAD']),
    branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    subject: sh('git', ['log', '-1', '--format=%s']),
    modifiedFiles: dirty,
    clean: dirty.length === 0,
  }
}

export function machineInfo() {
  const gpuJson = sh('system_profiler', ['SPDisplaysDataType', '-json'])
  let displays = []
  try {
    displays = JSON.parse(gpuJson ?? '{}').SPDisplaysDataType ?? []
  } catch {
    displays = []
  }
  return {
    model: sh('sysctl', ['-n', 'hw.model']),
    chip: sh('sysctl', ['-n', 'machdep.cpu.brand_string']),
    logicalCpus: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    os: `${sh('sw_vers', ['-productName'])} ${sh('sw_vers', ['-productVersion'])} (${os.arch()})`,
    node: process.version,
    gpuNames: displays.map(
      (d) => `${d.sppci_model ?? d._name}${d.sppci_cores ? `, ${d.sppci_cores} cores` : ''}`,
    ),
    ffmpeg: sh('ffmpeg', ['-version'])?.split('\n')[0] ?? null,
  }
}

/** Load and competing work at the start of a run, so a reader can tell whether timings were taken on a quiet machine. */
export function busyness() {
  const ps = sh('ps', ['-axo', 'pid=,pcpu=,command=']) ?? ''
  const competing = ps
    .split('\n')
    .map((line) => /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ cpu: Number(m[2]), command: m[3] }))
    .filter(
      (p) =>
        p.cpu >= 5 && /Google Chrome|ffmpeg|chrome-headless|Electron|vite|node /.test(p.command),
    )
    // Not the benchmark itself.
    .filter(
      (p) =>
        !p.command.includes('bench/run.mjs') && !p.command.includes('droneclean-bench-profile'),
    )
    .map((p) => ({ cpuPercent: p.cpu, command: p.command.slice(0, 90) }))
  return {
    loadAverage1m: Number(os.loadavg()[0].toFixed(2)),
    competingProcessesAbove5PercentCpu: competing.slice(0, 10),
    quiet: os.loadavg()[0] < 2 && competing.length === 0,
  }
}
