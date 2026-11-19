// Where the inputs are, and the few parameters of a run. BENCH_CLIP has no default and must be set. Everything can be set by an environment variable
// (or, for the lengths, a command-line flag in run.mjs); a missing input stops the run with a plain message.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function numberFrom(value, fallback, name) {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive number, got "${value}"`)
  return n
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ seconds?: string, fidelitySeconds?: string, longSeconds?: string, out?: string }} flags
 */
export function loadConfig(env = process.env, flags = {}) {
  const cache = path.resolve(env.BENCH_CACHE ?? path.join(REPO_ROOT, 'bench', '.cache'))
  // No default: the footage is the maintainer's own. requireInputs stops the run when BENCH_CLIP is not set.
  const clip = env.BENCH_CLIP ?? ''
  return {
    clip,
    // BENCH_LUT points at another .cube; otherwise the bench generates its own (lib/lut.mjs) into the cache.
    lut: env.BENCH_LUT ?? path.join(cache, 'bench-grade.cube'),
    lutGenerated: !env.BENCH_LUT,
    // The import measurement imports the whole folder the clip comes from unless told otherwise.
    importDir: env.BENCH_IMPORT_DIR ?? (clip ? path.dirname(clip) : ''),
    cache,
    outDir: path.resolve(flags.out ?? env.BENCH_OUT ?? path.join(cache, 'results')),
    startSeconds: numberFrom(env.BENCH_START_SECONDS, 60, 'BENCH_START_SECONDS'),
    // The segment of the speed, quality, colour and grey-ramp measurements.
    segmentSeconds: numberFrom(
      flags.seconds ?? env.BENCH_SEGMENT_SECONDS,
      10,
      'BENCH_SEGMENT_SECONDS',
    ),
    // The frame-fidelity measurement needs a segment long enough to hold a repeated frame (see its README section).
    fidelitySeconds: numberFrom(
      flags.fidelitySeconds ?? env.BENCH_FIDELITY_SECONDS,
      20,
      'BENCH_FIDELITY_SECONDS',
    ),
    customBitrate: numberFrom(env.BENCH_CUSTOM_BITRATE, 120_000_000, 'BENCH_CUSTOM_BITRATE'),
    // Output frame of the colour comparison (counted from the start of the segment).
    colourFrame: numberFrom(env.BENCH_COLOUR_FRAME, 300, 'BENCH_COLOUR_FRAME'),
    // The long-export measurement: how much of the six-clip timeline to export (null: all of it) and the browser
    // memory (GiB) past which it aborts the export and fails.
    longExportSeconds: numberFrom(
      flags.longSeconds ?? env.BENCH_LONG_EXPORT_SECONDS,
      null,
      'BENCH_LONG_EXPORT_SECONDS',
    ),
    memoryLimitGiB: numberFrom(env.BENCH_MEMORY_LIMIT_GIB, 6, 'BENCH_MEMORY_LIMIT_GIB'),
  }
}

/** Stop with a clear message when an input file is missing. */
export function requireInputs(config, { clip = true, lut = false, importDir = false } = {}) {
  const missing = []
  if (clip && !config.clip) {
    missing.push(
      'the clip: BENCH_CLIP is not set\n    (set BENCH_CLIP to the footage file, a long HEVC clip such as DJI_20261115124704_0020_D.MP4)',
    )
  } else if (clip && !fs.existsSync(config.clip)) {
    missing.push(
      `the clip: ${config.clip}\n    (set BENCH_CLIP to the footage file, a long HEVC clip such as DJI_20261115124704_0020_D.MP4)`,
    )
  }
  if (lut && !config.lutGenerated && !fs.existsSync(config.lut)) {
    missing.push(
      `the LUT: ${config.lut}\n    (BENCH_LUT must point at a .cube file, or be unset to use the generated one)`,
    )
  }
  if (importDir && (!config.importDir || !fs.existsSync(config.importDir))) {
    missing.push(
      `the import folder: ${config.importDir}\n    (set BENCH_IMPORT_DIR to the folder with the six clips of 15 Nov)`,
    )
  }
  if (missing.length > 0) {
    throw new Error(`Benchmark input missing:\n  - ${missing.join('\n  - ')}`)
  }
}
