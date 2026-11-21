// How pre-rendered frames are stored (design `docs/designs/prerender-preview.md` §0.3): encoded with WebCodecs into
// memory, never as raw pixels (a minute of 1080p RGBA is about 30 GB; encoded at 1080p60 it is about 230 MB). The first codec
// this machine can both encode and decode at the render size wins: H.264 (hardware on every Mac and most PCs), then
// VP9, then VP8. No reordered frames (`latencyMode: 'realtime'`), so every chunk comes out in display order and a
// group of pictures depends only on its own key frame.

/**
 * Bits per pixel per frame: about 31 Mbit/s at 1080p60. Measured on clip 0020 at 928x522 (design §2.3): a cached frame
 * reads 33.5-40.9 dB from the frame as rendered (0.6 bit per pixel buys 2-3 dB more for 2.4 times the memory).
 */
const BITS_PER_PIXEL = 0.25
/** The ceiling of the bitrate, whatever the size and rate */
const MAX_BITRATE = 50_000_000

/** A key frame every half second: playback can start anywhere in under half a second of decoding */
export function keyFrameInterval(fps: number): number {
  return Math.max(1, Math.round((Number.isFinite(fps) && fps > 0 ? fps : 30) / 2))
}

export interface PrerenderCodec {
  readonly encoder: VideoEncoderConfig
  readonly decoder: VideoDecoderConfig
}

/** What the choice needs from WebCodecs; the tests pass their own */
export interface CodecSupport {
  encoderSupported(config: VideoEncoderConfig): Promise<boolean>
  decoderSupported(config: VideoDecoderConfig): Promise<boolean>
}

/** The candidates, in order of preference */
const CANDIDATES: ReadonlyArray<{
  codec: string
  extra?: Pick<VideoEncoderConfig, 'avc'>
}> = [
  // High profile, level 5.1: up to 4096x2304 at 30 and 1920x1080 at 120
  { codec: 'avc1.640033', extra: { avc: { format: 'annexb' } } },
  { codec: 'vp09.00.41.08' },
  { codec: 'vp8' },
]

/** The machine's WebCodecs, or `null` where the page has none (a worker without it, Node) */
export function browserCodecSupport(): CodecSupport | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return null
  return {
    async encoderSupported(config) {
      try {
        return (await VideoEncoder.isConfigSupported(config)).supported === true
      } catch {
        return false
      }
    },
    async decoderSupported(config) {
      try {
        return (await VideoDecoder.isConfigSupported(config)).supported === true
      } catch {
        return false
      }
    },
  }
}

/**
 * The first codec the machine can encode and decode at `width`x`height` and `fps`, or `null` when there is none (the
 * pre-render then says so and the preview stays live). Sizes are rounded to even, as H.264 needs.
 */
export async function pickPrerenderCodec(
  support: CodecSupport,
  size: { width: number; height: number },
  fps: number,
): Promise<PrerenderCodec | null> {
  const width = Math.max(2, Math.round(size.width / 2) * 2)
  const height = Math.max(2, Math.round(size.height / 2) * 2)
  const framerate = Number.isFinite(fps) && fps > 0 ? fps : 30
  const bitrate = Math.min(MAX_BITRATE, Math.round(width * height * framerate * BITS_PER_PIXEL))
  for (const candidate of CANDIDATES) {
    const encoder: VideoEncoderConfig = {
      codec: candidate.codec,
      width,
      height,
      framerate,
      bitrate,
      bitrateMode: 'variable',
      latencyMode: 'realtime',
      ...candidate.extra,
    }
    const decoder: VideoDecoderConfig = {
      codec: candidate.codec,
      codedWidth: width,
      codedHeight: height,
    }
    if ((await support.encoderSupported(encoder)) && (await support.decoderSupported(decoder))) {
      return { encoder, decoder }
    }
  }
  return null
}
