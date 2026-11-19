// The render loop of a native 10-bit export (design 3.6 sections 2.15 and 2.16, plan tasks 3.3 and 8.4), in the realm
// that renders it: the export worker, or the page when the export renders there. It is FreeCut's own export renderer
// (`createCompositionRenderer`, the composite, the effects, the stages) with two things switched on for its length:
//
//   the session   (`precise/native-session.ts`): every video clip is drawn through the stages, and the renderer's
//                 provider reads it from its file on disk through the desktop's FFmpeg (`frames/backends/native.ts`);
//   the sink      (`precise/p010-out.ts`): the renderer composites in `rgba16float` and hands each finished frame to
//                 the encode stream, which packs it to `p010le` on the GPU and posts it to the encoder the page started.
//
// No WebCodecs encoder and no muxer run: the desktop's FFmpeg writes the file. Both switches are cleared on every way
// out, and a failed or cancelled export cancels the encode, which removes the partial file.

import { EffectsPipeline } from '@/infrastructure/gpu-effects/effects-pipeline'
import { createCompositionRenderer } from '@/runtime/renderer/client-render-engine'
import type {
  ClientExportSettings,
  ClientRenderResult,
  RenderProgress,
} from '@/runtime/renderer/client-renderer'
import { EXPORT_FORMATS, setPreciseOutputSink } from '@/studio/render/precise/contract'
import { setNativeExportSession } from '@/studio/render/precise/native-session'
import { openNativeEncodeStream } from '@/studio/render/precise/p010-out'
import type { CompositionInputProps } from '@/types/export'
import type { NativeExportPlan } from './native-export'
import type { NativeDecodeBridge } from './native-relay'

export interface NativeRenderOptions {
  readonly settings: ClientExportSettings
  readonly composition: CompositionInputProps
  readonly onProgress: (progress: RenderProgress) => void
  readonly signal?: AbortSignal
  readonly plan: NativeExportPlan
  /** The shell's decode IPC: the page's preload, or its relay in the worker */
  readonly bridge: NativeDecodeBridge
}

/** The MIME type of a format's container */
function mimeTypeOf(plan: NativeExportPlan): string {
  const format = EXPORT_FORMATS.find((entry) => entry.id === plan.target.format)
  return format?.container === 'mov' ? 'video/quicktime' : 'video/mp4'
}

function aborted(): DOMException {
  return new DOMException('Render cancelled', 'AbortError')
}

/**
 * Renders `composition` into the encode job of `plan`. The result's blob is empty: the file is where the caller asked
 * for it (`plan.target.path`), written by the desktop's encoder.
 */
export async function renderNativeComposition(
  options: NativeRenderOptions,
): Promise<ClientRenderResult> {
  const { settings, composition, onProgress, signal, plan, bridge } = options
  const totalFrames = composition.durationInFrames ?? 0
  const { width, height, jobId, frameBytes } = plan.encode
  if (totalFrames <= 0) throw new Error('Composition has no duration')
  if (settings.resolution.width !== width || settings.resolution.height !== height) {
    throw new Error(
      `A 10-bit export is written at the project's size (${width}x${height}); ` +
        `${settings.resolution.width}x${settings.resolution.height} is not supported yet`,
    )
  }
  const device = await EffectsPipeline.requestCachedDevice()
  if (device === null)
    throw new Error('A 10-bit export needs WebGPU, and this renderer has no GPU device')

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames,
    message: 'Starting the 10-bit encoder...',
  })
  setNativeExportSession({ bridge, paths: new Map(plan.paths) })
  const sink = openNativeEncodeStream({
    device,
    jobId,
    width,
    height,
    frameBytes,
    cancel: () => bridge.cancel({ jobId }),
  })
  setPreciseOutputSink(sink)
  let renderer: Awaited<ReturnType<typeof createCompositionRenderer>> | null = null
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Failed to create OffscreenCanvas 2D context')
    renderer = await createCompositionRenderer(composition, canvas, context)
    await renderer.preload()
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (signal?.aborted === true) throw aborted()
      // The renderer composites in float and awaits the sink's `deliver` before it returns (`frame-render-pass.ts`).
      await renderer.renderFrame(frame)
      onProgress({
        phase: 'rendering',
        progress: Math.round(((frame + 1) / totalFrames) * 100),
        currentFrame: frame + 1,
        totalFrames,
        message: `Rendering frame ${frame + 1}/${totalFrames}`,
      })
    }
    onProgress({
      phase: 'finalizing',
      progress: 100,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Finishing the file...',
    })
    const reply = await sink.finish()
    if (reply.framesWritten !== totalFrames) {
      throw new Error(`The encoder wrote ${reply.framesWritten} of the ${totalFrames} frames`)
    }
    return {
      blob: new Blob([], { type: mimeTypeOf(plan) }),
      mimeType: mimeTypeOf(plan),
      duration: totalFrames / composition.fps,
      fileSize: 0,
    }
  } catch (error) {
    sink.cancel()
    throw error
  } finally {
    setPreciseOutputSink(null)
    setNativeExportSession(null)
    renderer?.dispose()
  }
}
