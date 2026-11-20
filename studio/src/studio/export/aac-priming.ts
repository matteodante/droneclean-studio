/**
 * AAC encoder priming, and how an export keeps it out of the MP4's edit list.
 *
 * An AAC encoder emits `p` frames of priming ahead of the sound it was given (2,112 for Chromium's, 44 ms at
 * 48 kHz). mediabunny stamps the packets `p` early so the picture and the sound stay in step, and for a first
 * timestamp below zero the MP4 muxer writes an edit list (`edts`) that skips the priming. Meta's Reel
 * specification asks for no edit lists, so the export gives the encoder its sound starting at `p` instead of 0:
 * the first packet is then stamped exactly 0, no edit list is written, and the decoder's own `p` frames of delay
 * land the sound at its time. The cost is the first `p` frames of the sound (44 ms, the same as the
 * `atrim=start_sample` the 19 Nov reel was fixed with in FFmpeg).
 *
 * `p` is measured the way mediabunny measures it (an impulse through the encoder and a decoder), because the
 * library keeps the value to itself: if the two ever differ, the first packet is not at 0 and the file keeps its
 * edit list, which still plays in step.
 */

const SAMPLE_RATE = 48_000
const IMPULSE_INDEX = 4096
const AAC_LC = 'mp4a.40.2'

let measured: Promise<number> | null = null

/** The AAC encoder's priming in frames at 48 kHz (measured once). Rejects where WebCodecs has no AAC encoder. */
export function detectAacPrimingFrames(): Promise<number> {
  measured ??= measure().catch((error) => {
    measured = null
    throw error
  })
  return measured
}

async function measure(): Promise<number> {
  const config: AudioEncoderConfig = {
    codec: AAC_LC,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
    aac: { format: 'aac' },
  }
  const chunks: EncodedAudioChunk[] = []
  let decoderConfig: AudioDecoderConfig | null = null
  let failure: unknown = null
  let peakIndex = -1
  let peakValue = -Infinity
  let decoded = 0

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      decoderConfig ??= meta?.decoderConfig ?? null
      chunks.push(chunk)
    },
    error: (error) => {
      failure ??= error
    },
  })
  const decoder = new AudioDecoder({
    output: (audio) => {
      const values = new Float32Array(audio.numberOfFrames)
      audio.copyTo(values, { planeIndex: 0, format: 'f32-planar' })
      audio.close()
      for (let i = 0; i < values.length; i++) {
        if (values[i]! > peakValue) {
          peakValue = values[i]!
          peakIndex = decoded + i
        }
      }
      decoded += values.length
    },
    error: (error) => {
      failure ??= error
    },
  })

  try {
    encoder.configure(config)
    const data = new Float32Array(2 * IMPULSE_INDEX)
    data[IMPULSE_INDEX] = 1
    const audio = new AudioData({
      data,
      format: 'f32-planar',
      numberOfChannels: 1,
      numberOfFrames: data.length,
      sampleRate: SAMPLE_RATE,
      timestamp: 0,
    })
    encoder.encode(audio)
    audio.close()
    await encoder.flush()
    if (!decoderConfig || chunks.length === 0) throw new Error('the AAC encoder produced no output')
    decoder.configure(decoderConfig)
    for (const chunk of chunks) decoder.decode(chunk)
    await decoder.flush()
  } catch (error) {
    throw failure ?? error
  } finally {
    if (encoder.state !== 'closed') encoder.close()
    if (decoder.state !== 'closed') decoder.close()
  }
  if (peakIndex < 0) throw new Error('the AAC priming measurement found no impulse')
  const firstChunkFrames = Math.round((chunks[0]!.timestamp / 1e6) * SAMPLE_RATE)
  return Math.max(0, peakIndex - IMPULSE_INDEX + firstChunkFrames)
}

/**
 * How many leading frames of the stream are still to be dropped. One lives per export; each chunk of sound
 * goes through `take` before it is handed to the encoder.
 */
export class LeadingTrim {
  private remainingSeconds: number

  constructor(primingFrames: number) {
    this.remainingSeconds = primingFrames / SAMPLE_RATE
  }

  /** Frames to cut from the front of a chunk of `frameCount` frames at `sampleRate`. */
  take(frameCount: number, sampleRate: number): number {
    if (this.remainingSeconds <= 0) return 0
    const wanted = Math.round(this.remainingSeconds * sampleRate)
    const dropped = Math.min(wanted, frameCount)
    this.remainingSeconds -= dropped / sampleRate
    if (dropped === wanted) this.remainingSeconds = 0
    return dropped
  }
}
