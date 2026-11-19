#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool */
// Prints, for this machine, each stage's time per frame (mean and 95th percentile) next to the `ceiling` record, and
// names the slowest stage. Reads the records `node bench/run.mjs stage-timings` and `... ceiling` wrote.
//
//   node bench/report.mjs [--dir bench/.cache/results]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSummary } from './lib/timings.mjs'

/** Reads `<dir>/<name>.json`; null when absent. */
function readRecord(dir, name) {
  const file = path.join(dir, `${name}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

/** The ceiling lines: FFmpeg's own decode and encode speed, as frames per second and milliseconds per frame. */
function ceilingLines(ceiling) {
  if (!ceiling) return ['ceiling: no record (run: node bench/run.mjs ceiling)']
  const rows = []
  const decode = ceiling.result?.decode
  const ms = (fps) => (fps ? (1000 / fps).toFixed(1) : '-')
  if (decode?.ran)
    rows.push(
      `  FFmpeg decode alone, hardware      ${decode.framesPerSecond} fps = ${ms(decode.framesPerSecond)} ms per frame`,
    )
  for (const e of ceiling.result?.encodes ?? []) {
    rows.push(
      e.ran
        ? `  FFmpeg ${e.label}  ${e.framesPerSecond} fps = ${ms(e.framesPerSecond)} ms per frame (decode, encode and write together)`
        : `  FFmpeg ${e.label}  did not run: ${e.error}`,
    )
  }
  return ['ceiling (FFmpeg alone, hardware codecs, same clip):', ...rows]
}

/** The whole report as text. */
export function buildReport(stageRecord, ceilingRecord) {
  if (!stageRecord) return 'No stage-timings record (run: node bench/run.mjs stage-timings)'
  const lines = []
  const m = stageRecord.machine ?? {}
  lines.push(
    `Machine: ${m.model ?? '?'} ${m.chip ?? ''} ${m.memoryGiB ?? '?'} GB (${stageRecord.date?.slice(0, 10)}, commit ${stageRecord.git?.commit?.slice(0, 9) ?? '?'})`,
  )
  lines.push('')
  lines.push(...ceilingLines(ceilingRecord))
  for (const run of stageRecord.result.runs) {
    lines.push('')
    if (run.ran === false) {
      lines.push(`${run.label}: did not run: ${run.error}`)
      continue
    }
    const fps = run.kind === 'export' ? run.framesPerSecond : run.steadyFramesPerSecond
    lines.push(
      formatSummary(`${run.label}  (${fps} fps, ${run.frames} frames)`, run.summary, {
        wallMsPerFrame: run.wallMsPerFrame,
      }),
    )
    const s = run.summary
    if (s.slowest)
      lines.push(
        `  slowest stage: ${s.slowest} (${s.stages[s.slowest].meanPerFrameMs.toFixed(2)} ms per frame)`,
      )
  }
  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dirIndex = args.indexOf('--dir')
  const dir =
    dirIndex >= 0 ? path.resolve(args[dirIndex + 1]) : path.join(here, '.cache', 'results')
  console.log(buildReport(readRecord(dir, 'stage-timings'), readRecord(dir, 'ceiling')))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
