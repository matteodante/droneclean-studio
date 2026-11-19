// 3. Quality: PSNR and SSIM of the untouched exports against the source segment, frame by frame after the two have
// been lined up (the project and the clip are both 59.94, so the pairing is one to one; it stays robust if a frame
// is repeated).
import { alignedSelections, matchFrames, summariseMatches } from '../lib/align.mjs'
import { decodeSmallGrey } from '../lib/frames.mjs'
import { complementOf, measureQuality } from '../lib/quality.mjs'
import { describeExport } from './describe.mjs'

export const name = 'quality'

export async function measure(ctx) {
  const segment = await ctx.segment(ctx.config.segmentSeconds)
  const source = await decodeSmallGrey(segment.file)
  const result = {}
  for (const [label, kind] of [
    ['ultraAutoBitrate', 'auto'],
    ['custom120Mbps', 'custom'],
  ]) {
    const run = await ctx.export({ what: 'segment', kind })
    const output = await decodeSmallGrey(run.outFile)
    const matched = matchFrames(source, output)
    const summary = summariseMatches(matched.matches, source.length)
    const entry = {
      export: describeExport(run),
      alignment: { ...summary, ambiguousMatches: matched.ambiguousOutputFrames.length },
    }
    if (summary.outOfOrderFrames > 0) {
      entry.skipped = 'frames are out of order, so no frame pairing is possible'
    } else {
      const { keepOutput, keepSource } = alignedSelections(matched.matches, source.length)
      Object.assign(
        entry,
        measureQuality(run.outFile, segment.file, {
          dropOutput: complementOf(keepOutput, output.length),
          dropSource: complementOf(keepSource, source.length),
        }),
      )
      entry.pairedFrames = keepOutput.length
    }
    result[label] = entry
  }
  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: ctx.config.segmentSeconds,
      method:
        "FFmpeg's psnr and ssim filters on all planes at full size, both sides as 10-bit YUV 4:2:0 (an 8-bit export is scaled by four, exactly); frames paired by the match to the source, a repeated output frame is left out",
    },
    result,
  }
}
