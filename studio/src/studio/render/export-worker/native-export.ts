// The page's half of a native 10-bit export (design 3.6 sections 2.15 and 2.16, plan tasks 3.3 and 8.4). A caller asks
// for one by giving `runRender` a `NativeExportTarget` (the format, the file the user chose in a save dialog, the
// bitrate); the export then renders in the worker as any other, but its frames come from each clip's file on disk
// through the desktop's FFmpeg, composite in float, and leave packed as `p010le` for the desktop's FFmpeg encoder,
// which writes the file. Before the worker's first frame the page does what only the page can:
//
//   paths    every video clip's file on disk, from its media record (`filePath`, recorded by the desktop app for
//            linked media), named to the shell's media registry, which lets a decode open only what the page named.
//            A clip with no path stops the export here with a `SourceError`: a 10-bit export never falls back to the
//            browser's 8-bit decoder for one clip;
//   encode   the encode job (`encode.start`, IPC): the shell checks the path was granted by a save dialog, spawns
//            FFmpeg and answers the frame length the worker's packing must make;
//   relay    a port serving the shell's decode IPC to the worker (`native-relay.ts`).
//
// `close` cancels the encode job (the shell kills FFmpeg and removes the partial file) unless the export completed.

import type { DesktopBridge } from '@/studio/desktop/bridge'
import { getDesktopBridge } from '@/studio/desktop/bridge'
import type { EncodeStartReply, EncodeStartRequest } from '@/studio/media/native-protocol'
import { NO_FILE_PATH } from '@/studio/render/frames/backends/native'
import {
  NativeEngineError,
  OUTPUT_COLOUR_TAGS,
  type NativeEngineErrorPayload,
  type PreciseExportFormatId,
} from '@/studio/render/precise/contract'
import { SourceError } from '@/studio/render/source-error'
import { toRate } from '@/studio/time'
import type { CompositionInputProps } from '@/types/export'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { serveNativeMedia, type NativeDecodeBridge } from './native-relay'

/** What a caller asks of a native 10-bit export */
export interface NativeExportTarget {
  /** One of `EXPORT_FORMATS`: HEVC Main 10 and ProRes 422 HQ are the 10-bit ones */
  readonly format: PreciseExportFormatId
  /** The file, as the user chose it in the desktop's save dialog (the shell refuses any other path) */
  readonly path: string
  /** The video bitrate, in bits per second */
  readonly bitrate: number
}

/** What the worker is handed: plain data and the relay's port */
export interface NativeExportPlan {
  readonly target: NativeExportTarget
  /** Each media id's absolute path, as the shell's media registry knows it */
  readonly paths: ReadonlyArray<readonly [string, string]>
  /** The started encode job: its id, the frame length the shell takes, and the picture size it was started for */
  readonly encode: {
    readonly jobId: string
    readonly frameBytes: number
    readonly width: number
    readonly height: number
  }
  /** The port to the page's decode IPC; `null` when the export renders on the page itself */
  readonly media: MessagePort | null
}

/** The shell's members a native export uses from the page */
export interface NativeShellBridge extends NativeDecodeBridge {
  encodeStart(
    request: EncodeStartRequest,
  ): Promise<
    | { readonly ok: true; readonly value: EncodeStartReply }
    | { readonly ok: false; readonly error: NativeEngineErrorPayload }
  >
  /** The media registry's naming of files by path (`mediaPaths.describe`): the real path of each, in order */
  describeMedia(paths: readonly string[]): Promise<readonly string[]>
}

interface PreloadMediaPaths {
  describe(paths: readonly string[]): Promise<ReadonlyArray<{ readonly path: string }>>
}

/** The desktop preload's members, as a native export uses them; an error outside the desktop shell */
export function preloadNativeShell(): NativeShellBridge {
  const bridge = getDesktopBridge() as
    | (DesktopBridge & {
        readonly nativeMedia?: Omit<NativeShellBridge, 'describeMedia'>
        readonly mediaPaths?: PreloadMediaPaths
      })
    | undefined
  const nativeMedia = bridge?.nativeMedia
  const mediaPaths = bridge?.mediaPaths
  if (nativeMedia === undefined || mediaPaths === undefined) {
    throw new Error(
      'A 10-bit export needs the desktop app: its FFmpeg decodes and encodes the frames',
    )
  }
  return {
    startDecode: (request) => nativeMedia.startDecode(request),
    cancel: (request) => nativeMedia.cancel(request),
    encodeStart: (request) => nativeMedia.encodeStart(request),
    async describeMedia(paths) {
      return (await mediaPaths.describe(paths)).map((file) => file.path)
    },
  }
}

/** The page's part of one native export, while it runs */
export interface NativeExportOpening {
  readonly plan: NativeExportPlan
  /** What the start message transfers (the relay's port) */
  readonly transfer: Transferable[]
  /** The export completed: the encode job is the shell's to finish, `close` leaves it alone */
  completed(): void
  /** Stops the relay; cancels the encode job unless the export completed */
  close(): void
}

/** The composition's video clips (a composition with sub-compositions renders on the page: FreeCut's refusal) */
function videoClipsOf(composition: CompositionInputProps): VideoItem[] {
  return (composition.tracks ?? [])
    .flatMap((track) => (track.items ?? []) as TimelineItem[])
    .filter((item): item is VideoItem => item.type === 'video')
}

/** A job id for an encode: `native-` and a UUID, which the protocol's pattern accepts */
function newJobId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `native-${random}`
}

/** The project's picture size, which the packing needs even (4:2:0 has whole chroma blocks) */
function pictureSize(composition: CompositionInputProps): { width: number; height: number } {
  const width = composition.width ?? 0
  const height = composition.height ?? 0
  const even = (side: number) => Number.isInteger(side) && side >= 2 && side % 2 === 0
  if (!even(width) || !even(height)) {
    throw new Error(`A 10-bit export needs an even picture size, the project is ${width}x${height}`)
  }
  return { width, height }
}

/** Each clip's media id and file on disk; a `SourceError` for the first clip that has none */
function clipPathsOf(
  clips: readonly VideoItem[],
  mediaById: Readonly<Record<string, MediaMetadata | undefined>>,
): Map<string, string> {
  const paths = new Map<string, string>()
  for (const clip of clips) {
    const filePath = clip.mediaId === undefined ? undefined : mediaById[clip.mediaId]?.filePath
    if (clip.mediaId === undefined || filePath === undefined || filePath === '') {
      throw new SourceError({
        clip: clip.label || clip.id,
        mediaId: clip.mediaId,
        reason: NO_FILE_PATH,
      })
    }
    paths.set(clip.mediaId, filePath)
  }
  return paths
}

/** Names the files to the shell's media registry; each media id's real path, or a `SourceError` naming the clip */
async function namePaths(
  clips: readonly VideoItem[],
  clipPaths: ReadonlyMap<string, string>,
  shell: NativeShellBridge,
): Promise<Array<readonly [string, string]>> {
  const named = [...new Set(clipPaths.values())]
  let realPaths: readonly string[]
  try {
    realPaths = await shell.describeMedia(named)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const [mediaId] = [...clipPaths].find(([, path]) => message.includes(path)) ?? []
    const clip = clips.find((item) => item.mediaId === mediaId) ?? clips[0]
    throw new SourceError({
      clip: clip?.label || clip?.id || 'unknown',
      mediaId,
      reason: `the desktop app cannot open its file: ${message}`,
      cause: error,
    })
  }
  const realOf = new Map(named.map((path, index) => [path, realPaths[index] ?? path]))
  return [...clipPaths].map(([mediaId, path]) => [mediaId, realOf.get(path) ?? path] as const)
}

/**
 * Prepares the page's part of a native export of `composition` into `target`. Rejects with a `SourceError` for a clip
 * whose file is not on disk (or that the shell cannot find), and with the shell's `NativeEngineError` when the encode
 * does not start (no FFmpeg, a path no save dialog granted, a format this FFmpeg cannot write).
 */
export async function openNativeExport(
  composition: CompositionInputProps,
  target: NativeExportTarget,
  mediaById: Readonly<Record<string, MediaMetadata | undefined>>,
  shell: NativeShellBridge,
  {
    relay,
    sendAudio,
  }: {
    readonly relay: boolean
    /** Mixes the project's sound and stages it in the shell for this job; `false` when the project has none */
    readonly sendAudio?: (jobId: string) => Promise<boolean>
  },
): Promise<NativeExportOpening> {
  const { width, height } = pictureSize(composition)
  const clips = videoClipsOf(composition)
  const paths = await namePaths(clips, clipPathsOf(clips, mediaById), shell)

  const jobId = newJobId()
  // The sound goes first: `encode.start` takes the staged mix by the job id and gives FFmpeg its second input.
  let staged = false
  if (sendAudio !== undefined) {
    try {
      staged = await sendAudio(jobId)
    } catch (error) {
      shell.cancel({ jobId })
      throw error
    }
  }
  const answer = await shell.encodeStart({
    jobId,
    path: target.path,
    format: target.format,
    readback: 'p010le',
    bitrate: target.bitrate,
    fps: toRate(composition.fps),
    tags: OUTPUT_COLOUR_TAGS,
    width,
    height,
  })
  if (!answer.ok) {
    if (staged) shell.cancel({ jobId })
    throw new NativeEngineError(answer.error)
  }
  if (answer.value.readback !== 'p010le') {
    shell.cancel({ jobId })
    throw new Error(
      `A 10-bit export packs p010le on the GPU; the shell takes ${answer.value.readback}`,
    )
  }

  const channel = relay ? new MessageChannel() : null
  const stopRelay = channel === null ? null : serveNativeMedia(channel.port1, shell)
  const media = channel?.port2 ?? null
  let completed = false
  let closed = false
  return {
    plan: {
      target,
      paths,
      encode: { jobId, frameBytes: answer.value.frameBytes, width, height },
      media,
    },
    transfer: media === null ? [] : [media],
    completed() {
      completed = true
    },
    close() {
      if (closed) return
      closed = true
      stopRelay?.()
      if (!completed) shell.cancel({ jobId })
    },
  }
}
