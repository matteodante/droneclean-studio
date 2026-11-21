// How FreeCut's renderer draws a staged clip (design 3.6 sections 2.10, 2.11 and 2.19): the three calls its files make,
// so each of them carries one line and the staged path lives here.
//
//   resolveStagedParticipantSource   the GPU participant path (gpu.ts): the clip's source is its staged picture, at the
//                                    staged size, so FreeCut's layout, crop, transform and effects work on that picture;
//   renderStagedParticipant          its draw: the staged texture through FreeCut's media pipeline, as any source;
//   drawStagedVideoItem              the canvas path (video.ts): masks and canvas effects draw on the staged picture too
//                                    (R1), copied into a canvas at the staged size. In a precise export that clip is 8-bit
//                                    from there on (design 3.6 section 2.11; logged once per clip).
//
// Where a staged clip's frame comes from (`stagesFromProvider`): in an export, and in a preview for a clip whose stages
// need the exact frame (stabilization, a blur that blends frames, also with a speed curve, cleaned pieces or reverse),
// from the renderer's source-frame provider by integer source frame, never from a DOM `<video>` (S1). A preview clip
// whose stages act on any frame they are given (input colour, a look) starts from FreeCut's own fast preview source
// (its `<video>` or its decoder), fed into the stages (task 8.2: the provider's decode was 47.65 ms a frame there). In
// an export a stage that cannot draw throws its `StageError`; a preview that cannot draw a clip at all leaves its last
// picture on screen (FreeCut's pending frame).

import { drawContainedMediaSource } from '@/runtime/renderer/canvas-item-renderer/media-draw'
import type {
  ItemRenderContext,
  ItemTransform,
  PreparedGpuMediaParticipant,
  ResolvedGpuMediaParticipantSource,
  TransitionParticipantRenderState,
} from '@/runtime/renderer/canvas-item-renderer/types'
import type { RenderTimelineSpan } from '@/runtime/renderer/render-span'
import { createLogger } from '@/shared/logging/logger'
import { perDevice } from '@/studio/render/device-cache'
import { preciseOutputActive } from '@/studio/render/precise/contract'
import { withAnimatedFraming } from '@/studio/stabilization/framing-keyframes'
import { timedStageAsync } from '@/studio/render/timings'
import type { VideoItem } from '@/types/timeline'
import type { StagedFrame } from './pipeline'
import type { PreviewBox } from './preview-size'
import { timelineFramePlan, type SourceFramePlan } from './plan'
import { needsExactSourceFrame, needsSourceStages } from './predicates'

/**
 * Whether a staged clip's frames come from the renderer's source-frame provider: always in an export (the exact frame,
 * at full precision), and in a preview when the clip's stages need the exact frame.
 */
function stagesFromProvider(item: VideoItem, rctx: ItemRenderContext): boolean {
  return rctx.renderMode === 'export' || needsExactSourceFrame(item)
}

/**
 * Whether this item is a staged clip drawn from the provider: then FreeCut's own decoder is not needed for it, and a
 * renderer must not refuse the clip, or draw it another way, because that decoder did not open (§2.10).
 */
export function stagedFromProvider(item: VideoItem, rctx: ItemRenderContext): boolean {
  return needsSourceStages(item) && stagesFromProvider(item, rctx)
}

const log = createLogger('StagedClip')

/** What the pipeline is given for a plan: one sample with no blur is the frame itself, as a bare index */
function pipelineSource(plan: SourceFramePlan): number | SourceFramePlan {
  const only = plan.samples.length === 1 ? plan.samples[0]! : undefined
  return only !== undefined && only.extent === undefined ? only.index : plan
}

/** The clip with the framing its keyframes give at timeline frame `frame` (the same clip when it has none; `framing-keyframes.ts`) */
function framedAt(item: VideoItem, frame: number, rctx: ItemRenderContext): VideoItem {
  const keyframes = rctx.getCurrentKeyframes?.(item.id) ?? rctx.keyframesMap.get(item.id)
  return withAnimatedFraming(item, keyframes, frame - item.from)
}

/**
 * The box a preview shows the clip's staged picture in (design 8.10): its transform's, in the canvas's pixels, which
 * the picture is contained in. None in an export, and none for a clip with a corner pin, which may stretch the picture
 * past its box.
 */
function previewBoxOf(item: VideoItem, box: { width: number; height: number }, rctx: ItemRenderContext): PreviewBox | undefined {
  if (rctx.renderMode !== 'preview' || item.cornerPin !== undefined) return undefined
  return { width: Math.abs(box.width), height: Math.abs(box.height) }
}

/** The clip's staged picture, or `null` when a preview cannot draw it at all */
async function stagedPicture(
  item: VideoItem,
  frame: number,
  rctx: ItemRenderContext,
  renderSpan: RenderTimelineSpan | undefined,
  sourceFrameOffset: number,
  box: { width: number; height: number },
): Promise<StagedFrame | null> {
  const stages = rctx.stages
  const plan = timelineFramePlan(item, frame, rctx.fps, renderSpan, sourceFrameOffset)
  const framed = framedAt(item, frame, rctx)
  const source = pipelineSource(plan)
  if (rctx.renderMode === 'export') {
    if (!stages)
      throw new Error(
        `Clip '${item.label || item.id}' needs the stage pipeline, and this renderer has none`,
      )
    return stages.render(framed, source)
  }
  if (!stages) return null
  try {
    return await stages.render(framed, source, previewBoxOf(item, box, rctx))
  } catch (error) {
    log.warn('a staged clip could not be drawn in the preview', {
      clip: item.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * The GPU participant path's source for a staged clip: its staged picture at the staged size. `freeCutSource` is the
 * path's own resolution of the clip's frame (DOM `<video>` or decoder), used in a preview for a clip whose stages need
 * no exact frame.
 */
export async function resolveStagedParticipantSource(
  participant: TransitionParticipantRenderState<VideoItem>,
  frame: number,
  rctx: ItemRenderContext,
  freeCutSource: () => Promise<ResolvedGpuMediaParticipantSource | null>,
): Promise<ResolvedGpuMediaParticipantSource | null> {
  const staged = stagesFromProvider(participant.item, rctx)
    ? await stagedPicture(participant.item, frame, rctx, participant.renderSpan, 0, participant.transform)
    : await stagedFreeCutPicture(participant, frame, rctx, freeCutSource)
  if (!staged) return null
  // The size the picture stands for: the media pipeline reads the texture by its share of that size, so a preview's
  // smaller texture (design 8.10) is placed, cropped and fitted exactly as the full-size one
  return {
    kind: 'staged',
    item: participant.item,
    texture: staged.texture,
    sourceWidth: staged.natural.width,
    sourceHeight: staged.natural.height,
  }
}

/** The preview's staged picture of FreeCut's own frame: `null` when FreeCut has none, or the stages cannot draw it */
async function stagedFreeCutPicture(
  participant: TransitionParticipantRenderState<VideoItem>,
  frame: number,
  rctx: ItemRenderContext,
  freeCutSource: () => Promise<ResolvedGpuMediaParticipantSource | null>,
): Promise<StagedFrame | null> {
  const stages = rctx.stages
  if (!stages) return null
  const item = framedAt(participant.item, frame, rctx)
  const media = await timedStageAsync('decode', freeCutSource, frame)
  if (!media) return null
  try {
    if (media.kind !== 'media') return null
    const index = timelineFramePlan(item, frame, rctx.fps, participant.renderSpan, 0).samples[0]!.index
    const image = { source: media.source, width: media.sourceWidth, height: media.sourceHeight }
    return await stages.stageImage(item, index, image)
  } catch (error) {
    log.warn('a staged clip could not be drawn in the preview', {
      clip: item.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  } finally {
    media.close?.()
  }
}

/** Draws a prepared staged participant with FreeCut's media pipeline: crop, transform, corner pin, feather, opacity */
export function renderStagedParticipant(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  options?: { clear?: boolean; blend?: boolean },
): boolean {
  const { media } = prepared
  if (media.kind !== 'staged') return false
  return (
    rctx.gpuMediaPipeline?.renderTextureToTexture(media.texture, outputTexture, {
      sourceWidth: media.sourceWidth,
      sourceHeight: media.sourceHeight,
      outputWidth: rctx.canvasSettings.width,
      outputHeight: rctx.canvasSettings.height,
      sourceRect: prepared.sourceRect,
      destRect: prepared.destRect,
      transformRect: prepared.transformRect,
      featherPixels: prepared.featherPixels,
      cornerRadius: prepared.cornerRadius,
      cornerPin: prepared.cornerPin,
      opacity: prepared.participant.transform.opacity,
      rotationRad: prepared.rotationRad,
      flipX: prepared.flipX,
      flipY: prepared.flipY,
      clear: options?.clear,
      blend: options?.blend,
    }) ?? false
  )
}

/** Clips already said to be 8-bit after their stages in this realm's precise exports */
const eightBitClips = new Set<string>()

/**
 * The canvas path's draw of a staged clip (masks, canvas effects, a transition drawn on canvas): the staged picture,
 * copied into a canvas at the staged size, drawn with the clip's crop and transform like any decoded frame. `false`
 * when a preview cannot draw the clip (FreeCut then keeps the last picture on screen).
 */
export async function drawStagedVideoItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number,
  renderSpan: RenderTimelineSpan | undefined,
): Promise<boolean> {
  const staged = await stagedPicture(item, frame, rctx, renderSpan, sourceFrameOffset, transform)
  const device = staged ? await rctx.stages?.device() : null
  if (!staged || !device) return false
  if (preciseOutputActive(rctx.renderMode) && !eightBitClips.has(item.id)) {
    eightBitClips.add(item.id)
    log.warn(
      'a staged clip under a mask or a canvas effect is 8-bit after its stages in this precise export',
      {
        clip: item.label || item.id,
      },
    )
  }
  const image = stagedImage(device, staged)
  return drawContainedMediaSource(
    ctx,
    image,
    staged.width,
    staged.height,
    transform,
    rctx.canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
}

const BLIT_WGSL = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@group(0) @binding(0) var picture: texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(picture));
  return textureLoad(picture, clamp(vec2i(position.xy), vec2i(0), dimensions - vec2i(1)), 0);
}
`

/** A canvas of the device for the staged picture's copy, one per size: the copy and its `drawImage` are back to back */
interface ImageCanvas {
  readonly canvas: OffscreenCanvas
  readonly context: GPUCanvasContext
  readonly format: GPUTextureFormat
}

function imageCanvas(device: GPUDevice, width: number, height: number): ImageCanvas {
  return perDevice(device, `staged-image:${width}x${height}`, () => {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context)
      throw new Error('The staged picture needs a WebGPU canvas, and this browser gives none')
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'premultiplied' })
    return { canvas, context, format }
  })
}

function blitPipeline(device: GPUDevice, format: GPUTextureFormat) {
  return perDevice(device, `staged-image-blit:${format}`, () => {
    const module = device.createShaderModule({ label: 'staged-image-blit', code: BLIT_WGSL })
    return device.createRenderPipeline({
      label: 'staged-image-blit',
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
  })
}

/** The staged picture as an image a 2D canvas draws: one pass into a WebGPU canvas of its size, submitted */
function stagedImage(device: GPUDevice, staged: StagedFrame): OffscreenCanvas {
  const { canvas, context, format } = imageCanvas(device, staged.width, staged.height)
  const pipeline = blitPipeline(device, format)
  const encoder = device.createCommandEncoder({ label: 'staged-image' })
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: staged.texture.createView() }],
    }),
  )
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
  return canvas
}
