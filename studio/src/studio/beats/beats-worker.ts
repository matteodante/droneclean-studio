/// <reference lib="webworker" />

import { detectBeats } from './detect'

interface BeatsRequest {
  id: string
  samples: ArrayBuffer
  sampleRate: number
  strength: number
}

interface BeatsResponse {
  error?: string
  id: string
  times?: number[]
}

self.addEventListener('message', (event: MessageEvent<BeatsRequest>) => {
  const { id, samples, sampleRate, strength } = event.data
  try {
    const times = detectBeats(new Float32Array(samples), sampleRate, { strength })
    self.postMessage({ id, times } satisfies BeatsResponse)
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies BeatsResponse)
  }
})

export {}
