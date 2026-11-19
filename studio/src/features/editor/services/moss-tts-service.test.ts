import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

interface FakeWorkerMessage {
  source?: string
  type?: string
  action?: string
  requestId?: string
  [key: string]: unknown
}

class FakeWorker {
  static instances: FakeWorker[] = []

  readonly messages: FakeWorkerMessage[] = []
  private readonly listeners = new Map<string, Set<(event: { data: FakeWorkerMessage }) => void>>()

  constructor() {
    FakeWorker.instances.push(this)
    queueMicrotask(() => {
      this.emit({
        source: 'freecut-moss-tts-worker',
        type: 'ready',
      })
    })
  }

  addEventListener(type: string, listener: (event: { data: FakeWorkerMessage }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: { data: FakeWorkerMessage }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: FakeWorkerMessage): void {
    this.messages.push(message)
    if (message.action === 'cleanup') {
      queueMicrotask(() => {
        this.emit({
          source: 'freecut-moss-tts-worker',
          type: 'response',
          requestId: message.requestId,
          ok: true,
          data: { status: 'cleaned', removed: true },
        })
      })
    }
  }

  terminate(): void {}

  emit(data: FakeWorkerMessage): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data })
    }
  }
}

describe('MossTtsService cancellation', () => {
  beforeEach(() => {
    vi.resetModules()
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn() },
    })
  })

  afterEach(async () => {
    const { mossTtsService } = await import('./moss-tts-service')
    await mossTtsService.unload().catch(() => {})
    vi.unstubAllGlobals()
  })

  it('aborts a model download in the worker, then cleans up the partial model', async () => {
    const { mossTtsService } = await import('./moss-tts-service')
    const controller = new AbortController()

    const promise = mossTtsService.generateSpeechFile({
      text: 'Hello there',
      voice: 'Ava',
      speed: 1,
      signal: controller.signal,
    })
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    const worker = await vi.waitFor(() => {
      const instance = FakeWorker.instances[0]
      expect(instance).toBeDefined()
      return instance!
    })
    const warmup = await vi.waitFor(() => {
      const message = worker.messages.find((entry) => entry.action === 'warmup')
      expect(message).toBeDefined()
      return message!
    })

    controller.abort()
    await vi.waitFor(() => {
      expect(worker.messages.some((entry) => entry.action === 'cancel')).toBe(true)
    })

    // The worker's aborted warmup reports the failure; the service turns it into AbortError
    // and then asks the worker to delete the files the cancelled download wrote.
    worker.emit({
      source: 'freecut-moss-tts-worker',
      type: 'response',
      requestId: warmup.requestId,
      ok: false,
      error: 'The operation was aborted.',
    })
    await rejection

    await vi.waitFor(() => {
      expect(worker.messages.some((entry) => entry.action === 'cleanup')).toBe(true)
    })
  })
})
