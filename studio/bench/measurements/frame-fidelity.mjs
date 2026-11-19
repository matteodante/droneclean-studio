// 2. Frame fidelity: is every source frame present exactly once, in order? The editor's project is 59.94
// (60000/1001), the clip is 59.94 too, so output frame n must show source frame n: the 1,199 source frames of a
// 20 s cut become 1,199 output frames, with no repeat and no skip. The file must carry that exact rate: a 1/60000
// clock with 1,001 ticks per frame, declared as 60000/1001 (design 1.5, section 4.5).
import { matchFrames, nearDuplicateOutputFrames, summariseMatches } from '../lib/align.mjs'
import { decodeSmallGrey } from '../lib/frames.mjs'
import { describeExport } from './describe.mjs'

export const name = 'frame-fidelity'

/**
 * The design's "done when" (section 4.5), read from the facts of one export: as many output frames as the cut
 * has, every source frame exactly once and in order, on a 1/60000 clock with 1,001 ticks per frame, and the file
 * declaring 60000/1001.
 *
 * It is written into the record as `doneWhen`; `bench/test/frame-fidelity.test.mjs` holds it to the design's
 * numbers and to the old 60 fps record's, which fails with the reasons spelled out.
 *
 * @param {object} facts the measurement's `result`, without `doneWhen`
 */
export function checkDoneWhen(facts) {
  const problems = []
  const note = (holds, problem) => {
    if (!holds) problems.push(problem)
  }
  note(
    Number.isInteger(facts.outputFrames) && facts.outputFrames === facts.sourceFrames,
    `outputFrames ${facts.outputFrames} is not sourceFrames ${facts.sourceFrames}`,
  )
  note(
    facts.everySourceFrameExactlyOnceInOrder === true,
    'not every source frame is shown exactly once, in order',
  )
  note(facts.repeatedFrames === 0, `repeatedFrames is ${facts.repeatedFrames}, not 0`)
  note(facts.skippedSourceFrames === 0, `skippedSourceFrames is ${facts.skippedSourceFrames}, not 0`)
  const timestamps = facts.timestamps ?? {}
  note(timestamps.timeBase === '1/60000', `timestamps.timeBase is ${timestamps.timeBase}, not 1/60000`)
  const gaps = timestamps.distinctGapsInTicks ?? []
  const expectedGaps = Math.max(0, facts.outputFrames - 1)
  note(
    gaps.length === 1 && gaps[0].gap === 1001 && gaps[0].count === expectedGaps,
    `tick gaps are ${JSON.stringify(gaps)}, not ${expectedGaps} of 1,001`,
  )
  note(
    facts.declaredFrameRate === '60000/1001',
    `declaredFrameRate is ${facts.declaredFrameRate}, not 60000/1001`,
  )
  return { holds: problems.length === 0, problems }
}

export async function measure(ctx) {
  const seconds = ctx.config.fidelitySeconds
  const segment = await ctx.segment(seconds)
  const run = await ctx.export({ what: 'segment', kind: 'custom', seconds })
  const source = await decodeSmallGrey(segment.file)
  const output = await decodeSmallGrey(run.outFile)
  const matched = matchFrames(source, output)
  const summary = summariseMatches(matched.matches, source.length)
  const ambiguous = new Set(matched.ambiguousOutputFrames)
  summary.repeated = summary.repeated.map((r) => ({
    ...r,
    matchWasAmbiguous: ambiguous.has(r.outputFrame),
  }))
  const secondOpinion = nearDuplicateOutputFrames(output)
  const confirmed = summary.repeated.filter((r) =>
    secondOpinion.outputFrames.includes(r.outputFrame),
  ).length
  const described = describeExport(run)
  const facts = {
    ...summary,
    ambiguousMatches: ambiguous.size,
    worstMatchDistance: Math.max(...matched.bestDistances),
    secondOpinionWithoutSource: { ...secondOpinion, listedRepeatsAlsoFoundByIt: confirmed },
    timestamps: described.file.timestamps,
    declaredFrameRate: described.file.declaredFrameRate,
  }
  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: seconds,
      projectFps: '59.94 (60000/1001), the clip rate exactly: every source frame has one output frame',
      exportSettings:
        'H.265 MP4, custom 120 Mbps (so that the encoder noise stays far below the difference between frames)',
      method:
        'every frame of the source and of the export is reduced to a 192x144 grey picture; each output frame is matched to the source frame with the smallest sum of absolute differences, searched along the sequence',
      expectedRepeats: 0,
      expectedSkippedSourceFrames: 0,
      expectedByDesign:
        'outputFrames = sourceFrames, every source frame exactly once in order, timestamps on a 1/60000 clock with 1,001 ticks per frame, the file declaring 60000/1001 (design 1.5, section 4.5)',
    },
    result: {
      ...facts,
      doneWhen: checkDoneWhen(facts),
      export: described,
    },
  }
}
