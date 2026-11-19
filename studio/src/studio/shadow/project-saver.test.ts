import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { saveOpenProject, setProjectSaver } from './project-saver'

describe('project-saver', () => {
  afterEach(() => setProjectSaver(null))

  it('rejects with a clear error when no saver is registered', async () => {
    await expect(saveOpenProject()).rejects.toThrow('has not registered a way to save')
  })

  it('calls the registered saver and passes its rejection on', async () => {
    const fn = vi.fn(async () => undefined)
    setProjectSaver(fn)
    await saveOpenProject()
    expect(fn).toHaveBeenCalledTimes(1)
    setProjectSaver(async () => {
      throw new Error('disk full')
    })
    await expect(saveOpenProject()).rejects.toThrow('disk full')
  })

  it('uses the latest saver and forgets it on null', async () => {
    const a = vi.fn(async () => undefined)
    const b = vi.fn(async () => undefined)
    setProjectSaver(a)
    setProjectSaver(b)
    await saveOpenProject()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    setProjectSaver(null)
    await expect(saveOpenProject()).rejects.toThrow()
  })
})
