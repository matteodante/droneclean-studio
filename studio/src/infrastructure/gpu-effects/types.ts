import { PRECISE_RENDER_FORMAT } from '@/studio/render/precise/contract'

export interface EffectParam {
  /** 'json' params hold structured data as a JSON string (custom panels only — no generic UI) */
  type: 'number' | 'boolean' | 'select' | 'color' | 'point' | 'json' | 'text'
  label: string
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  animatable?: boolean
  quality?: boolean
  visibleWhen?: (params: Record<string, number | boolean | string>) => boolean
}

/** Texel payload for an effect's auxiliary data texture; the chain stores it as `rgba16float`. */
export interface EffectDataTexturePayload {
  width: number
  height: number
  /** 1 for 2d textures */
  depth: number
  /**
   * width * height * depth * 4 channels: bytes (0..255 is 0..1) or, to keep more than 256 levels, floats.
   */
  data: Uint8Array | Float32Array
}

/**
 * Auxiliary data texture bound at @group(0) @binding(3), sampled with the
 * shared linear sampler at binding 0. Built CPU-side from the effect params
 * (e.g. a 256x1 curve LUT or a 3D color LUT) and cached by `key` — the
 * texture is only rewritten when the key changes.
 */
export interface EffectDataTextureSpec {
  dimension: '2d' | '3d'
  /** Cheap change-detection key derived from params */
  key: (params: Record<string, number | boolean | string>) => string
  /** Build texel data; must always return a valid payload (use identity data as fallback) */
  build: (params: Record<string, number | boolean | string>) => EffectDataTexturePayload
}

/**
 * Format of the precise path's chain, taken from the contract
 * (`PRECISE_RENDER_FORMAT`): 16-bit float, so chained passes keep the source's
 * precision instead of rounding to 8 bits after each one.
 */
export const EFFECT_TEXTURE_FORMAT = PRECISE_RENDER_FORMAT

/** The 8-bit format of a caller still on today's path (the preview renders to an 8-bit canvas). */
export const EFFECT_BYTE_TEXTURE_FORMAT = 'rgba8unorm' as const satisfies GPUTextureFormat

/**
 * The two formats the chain itself runs in. The chain takes the format of the
 * caller's output texture: an 8-bit caller keeps the 8-bit chain (the pixels
 * moved by up to 2 levels in commit 41fa8e78b, whose golden frames were
 * re-stored; they are not today's pixels exactly), and a float caller (the precise path's composite) gets the float chain, with the
 * effect and compute pipelines compiled once per format.
 */
export type EffectChainFormat = typeof EFFECT_TEXTURE_FORMAT | typeof EFFECT_BYTE_TEXTURE_FORMAT

/**
 * The storage-texture format token a compute effect's WGSL declares in place of
 * the chain format; the pipeline substitutes the format it is compiling for
 * (`texture_storage_2d<…, write>`). WGSL has no generic storage formats, so this
 * is the one place the two chains differ in source.
 */
export const EFFECT_CHAIN_STORAGE_FORMAT = 'EFFECT_CHAIN_STORAGE_FORMAT'

/**
 * Marks an effect as running through a compute pass instead of the default
 * fragment render pass. Compute effects read the input via `textureLoad`
 * (binding 0, a plain `texture_2d<f32>` — no sampler) and write results with
 * `textureStore` into a write-only storage texture of `EFFECT_CHAIN_STORAGE_FORMAT`
 * (binding 1); uniforms stay at binding 2. This unlocks passes a single fragment
 * shader can't express — scatter writes, cross-pixel sorting, prefix scans —
 * because an invocation can write to an output location other than its own.
 */
export interface GpuEffectComputeSpec {
  /**
   * Workgroup counts to dispatch, derived from the output dimensions. Must
   * cover every output texel given the shader's `@workgroup_size` (the shader
   * is responsible for bounds-guarding invocations past width/height).
   */
  dispatch: (width: number, height: number) => [number, number, number]
}

export interface GpuEffectDefinition {
  id: string
  name: string
  category: GpuEffectCategory
  shader: string
  entryPoint: string
  uniformSize: number
  params: Record<string, EffectParam>
  packUniforms: (
    params: Record<string, number | boolean | string>,
    width: number,
    height: number,
    timelineTimeSeconds?: number,
  ) => Float32Array | null
  dataTexture?: EffectDataTextureSpec
  /** When set, the effect runs as a compute pass rather than a fragment pass. */
  compute?: GpuEffectComputeSpec
}

export type GpuEffectCategory = 'color' | 'blur' | 'distort' | 'stylize' | 'keying'

export interface GpuEffectInstance {
  /** Composition timeline time, never wall-clock or media source time. */
  timelineTimeSeconds?: number
  id: string
  type: string
  name: string
  enabled: boolean
  params: Record<string, number | boolean | string>
}
