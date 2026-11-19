// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { SoundTouchPreviewProcessorMessage } from '../utils/soundtouch-preview-shared'

/**
 * The processor's messages as the DSP sees them. `TimeStretchProcessor` (SoundTouch) keeps the
 * effective values: `rate` is speed and pitch together (varispeed) and `tempo` is speed with
 * the pitch held, so a ramp's `set-rate` is visible here as a changed `rate` at tempo 1
 * (design 7.1, section 4.3).
 */
interface ProcessorSettings {
  readonly tempo: number
  readonly rate: number
}

interface ProcessorInternals {
  readonly processor: ProcessorSettings
  readonly playing: boolean
}

interface ProcessorPort {
  onmessage: ((event: { data: SoundTouchPreviewProcessorMessage }) => void) | null
}

interface ProcessorInstance extends ProcessorInternals {
  readonly port: ProcessorPort
}

const workletMocks = vi.hoisted(() => ({
  registered: new Map<string, new () => ProcessorInstance>(),
}))

vi.stubGlobal(
  'AudioWorkletProcessor',
  class {
    port: ProcessorPort = { onmessage: null }
  },
)
vi.stubGlobal(
  'registerProcessor',
  (name: string, processorCtor: new () => ProcessorInstance) => {
    workletMocks.registered.set(name, processorCtor)
  },
)

const { SOUND_TOUCH_PREVIEW_PROCESSOR_NAME } = await import('../utils/soundtouch-preview-shared')
await import('./soundtouch-preview-processor.worklet')

function createProcessor(): ProcessorInstance {
  const ProcessorCtor = workletMocks.registered.get(SOUND_TOUCH_PREVIEW_PROCESSOR_NAME)
  if (!ProcessorCtor) {
    throw new Error('the SoundTouch preview processor did not register itself')
  }
  return new ProcessorCtor()
}

function send(processor: ProcessorInstance, message: SoundTouchPreviewProcessorMessage): void {
  processor.port.onmessage?.({ data: message })
}

describe('the SoundTouch preview processor', () => {
  it('registers under the name the loader asks for', () => {
    expect(workletMocks.registered.has(SOUND_TOUCH_PREVIEW_PROCESSOR_NAME)).toBe(true)
  })

  it('plays a ramp varispeed: set-rate moves speed and pitch with tempo held', () => {
    const processor = createProcessor()

    send(processor, { type: 'set-tempo', tempo: 1 })
    send(processor, { type: 'set-pitch', pitch: 1 })
    send(processor, { type: 'set-rate', rate: 2.5 })

    // SoundTouch's effective rate is what resamples the source: 2.5 reads 2.5x as fast and
    // raises the pitch by 2.5, while tempo 1 leaves the speed schedule to the rate.
    expect(processor.processor.rate).toBe(2.5)
    expect(processor.processor.tempo).toBe(1)
  })

  it('keeps a constant-speed clip pitch-preserved: tempo moves and rate stays 1', () => {
    const processor = createProcessor()

    send(processor, { type: 'set-tempo', tempo: 3.85 })

    expect(processor.processor.tempo).toBe(3.85)
    expect(processor.processor.rate).toBe(1)
  })

  it('takes the curve rate and the transport tempo together', () => {
    const processor = createProcessor()

    send(processor, { type: 'set-tempo', tempo: 4 })
    send(processor, { type: 'set-rate', rate: 2.5 })

    expect(processor.processor.tempo).toBe(4)
    expect(processor.processor.rate).toBe(2.5)
  })

  it('holds the tempo, pitch and rate across the other messages', () => {
    const processor = createProcessor()

    send(processor, { type: 'set-tempo', tempo: 2 })
    send(processor, { type: 'set-pitch', pitch: 1.5 })
    send(processor, { type: 'set-rate', rate: 4 })
    send(processor, {
      type: 'append-source',
      startFrame: 0,
      leftChannel: new Float32Array([0, 1, 0, -1]).buffer,
      rightChannel: new Float32Array([0, 1, 0, -1]).buffer,
      frameCount: 4,
      sampleRate: 48000,
    })
    send(processor, { type: 'seek', frame: 2 })
    send(processor, { type: 'set-playing', playing: true })
    send(processor, { type: 'reset' })

    expect(processor.playing).toBe(false)
    expect(processor.processor.tempo).toBeCloseTo(2 / 1.5, 10)
    expect(processor.processor.rate).toBeCloseTo(4 * 1.5, 10)
  })
})
