// The fixed input of the import measurement: the six clips of one flight on 15 Nov 2026. Their folder is
// read-only test material; this module only stats them. Sizes and modification times identify the files (hashing
// all 18.4 GB would dominate the measurement itself).
import fs from 'node:fs'
import path from 'node:path'

export const IMPORT_CLIP_NAMES = [
  'DJI_20261115114020_0019_D.MP4',
  'DJI_20261115124704_0020_D.MP4',
  'DJI_20261115125055_0021_D.MP4',
  'DJI_20261115130513_0022_D.MP4',
  'DJI_20261115130733_0023_D.MP4',
  'DJI_20261115131124_0024_D.MP4',
]

/** Locate and describe the clips, in the order the folder/plan names them. Missing files stop the run. */
export function resolveImportClips(importDir, names = IMPORT_CLIP_NAMES) {
  const clips = names.map((fileName) => {
    const filePath = path.join(importDir, fileName)
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      throw new Error(
        `import clip missing: ${filePath} (set BENCH_IMPORT_DIR to the footage folder)`,
      )
    }
    if (!stat.isFile()) throw new Error(`import clip is not a file: ${filePath}`)
    return {
      fileName,
      path: filePath,
      bytes: stat.size,
      lastModifiedMs: Math.round(stat.mtimeMs),
    }
  })
  return clips
}

/**
 * The numbers the measurement is judged on. `timings` are the per-clip service calls; `totalSeconds` is the drop
 * to all six ready. Limits are the plan's: under 10 s in total, under 50 MB of workspace growth.
 */
export function summariseImport({
  timings,
  totalSeconds,
  workspaceGrowthBytes,
  timeLimitSeconds,
  growthLimitBytes,
}) {
  const completed = timings.filter((timing) => !timing.error)
  const failed = timings.filter((timing) => timing.error)
  const slowest = completed.reduce(
    (slowestSoFar, timing) => (timing.seconds > slowestSoFar ? timing.seconds : slowestSoFar),
    0,
  )
  return {
    clipsImported: completed.length,
    clipsFailed: failed.length,
    allClipsImported:
      completed.length > 0 && failed.length === 0 && completed.length === timings.length,
    slowestClipSeconds: slowest,
    totalSeconds,
    workspaceGrowthBytes,
    timeLimitSeconds,
    growthLimitBytes,
    meetsTimeLimit: totalSeconds !== null && totalSeconds < timeLimitSeconds,
    meetsGrowthLimit: workspaceGrowthBytes < growthLimitBytes,
  }
}
