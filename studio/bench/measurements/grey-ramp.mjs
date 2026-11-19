// 5. Grey ramp: an identity project of the 10-bit ramp (877 grey levels in each row), exported; how many different
// grey levels per row survive in the file. Expected today: at most 256, 8-bit file. Target after the engine work: 800+.
import { distinctLevelsPerRow, decodeLuma10, summariseCounts } from '../lib/levels.mjs'
import { RAMP_SCORED_FROM_ROW } from '../lib/inputs.mjs'
import { describeExport } from './describe.mjs'

export const name = 'grey-ramp'

const TARGET_LEVELS = 800

export async function measure(ctx) {
  const ramp = await ctx.ramp()
  const run = await ctx.export({ what: 'ramp', kind: 'custom' })
  const described = describeExport(run)
  const { width, height } = described.file
  const luma = decodeLuma10(run.outFile, width, height, 10)
  const perRow = distinctLevelsPerRow(luma, width, height)
  const scored = summariseCounts(perRow.slice(RAMP_SCORED_FROM_ROW))
  return {
    ...(await ctx.header(name, { ramp })),
    parameters: {
      project: '3840x2880 at 30 fps, one clip, no effect, no transform',
      exportSettings: 'H.265 MP4, custom 120 Mbps',
      framesDecoded: 'frame 10 of the export',
      rowsScored: `rows ${RAMP_SCORED_FROM_ROW} to ${height - 1} (the ramp file itself is coarser in its top rows)`,
      unit: "distinct luma code values per row, counted at 10-bit scale without any range or colour conversion (an 8-bit file's values are scaled by 4, exactly)",
      sourceLevelsPerRow: ramp.distinctLevelsPerRow.scoredRows,
    },
    result: {
      distinctLevelsPerRow: scored,
      fileBitDepth: described.file.bitDepth,
      filePixelFormat: described.file.pixelFormat,
      targetAfterEngineWork: `at least ${TARGET_LEVELS}`,
      meetsTarget: scored.min >= TARGET_LEVELS,
      export: described,
    },
  }
}
