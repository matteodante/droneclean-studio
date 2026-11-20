// Where is the motion? Samples 9 frames every 10 s of the benchmark clip and prints the mean absolute difference of
// consecutive frames (luma, 480x360): a rough proxy to choose sections for the quality comparison of run.mjs.
//   ../scripts/heavy.sh -- node bench/flow-probe/survey.mjs
import { spawnSync } from 'node:child_process'

const clip = process.env.BENCH_CLIP
if (!clip) throw new Error('set BENCH_CLIP (scripts/local-paths.env)')
const rows = []
for (let t = 5; t < 228; t += 10) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(t),
      '-i',
      clip,
      '-frames:v',
      '9',
      '-vf',
      'scale=480:360,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  )
  const v = [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1])).slice(1)
  rows.push({ t, meanAbsDiff: v.reduce((a, b) => a + b, 0) / v.length })
  console.log(`${String(t).padStart(4)} s  ${rows.at(-1).meanAbsDiff.toFixed(2)}`)
}
