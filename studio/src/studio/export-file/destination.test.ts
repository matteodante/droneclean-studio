// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import type { ExportFileBridge } from './wire'

const bridge = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('@/studio/desktop/bridge', () => ({
  getDesktopBridge: () => (bridge.current === undefined ? undefined : { exportFile: bridge.current }),
}))

import { chooseExportDestination, containerForMimeType, writeBlobToDestination } from './destination'

function shellBridge(choose: Awaited<ReturnType<ExportFileBridge['choose']>>) {
  const calls = { commit: [] as unknown[], discard: [] as unknown[], choose: [] as unknown[] }
  const api: ExportFileBridge = {
    choose: async (request) => {
      calls.choose.push(request)
      return choose
    },
    commit: async (request) => {
      calls.commit.push(request)
      return { ok: true, value: { path: '/x.mp4', size: 1 } }
    },
    discard: async (request) => {
      calls.discard.push(request)
      return { ok: true, value: null }
    },
  }
  return { api, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
  bridge.current = undefined
  vi.unstubAllGlobals()
})

describe('chooseExportDestination in the desktop app', () => {
  it('sends the save dialog the interface language\'s word for Export', async () => {
    const { api, calls } = shellBridge({ ok: true, value: null })
    bridge.current = api
    vi.spyOn(i18n, 't').mockImplementation(((key: string) => (key === 'export.dialog.titleSettings' ? 'Esporta' : key)) as never)

    await chooseExportDestination({ container: 'mp4', baseName: 'volo' })

    expect(calls.choose).toEqual([{ suggestedName: 'volo.mp4', extension: 'mp4', title: 'Esporta' }])
  })

  it('asks the shell with the name and extension, and names the file by its path', async () => {
    const { api, calls } = shellBridge({ ok: true, value: { id: 'exp-1', path: '/Users/p/flight.mp4', name: 'flight.mp4' } })
    bridge.current = api
    const choice = await chooseExportDestination({ container: 'mp4', baseName: 'export-1' })

    // The title is the interface language's word for Export (English here).
    expect(calls.choose).toEqual([{ suggestedName: 'export-1.mp4', extension: 'mp4', title: 'Export' }])
    if (choice.status !== 'chosen') throw new Error('expected a destination')
    expect(choice.destination.output).toEqual({ kind: 'desktop-file', id: 'exp-1' })
    expect(choice.destination.label).toBe('/Users/p/flight.mp4')

    await choice.destination.commit({ content: 'srt' })
    await choice.destination.discard()
    expect(calls.commit).toEqual([{ id: 'exp-1', sidecar: { content: 'srt' } }])
    expect(calls.discard).toEqual([{ id: 'exp-1' }])
  })

  it('asks for a native export with the flag, and carries the path the encoder is granted and the committed size', async () => {
    const { api, calls } = shellBridge({ ok: true, value: { id: 'exp-n', path: '/Users/p/master.mov', name: 'master.mov' } })
    api.commit = async (request) => {
      calls.commit.push(request)
      return { ok: true, value: { path: '/Users/p/master.mov', size: 123_456 } }
    }
    bridge.current = api
    const choice = await chooseExportDestination({ container: 'mov', baseName: 'export-2', native: true })

    expect(calls.choose).toEqual([{ suggestedName: 'export-2.mov', extension: 'mov', title: 'Export', native: true }])
    if (choice.status !== 'chosen') throw new Error('expected a destination')
    expect(choice.destination.nativePath).toBe('/Users/p/master.mov')
    expect(choice.destination.label).toBe('/Users/p/master.mov')
    expect(await choice.destination.commit()).toBe(123_456)
    await choice.destination.discard()
    expect(calls.discard).toEqual([{ id: 'exp-n' }])
  })

  it('has no native path for an export the muxer writes', async () => {
    bridge.current = shellBridge({ ok: true, value: { id: 'exp-m', path: '/p.mp4', name: 'p.mp4' } }).api
    const choice = await chooseExportDestination({ container: 'mp4', baseName: 'x' })
    if (choice.status !== 'chosen') throw new Error('expected a destination')
    expect(choice.destination.nativePath).toBeNull()
  })

  it('refuses a native export outside the desktop app: the browser’s save picker has no native encoder', async () => {
    expect(await chooseExportDestination({ container: 'mp4', baseName: 'x', native: true })).toEqual({ status: 'unsupported' })
  })

  it('is declined when the user closes the dialog', async () => {
    bridge.current = shellBridge({ ok: true, value: null }).api
    expect(await chooseExportDestination({ container: 'mov', baseName: 'x' })).toEqual({ status: 'declined' })
  })

  it('throws the shell’s refusal with its words', async () => {
    bridge.current = shellBridge({ ok: false, message: 'the file name must end in .mp4' }).api
    await expect(chooseExportDestination({ container: 'mp4', baseName: 'x' })).rejects.toThrow('the file name must end in .mp4')
  })

  it('has no way to ask for a container the muxer does not write', async () => {
    bridge.current = shellBridge({ ok: true, value: null }).api
    expect(await chooseExportDestination({ container: 'avi', baseName: 'x' })).toEqual({ status: 'unsupported' })
  })

  it('swallows a failed discard: the shell removes the file when the window goes away', async () => {
    const { api } = shellBridge({ ok: true, value: { id: 'exp-2', path: '/p.mp4', name: 'p.mp4' } })
    api.discard = async () => {
      throw new Error('gone')
    }
    bridge.current = api
    const choice = await chooseExportDestination({ container: 'mp4', baseName: 'x' })
    if (choice.status !== 'chosen') throw new Error('expected a destination')
    await expect(choice.destination.discard()).resolves.toBeUndefined()
  })
})

describe('chooseExportDestination in a browser', () => {
  it('is unsupported without a save picker, and declined when the user cancels it', async () => {
    vi.stubGlobal('window', {})
    expect(await chooseExportDestination({ container: 'mp4', baseName: 'x' })).toEqual({ status: 'unsupported' })

    vi.stubGlobal('window', {
      showSaveFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
    })
    expect(await chooseExportDestination({ container: 'mp4', baseName: 'x' })).toEqual({ status: 'declined' })
  })

  it('uses the picker’s file handle as the destination', async () => {
    const handle = { name: 'flight.mp4' }
    vi.stubGlobal('window', { showSaveFilePicker: async () => handle })
    const choice = await chooseExportDestination({ container: 'mp4', baseName: 'x' })
    if (choice.status !== 'chosen') throw new Error('expected a destination')
    expect(choice.destination.output).toEqual({ kind: 'file-handle', handle })
    expect(choice.destination.label).toBe('flight.mp4')
  })
})

describe('writeBlobToDestination', () => {
  it('streams a smart copy into the file in 4 MiB pieces, in order', async () => {
    const positions: (number | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        positions.push(new URL(url).searchParams.get('position') === null ? null : Number(new URL(url).searchParams.get('position')))
        return new Response(null, { status: 204 })
      }),
    )
    const blob = new Blob([new Uint8Array(9 * 1024 * 1024)])
    const size = await writeBlobToDestination(
      { output: { kind: 'desktop-file', id: 'exp-3' }, label: 'x', nativePath: null, commit: async () => null, discard: async () => {} },
      blob,
      new AbortController().signal,
    )
    expect(size).toBe(9 * 1024 * 1024)
    expect(positions).toEqual([null, 0, 4 * 1024 * 1024, 8 * 1024 * 1024])
  })

  it('stops when the export is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const controller = new AbortController()
    controller.abort()
    await expect(
      writeBlobToDestination(
        { output: { kind: 'desktop-file', id: 'exp-4' }, label: 'x', nativePath: null, commit: async () => null, discard: async () => {} },
        new Blob([new Uint8Array(10)]),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('containerForMimeType', () => {
  it('names the container a source file’s type is written by', () => {
    expect(containerForMimeType('video/mp4')).toBe('mp4')
    expect(containerForMimeType('video/quicktime')).toBe('mov')
    expect(containerForMimeType('video/webm')).toBe('webm')
    expect(containerForMimeType('audio/mpeg')).toBe('mp3')
    expect(containerForMimeType('application/octet-stream')).toBeNull()
  })
})
