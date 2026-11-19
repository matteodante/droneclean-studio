#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool */
// DroneClean Studio benchmark kit. One command per measurement, plus `all`.
//
//   node bench/run.mjs <measurement|all> [--seconds N] [--fidelity-seconds N] [--long-seconds N] [--out DIR]
//
// Each measurement writes <out>/<name>.json (default out: bench/.cache/results). See bench/README.md.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, requireInputs } from './lib/config.mjs'
import { createContext } from './lib/context.mjs'
import { startSampler } from './lib/sampler.mjs'
import { name as ceilingName, measure as measureCeiling } from './measurements/ceiling.mjs'
import {
  name as engineLanesName,
  measure as measureEngineLanes,
} from './measurements/engine-lanes.mjs'
import { name as colourName, measure as measureColour } from './measurements/colour.mjs'
import {
  name as speedName,
  measure as measureSpeed,
} from './measurements/export-speed-and-format.mjs'
import { name as fidelityName, measure as measureFidelity } from './measurements/frame-fidelity.mjs'
import { name as rampName, measure as measureRamp } from './measurements/grey-ramp.mjs'
import { name as qualityName, measure as measureQuality } from './measurements/quality.mjs'
import { name as speedRampName, measure as measureSpeedRamp } from './measurements/speed-ramp.mjs'
import {
  name as speedRampAudioName,
  measure as measureSpeedRampAudio,
} from './measurements/speed-ramp-audio.mjs'
import {
  name as speedRampStabilizedName,
  measure as measureSpeedRampStabilized,
} from './measurements/speed-ramp-stabilized.mjs'
import { name as importName, measure as measureImport } from './measurements/import.mjs'
import { name as longName, measure as measureLong } from './measurements/long-export.mjs'
import {
  name as sideWorkName,
  measure as measureSideWork,
} from './measurements/import-side-work.mjs'
import {
  name as motionBlurName,
  measure as measureMotionBlur,
} from './measurements/motion-blur.mjs'
import {
  name as motionBlurPreviewName,
  measure as measureMotionBlurPreview,
} from './measurements/motion-blur-preview.mjs'
import { name as timingsName, measure as measureTimings } from './measurements/stage-timings.mjs'
import {
  name as mainThreadName,
  measure as measureMainThread,
} from './measurements/main-thread-export.mjs'
import {
  name as stabilizedExportName,
  measure as measureStabilizedExport,
} from './measurements/stabilized-export.mjs'
import {
  name as nativeExportName,
  measure as measureNativeExport,
} from './measurements/native-export.mjs'
import {
  name as stabilizationControlsName,
  measure as measureStabilizationControls,
} from './measurements/stabilization-controls.mjs'
import { name as aacSyncName, measure as measureAacSync } from './measurements/aac-sync.mjs'

const MEASUREMENTS = [
  { name: speedName, measure: measureSpeed },
  { name: fidelityName, measure: measureFidelity },
  { name: qualityName, measure: measureQuality },
  { name: colourName, measure: measureColour },
  { name: rampName, measure: measureRamp },
  { name: speedRampName, measure: measureSpeedRamp },
  { name: speedRampAudioName, measure: measureSpeedRampAudio, optIn: true },
  { name: speedRampStabilizedName, measure: measureSpeedRampStabilized, optIn: true },
  { name: importName, measure: measureImport },
  // Opt-in: it runs every kind of side work on six 18 GB clips and takes tens of minutes, so `all` leaves it out.
  { name: sideWorkName, measure: measureSideWork, optIn: true },
  { name: ceilingName, measure: measureCeiling },
  { name: engineLanesName, measure: measureEngineLanes },
  { name: timingsName, measure: measureTimings },
  // Opt-in as well: minutes long and gigabytes big.
  { name: longName, measure: measureLong, optIn: true },
  // Opt-in: two exports watched through the DevTools protocol, for task 8.3's main-thread target.
  { name: mainThreadName, measure: measureMainThread, optIn: true },
  // Opt-in: task 7.2's motion blur proof (export) and its preview twin, on the real GPU and the clips.
  { name: motionBlurName, measure: measureMotionBlur, optIn: true },
  { name: motionBlurPreviewName, measure: measureMotionBlurPreview, optIn: true },
  // Opt-in: task 6.4's stabilization proofs (a stabilized export, and the controls in the editor), on the real GPU and a 3.76 GB clip.
  { name: stabilizedExportName, measure: measureStabilizedExport, optIn: true },
  { name: stabilizationControlsName, measure: measureStabilizationControls, optIn: true },
  // Opt-in: it needs Electron and the desktop shell's FFmpeg, and writes a 10 s ProRes master.
  { name: nativeExportName, measure: measureNativeExport, optIn: true },
  { name: aacSyncName, measure: measureAacSync, optIn: true },
]
const FLAGS = {
  '--seconds': 'seconds',
  '--fidelity-seconds': 'fidelitySeconds',
  '--long-seconds': 'longSeconds',
  '--out': 'out',
}

function parseArgs(argv) {
  const flags = {}
  const names = []
  for (let i = 0; i < argv.length; i++) {
    if (FLAGS[argv[i]]) flags[FLAGS[argv[i]]] = argv[++i]
    else if (argv[i].startsWith('--')) throw new Error(`Unknown option ${argv[i]}`)
    else names.push(argv[i])
  }
  return { flags, names }
}

function usage() {
  return `Usage: BENCH_CLIP=/path/to/clip.mp4 node bench/run.mjs <${MEASUREMENTS.map((m) => m.name).join('|')}|all> [--seconds N] [--fidelity-seconds N] [--long-seconds N] [--out DIR]`
}

async function main() {
  const { flags, names } = parseArgs(process.argv.slice(2))
  if (names.length === 0) throw new Error(usage())
  const wanted = names.includes('all')
    ? MEASUREMENTS.filter((m) => !m.optIn)
    : names.map((n) => MEASUREMENTS.find((m) => m.name === n) ?? failUnknown(n))
  const config = loadConfig(process.env, flags)
  const noClip = new Set([importName, sideWorkName, longName, engineLanesName, speedRampAudioName])
  const needsImportDir = new Set([importName, sideWorkName, longName])
  requireInputs(config, {
    clip: wanted.some((m) => !noClip.has(m.name)),
    lut: wanted.some((m) => m.name === colourName),
    importDir: wanted.some((m) => needsImportDir.has(m.name)),
  })
  fs.mkdirSync(config.outDir, { recursive: true })
  const ctx = createContext(config)
  for (const measurement of wanted) {
    const started = Date.now()
    console.log(`\n== ${measurement.name}`)
    // The machine is sampled (CPU per core, GPU, browser memory) during every measurement.
    ctx.sampler = await startSampler()
    let record
    let machineSampler
    try {
      record = await measurement.measure(ctx)
    } finally {
      machineSampler = await ctx.sampler.stop()
      ctx.sampler = null
    }
    record.sampler = machineSampler
    record.measurementSeconds = Math.round((Date.now() - started) / 1000)
    const file = path.join(config.outDir, `${measurement.name}.json`)
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
    console.log(`   wrote ${file} (${record.measurementSeconds} s)`)
    // A measurement that judges itself (the long export) says why it failed; the command then fails too.
    if (record.failure) {
      console.error(`\n   FAILED: ${record.failure}`)
      process.exitCode = 1
    }
  }
}

function failUnknown(name) {
  throw new Error(`Unknown measurement "${name}".\n${usage()}`)
}

main().catch((error) => {
  console.error(`\nBenchmark failed: ${error.message}`)
  process.exit(1)
})
