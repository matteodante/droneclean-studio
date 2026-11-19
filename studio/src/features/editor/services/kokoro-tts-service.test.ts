import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('kokoro-js', () => ({
  env: { wasmPaths: undefined as unknown },
  KokoroTTS: {
    from_pretrained: async () => {
      await fetch(
        'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/config.json',
      )
      return {
        model: { dispose: vi.fn() },
        generate: vi.fn(async () => ({ audio: new Float32Array(2_400), sampling_rate: 24_000 })),
      }
    },
  },
}))
import { kokoroTtsService } from './kokoro-tts-service'
import { KOKORO_WASM_PATHS } from '@/shared/utils/ort-runtime'
import { env as kokoroEnv } from 'kokoro-js'

function stubCacheStorage(): void {
  vi.stubGlobal('caches', {
    async has() {
      return false
    },
    async open() {
      return {
        async keys() {
          return []
        },
        async delete() {
          return false
        },
      }
    },
  })
}

describe('KokoroTtsService cancellation', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { gpu: {} })
    stubCacheStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects before starting anything when the signal is already aborted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(
      kokoroTtsService.generateSpeechFile({
        text: 'Hello',
        voice: 'af_heart',
        speed: 1,
        model: 'fp32',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('points the nested transformers runtime at the app origin before the first model load', async () => {
    stubCacheStorage()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))

    await kokoroTtsService
      .generateSpeechFile({ text: 'Hello', voice: 'af_heart', speed: 1, model: 'fp32' })
      .catch(() => {})

    expect(kokoroEnv.wasmPaths).toBe(KOKORO_WASM_PATHS)

    await kokoroTtsService.unloadModel('fp32')
  })

  it('gives the model download the caller signal and restores fetch after a cancel', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const promise = kokoroTtsService.generateSpeechFile({
      text: 'Hello',
      voice: 'af_heart',
      speed: 1,
      model: 'fp32',
      signal: controller.signal,
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.signal).toBeDefined()
    expect(init?.signal?.aborted).toBe(false)

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(globalThis.fetch).toBe(fetchMock)
  })
})
