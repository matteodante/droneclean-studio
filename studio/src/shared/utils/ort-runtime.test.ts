import { describe, expect, it } from 'vite-plus/test'
import { KOKORO_WASM_PATHS, ORT_WASM_PATHS, TRANSFORMERS_WASM_PATHS } from './ort-runtime'

describe('ort-runtime wasm paths', () => {
  it('serves the build of onnxruntime-web the feature handed them to runs', () => {
    expect(ORT_WASM_PATHS.mjs).toMatch(/ort-wasm-simd-threaded\.jsep\.mjs$/)
    expect(ORT_WASM_PATHS.wasm).toMatch(/ort-wasm-simd-threaded\.jsep\.wasm$/)
    expect(TRANSFORMERS_WASM_PATHS.mjs).toMatch(/ort-wasm-simd-threaded\.asyncify\.mjs$/)
    expect(TRANSFORMERS_WASM_PATHS.wasm).toMatch(/ort-wasm-simd-threaded\.asyncify\.wasm$/)
  })

  it("keeps kokoro's nested onnxruntime-web 1.22 pair apart from the app's 1.26 one", () => {
    expect(KOKORO_WASM_PATHS.mjs).toMatch(/ort-wasm-simd-threaded\.jsep\.mjs$/)
    expect(KOKORO_WASM_PATHS.wasm).toMatch(/ort-wasm-simd-threaded\.jsep\.wasm$/)
    expect(KOKORO_WASM_PATHS.mjs).not.toBe(ORT_WASM_PATHS.mjs)
    expect(KOKORO_WASM_PATHS.wasm).not.toBe(ORT_WASM_PATHS.wasm)
  })

  it('resolves every path to a URL the browser can fetch', () => {
    for (const paths of [ORT_WASM_PATHS, TRANSFORMERS_WASM_PATHS, KOKORO_WASM_PATHS]) {
      expect(paths.mjs).toMatch(/^[a-z]+:/)
      expect(paths.wasm).toMatch(/^[a-z]+:/)
    }
  })
})
