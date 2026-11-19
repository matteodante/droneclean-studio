// What the speed-ramp measurements share (task 7.1): one export of a clip with a speed curve (or a constant speed)
// through the app's own path, in a browser page that is already open, and the curve's own arithmetic in plain numbers.
//
// The measurements that import this (speed-ramp, speed-ramp-audio, speed-ramp-stabilized) drive the page the way
// `lib/exports.mjs` does; they cannot use `runOneExport` because the kit's export spec has no place for a curve.
import fs from 'node:fs'
import path from 'node:path'
import { startMemorySampler } from '../lib/browser.mjs'

/** The project's rate, exactly 60,000/1001: the rate the design's table is computed at. */
export const PROJECT_FPS = 60000 / 1001

/**
 * Prepare the page's clip, export it, and save the file. Returns what the page and the memory sampler measured.
 *
 * @param {object} bench an open bench page (`openBenchPage`)
 * @param {object} spec
 * @param {string} spec.id file name (without extension) of the saved export, in `outDir`
 * @param {string} spec.mediaFile the file the clip points to (its name goes to the page)
 * @param {{width:number,height:number,fps:number}} spec.project
 * @param {object} spec.settings what the export dialog hands to the exporter
 * @param {{keys:Array<{frame:number,speed:number}>}} [spec.speedCurve]
 * @param {number} [spec.speed] a constant speed, instead of a curve
 * @param {boolean} [spec.wholeSpans] with `speed`: cut the source end to a multiple of the speed
 * @param {object} [spec.stabilization] stabilization settings over the engine's defaults (`{}` for the defaults)
 * @param {number} [spec.fileLastModified] the file's modification time as the page should see it
 * @param {{startFrame:number,frames:number}} [spec.sourceWindow] show only these source frames at speed 1
 * @param {number[]} [spec.watchFrames] source frames whose stabilization data are hashed (a stabilized run)
 * @param {string} outDir
 */
export async function exportOnPage(bench, spec, outDir) {
  const mediaId = 'bench-clip'
  fs.mkdirSync(outDir, { recursive: true })
  const { page } = bench
  const prepared = await page.evaluate((input) => window.bench.prepare(input), {
    mediaId,
    mediaUrl: bench.mediaUrl(mediaId),
    fileName: path.basename(spec.mediaFile),
    project: spec.project,
    forceRender: false,
    speedCurve: spec.speedCurve,
    speed: spec.speed,
    wholeSpans: spec.wholeSpans,
    stabilization: spec.stabilization,
    fileLastModified: spec.fileLastModified,
    sourceWindow: spec.sourceWindow,
  })
  // Let the import and the probe go quiet before the memory baseline is taken (as the kit does).
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)))
  if (spec.stabilization) {
    await page.evaluate((watch) => window.benchRamp.startSeatLog(watch), spec.watchFrames ?? [])
  }
  const sampler = startMemorySampler(bench.profileDir)
  let record
  let memory
  try {
    record = await page.evaluate((settings) => window.bench.runExport(settings), spec.settings)
  } finally {
    memory = sampler.stop()
  }
  const seatLog = spec.stabilization ? await page.evaluate(() => window.benchRamp.takeSeatLog()) : null
  const extension = record.effective.container ?? 'mp4'
  const outFile = path.join(outDir, `${spec.id}.${extension}`)
  const downloadPromise = page.waitForEvent('download', { timeout: 10 * 60_000 })
  await page.evaluate((fileName) => window.bench.download(fileName), `${spec.id}.${extension}`)
  await (await downloadPromise).saveAs(outFile)
  return {
    id: spec.id,
    outFile,
    prepared,
    export: record,
    memory,
    seatLog,
    chromeVersion: bench.chromeVersion,
    gpu: bench.gpu,
    pageErrors: bench.pageErrors.splice(0).slice(0, 20),
  }
}

/**
 * The curve's integral in "speed x timeline frames" at clip frame `n`: speed is linear between keys and the last
 * key's speed holds past the end. This is a second, plain-number statement of `areaAt` (`src/studio/speed/curve.ts`),
 * so a measurement does not check the app's mapping against itself.
 *
 * @param {Array<{frame:number,speed:number}>} keys sorted, the first at frame 0
 */
export function curveArea(keys, n) {
  let area = 0
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    const length = b.frame - a.frame
    if (n >= b.frame) {
      area += (length * (a.speed + b.speed)) / 2
    } else if (n > a.frame) {
      const u = n - a.frame
      return area + u * a.speed + ((b.speed - a.speed) * u * u) / (2 * length)
    } else {
      return area
    }
  }
  const last = keys[keys.length - 1]
  return n > last.frame ? area + (n - last.frame) * last.speed : area
}

/** The clip frame (a real number) at which `curveArea` reaches `area`; the area grows with the frame, so it bisects. */
export function frameAtArea(keys, area) {
  let low = 0
  let high = Math.max(1, area / Math.min(...keys.map((key) => key.speed))) + 1
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2
    if (curveArea(keys, mid) < area) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** The source frame an output frame shows for a curve whose source and project rates are equal: `floor(area)`. */
export function shownSourceFrame(keys, n) {
  return Math.floor(curveArea(keys, n) + 1e-9)
}
