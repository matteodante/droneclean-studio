// One export through the app's path, in a fresh browser, with the browser's memory sampled while it runs.
import fs from 'node:fs'
import path from 'node:path'
import { startMemorySampler, openBenchPage } from './browser.mjs'

/**
 * @typedef {object} ExportSpec
 * @property {string} id           Short name, used for the output file.
 * @property {string} mediaFile    The file the clip on the timeline points to.
 * @property {{width:number,height:number,fps:number}} project
 * @property {object} settings     What the export dialog hands to the exporter (ExtendedExportSettings).
 * @property {object} [lut]        {lutName, lutSize, lutData}: add the editor's LUT effect to the clip.
 * @property {boolean} [forceRender] Keep the packet-copy shortcut from taking over (see bench/page/main.ts).
 * @property {'dlog-m'|'dlog'} [inputColor] Give the clip an input colour profile (the stage pipeline's colour stage runs).
 * @property {boolean} [timings] Record the stage marks (src/studio/render/timings.ts) and return them in `export.timingMarks`.
 * @property {number} [speed]      A constant speed for the clip (4 = 4x). Off by default.
 * @property {boolean} [wholeSpans] With `speed`: cut the source end to a multiple of the speed (the last blurred frame would ask for a frame past the file).
 * @property {{shutterDegrees: 90|180|270|360, smoothSlowMotion?: 'blend'|'optical-flow'}} [motionBlur] Motion blur on the clip (design 7.2), with its smooth slow motion (task 11.12); the page turns the hidden switch on.
 * @property {object} [stabilization] Stabilization settings over the engine's defaults, `enabled` true. Off by default.
 * @property {number} [fileLastModified] The file's modification time as the page should see it (the motion cache's key holds it).
 * @property {{startFrame:number, frames:number}} [sourceWindow] Show only these source frames of the clip, at speed 1.
 * @property {boolean} [countDecodes] Count the chunks given to the decoders during the export (`run.decodes`).
 * @property {number[]} [stills]   Also render these frames as PNGs straight from the render path (no encoder).
 */

/** Run one export and save its file in `outDir`. Returns what the page and the sampler measured. */
export async function runOneExport(config, spec, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const mediaId = 'bench-clip'
  const bench = await openBenchPage({ cache: config.cache, media: { [mediaId]: spec.mediaFile } })
  try {
    const { page } = bench
    const prepared = await page.evaluate((input) => window.bench.prepare(input), {
      mediaId,
      mediaUrl: bench.mediaUrl(mediaId),
      fileName: path.basename(spec.mediaFile),
      project: spec.project,
      lut: spec.lut,
      forceRender: spec.forceRender ?? false,
      inputColor: spec.inputColor,
      speed: spec.speed,
      wholeSpans: spec.wholeSpans,
      motionBlur: spec.motionBlur,
      stabilization: spec.stabilization,
      fileLastModified: spec.fileLastModified,
      sourceWindow: spec.sourceWindow,
    })
    await settle(page)
    const sampler = startMemorySampler(bench.profileDir)
    let record
    let memory
    let decodes
    if (spec.countDecodes) await page.evaluate(() => window.bench.startDecodeCount())
    try {
      record = await page.evaluate(
        ([settings, timings]) => window.bench.runExport(settings, { timings }),
        [spec.settings, spec.timings === true],
      )
    } finally {
      memory = sampler.stop()
      if (spec.countDecodes) decodes = await page.evaluate(() => window.bench.stopDecodeCount())
    }
    const extension = record.effective.container ?? 'mp4'
    const outFile = path.join(outDir, `${spec.id}.${extension}`)
    const downloadPromise = page.waitForEvent('download', { timeout: 5 * 60_000 })
    await page.evaluate((name) => window.bench.download(name), `${spec.id}.${extension}`)
    await (await downloadPromise).saveAs(outFile)
    const stills = {}
    for (const frame of spec.stills ?? []) {
      const file = path.join(outDir, `${spec.id}-frame${frame}.png`)
      const stillDownload = page.waitForEvent('download', { timeout: 5 * 60_000 })
      await page.evaluate(
        ([n, name]) => window.bench.renderStill(n, name),
        [frame, path.basename(file)],
      )
      await (await stillDownload).saveAs(file)
      stills[frame] = file
    }
    return {
      id: spec.id,
      outFile,
      stills,
      prepared,
      export: record,
      memory,
      ...(decodes ? { decodes } : {}),
      chromeVersion: bench.chromeVersion,
      gpu: bench.gpu,
      pageErrors: bench.pageErrors.slice(0, 20),
    }
  } finally {
    await bench.close()
  }
}

/**
 * Imports the clip into the open bench page as `spec` says and returns what the page reports. Fields the spec leaves
 * out are not sent.
 */
export function preparePage(bench, mediaId, spec) {
  return bench.page.evaluate((input) => window.bench.prepare(input), {
    mediaId,
    mediaUrl: bench.mediaUrl(mediaId),
    fileName: path.basename(spec.mediaFile),
    project: spec.project,
    forceRender: spec.forceRender ?? false,
    inputColor: spec.inputColor,
    speed: spec.speed,
    wholeSpans: spec.wholeSpans,
    motionBlur: spec.motionBlur,
    stabilization: spec.stabilization,
    fileLastModified: spec.fileLastModified,
    sourceWindow: spec.sourceWindow,
  })
}

/**
 * A fresh browser with the clip prepared as `spec` says (the fields of `ExportSpec`), settled, handed to `work(bench,
 * prepared)`; the browser is closed afterwards. For the measurements that call the page's own functions.
 */
export async function withPreparedPage(config, spec, work) {
  const mediaId = 'bench-clip'
  const bench = await openBenchPage({ cache: config.cache, media: { [mediaId]: spec.mediaFile } })
  try {
    const prepared = await preparePage(bench, mediaId, spec)
    await settle(bench.page)
    return await work(bench, prepared)
  } finally {
    await bench.close()
  }
}

/** Let the page go quiet (probe finished, workers idle) so the memory baseline is the editor's, not the import's. */
function settle(page) {
  return page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)))
}

/**
 * Preview playback of `frames` consecutive frames of the clip in a fresh browser (see `runPreview` in
 * bench/page/main.ts), the stage marks on. `scale` shrinks the canvas (1 = the project's size).
 */
export async function runOnePreview(config, spec, { frames, scale = 1 }) {
  const mediaId = 'bench-clip'
  const bench = await openBenchPage({ cache: config.cache, media: { [mediaId]: spec.mediaFile } })
  try {
    const { page } = bench
    await preparePage(bench, mediaId, spec)
    await settle(page)
    const preview = await page.evaluate(
      (options) => window.bench.runPreview(options.frames, { timings: true, scale: options.scale }),
      { frames, scale },
    )
    return {
      id: spec.id,
      preview,
      chromeVersion: bench.chromeVersion,
      gpu: bench.gpu,
      pageErrors: bench.pageErrors.slice(0, 20),
    }
  } finally {
    await bench.close()
  }
}
