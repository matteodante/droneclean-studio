/**
 * The one question a project asks about DJI clips (plan 5.2): "were these shot in D-Log M?"
 *
 * The profile is not in the file (see `suggest.ts`), so the app asks. The first time a DJI file
 * (by its name) is imported into a project that has not answered, a small toast asks; "Yes" sets
 * D-Log M on the project's DJI clips that have no answer yet, and clips of the same project that
 * reach the timeline later get it as they arrive. "No" is remembered too, and nothing is applied.
 * Closing the toast answers nothing; the question is asked at most once per session then.
 *
 * The answer is kept per project in this browser's storage (`droneclean-dji-profile:<project id>`),
 * not in the project file, so it does not travel with an exported bundle; the clip panel's hint
 * and select still work on any clip.
 */

import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import type { ColorProfileId } from '@/studio/color/types'
import type { TimelineItem } from '@/types/timeline'
import { updateClipsTogether } from './batch-update'
import { onImportedClip } from '@/studio/side-work/imported-clips'
import { suggestColorProfile } from './suggest'

/** What a project answered: D-Log M, or "not log" (no transform is ever suggested again). */
export type ProjectProfileAnswer = 'dlog-m' | 'none'

const STORAGE_PREFIX = 'droneclean-dji-profile:'

/** The project's answer, or null when it has not answered (or storage is unreadable). */
export function readProfileAnswer(projectId: string): ProjectProfileAnswer | null {
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + projectId)
    return value === 'dlog-m' || value === 'none' ? value : null
  } catch {
    return null
  }
}

/** Remembers the project's answer; storage that is blocked only loses the memory. */
function writeProfileAnswer(projectId: string, answer: ProjectProfileAnswer): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + projectId, answer)
  } catch {
    // The answer still applies to this session's clips.
  }
}

/** Whether a media record's file name is DJI footage that carries a profile suffix. */
export function isDjiProfileFile(fileName: string): boolean {
  return suggestColorProfile({ fileName }) !== null
}

/**
 * The video clips among `items` that still wait for an answer (`inputColor` unset) and whose media
 * is DJI footage, by file name. `fileNameOf` gives a clip's media file name.
 */
export function djiClipsToAnswer(
  items: readonly TimelineItem[],
  fileNameOf: (item: TimelineItem) => string | undefined,
): string[] {
  return items
    .filter((item) => item.type === 'video' && item.inputColor === undefined)
    .filter((item) => {
      const name = fileNameOf(item)
      return name !== undefined && isDjiProfileFile(name)
    })
    .map((item) => item.id)
}

function mediaFileNameOf(item: TimelineItem): string | undefined {
  const mediaId = 'mediaId' in item ? item.mediaId : undefined
  if (!mediaId) return undefined
  return useMediaLibraryStore.getState().mediaById[mediaId]?.fileName
}

/** Sets the profile on every waiting DJI clip of the timeline, as one undo step. Returns the count. */
export function applyProfileToDjiClips(profile: ColorProfileId): number {
  const ids = djiClipsToAnswer(useItemsStore.getState().items, mediaFileNameOf)
  updateClipsTogether(
    'SET_COLOR_PROFILE',
    ids.map((id) => ({ id, updates: { inputColor: profile } })),
  )
  return ids.length
}

function currentProjectId(): string | null {
  return useProjectStore.getState().currentProject?.id ?? null
}

let followingTimeline = false
let seenIds = new Set<string>()

/**
 * After a "yes": clips that arrive on the timeline from now on get the answer too. Only ids not
 * seen before are looked at, so undoing the apply on a clip is not undone by this.
 */
function followTimeline(): void {
  if (followingTimeline) return
  followingTimeline = true
  seenIds = new Set(useItemsStore.getState().items.map((item) => item.id))
  useItemsStore.subscribe((state) => {
    const fresh = state.items.filter((item) => !seenIds.has(item.id))
    if (fresh.length === 0) return
    for (const item of fresh) seenIds.add(item.id)
    const projectId = currentProjectId()
    if (projectId === null || readProfileAnswer(projectId) !== 'dlog-m') return
    const ids = djiClipsToAnswer(fresh, mediaFileNameOf)
    updateClipsTogether(
      'SET_COLOR_PROFILE',
      ids.map((id) => ({ id, updates: { inputColor: 'dlog-m' as const } })),
    )
  })
}

/** Milliseconds a batch of imports is given to finish before the question is asked. */
export const PROMPT_DELAY_MS = 800

let timer: ReturnType<typeof setTimeout> | null = null
let askedThisSession = false

function ask(projectId: string): void {
  askedThisSession = true
  const answer = (value: ProjectProfileAnswer) => {
    writeProfileAnswer(projectId, value)
    if (value === 'dlog-m') {
      applyProfileToDjiClips('dlog-m')
      followTimeline()
    }
  }
  toast(i18n.t('presets.profile.askTitle', { defaultValue: 'Were these DJI clips shot in D-Log M?' }), {
    description: i18n.t('presets.profile.askBody', {
      defaultValue: 'The file does not say. Yes sets the D-Log M colour profile on them; you can change it on any clip.',
    }),
    duration: Infinity,
    closeButton: true,
    action: {
      label: i18n.t('presets.profile.askYes', { defaultValue: 'Yes, D-Log M' }),
      onClick: () => answer('dlog-m'),
    },
    cancel: {
      label: i18n.t('presets.profile.askNo', { defaultValue: 'No, normal' }),
      onClick: () => answer('none'),
    },
  })
}

/**
 * A freshly imported clip. A DJI-named video in a project that has not answered starts the
 * question (after a short pause, so a batch of clips asks once); in a project that answered
 * "D-Log M", the clips of this session follow the timeline.
 */
export function noteImportedClip(media: { fileName: string; mimeType: string }): void {
  if (!media.mimeType.startsWith('video/') || !isDjiProfileFile(media.fileName)) return
  const projectId = currentProjectId()
  if (projectId === null) return
  const answer = readProfileAnswer(projectId)
  if (answer === 'dlog-m') {
    followTimeline()
    return
  }
  if (answer === 'none' || askedThisSession) return
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const id = currentProjectId()
    if (id !== null && readProfileAnswer(id) === null) ask(id)
  }, PROMPT_DELAY_MS)
}

/** Forgets the session's state; for tests. */
export function resetProfilePromptForTests(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  askedThisSession = false
}

/** Starts listening for imports; called once from the app's startup. */
export function installDjiProfilePrompt(): void {
  onImportedClip(noteImportedClip)
}
