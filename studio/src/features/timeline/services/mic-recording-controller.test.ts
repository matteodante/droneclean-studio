import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const askDesktopMicrophone = vi.fn()
const start = vi.fn()

vi.mock('@/studio/desktop/microphone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/studio/desktop/microphone')>()),
  askDesktopMicrophone: () => askDesktopMicrophone(),
}))
vi.mock('@/infrastructure/audio/mic-recorder', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/infrastructure/audio/mic-recorder')>()
  class FakeRecorder {
    start = start
    dispose = vi.fn()
  }
  return { ...original, MicRecorder: FakeRecorder, hasMicRecordingSupport: () => true }
})

import { useMediaLibraryStore } from '../deps/media-library-store'
import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { MicStartTimeoutError } from '@/infrastructure/audio/mic-recorder'
import { startMicRecording } from './mic-recording-controller'

beforeEach(() => {
  askDesktopMicrophone.mockReset()
  start.mockReset()
  useMicRecordingStore.getState().reset()
  useMicRecordingStore.getState().setError(null)
  useMediaLibraryStore.setState({ currentProjectId: 'project-1' })
})

describe('startMicRecording in the desktop app', () => {
  it('stops with the way to fix it when the system refuses the microphone, without starting the recorder', async () => {
    askDesktopMicrophone.mockResolvedValue('denied')
    await startMicRecording()
    const { status, error } = useMicRecordingStore.getState()
    expect(status).toBe('idle')
    expect(error).toContain('System Settings')
    expect(error).toContain('Microphone')
    expect(start).not.toHaveBeenCalled()
  })

  it('goes on to record when the system allows it, or the shell has no answer', async () => {
    start.mockRejectedValue(new Error('stop here'))
    for (const answer of ['granted', null]) {
      askDesktopMicrophone.mockResolvedValue(answer)
      await startMicRecording()
    }
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('goes back to idle with a message when the recorder times out', async () => {
    askDesktopMicrophone.mockResolvedValue('granted')
    start.mockRejectedValue(new MicStartTimeoutError('The microphone'))
    await startMicRecording()
    const { status, error } = useMicRecordingStore.getState()
    expect(status).toBe('idle')
    expect(error).toContain('did not start')
  })
})
