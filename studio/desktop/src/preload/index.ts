/**
 * Preload of the editor window: exposes `window.dronecleanDesktop` (see
 * `shared/bridge.ts`) and nothing else.
 *
 * The renderer is sandboxed, so this file may only require `electron`; the type
 * import below is erased at compile time and the native media channel names are
 * written out rather than imported, because a sandboxed preload cannot load
 * another file of the shell. `test/native-media.test.mjs` compares those names
 * with the main process's copy in `shared/native-media.ts`, and
 * `test/media-paths.test.mjs` compares the media path channel with
 * `main/media.ts`.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DesktopBridge,
  DesktopExportFile,
  DesktopMediaFile,
  DesktopMediaPaths,
  DesktopNativeMedia,
  DesktopShadowSession,
} from '../shared/bridge'
import type {
  ShadowRelayRequest,
  ShadowRelayResponse,
  ShadowSessionStatus,
} from '../shared/shadow-session'
import type {
  ExportFileAnswer,
  ExportFileChooseRequest,
  ExportFileChosen,
  ExportFileCommitRequest,
  ExportFileCommitted,
} from '../shared/export-file'
import type {
  CancelRequest,
  DecodeStartRequest,
  DecodeStartReply,
  EncodeStartReply,
  EncodeStartRequest,
  NativeEngineCapabilities,
  NativeMediaAnswer,
  NativeProgress,
} from '../shared/native-media'

/** `shared/native-media.ts`'s `NATIVE_MEDIA_CHANNELS`, written out. */
const CHANNELS = {
  decodeStart: 'native-media:decode.start',
  encodeStart: 'native-media:encode.start',
  cancel: 'native-media:cancel',
  progress: 'native-media:progress',
  capabilities: 'native-media:capabilities',
} as const

/** `main/media.ts`'s channel names, written out for the same reason. */
const MEDIA_PATH_DESCRIBE = 'media-paths:describe'
const MEDIA_PATH_ALLOW = 'media-paths:allow'

/** `shared/export-file.ts`'s `EXPORT_FILE_CHANNELS`, written out for the same reason. */
const EXPORT_FILE_CHANNELS = {
  choose: 'export-file:choose',
  commit: 'export-file:commit',
  discard: 'export-file:discard',
} as const

/** `shared/shadow-session.ts`'s `SHADOW_SESSION_CHANNELS`, written out for the same reason. */
const SHADOW_SESSION_CHANNELS = {
  status: 'shadow-session:status',
  request: 'shadow-session:request',
  signOut: 'shadow-session:sign-out',
} as const

function platform(): DesktopBridge['platform'] {
  if (process.platform === 'win32' || process.platform === 'linux') return process.platform
  // The product ships on macOS, Windows and Linux; Electron's Node reports one of
  // the three there, and anything else is not a supported build.
  return 'darwin'
}

const nativeMedia: DesktopNativeMedia = {
  startDecode(request: DecodeStartRequest): Promise<NativeMediaAnswer<DecodeStartReply>> {
    return ipcRenderer.invoke(CHANNELS.decodeStart, request)
  },
  encodeStart(request: EncodeStartRequest): Promise<NativeMediaAnswer<EncodeStartReply>> {
    return ipcRenderer.invoke(CHANNELS.encodeStart, request)
  },
  capabilities(): Promise<NativeMediaAnswer<NativeEngineCapabilities>> {
    return ipcRenderer.invoke(CHANNELS.capabilities)
  },
  cancel(request: CancelRequest): void {
    ipcRenderer.send(CHANNELS.cancel, request)
  },
  onProgress(listener: (progress: NativeProgress) => void): () => void {
    // The page never sees the IPC event itself, only the progress object.
    const handler = (_event: unknown, progress: NativeProgress): void => listener(progress)
    ipcRenderer.on(CHANNELS.progress, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.progress, handler)
    }
  },
}

const mediaPaths: DesktopMediaPaths = {
  describe(paths: readonly string[]): Promise<readonly DesktopMediaFile[]> {
    return ipcRenderer.invoke(MEDIA_PATH_DESCRIBE, paths)
  },
  allow(folders: readonly string[]): Promise<readonly string[]> {
    return ipcRenderer.invoke(MEDIA_PATH_ALLOW, folders)
  },
}

const exportFile: DesktopExportFile = {
  choose(request: ExportFileChooseRequest): Promise<ExportFileAnswer<ExportFileChosen | null>> {
    return ipcRenderer.invoke(EXPORT_FILE_CHANNELS.choose, request)
  },
  commit(request: ExportFileCommitRequest): Promise<ExportFileAnswer<ExportFileCommitted>> {
    return ipcRenderer.invoke(EXPORT_FILE_CHANNELS.commit, request)
  },
  discard(request: { readonly id: string }): Promise<ExportFileAnswer<null>> {
    return ipcRenderer.invoke(EXPORT_FILE_CHANNELS.discard, request)
  },
}

const shadowSession: DesktopShadowSession = {
  status(): Promise<ShadowSessionStatus> {
    return ipcRenderer.invoke(SHADOW_SESSION_CHANNELS.status)
  },
  request(request: ShadowRelayRequest): Promise<ShadowRelayResponse> {
    return ipcRenderer.invoke(SHADOW_SESSION_CHANNELS.request, request)
  },
  signOut(): Promise<void> {
    return ipcRenderer.invoke(SHADOW_SESSION_CHANNELS.signOut)
  },
}

const bridge: DesktopBridge = {
  version: 1,
  platform: platform(),
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  nativeMedia,
  mediaPaths,
  exportFile,
  shadowSession,
}

contextBridge.exposeInMainWorld('dronecleanDesktop', bridge)
