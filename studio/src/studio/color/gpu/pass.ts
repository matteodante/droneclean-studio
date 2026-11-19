/**
 * What both colour passes share: the full-screen triangle that covers the target, the one way a
 * pass compiles its shader for a target format, and the size check every `encode` makes.
 *
 * A pass is one render pipeline that reads one texture with `textureLoad` (no sampler, no vertex
 * buffer) and writes one target; the caller owns both textures and the command encoder (design 5.1
 * §4.6). The pipeline's target format is fixed when the pass is built, because a
 * `GPUTextureView` carries no format to check at draw time.
 */

/**
 * The vertex stage of every colour pass: three vertices outside the target, one triangle that
 * covers all of it. `@builtin(position)` in the fragment stage is then the target pixel itself,
 * so the shader reads the input at exactly the pixel it writes.
 */
export const FULLSCREEN_VERTEX_WGSL = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VertexOut;
  out.position = vec4f(corners[index], 0.0, 1.0);
  return out;
}
`

/** What one pass's pipeline is made of. */
export interface PassPipelineOptions {
  /** The pass's name in the device's debug messages, such as "input colour". */
  readonly label: string
  /** The whole shader: `FULLSCREEN_VERTEX_WGSL` followed by the pass's fragment stage. */
  readonly code: string
  readonly layout: GPUBindGroupLayout
  /** The fragment target's format. */
  readonly format: GPUTextureFormat
}

/**
 * Compiles one pass's shader for one target format. A shader that does not compile fails here,
 * with the compiler's own messages, where a caller builds the stage — not on the first frame.
 */
export async function createPassPipeline(
  device: GPUDevice,
  options: PassPipelineOptions,
): Promise<GPURenderPipeline> {
  const module = device.createShaderModule({ label: options.label, code: options.code })
  const compilation = await module.getCompilationInfo()
  const errors = compilation.messages.filter((message) => message.type === 'error')
  if (errors.length > 0) {
    throw new Error(
      `the ${options.label} shader does not compile:\n${errors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n')}`,
    )
  }
  return device.createRenderPipelineAsync({
    label: options.label,
    layout: device.createPipelineLayout({
      label: options.label,
      bindGroupLayouts: [options.layout],
    }),
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: options.format }] },
    primitive: { topology: 'triangle-list' },
  })
}

/**
 * Throws unless `size` is a positive whole number of pixels. The textures are the caller's, so a
 * view has no size to read; what can be checked is the size the pass is told, and a zero or
 * fractional one is a bug in the call, not a frame.
 */
export function assertPassSize(
  functionName: string,
  size: { readonly width: number; readonly height: number },
): void {
  if (
    !Number.isInteger(size.width) ||
    size.width < 1 ||
    !Number.isInteger(size.height) ||
    size.height < 1
  ) {
    throw new RangeError(
      `${functionName}: the size must be positive whole pixels, got ${size.width}x${size.height}`,
    )
  }
}
