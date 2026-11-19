// One full-screen pass that copies a picture into a source-frame texture (design 3.6 section 2.4). A browser decoder's
// frame can only enter the GPU as 8-bit (`copyExternalImageToTexture` into `rgba8unorm`), and the native path's
// source pass writes one texture it overwrites with the next frame; both go through this blit into a fresh
// `rgba16float` texture the provider can keep. `textureLoad` at the pixel: no sampler, no resampling, alpha 1.

import { perDevice } from '@/studio/render/device-cache'
import { PRECISE_RENDER_FORMAT } from '@/studio/render/precise/contract'

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
  let pixel = clamp(vec2i(position.xy), vec2i(0), dimensions - vec2i(1));
  return vec4f(textureLoad(picture, pixel, 0).rgb, 1.0);
}
`

// The WebGPU usage flags, as the spec numbers them (read at call time by `GPUTextureUsage` in a browser, spelled out
// here so the module loads where there is no GPU, as arena.ts does).
const COPY_SRC = 0x01
const COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const RENDER_ATTACHMENT = 0x10
const SHADER_STAGE_FRAGMENT = 0x2

/** The usage of every texture the provider hands out: a stage samples it, a stage or a test may copy it. */
const SOURCE_FRAME_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC

/** The descriptor of a source-frame texture at the file's size: `rgba16float`, one mip level. */
export function sourceFrameTextureDescriptor(width: number, height: number): GPUTextureDescriptor {
  return {
    label: 'source-frame',
    size: { width, height },
    format: PRECISE_RENDER_FORMAT,
    usage: SOURCE_FRAME_USAGE,
  }
}

/** The 8-bit texture a browser frame is copied into before the blit. */
export function stagingTextureDescriptor(width: number, height: number): GPUTextureDescriptor {
  return {
    label: 'source-frame-staging',
    size: { width, height },
    format: 'rgba8unorm',
    usage: TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT,
  }
}

interface BlitPipeline {
  readonly pipeline: GPURenderPipeline
  readonly layout: GPUBindGroupLayout
}

function blitPipeline(device: GPUDevice): BlitPipeline {
  return perDevice(device, 'source-frame-blit', () => {
    const module = device.createShaderModule({ label: 'source-frame-blit', code: BLIT_WGSL })
    const layout = device.createBindGroupLayout({
      label: 'source-frame-blit-layout',
      entries: [
        {
          binding: 0,
          visibility: SHADER_STAGE_FRAGMENT,
          texture: { sampleType: 'unfilterable-float' as const },
        },
      ],
    })
    const pipeline = device.createRenderPipeline({
      label: 'source-frame-blit',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: PRECISE_RENDER_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    })
    return { pipeline, layout }
  })
}

/**
 * Draws `source` into `target` (same size, `rgba16float`) and submits. Queue order does the synchronization: a
 * `copyExternalImageToTexture` into `source` before this call, and another write into it after, see the right data.
 */
export function blitToSourceFrame(device: GPUDevice, source: GPUTexture, target: GPUTexture): void {
  const { pipeline, layout } = blitPipeline(device)
  const encoder = device.createCommandEncoder({ label: 'source-frame-blit' })
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      label: 'source-frame-blit-bindings',
      layout,
      entries: [{ binding: 0, resource: source.createView() }],
    }),
  )
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
}
