/* eslint-disable no-console -- a command-line tool */
// What a measurement gets: the config, the inputs, a memoised way to run exports (so `all` runs each export once),
// and the header every record starts with.
import fs from 'node:fs'
import path from 'node:path'
import { ensureRamp, ensureSegment, describeLut, parseCube } from './inputs.mjs'
import { requireInputs } from './config.mjs'
import { runOneExport } from './exports.mjs'
import { busyness, gitState, machineInfo } from './machine.mjs'

/**
 * The kit's project rate: 59.94 as the exact fraction's double (`60000 / 1001`), which is what a
 * project file holds after task 1.5. Never the decimal `59.94`: the exporter reads that as a 1/2997
 * time base, a different rate (design 1.5, 4.5).
 */
export const PROJECT_FPS = 60000 / 1001

/** The export dialog's state when a pilot picks H.265, MP4, "ultra", Auto bitrate. */
export function dialogSettings(config, kind) {
  const base = {
    codec: 'h265',
    quality: 'ultra',
    resolution: { width: 3840, height: 2880 },
    smartCopy: true,
    mode: 'video',
    videoContainer: 'mp4',
    subtitleMode: 'burn',
    renderWholeProject: false,
  }
  return kind === 'auto'
    ? { ...base, rateControl: 'auto' }
    : { ...base, rateControl: 'variable', videoBitrate: config.customBitrate }
}

/**
 * The spec of one export of the 10/20 s segment, or of the ramp, or of the LUT-graded segment.
 * `kind`: 'auto' (ultra, automatic bitrate) | 'custom' (custom bitrate, default 120 Mbps).
 * `what`: 'segment' (a +0.01 dB nudge, so the render runs) | 'segment-copy-path' (the untouched clip,
 * smart copy off so that the packet remux runs; design 1.5, decision 4) | 'segment-lut' | 'ramp'.
 */
export async function exportSpec(ctx, { id, what, kind, seconds, inputColor, timings }) {
  const { config } = ctx
  const settings = dialogSettings(config, kind)
  if (what === 'ramp') {
    const ramp = await ctx.ramp()
    return {
      id,
      mediaFile: ramp.file,
      project: { width: 3840, height: 2880, fps: 30 },
      settings,
      forceRender: true,
    }
  }
  const segment = await ctx.segment(seconds)
  const spec = {
    id,
    mediaFile: segment.file,
    project: { width: 3840, height: 2880, fps: PROJECT_FPS },
    // A 59.94 project of this 59.94 clip makes smart copy eligible, and smart copy hands back the
    // cut file untouched: switched off, the untouched-clip run measures the packet remux instead.
    settings: what === 'segment-copy-path' ? { ...settings, smartCopy: false } : settings,
    forceRender: what !== 'segment-copy-path',
    ...(inputColor ? { inputColor } : {}),
    ...(timings ? { timings: true } : {}),
  }
  if (what === 'segment-lut') {
    requireInputs(config, { clip: false, lut: true })
    spec.lut = (await ctx.lut()).params
    spec.stills = [config.colourFrame]
  }
  return spec
}

export function createContext(config) {
  const exportsByKey = new Map()
  const inputsByKey = new Map()
  const started = Date.now()
  let header = null
  let browser = null

  const memo = (map, key, make) => {
    if (!map.has(key)) map.set(key, make())
    return map.get(key)
  }

  // Chrome's version and the WebGPU adapter, as the last export's browser reported them.
  const remember = (run) => {
    browser = { chromeVersion: run.chromeVersion, webgpuAdapter: run.gpu }
    return run
  }

  const ctx = {
    config,
    segment: (seconds) =>
      memo(inputsByKey, `segment:${seconds}`, () => ensureSegment(config, seconds)),
    ramp: () => memo(inputsByKey, 'ramp', () => ensureRamp(config)),
    lut: () =>
      memo(inputsByKey, 'lut', async () => ({
        ...(await describeLut(config)),
        params: parseCube(fs.readFileSync(config.lut, 'utf8')),
      })),
    async clipHash() {
      return (await ctx.segment(config.segmentSeconds)).sourceSha256
    },

    /**
     * Run (once per process) an export of the segment, or the ramp, or the LUT-graded segment.
     * `kind`: 'auto' (ultra, automatic bitrate) | 'custom' (custom bitrate, default 120 Mbps).
     * `what`: 'segment' | 'segment-copy-path' (no nudge, smart copy off: the app copies packets) |
     * 'segment-lut' | 'ramp'.
     */
    export({ what, kind, seconds = config.segmentSeconds, inputColor, timings }) {
      const variant = `${inputColor ? `-${inputColor}` : ''}${timings ? '-timed' : ''}`
      return memo(exportsByKey, `${what}|${kind}|${seconds}${variant}`, async () => {
        const id = `${what}-${kind}-${seconds}s${variant}`.replace(/\./g, '_')
        const dir = path.join(config.cache, 'exports')
        // Development shortcut (never used for a baseline): BENCH_REUSE_EXPORTS=1 reuses the last export of this name.
        const saved = path.join(dir, `${id}.run.json`)
        if (process.env.BENCH_REUSE_EXPORTS === '1' && fs.existsSync(saved)) {
          console.log(`   reusing ${id} (BENCH_REUSE_EXPORTS=1)`)
          return remember(JSON.parse(fs.readFileSync(saved, 'utf8')))
        }
        const run = await runOneExport(
          config,
          await exportSpec(ctx, { id, what, kind, seconds, inputColor, timings }),
          dir,
        )
        fs.writeFileSync(saved, JSON.stringify(run))
        return remember(run)
      })
    },

    /** The header every record starts with. */
    async header(measurement, inputs) {
      header ??= { git: gitState(), machine: machineInfo(), busyAtStart: busyness() }
      return {
        measurement,
        schemaVersion: 1,
        date: new Date().toISOString(),
        git: header.git,
        machine: header.machine,
        machineBusyAtStart: header.busyAtStart,
        browser,
        inputs: {
          clip: { path: config.clip, sha256: await ctx.clipHash() },
          ...inputs,
        },
        elapsedSecondsBeforeThisRecord: Math.round((Date.now() - started) / 1000),
      }
    },
  }
  return ctx
}
