// 4. Colour: the segment with the bench's generated grade LUT (lib/lut.mjs) applied, exported; one fixed frame of the file against a
// 16-bit reference made by FFmpeg from the same source frame with the same LUT (tetrahedral interpolation).
// Two more comparisons say where the error comes from: the same frame as a PNG straight from the render path
// (no video encoder), and an export with no LUT against a reference with no LUT (what the encode alone costs).
import fs from 'node:fs'
import path from 'node:path'
import { compareToReference, readingOf } from '../lib/colour.mjs'
import { decodePngRgb, decodeRgbFrame } from '../lib/frames.mjs'
import { describeExport } from './describe.mjs'

export const name = 'colour'

const as16 = (raw) => new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))
const as8 = (raw) => new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))

/** Compare `actual` with the reference of each candidate source frame; keep the closest. */
function closestReference(actual, segmentFile, candidates, lut) {
  const tried = []
  let best = null
  for (const frame of candidates) {
    const raw = decodeRgbFrame(segmentFile, frame, {
      matrix: 'bt709',
      range: 'tv',
      format: 'rgb48le',
      lut,
    })
    const comparison = compareToReference(actual, as16(raw))
    tried.push({
      sourceFrame: frame,
      meanAbsError: comparison.allChannels.meanAbsError,
    })
    if (!best || comparison.allChannels.meanAbsError < best.comparison.allChannels.meanAbsError) {
      best = { sourceFrame: frame, comparison }
    }
  }
  return { ...best, tried }
}

export async function measure(ctx) {
  const { config } = ctx
  const segment = await ctx.segment(config.segmentSeconds)
  const lut = await ctx.lut()
  const run = await ctx.export({ what: 'segment-lut', kind: 'custom' })
  const plain = await ctx.export({ what: 'segment', kind: 'custom' })
  const described = describeExport(run)
  const reading = readingOf(described.file.colour)
  const frame = config.colourFrame
  // The LUT path for FFmpeg: a copy with a plain name, so that no filter-graph quoting is needed.
  const lutCopy = path.join(config.cache, 'lut.cube')
  fs.copyFileSync(config.lut, lutCopy)
  // The project and the clip are both 59.94, so output frame n shows source frame n; the neighbours are still
  // tried, because a still scene can pair ambiguously.
  const candidates = [frame - 2, frame - 1, frame, frame + 1].filter((j) => j >= 0)

  const file = closestReference(
    as8(decodeRgbFrame(run.outFile, frame, { ...reading, format: 'rgb24' })),
    segment.file,
    candidates,
    lutCopy,
  )
  const still = compareToReference(
    as8(decodePngRgb(run.stills[frame])),
    as16(
      decodeRgbFrame(segment.file, file.sourceFrame, {
        matrix: 'bt709',
        range: 'tv',
        format: 'rgb48le',
        lut: lutCopy,
      }),
    ),
  )
  const noLut = closestReference(
    as8(decodeRgbFrame(plain.outFile, frame, { ...reading, format: 'rgb24' })),
    segment.file,
    candidates,
    null,
  )

  return {
    ...(await ctx.header(name, {
      segment,
      lut: {
        file: lut.file,
        generated: config.lutGenerated,
        title: lut.title,
        size: lut.size,
        sha256: lut.sha256,
      },
    })),
    parameters: {
      segmentSeconds: config.segmentSeconds,
      outputFrame: frame,
      referenceSourceFrame: file.sourceFrame,
      sourceFramesTried: file.tried,
      reference:
        'FFmpeg: the 10-bit source frame to 16-bit RGB (BT.709 limited range, accurate rounding, full chroma interpolation), then lut3d with tetrahedral interpolation',
      outputRead: `the export's frame decoded with ${reading.matrix}/${reading.range}${reading.assumed ? ' (assumed: the file does not say)' : " (from the file's tags)"} to 8-bit RGB`,
      errorUnit:
        '8-bit levels: |output - reference / 257|; the mean is over every pixel and channel of the 3840x2880 frame',
    },
    result: {
      headline: {
        meanAbsErrorLevels: file.comparison.allChannels.meanAbsError,
        maxAbsErrorLevels: file.comparison.allChannels.maxAbsError,
        perChannelMeanAbsErrorLevels: Object.fromEntries(
          Object.entries(file.comparison.perChannel).map(([c, v]) => [c, v.meanAbsError]),
        ),
        perChannelMaxAbsErrorLevels: Object.fromEntries(
          Object.entries(file.comparison.perChannel).map(([c, v]) => [c, v.maxAbsError]),
        ),
      },
      exportedFileWithLut: file.comparison,
      whereTheErrorComesFrom: {
        pngFromRenderPathWithLut: {
          what: 'the same frame rendered to a PNG by the render path (no video encoder, no 4:2:0), against the same reference',
          ...still,
        },
        exportedFileWithoutLut: {
          what: 'the untouched export (no LUT) against a reference with no LUT: the cost of decode, 8-bit RGB, encode and 4:2:0 alone',
          referenceSourceFrame: noLut.sourceFrame,
          ...noLut.comparison,
        },
      },
      export: described,
    },
  }
}
