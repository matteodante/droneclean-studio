/**
 * The bridge the desktop shell exposes to the editor page as
 * `window.dronecleanDesktop`, version 1.
 *
 * This is the meeting point between the shell and the editor (task 1.2 records a
 * clip's file path through `getPathForFile`). Changing it means a new `version`;
 * nothing else is exposed in v1.
 *
 * v1 gained one additive member in task 3.1's slice P4: `nativeMedia`, the
 * control messages of the native media engine (`shared/native-media.ts`). Task
 * 2.2's slice 5 adds `mediaPaths`, the media an agent names by path: the page
 * asks for a URL on the app's own scheme and the shell answers it only for what
 * was named. Task 3.5 adds `exportFile`, the file an export streams into, and
 * task 4.6 adds `shadowSession`, the cloud sign-in kept in the main process.
 * Every additive member is optional, so an editor talking to a shell that
 * predates it keeps working; nothing is ever removed or retyped under the
 * same `version`. The packaged e2e asserts the exact set of members, so a new
 * member is a deliberate change there too.
 */
import type {
  ExportFileAnswer,
  ExportFileChooseRequest,
  ExportFileChosen,
  ExportFileCommitRequest,
  ExportFileCommitted,
} from './export-file'
import type {
  ShadowRelayRequest,
  ShadowRelayResponse,
  ShadowSessionStatus,
} from './shadow-session'
import type { MicrophoneAccess } from './microphone'
import type {
  CancelRequest,
  DecodeStartRequest,
  DecodeStartReply,
  EncodeStartReply,
  EncodeStartRequest,
  NativeEngineCapabilities,
  NativeMediaAnswer,
  NativeProgress,
} from './native-media'

/**
 * The native media engine, driven from the page: `decode.start`, `capabilities`
 * and `cancel` over Electron's IPC, and `progress` pushed back per decoded frame.
 *
 * The pixels do not travel here: a decoded frame is a `GET` of its URL on the
 * `droneclean-frame:` scheme (`shared/native-media.ts`), because 66 MB a frame
 * cannot cross an `ipc` message at a usable rate.
 */
export interface DesktopNativeMedia {
  /** Starts a decode; the reply says the source's size, rate, colour and frame length. */
  startDecode(request: DecodeStartRequest): Promise<NativeMediaAnswer<DecodeStartReply>>
  /**
   * Starts an encode to `request.path` (a path the user chose in a save dialog); the readback is
   * then POSTed to `droneclean-encode://encode/<jobId>`.
   */
  encodeStart(request: EncodeStartRequest): Promise<NativeMediaAnswer<EncodeStartReply>>
  /** What the shell's FFmpeg can do; 3.4's dialog reads it once a session. */
  capabilities(): Promise<NativeMediaAnswer<NativeEngineCapabilities>>
  /** Stops a decode: FFmpeg is killed, the frames are freed, further GETs are 410. */
  cancel(request: CancelRequest): void
  /** Listens to per-frame progress; the returned function stops listening. */
  onProgress(listener: (progress: NativeProgress) => void): () => void
}

/**
 * One file the page named by path (task 2.2 slice 5, design §4.5): what the
 * shell found on disk and the URL that serves its bytes on the app's scheme.
 */
export interface DesktopMediaFile {
  /** Real path of the file, with symlinks resolved. */
  readonly path: string
  /** Base name, for the media library's title. */
  readonly name: string
  /** Size in bytes. */
  readonly size: number
  /** Modification time, epoch milliseconds (`File.lastModified`). */
  readonly lastModified: number
  /** `droneclean://app/__media/<id>`, read with `Range` on the app's own origin. */
  readonly url: string
}

/**
 * Media an agent names by path. The page names the files of an import through
 * `describe` and the folders of the open project's path records through
 * `allow` (the restart case); both answer only what the app named, and the
 * route serves nothing else.
 */
export interface DesktopMediaPaths {
  describe(paths: readonly string[]): Promise<readonly DesktopMediaFile[]>
  allow(folders: readonly string[]): Promise<readonly string[]>
}

/**
 * The file an export is written to (task 3.5): the dialog asks for it before the export starts,
 * the muxer's bytes are POSTed to `droneclean-export://file/<id>/…` (`shared/export-file.ts`), and
 * the export ends with `commit` (the file appears under its name) or `discard` (nothing is left).
 */
export interface DesktopExportFile {
  /** The save dialog; `null` value when the user closed it. The file is open on success. */
  choose(request: ExportFileChooseRequest): Promise<ExportFileAnswer<ExportFileChosen | null>>
  /** Moves the finished file to its name, with the sidecar subtitle file beside it when given. */
  commit(request: ExportFileCommitRequest): Promise<ExportFileAnswer<ExportFileCommitted>>
  /** Removes what was written; the user's file of that name, if any, is untouched. */
  discard(request: { readonly id: string }): Promise<ExportFileAnswer<null>>
}

/**
 * The cloud sign-in (task 4.6, slice E7): the main process keeps the token and attaches it, so
 * the page only asks for its calls to be made (`shared/shadow-session.ts`).
 */
export interface DesktopShadowSession {
  status(): Promise<ShadowSessionStatus>
  /** One call to the cloud's `/v1/*` or device sign-in routes, made with the token. */
  request(request: ShadowRelayRequest): Promise<ShadowRelayResponse>
  /** Deletes the token and ends the session at the cloud. */
  signOut(): Promise<void>
}

/** The microphone's system permission, asked for by the shell (`shared/microphone.ts`). */
export interface DesktopMicrophone {
  /** Asks macOS when undecided, and says where it stands. */
  request(): Promise<MicrophoneAccess>
}

export interface DesktopBridge {
  readonly version: 1
  readonly platform: 'darwin' | 'win32' | 'linux'
  /** Absolute path of a File that comes from the local disk, '' otherwise. */
  getPathForFile(file: File): string
  /** The native media engine (task 3.1, P4); absent in a shell that predates it. */
  readonly nativeMedia?: DesktopNativeMedia
  /** Media named by path (task 2.2, slice 5); absent in a shell that predates it. */
  readonly mediaPaths?: DesktopMediaPaths
  /** The export's destination file (task 3.5); absent in a shell that predates it. */
  readonly exportFile?: DesktopExportFile
  /** The cloud sign-in's token and relay (task 4.6); absent in a shell that predates it. */
  readonly shadowSession?: DesktopShadowSession
  /** The microphone's permission; absent in a shell that predates it. */
  readonly microphone?: DesktopMicrophone
}
