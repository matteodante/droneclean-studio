/**
 * Media an agent names by path, on the page side (task 2.2 slice 5, design
 * §4.5): the rules in front of the shell's route and the library's path
 * records, with the shell, the library and the URL manager behind the
 * `MediaPathEnvironment` seam. The route itself (allow-list, Range, 404) is
 * `studio/desktop/test/media-paths.test.mjs`; the records are
 * `media-library-service.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { StudioError } from '../sdk/errors'
import type { MediaImportOptions, MediaInfo, Studio } from '../sdk/types'
import type {
  DesktopMediaFile as ShellMediaFile,
  DesktopMediaPaths as ShellMediaPaths,
} from '../../../desktop/src/shared/bridge'
import {
  folderOfPath,
  importMediaPaths,
  importNamedPaths,
  installAgentMedia,
  pathRecordsOf,
  registerPathRecords,
  type AgentMediaPathFile,
  type AgentMediaPathsBridge,
  type MediaPathEnvironment,
  type PathMediaRecord,
} from './media'

/** True only when `A` and `B` are assignable to each other: the same shape. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// The shell is its own TypeScript project, so the page keeps a copy of the
// member it calls; a field renamed on one side fails `vp run check` here.
const sameFile: Same<AgentMediaPathFile, ShellMediaFile> = true
const sameBridge: Same<AgentMediaPathsBridge, ShellMediaPaths> = true

function file(path: string, overrides: Partial<AgentMediaPathFile> = {}): AgentMediaPathFile {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    name,
    size: 1024,
    lastModified: 1_700_000_000_000,
    url: `droneclean://app/__media/${name.replace(/[^A-Za-z0-9]/g, '')}`,
    ...overrides,
  }
}

function record(id: string, overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id,
    storageType: 'path',
    filePath: `/media/${id}.mp4`,
    fileName: `${id}.mp4`,
    fileSize: 1024,
    fileLastModified: 1_700_000_000_000,
    mimeType: 'video/mp4',
    duration: 10,
    width: 3840,
    height: 2880,
    fps: 30,
    codec: 'hevc',
    bitrate: 100_000_000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function info(id: string): MediaInfo {
  return { id, fileName: `${id}.mp4` } as MediaInfo
}

/** What the fakes were asked to do, in order. */
interface Faked {
  log: string[]
  described: string[][]
  allowed: string[][]
  imported: Array<{ sources: readonly AgentMediaPathFile[]; projectId: string }>
  shown: string[][]
  urls: Array<{ id: string; url: string }>
  healthy: string[]
  handleCalls: Array<{ items: readonly FileSystemFileHandle[]; options?: MediaImportOptions }>
}

/** An environment whose shell, library and URL manager record their calls. */
function fakeEnvironment(
  options: {
    bridge?: AgentMediaPathsBridge | null
    projectId?: string | null
    importError?: Error
    describeError?: Error
    describe?: (paths: readonly string[]) => readonly AgentMediaPathFile[]
  } = {},
): { environment: MediaPathEnvironment; faked: Faked } {
  const faked: Faked = {
    log: [],
    described: [],
    allowed: [],
    imported: [],
    shown: [],
    urls: [],
    healthy: [],
    handleCalls: [],
  }
  const bridge =
    options.bridge === null
      ? undefined
      : (options.bridge ?? {
          describe: async (paths) => {
            faked.described.push([...paths])
            faked.log.push('describe')
            if (options.describeError) throw options.describeError
            return options.describe ? options.describe(paths) : paths.map((path) => file(path))
          },
          allow: async (folders) => {
            faked.allowed.push([...folders])
            return [...folders]
          },
        })
  const environment: MediaPathEnvironment = {
    bridge: () => bridge,
    currentProjectId: () => (options.projectId === undefined ? 'project-1' : options.projectId),
    importHandles: async (items, importOptions) => {
      faked.handleCalls.push({ items, ...(importOptions ? { options: importOptions } : {}) })
      if (!Array.isArray(items)) {
        throw new StudioError({
          code: 'INVALID_ARGUMENT',
          message: 'media.import: "handles" must be an array of FileSystemFileHandle',
        })
      }
      return items.map((item) => info(item.name))
    },
    importLinkedPaths: async (sources, projectId) => {
      faked.imported.push({ sources, projectId })
      if (options.importError) throw options.importError
      return sources.map((_source, index) => record(`media-${index}`))
    },
    showInLibrary: (records) => {
      faked.shown.push(records.map((entry) => entry.id))
      faked.log.push('show')
    },
    registerUrl: (id, url) => {
      faked.urls.push({ id, url })
      faked.log.push('register')
    },
    hasUrl: (id) => faked.urls.some((entry) => entry.id === id),
    markHealthy: (id) => {
      faked.healthy.push(id)
    },
    info: (id) => info(id),
  }
  return { environment, faked }
}

/** The `StudioError` a call threw. */
async function caught(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('the call did not throw')
}

describe('the page’s copy of the shell’s media paths member', () => {
  it('is the same shape as the shell’s, at compile time', () => {
    expect([sameFile, sameBridge]).toEqual([true, true])
  })
})

describe('importNamedPaths', () => {
  it('describes every path in one call, imports the files and answers their infos', async () => {
    const { environment, faked } = fakeEnvironment()

    const infos = await importNamedPaths(
      ['/media/a.mp4', '/media/b.mp4', '/media/a.mp4'],
      undefined,
      environment,
    )

    expect(faked.described).toEqual([['/media/a.mp4', '/media/b.mp4']])
    expect(faked.imported).toHaveLength(1)
    expect(faked.imported[0]?.projectId).toBe('project-1')
    expect(faked.imported[0]?.sources.map((source) => source.url)).toEqual([
      'droneclean://app/__media/amp4',
      'droneclean://app/__media/bmp4',
    ])
    expect(infos.map((entry) => entry.id)).toEqual(['media-0', 'media-1'])
  })

  it('registers each URL before the record is shown in the library', async () => {
    const { environment, faked } = fakeEnvironment()

    await importNamedPaths(['/media/a.mp4'], undefined, environment)

    expect(faked.log).toEqual(['describe', 'register', 'show'])
    expect(faked.urls).toEqual([{ id: 'media-0', url: 'droneclean://app/__media/amp4' }])
    expect(faked.shown).toEqual([['media-0']])
  })

  it('refuses copy: a path is linked, never copied', async () => {
    const { environment } = fakeEnvironment()

    const error = await caught(() =>
      importNamedPaths(['/media/a.mp4'], { storageMode: 'copy' }, environment),
    )

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toMatch(/never copied/)
  })

  it('refuses a page without the desktop shell', async () => {
    const { environment } = fakeEnvironment({ bridge: null })

    const error = await caught(() => importNamedPaths(['/media/a.mp4'], undefined, environment))

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toMatch(/needs the desktop app/)
  })

  it('refuses when no project is open', async () => {
    const { environment } = fakeEnvironment({ projectId: null })

    const error = await caught(() => importNamedPaths(['/media/a.mp4'], undefined, environment))

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toMatch(/no project is open/)
    // The MCP tour: create alone does not get the library ready; the hint names the call that does.
    expect(error.hint).toBe(
      'Open the project first with studio.project.open(id); after studio.project.create, pass the id it returned.',
    )
  })

  it('turns the shell’s refusal into MEDIA_UNAVAILABLE, naming the reason', async () => {
    const { environment, faked } = fakeEnvironment({
      describeError: new Error(
        "Error invoking remote method 'media-paths:describe': Error: media paths: not video, audio or image: /media/notes.txt",
      ),
    })

    const error = await caught(() => importNamedPaths(['/media/notes.txt'], undefined, environment))

    expect(error.code).toBe('MEDIA_UNAVAILABLE')
    // The Electron invoke wrapper is not the agent's sentence; the shell's is.
    expect(error.message).toBe(
      'media.import: the desktop app could not open the media: media paths: not video, audio or image: /media/notes.txt',
    )
    expect(faked.shown).toEqual([])
  })

  it('turns a failed import into MEDIA_UNAVAILABLE and registers nothing', async () => {
    const { environment, faked } = fakeEnvironment({
      importError: new Error('"a.mp4" could not be read: timeout'),
    })

    const error = await caught(() => importNamedPaths(['/media/a.mp4'], undefined, environment))

    expect(error.code).toBe('MEDIA_UNAVAILABLE')
    expect(error.message).toContain('could not be read')
    expect(faked.urls).toEqual([])
    expect(faked.shown).toEqual([])
  })
})

describe('importMediaPaths: the wrapped studio.media.import', () => {
  it('sends a call of handles to the SDK unchanged', async () => {
    const { environment, faked } = fakeEnvironment()
    const handle = { name: 'a.mp4' } as unknown as FileSystemFileHandle

    const infos = await importMediaPaths([handle], { storageMode: 'link' }, environment)

    expect(faked.handleCalls).toEqual([{ items: [handle], options: { storageMode: 'link' } }])
    expect(faked.described).toEqual([])
    expect(infos.map((entry) => entry.id)).toEqual(['a.mp4'])
  })

  it('sends a mixed call to the SDK first, then through the shell', async () => {
    const { environment, faked } = fakeEnvironment()
    const handle = { name: 'picked.mp4' } as unknown as FileSystemFileHandle

    const infos = await importMediaPaths([handle, '/media/a.mp4'], undefined, environment)

    expect(faked.handleCalls).toHaveLength(1)
    expect(faked.described).toEqual([['/media/a.mp4']])
    expect(infos.map((entry) => entry.id)).toEqual(['picked.mp4', 'media-0'])
  })

  it('delegates a non-array to the SDK’s own argument check', async () => {
    const { environment, faked } = fakeEnvironment()

    const error = await caught(() => importMediaPaths('not-an-array', undefined, environment))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(faked.handleCalls).toHaveLength(1)
    expect(faked.described).toEqual([])
  })
})

describe('registerPathRecords: the restart path', () => {
  const records: PathMediaRecord[] = [
    { id: 'one', filePath: '/footage/clip-1.mp4' },
    { id: 'two', filePath: '/footage/clip-2.mp4' },
    { id: 'three', filePath: '/footage/nested/clip-3.mp4' },
  ]

  it('allows the folders first, then names every file in one call and registers its URL', async () => {
    const { environment, faked } = fakeEnvironment()

    const result = await registerPathRecords(records, environment)

    expect(faked.allowed).toEqual([['/footage', '/footage/nested']])
    expect(faked.described).toEqual([['/footage/clip-1.mp4', '/footage/clip-2.mp4', '/footage/nested/clip-3.mp4']])
    expect(faked.urls.map((entry) => entry.id)).toEqual(['one', 'two', 'three'])
    expect(faked.healthy).toEqual(['one', 'two', 'three'])
    expect(result).toEqual({ folders: 2, files: 3, urls: 3 })
  })

  it('skips records whose URL is already registered', async () => {
    const { environment, faked } = fakeEnvironment()
    environment.registerUrl('two', 'droneclean://app/__media/two')

    const result = await registerPathRecords(records, environment)

    expect(faked.described.flat()).not.toContain('/footage/clip-2.mp4')
    expect(result.urls).toBe(2)
  })

  it('falls back to one call per file when the batch fails, costing only the failing file', async () => {
    const { environment, faked } = fakeEnvironment({
      describe: (paths) => {
        if (paths.includes('/footage/clip-2.mp4')) throw new Error('no such file')
        return paths.map((path) => file(path))
      },
    })

    const result = await registerPathRecords(records, environment)

    expect(result.urls).toBe(2)
    expect(faked.urls.map((entry) => entry.id)).toEqual(['one', 'three'])
    // The batch, then each file on its own.
    expect(faked.described).toEqual([
      ['/footage/clip-1.mp4', '/footage/clip-2.mp4', '/footage/nested/clip-3.mp4'],
      ['/footage/clip-1.mp4'],
      ['/footage/clip-2.mp4'],
      ['/footage/nested/clip-3.mp4'],
    ])
  })

  it('does nothing on a page without the desktop shell', async () => {
    const { environment, faked } = fakeEnvironment({ bridge: null })

    expect(await registerPathRecords(records, environment)).toEqual({
      folders: 0,
      files: 0,
      urls: 0,
    })
    expect(faked.urls).toEqual([])
  })
})

describe('path records and folders', () => {
  it('takes only path records that name a file', () => {
    const items = [
      record('one'),
      record('two', { storageType: 'handle', filePath: '/footage/two.mp4' }),
      record('three', { filePath: undefined }),
      record('four', { storageType: 'workspace' }),
    ]

    expect(pathRecordsOf(items)).toEqual([{ id: 'one', filePath: '/media/one.mp4' }])
  })

  it('finds the folder of a POSIX or Windows path, and none at a disk root', () => {
    expect(folderOfPath('/footage/2026-11-15/clip.mp4')).toBe('/footage/2026-11-15')
    expect(folderOfPath('C:\\footage\\clip.mp4')).toBe('C:\\footage')
    expect(folderOfPath('C:\\clip.mp4')).toBe('C:\\')
    // The disk root itself is not a folder the route allows.
    expect(folderOfPath('/clip.mp4')).toBe(null)
  })
})

describe('installAgentMedia', () => {
  afterEach(() => {
    delete (globalThis as { studio?: Studio }).studio
  })

  beforeEach(() => {
    delete (globalThis as { studio?: Studio }).studio
  })

  function fakeStudio(): {
    studio: Studio
    calls: Array<{ items: unknown; options?: MediaImportOptions }>
  } {
    const calls: Array<{ items: unknown; options?: MediaImportOptions }> = []
    const studio = {
      media: {
        import: async (items: FileSystemFileHandle[], options?: MediaImportOptions) => {
          calls.push({ items, ...(options ? { options } : {}) })
          return items.map((item) => info(item.name))
        },
      },
    } as unknown as Studio
    return { studio, calls }
  }

  it('needs the SDK: it is installed after installStudio()', () => {
    expect(() => installAgentMedia()).toThrow(/after installStudio/)
  })

  it('keeps the handle import and refuses a path without the desktop shell', async () => {
    const { studio, calls } = fakeStudio()
    ;(globalThis as { studio?: Studio }).studio = studio
    installAgentMedia()

    const handle = { name: 'picked.mp4' } as unknown as FileSystemFileHandle
    expect((await studio.media.import([handle])).map((entry) => entry.id)).toEqual(['picked.mp4'])
    expect(calls).toEqual([{ items: [handle] }])

    const error = await caught(() => studio.media.import(['/media/a.mp4' as never]))
    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toMatch(/needs the desktop app/)
  })

  it('wraps once, however many times it is installed', () => {
    const { studio } = fakeStudio()
    ;(globalThis as { studio?: Studio }).studio = studio
    installAgentMedia()
    const wrapped = studio.media.import
    installAgentMedia()
    expect(studio.media.import).toBe(wrapped)
  })
})
