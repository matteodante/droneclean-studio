import { describe, expect, it, vi } from 'vite-plus/test'
import { perDevice, type CachedDevice } from './device-cache'

function fakeDevice() {
  let lose: () => void = () => {}
  const device: CachedDevice = { lost: new Promise<void>((resolve) => (lose = resolve)) }
  return {
    device,
    lose: async () => {
      lose()
      await device.lost
      await Promise.resolve()
    },
  }
}

describe('perDevice', () => {
  it('builds once per device and key, and once per distinct device', () => {
    const a = fakeDevice().device
    const b = fakeDevice().device
    const build = vi.fn(() => ({}))
    const first = perDevice(a, 'pass', build)
    expect(perDevice(a, 'pass', build)).toBe(first)
    expect(build).toHaveBeenCalledTimes(1)
    expect(perDevice(b, 'pass', build)).not.toBe(first)
    expect(build).toHaveBeenCalledTimes(2)
    perDevice(a, 'other', build)
    expect(build).toHaveBeenCalledTimes(3)
  })

  it("forgets a device's entries when it is lost", async () => {
    const { device, lose } = fakeDevice()
    const build = vi.fn(() => ({}))
    const first = perDevice(device, 'pass', build)
    await lose()
    expect(perDevice(device, 'pass', build)).not.toBe(first)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('shares a pending promise, so two callers do not build twice', async () => {
    const { device } = fakeDevice()
    const build = vi.fn(async () => 'built')
    const [x, y] = await Promise.all([perDevice(device, 'k', build), perDevice(device, 'k', build)])
    expect([x, y]).toEqual(['built', 'built'])
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('does not cache a build that throws', () => {
    const { device } = fakeDevice()
    let attempts = 0
    const build = () => {
      attempts += 1
      if (attempts === 1) throw new Error('no adapter')
      return attempts
    }
    expect(() => perDevice(device, 'k', build)).toThrow('no adapter')
    expect(perDevice(device, 'k', build)).toBe(2)
  })

  it('drops a rejected promise so a later call retries', async () => {
    const { device } = fakeDevice()
    let attempts = 0
    const build = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('compile failed')
      return 'ok'
    }
    await expect(perDevice(device, 'k', build)).rejects.toThrow('compile failed')
    await Promise.resolve()
    await expect(perDevice(device, 'k', build)).resolves.toBe('ok')
    expect(attempts).toBe(2)
  })
})
