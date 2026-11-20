// The once-per-project question about DJI clips: asked at import, answered by the toast's two
// buttons, remembered, and carried to the clips that reach the timeline afterwards.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import type { MediaMetadata } from '@/types/storage'
import type { Project } from '@/types/project'
import type { VideoItem } from '@/types/timeline'

const toastCalls: Array<{ action: { onClick: () => void }; cancel: { onClick: () => void } }> = []
vi.mock('sonner', () => ({
  toast: vi.fn((_title: string, options: (typeof toastCalls)[number]) => {
    toastCalls.push(options)
  }),
}))

import {
  applyProfileToDjiClips,
  djiClipsToAnswer,
  isDjiProfileFile,
  noteImportedClip,
  PROMPT_DELAY_MS,
  readProfileAnswer,
  resetProfilePromptForTests,
} from './dji-profile-prompt'

const DJI_NAME = 'DJI_20261115124704_0020_D.MP4'

function media(id: string, fileName: string): MediaMetadata {
  return {
    id,
    storageType: 'workspace',
    fileName,
    fileSize: 1,
    mimeType: 'video/mp4',
    duration: 10,
    width: 3840,
    height: 2880,
    fps: 59.94,
    codec: 'hevc',
    bitrate: 1,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function clip(id: string, mediaId: string, extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id,
    trackId: 't1',
    type: 'video',
    label: id,
    mediaId,
    src: `blob:${id}`,
    from: 0,
    durationInFrames: 60,
    sourceFps: 59.94,
    sourceWidth: 3840,
    sourceHeight: 2880,
    ...extra,
  }
}

function inputColorOf(id: string): VideoItem['inputColor'] {
  return (useItemsStore.getState().itemById[id] as VideoItem | undefined)?.inputColor
}

let projectCounter = 0

describe('DJI colour profile question', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastCalls.length = 0
    projectCounter += 1
    useProjectStore.setState({
      currentProject: { id: `project-${projectCounter}`, name: 'p' } as unknown as Project,
    })
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
    useMediaLibraryStore.setState({
      mediaItems: [media('dji', DJI_NAME), media('plain', 'beach.mp4')],
    })
    resetProfilePromptForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('detects DJI profile file names and nothing else', () => {
    expect(isDjiProfileFile(DJI_NAME)).toBe(true)
    expect(isDjiProfileFile('DJI_20261115124704_0020_D-Log-M.MP4')).toBe(true)
    expect(isDjiProfileFile('DJI_20261115124704_0020.MP4')).toBe(false)
    expect(isDjiProfileFile('beach.mp4')).toBe(false)
  })

  it('asks once for a batch of DJI imports, and not for other clips', () => {
    noteImportedClip({ fileName: 'beach.mp4', mimeType: 'video/mp4' })
    noteImportedClip({ fileName: DJI_NAME, mimeType: 'image/jpeg' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS * 2)
    expect(toastCalls).toHaveLength(0)

    noteImportedClip({ fileName: DJI_NAME, mimeType: 'video/mp4' })
    noteImportedClip({ fileName: 'DJI_20261115125055_0021_D.MP4', mimeType: 'video/mp4' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS * 2)
    expect(toastCalls).toHaveLength(1)
  })

  it('Yes sets D-Log M on the waiting DJI clips as one undo step, remembers it, and follows later clips', () => {
    useItemsStore.getState().setItems([
      clip('a', 'dji'),
      clip('b', 'dji', { inputColor: 'none' }),
      clip('c', 'plain'),
    ])
    useTimelineCommandStore.getState().clearHistory()
    noteImportedClip({ fileName: DJI_NAME, mimeType: 'video/mp4' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)

    toastCalls[0]!.action.onClick()

    expect(inputColorOf('a')).toBe('dlog-m')
    expect(inputColorOf('b')).toBe('none')
    expect(inputColorOf('c')).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(readProfileAnswer(useProjectStore.getState().currentProject!.id)).toBe('dlog-m')

    // A clip that reaches the timeline afterwards is answered as it arrives.
    useItemsStore.getState().setItems([...useItemsStore.getState().items, clip('d', 'dji'), clip('e', 'plain')])
    expect(inputColorOf('d')).toBe('dlog-m')
    expect(inputColorOf('e')).toBeUndefined()

    // Undoing the apply is not undone again by the follower.
    useTimelineCommandStore.getState().undo()
    expect(inputColorOf('d')).toBeUndefined()
  })

  it('No is remembered, applies nothing and is never asked again in this project', () => {
    useItemsStore.getState().setItems([clip('a', 'dji')])
    noteImportedClip({ fileName: DJI_NAME, mimeType: 'video/mp4' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    toastCalls[0]!.cancel.onClick()

    expect(inputColorOf('a')).toBeUndefined()
    expect(readProfileAnswer(useProjectStore.getState().currentProject!.id)).toBe('none')

    resetProfilePromptForTests()
    noteImportedClip({ fileName: DJI_NAME, mimeType: 'video/mp4' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS * 2)
    expect(toastCalls).toHaveLength(1)
  })

  it('a project that answered is not asked, and a closed toast is not asked again this session', () => {
    noteImportedClip({ fileName: DJI_NAME, mimeType: 'video/mp4' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(toastCalls).toHaveLength(1)
    noteImportedClip({ fileName: DJI_NAME, mimeType: 'video/mp4' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(toastCalls).toHaveLength(1)
  })

  it('applyProfileToDjiClips counts what it set and makes no history entry for nothing', () => {
    useItemsStore.getState().setItems([clip('c', 'plain')])
    useTimelineCommandStore.getState().clearHistory()
    expect(applyProfileToDjiClips('dlog-m')).toBe(0)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(
      djiClipsToAnswer([clip('a', 'dji')], () => DJI_NAME),
    ).toEqual(['a'])
  })
})
