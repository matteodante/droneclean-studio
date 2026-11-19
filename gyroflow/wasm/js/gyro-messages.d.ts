// The worker's message switch (`gyro-messages.js`), as the editor's contract test imports it. The messages themselves
// are typed in `gyro-worker.d.ts`.

/** Where the switch posts its replies and receives its messages: the worker's `self`, or a test's stand-in */
export interface GyroMessageScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: { data: unknown }) => unknown) | null
}

/** What the switch is handed: the package's `init()` promise, its `Stabilizer` class and the clip's reader */
export interface GyroEngineModule {
  ready: Promise<unknown>
  Stabilizer: unknown
  reader: { readAsArrayBuffer(blob: Blob): ArrayBuffer }
  /** Bytes `start` to `end` (exclusive) of a linked file's URL, read synchronously; without it a linked file fails */
  readRange?: (url: string, start: number, end: number) => ArrayBuffer
}

/** How much of a linked file one `readRange` call reads */
export const LINKED_CHUNK_BYTES: number

/** Answers the engine's messages on `scope`, replacing its `onmessage` */
export function serveGyroMessages(scope: GyroMessageScope, engine: GyroEngineModule): void
