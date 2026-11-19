// The native 10-bit export of this realm, while one runs (design 3.6 sections 2.15 and 2.16, plan task 8.4): what the
// renderer's provider and the stage predicates read to draw every video clip from the desktop's FFmpeg instead of the
// browser's 8-bit decoder. The export loop (`export-worker/native-render.ts`) sets it before its renderer is created
// and clears it on every way out; in the export worker that is the worker's realm, on the page the page's.
//
//   bridge  the shell's decode IPC: the preload's on the page, the page's relayed through a port in the worker;
//   paths   each media id's file on disk, as the media library records it and the shell's media registry knows it.
//
// Nothing here imports a GPU, a store or the DOM: the predicates read it, and they are read everywhere.

import type { NativeMediaBridge } from './native-source'

/** One native export's session in this realm */
export interface NativeExportSession {
  readonly bridge: Pick<NativeMediaBridge, 'startDecode' | 'cancel'>
  /** Each media id's absolute path, registered with the shell's media registry by the page */
  readonly paths: ReadonlyMap<string, string>
}

let session: NativeExportSession | null = null

/** Starts (or, with `null`, ends) this realm's native export session */
export function setNativeExportSession(next: NativeExportSession | null): void {
  session = next
}

/** This realm's native export session, or `null` when none runs */
export function nativeExportSession(): NativeExportSession | null {
  return session
}

/** Whether a native export runs in this realm: every video clip then reads its frames through the provider */
export function nativeExportActive(): boolean {
  return session !== null
}
