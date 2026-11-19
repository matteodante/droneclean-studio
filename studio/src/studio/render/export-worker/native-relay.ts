// The desktop shell's native media IPC, reached from the export worker through a port (design 3.6 sections 2.15 and
// 2.16). Starting a decode and cancelling a job are IPC messages, and only the page has the preload that sends them;
// the frames themselves the worker fetches on the `droneclean-frame:` scheme, and the readback it posts on the
// `droneclean-encode:` scheme, with no page in between. So the page serves its bridge's `startDecode` and `cancel` over
// a `MessagePort` (`serveNativeMedia`) and the worker's native backend calls a bridge that asks the page
// (`createRelayedNativeMedia`). The shell then sees every job as the page's, which is what ties a job to its window:
// a reload or a closed window cancels it (finding R6).

import type {
  CancelRequest,
  DecodeStartReply,
  DecodeStartRequest,
} from '@/studio/media/native-protocol'
import { NativeEngineError, type NativeEngineErrorPayload } from '@/studio/render/precise/contract'
import type { NativeMediaAnswer, NativeMediaBridge } from '@/studio/render/precise/native-source'
import type { RelayPort } from './engine-relay'

/** The part of the shell's bridge a native export needs from the page */
export type NativeDecodeBridge = Pick<NativeMediaBridge, 'startDecode' | 'cancel'>

/** Any failure of the page's bridge, as the contract's plain payload */
function payloadOf(error: unknown): NativeEngineErrorPayload {
  if (error instanceof NativeEngineError) return error.toPayload()
  return {
    message: error instanceof Error ? error.message : String(error),
    command: [],
    exitCode: null,
    signal: null,
    log: [],
  }
}

/** What the worker asks the page */
type Ask =
  | { readonly op: 'startDecode'; readonly id: number; readonly request: DecodeStartRequest }
  | { readonly op: 'cancel'; readonly request: CancelRequest }

/** What the page answers a `startDecode` with */
interface Answer {
  readonly id: number
  readonly answer: NativeMediaAnswer<DecodeStartReply>
}

/** Serves `bridge` to the worker on the other end of `port`; the returned function stops and closes the port. */
export function serveNativeMedia(port: RelayPort, bridge: NativeDecodeBridge): () => void {
  port.onmessage = (event: MessageEvent) => {
    const ask = event.data as Ask
    if (ask.op === 'cancel') {
      bridge.cancel(ask.request)
      return
    }
    void Promise.resolve()
      .then(() => bridge.startDecode(ask.request))
      .then(
        (answer): Answer => ({ id: ask.id, answer }),
        (error: unknown): Answer => ({
          id: ask.id,
          answer: { ok: false, error: payloadOf(error) },
        }),
      )
      .then((reply) => port.postMessage(reply))
  }
  return () => {
    port.onmessage = null
    port.close()
  }
}

/** A bridge that asks the page on the other end of `port`; `destroy` refuses what is pending and closes the port. */
export function createRelayedNativeMedia(
  port: RelayPort,
): NativeDecodeBridge & { destroy(): void } {
  const pending = new Map<number, (answer: NativeMediaAnswer<DecodeStartReply>) => void>()
  let nextId = 0
  let destroyed = false
  port.onmessage = (event: MessageEvent) => {
    const reply = event.data as Answer
    const resolve = pending.get(reply.id)
    if (resolve === undefined) return
    pending.delete(reply.id)
    resolve(reply.answer)
  }
  const gone = (): NativeMediaAnswer<DecodeStartReply> => ({
    ok: false,
    error: {
      message: 'the export ended before the decode started',
      command: [],
      exitCode: null,
      signal: null,
      log: [],
    },
  })
  return {
    startDecode(request) {
      if (destroyed) return Promise.resolve(gone())
      const id = nextId
      nextId += 1
      return new Promise((resolve) => {
        pending.set(id, resolve)
        const ask: Ask = { op: 'startDecode', id, request }
        port.postMessage(ask)
      })
    },
    cancel(request) {
      if (destroyed) return
      const ask: Ask = { op: 'cancel', request }
      port.postMessage(ask)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const resolve of pending.values()) resolve(gone())
      pending.clear()
      port.onmessage = null
      port.close()
    },
  }
}
