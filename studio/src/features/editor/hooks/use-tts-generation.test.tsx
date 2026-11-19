import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TtsGenerateInput, TtsGenerateOutput } from '../services/tts-generate-request'
import { useTtsGeneration, type TtsGenerationParams } from './use-tts-generation'

const generateTtsAudioMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../services/tts-generate-request', () => ({
  generateTtsAudio: generateTtsAudioMock,
}))

function output(name: string): TtsGenerateOutput {
  const blob = new Blob([name], { type: 'audio/wav' })
  return {
    blob,
    file: new File([blob], `${name}.wav`, { type: 'audio/wav' }),
    duration: 1,
  }
}

const params: TtsGenerationParams = {
  projectId: 'project-1',
  sourceItemId: null,
  text: 'Hello',
  engine: 'kokoro',
  voice: 'af_heart',
  voiceLabel: 'Heart',
  language: 'auto',
  speed: 1,
  model: 'fp32',
  isSupported: true,
  loadMediaItems: vi.fn(async () => undefined),
  showNotification: vi.fn(),
}

describe('useTtsGeneration', () => {
  beforeEach(() => {
    generateTtsAudioMock.mockReset()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('revokes an uninserted result before replacing it during regeneration', async () => {
    generateTtsAudioMock
      .mockResolvedValueOnce({ ok: true, output: output('first') })
      .mockResolvedValueOnce({ ok: true, output: output('second') })
    const { result } = renderHook(() => useTtsGeneration(params))

    await act(async () => result.current.generate())
    expect(result.current.result?.objectUrl).toBe('blob:first')

    await act(async () => result.current.generate())

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(result.current.result?.objectUrl).toBe('blob:second')
  })

  it('stops a cancelled generation without showing an error', async () => {
    let receivedSignal: AbortSignal | undefined
    generateTtsAudioMock.mockImplementation(
      (input: TtsGenerateInput) =>
        new Promise((resolve) => {
          receivedSignal = input.signal
          input.signal?.addEventListener('abort', () => {
            resolve({ ok: false, message: 'Failed to generate speech.' })
          })
        }),
    )
    const { result } = renderHook(() => useTtsGeneration(params))

    act(() => {
      void result.current.generate()
    })
    await waitFor(() => {
      expect(receivedSignal).toBeDefined()
      expect(result.current.isGenerating).toBe(true)
    })

    act(() => {
      result.current.cancel()
    })

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false)
    })
    expect(result.current.error).toBeNull()
    expect(result.current.progress).toBeNull()
    expect(receivedSignal?.aborted).toBe(true)
  })
})
