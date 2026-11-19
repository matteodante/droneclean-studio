// The project's sound for a native 10-bit export (the desktop's FFmpeg writes the file, so it needs the sound as a
// second input). The page mixes the project's audio with FreeCut's own export mix (`processAudio`, or the 30-second
// windows of `processAudioWindows` for a long project, chosen by the same policy the normal export uses), cuts it
// into short pieces of interleaved stereo `float32` at 48 kHz and POSTs them in order to the shell
// (`droneclean-encode://audio/<jobId>/<n>`, `desktop/src/main/media/audio-protocol.ts`), which appends them to a
// temporary file. `encode.start` then gives FFmpeg that file. A project with no sound sends nothing, and its master
// has no audio stream.
//
// Memory: a window is at most 30 s (11.5 MB of planar float) and a piece 5 s (1.9 MB); a project that cannot be
// mixed in windows (speed, pitch or EQ on a clip) or is shorter than five minutes is mixed whole, as the normal
// export does: 384 KB per second, 461 MB for twenty minutes.

import type { CompositionInputProps } from '@/types/export'

/** The mix rate and channels of every export (`runtime/renderer/audio`): the shell's `-ar 48000 -ac 2` */
export const MIX_SAMPLE_RATE = 48_000
const MIX_CHANNELS = 2

/** The longest piece sent in one POST, in seconds of sound */
export const PIECE_SECONDS = 5

/** A stretch of the mix as the audio pipeline yields it: one `Float32Array` per channel */
export interface MixWindow {
  readonly samples: Float32Array[]
  readonly sampleRate: number
  readonly channels: number
}

/** The project's mix: whether there is sound, and its windows in order */
export interface ProjectMix {
  hasAudio(composition: CompositionInputProps): Promise<boolean>
  windows(composition: CompositionInputProps, signal?: AbortSignal): AsyncIterable<MixWindow>
}

/** The shell's audio route for a job, which `audio-protocol.ts` parses */
export function audioPieceUrl(jobId: string, part: number | 'end', chunks?: number): string {
  const base = `droneclean-encode://audio/${jobId}/${part}`
  return part === 'end' ? `${base}?chunks=${chunks ?? 0}` : base
}

/** What the shell counted of a sent mix */
export interface SentMix {
  readonly chunks: number
  readonly samples: number
}

export interface SendMixOptions {
  readonly jobId: string
  readonly signal?: AbortSignal
  readonly mix?: ProjectMix
  readonly fetch?: typeof fetch
}

/** FreeCut's export mix, loaded when a native export asks for it */
function exportMix(): ProjectMix {
  return {
    async hasAudio(composition) {
      return (await import('@/runtime/renderer/canvas-audio')).hasAudioContent(composition)
    },
    async *windows(composition, signal) {
      const audio = await import('@/runtime/renderer/canvas-audio')
      const { shouldUseWindowedAudioProcessing } = await import(
        '@/runtime/renderer/render-export-policy'
      )
      const seconds = (composition.durationInFrames ?? 0) / composition.fps
      if (
        shouldUseWindowedAudioProcessing({
          hasAudioContent: true,
          durationSeconds: seconds,
          supportsWindowedProcessing: () => audio.supportsWindowedAudioProcessing(composition),
        })
      ) {
        yield* audio.processAudioWindows(composition, signal)
        return
      }
      const whole = await audio.processAudio(composition, signal)
      if (whole !== null) yield whole
    },
  }
}

/** Interleaves `frames` sample frames of a window, from `offset`, into stereo bytes */
function interleave(window: MixWindow, offset: number, frames: number): Uint8Array {
  const left = window.samples[0] ?? new Float32Array(0)
  const right = window.samples[1] ?? left
  const out = new Float32Array(frames * MIX_CHANNELS)
  for (let index = 0; index < frames; index += 1) {
    out[index * 2] = left[offset + index] ?? 0
    out[index * 2 + 1] = right[offset + index] ?? 0
  }
  return new Uint8Array(out.buffer)
}

async function post(doFetch: typeof fetch, url: string, body: Uint8Array | null): Promise<void> {
  const response = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    ...(body === null ? {} : { body: body as BodyInit }),
  })
  if (!response.ok) {
    throw new Error(`native audio: ${response.status} ${(await response.text()).trim()}`)
  }
}

/**
 * Mixes the project's sound and sends it to the shell for `jobId`. Returns what the shell counted, or `null` when the
 * project has no sound (nothing was sent). A failure or an abort rejects; the caller cancels the job, which makes the
 * shell remove what it staged.
 */
export async function sendProjectMix(
  composition: CompositionInputProps,
  options: SendMixOptions,
): Promise<SentMix | null> {
  const mix = options.mix ?? exportMix()
  const doFetch = options.fetch ?? fetch
  if (!(await mix.hasAudio(composition))) return null

  const pieceFrames = PIECE_SECONDS * MIX_SAMPLE_RATE
  let chunks = 0
  let samples = 0
  for await (const window of mix.windows(composition, options.signal)) {
    if (window.sampleRate !== MIX_SAMPLE_RATE || window.channels !== MIX_CHANNELS) {
      throw new Error(
        `native audio: the mix is ${window.channels} channels at ${window.sampleRate} Hz, the encoder takes ${MIX_CHANNELS} at ${MIX_SAMPLE_RATE}`,
      )
    }
    const total = window.samples[0]?.length ?? 0
    for (let offset = 0; offset < total; offset += pieceFrames) {
      if (options.signal?.aborted === true) throw new DOMException('Audio cancelled', 'AbortError')
      const frames = Math.min(pieceFrames, total - offset)
      await post(doFetch, audioPieceUrl(options.jobId, chunks), interleave(window, offset, frames))
      chunks += 1
      samples += frames
    }
  }
  if (chunks === 0) return null
  await post(doFetch, audioPieceUrl(options.jobId, 'end', chunks), null)
  return { chunks, samples }
}
