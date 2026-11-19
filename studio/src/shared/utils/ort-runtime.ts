/**
 * Lazy, once-per-realm bootstrap of onnxruntime-web.
 *
 * The runtime ships with the app. The `.mjs` glue and the `.wasm` binary come
 * from the `onnxruntime-web` build pinned in `package.json` and are emitted as
 * assets of this app, so nothing a "local" feature needs is fetched from a CDN.
 * The glue and the binary are taken from the same package version: a mismatch
 * between them is a silent, confusing failure, so the two move together.
 * `numThreads = 1` because every model we run is already GPU-bound on the WebGPU
 * EP, and the wasm fallback path is a correctness net rather than a performance
 * one.
 *
 * Worker-safe, and intended to be imported by workers rather than the main
 * thread: each worker bundle gets its own module instance and therefore its own
 * single initialization.
 */

import ortWasmLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import transformersWasmLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import transformersWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
// kokoro-js carries its own copy of @huggingface/transformers (3.8.1) with its own
// onnxruntime-web (1.22), and that package's `exports` map does not expose its `dist/` files, so
// the pair is reached by path instead of by a package subpath. Both are pinned by kokoro-js's
// nested dependency, so the path cannot drift while kokoro-js is pinned.
import kokoroWasmLoaderUrl from '../../../node_modules/kokoro-js/node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import kokoroWasmBinaryUrl from '../../../node_modules/kokoro-js/node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url'

/** The two files onnxruntime-web loads at runtime, served by the app itself. */
export interface OrtWasmPaths {
  /** The Emscripten glue module onnxruntime-web imports. */
  mjs: string
  /** The WebAssembly binary the glue instantiates. */
  wasm: string
}

/** Resolve a build asset next to the module that imported it, whatever the base path. */
function servedAsset(url: string): string {
  return new URL(url, import.meta.url).href
}

/**
 * The build onnxruntime-web's browser bundle runs: WebGPU plus the CPU fallback.
 * `getOrt`, the Parakeet worker and the Supertonic service hand these paths to
 * their own `onnxruntime-web` module instance.
 */
export const ORT_WASM_PATHS: OrtWasmPaths = {
  mjs: servedAsset(ortWasmLoaderUrl),
  wasm: servedAsset(ortWasmBinaryUrl),
}

/**
 * The build `@huggingface/transformers` picks by default in a browser (its
 * asyncify variant), used by the Whisper worker and the other transformers.js
 * consumers. The library's own default is a jsdelivr URL (no-cdn-ok: it names
 * the default these paths replace); setting these makes it load from this app
 * instead.
 */
export const TRANSFORMERS_WASM_PATHS: OrtWasmPaths = {
  mjs: servedAsset(transformersWasmLoaderUrl),
  wasm: servedAsset(transformersWasmBinaryUrl),
}

/**
 * The wasm pair of kokoro-js's own @huggingface/transformers 3.8.1. Its
 * `env.wasmPaths` default is a jsdelivr URL too (no-cdn-ok: it names the
 * default this constant replaces); the service passes these paths to kokoro's
 * `env` before the first model load. This pair belongs to the nested
 * onnxruntime-web 1.22, not to the newer ORT_WASM_PATHS above: the glue and the
 * binary are version-specific and must not be mixed.
 */
export const KOKORO_WASM_PATHS: OrtWasmPaths = {
  mjs: servedAsset(kokoroWasmLoaderUrl),
  wasm: servedAsset(kokoroWasmBinaryUrl),
}

export type OrtModule = typeof import('onnxruntime-web')
export type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

let ortPromise: Promise<OrtModule> | null = null

export function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((module) => {
      module.env.wasm.wasmPaths = ORT_WASM_PATHS
      module.env.wasm.numThreads = 1
      return module
    })
  }
  return ortPromise
}
