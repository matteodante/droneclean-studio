/**
 * The validated `encode.start` request (task 3.3, slice P5): anything that is not
 * exactly the contract's shape is a refusal the page can read. No Electron import,
 * so a test loads it under plain Node.
 */
import path from 'node:path'
import {
  NATIVE_JOB_ID_PATTERN,
  type ColourTags,
  type EncodeStartRequest,
  type PreciseExportFormatId,
  type PreciseOutputFormat,
} from '../../shared/native-media'

const FORMATS: readonly PreciseExportFormatId[] = [
  'hevc-main10',
  'prores-422-hq',
  'h264-8bit',
  'hevc-8bit',
]

const MATRICES = ['bt709', 'bt470bg', 'smpte170m', 'bt2020nc', 'unknown']
const RANGES = ['tv', 'pc', 'unknown']
const TRANSFERS = ['bt709', 'smpte170m', 'linear', 'bt2020-10', 'smpte2084', 'arib-std-b67', 'unknown']
const PRIMARIES = ['bt709', 'bt470bg', 'smpte170m', 'bt2020', 'unknown']

/** The validated `encode.start` request; anything else is a refusal the page can read. */
export function parseEncodeStartRequest(raw: unknown): EncodeStartRequest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('encode.start: the request must be an object')
  }
  const record = raw as Record<string, unknown>
  const { jobId, path: file, format, readback, bitrate, fps, tags, width, height } = record

  if (typeof jobId !== 'string' || !NATIVE_JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`encode.start: not a job id: ${JSON.stringify(jobId)}`)
  }
  if (typeof file !== 'string' || file === '' || !path.isAbsolute(file)) {
    throw new Error(`encode.start: the path must be absolute, got ${JSON.stringify(file)}`)
  }
  if (typeof format !== 'string' || !(FORMATS as readonly string[]).includes(format)) {
    throw new Error(`encode.start: not an export format: ${JSON.stringify(format)}`)
  }
  if (readback !== 'p010le' && readback !== 'rgba64le') {
    throw new Error(`encode.start: not a readback format: ${JSON.stringify(readback)}`)
  }
  if (typeof bitrate !== 'number' || !Number.isSafeInteger(bitrate) || bitrate < 1) {
    throw new Error(`encode.start: the bitrate must be a positive integer, got ${String(bitrate)}`)
  }
  const rate = fps as { num?: unknown; den?: unknown } | null
  if (
    typeof rate !== 'object' ||
    rate === null ||
    typeof rate.num !== 'number' ||
    typeof rate.den !== 'number' ||
    !Number.isSafeInteger(rate.num) ||
    !Number.isSafeInteger(rate.den) ||
    rate.num < 1 ||
    rate.den < 1
  ) {
    throw new Error('encode.start: the rate must be { num, den } of positive integers')
  }
  const tag = tags as Record<string, unknown> | null
  if (
    typeof tag !== 'object' ||
    tag === null ||
    !MATRICES.includes(String(tag.matrix)) ||
    !RANGES.includes(String(tag.range)) ||
    !TRANSFERS.includes(String(tag.transfer)) ||
    !PRIMARIES.includes(String(tag.primaries))
  ) {
    throw new Error('encode.start: the tags must be a colour tag set')
  }
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('encode.start: the width and height must be numbers')
  }
  return {
    jobId,
    path: file,
    format: format as PreciseExportFormatId,
    readback: readback as PreciseOutputFormat,
    bitrate,
    fps: { num: rate.num, den: rate.den },
    tags: tag as unknown as ColourTags,
    width,
    height,
  }
}

