// The page's stabilization host, reached from the export worker through a port (design 3.6 section 2.15, finding S7).
//
// The engines are Gyroflow workers the page's host opened (`stabilization/seat.ts`): opening one reads 1.9 GB of
// clip 0020 in 3-6.5 s, and Gyroflow's worker answers only its owner. So the export worker does not open its own: the
// page serves its host over a `MessagePort` (`serveStabilizationHost`), and the worker's stabilization stage reads a
// host that asks the page (`createRelayedStabilizationHost`) - the same engine, its open, its size and its frames.
//
// The relayed host answers what the stage asks synchronously (`engineState`, `frame`, `outputSizeOf`, `loadedAssets`)
// from what the page already replied, and starts a request for the rest, as the page's host does with its engines.
// It keeps a frame window of its own and asks for the next frames ahead of the one the stage wants, so the port's
// round trip runs while the frame before is drawn. It never writes the page's host: it only opens (an open joins the
// page's), reads assets and reads frames; `release`, `close` and `sync` let go of what the worker holds, nothing more.

import {
  ClipUnreadableError,
  NoLensProfileError,
  NoMotionDataError,
  type StabilizationFrameData,
  type StabilizationInfo,
  type StabilizationLens,
} from '@/studio/stabilization/client'
import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import type {
  EngineOpenOptions,
  EngineOpenResult,
  EngineState,
  StabilizationSeat,
} from '@/studio/stabilization/seat'
import type { SmoothingMethod, StabilizationOutputSize } from '@/studio/stabilization/settings'
import type { StabilizationAssets } from '@/studio/stabilization/stage'
import type { VideoItem } from '@/types/timeline'
import { serializeFailure, type SerializedFailure } from './protocol'

/** What the relay needs of a port: a `MessagePort` (the tests use Node's) */
export interface RelayPort {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent) => void) | null
  close(): void
}

/** How many source frames' data the worker keeps per engine (the page's host keeps 48 too) */
const FRAME_CACHE = 48
/** How many frames after the one asked for are requested with it */
const LOOKAHEAD = 8

/** What the worker asks the page */
type HostAsk =
  | { readonly op: 'open'; readonly item: VideoItem; readonly fps?: number }
  | { readonly op: 'assets'; readonly key: string }
  | { readonly op: 'frame'; readonly key: string; readonly sourceFrame: number }

/** One ask, numbered: the reply carries the number */
type HostRequest = HostAsk & { readonly id: number }

/** An open's result as it crosses: the errors as name and message */
type RelayedOpenResult =
  | { readonly kind: 'ready'; readonly info: StabilizationInfo; readonly lens: StabilizationLens }
  | {
      readonly kind: 'no-lens-profile'
      readonly info: StabilizationInfo
      readonly error: SerializedFailure
    }
  | { readonly kind: 'no-motion-data'; readonly error: SerializedFailure }
  | { readonly kind: 'failed'; readonly error: SerializedFailure }

/** The reply to an open: the result and the size the page's host then reports for the key */
interface OpenReply {
  readonly result: RelayedOpenResult
  readonly size: StabilizationOutputSize | null
}

/** What the page answers */
type HostReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: SerializedFailure }

// -- the page's side --------------------------------------------------------------------------------------------------

function relayResult(result: EngineOpenResult): RelayedOpenResult {
  switch (result.kind) {
    case 'ready':
      return result
    case 'no-lens-profile':
      return { kind: result.kind, info: result.info, error: serializeFailure(result.error) }
    case 'no-motion-data':
    case 'failed':
      return { kind: result.kind, error: serializeFailure(result.error) }
  }
}

/** Why a frame the page's host was asked for is not there, when its fetch reported no failure */
function missingFrameReason(host: StabilizationSeat, key: string): string {
  const state = host.engineState(key)
  if (state.status === 'failed') return state.error.message
  return 'the clip’s engine for these settings closed while the export read it'
}

async function answer(host: StabilizationSeat, request: HostRequest): Promise<unknown> {
  switch (request.op) {
    case 'open': {
      const result = await host.open(request.item, { retry: true, fps: request.fps })
      const key = stabilizationEngineKey(request.item)
      const reply: OpenReply = {
        result: relayResult(result),
        size: key === null ? null : host.outputSizeOf(key),
      }
      return reply
    }
    case 'assets':
      return host.stageAssets(request.key)
    case 'frame': {
      const { key, sourceFrame } = request
      if (host.frame(key, sourceFrame) === undefined) await host.requestFrame(key, sourceFrame)
      const frame = host.frame(key, sourceFrame)
      if (frame !== undefined) return frame
      const failure = host.takeFrameFailure(key, sourceFrame)
      throw failure ?? new Error(missingFrameReason(host, key))
    }
  }
}

/**
 * Serves `host` (the page's) on `port` until the returned function is called, which closes the port. Each request is
 * answered on its own: a frame is never held behind an open.
 */
export function serveStabilizationHost(port: RelayPort, host: StabilizationSeat): () => void {
  let stopped = false
  port.onmessage = (event: MessageEvent) => {
    const request = event.data as HostRequest
    answer(host, request).then(
      (value) => {
        if (!stopped) port.postMessage({ id: request.id, ok: true, value } satisfies HostReply)
      },
      (error: unknown) => {
        if (!stopped) {
          port.postMessage({
            id: request.id,
            ok: false,
            error: serializeFailure(error),
          } satisfies HostReply)
        }
      },
    )
  }
  return () => {
    if (stopped) return
    stopped = true
    port.onmessage = null
    port.close()
  }
}

// -- the worker's side ------------------------------------------------------------------------------------------------

/** The error a relayed failure becomes on the worker's side: the class the page's host gave, by name, with its message */
function errorFrom(failure: SerializedFailure): Error {
  switch (failure.name) {
    case 'NoMotionDataError':
      return new NoMotionDataError(failure.message)
    case 'NoLensProfileError':
      return new NoLensProfileError(failure.message)
    default: {
      const error = new Error(failure.message)
      error.name = failure.name
      return error
    }
  }
}

function openResultFrom(relayed: RelayedOpenResult): EngineOpenResult {
  switch (relayed.kind) {
    case 'ready':
      return relayed
    case 'no-lens-profile':
      return {
        kind: 'no-lens-profile',
        info: relayed.info,
        error: new NoLensProfileError(relayed.error.message),
      }
    case 'no-motion-data':
      return { kind: 'no-motion-data', error: new NoMotionDataError(relayed.error.message) }
    case 'failed':
      return { kind: 'failed', error: errorFrom(relayed.error) }
  }
}

function isUsable(result: EngineOpenResult | null): boolean {
  return result?.kind === 'ready' || result?.kind === 'no-lens-profile'
}

/** One engine as the worker knows it */
interface RelayedEntry {
  result: EngineOpenResult | null
  pending: Promise<EngineOpenResult>
  size: StabilizationOutputSize | null
  /** The source's frame count, once open: the lookahead stops at the end */
  frameCount: number | null
  assets: StabilizationAssets | undefined
  assetsPending: Promise<StabilizationAssets> | undefined
  readonly frames: Map<number, StabilizationFrameData>
  readonly inflight: Map<number, Promise<void>>
  readonly failures: Map<number, Error>
}

class RelayedHost implements StabilizationSeat {
  private readonly entries = new Map<string, RelayedEntry>()
  private readonly waiters = new Map<string, Array<() => void>>()
  private readonly calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private nextId = 1
  private closed = false

  constructor(private readonly port: RelayPort) {
    port.onmessage = (event: MessageEvent) => {
      const reply = event.data as HostReply
      const call = this.calls.get(reply.id)
      if (!call) return
      this.calls.delete(reply.id)
      if (reply.ok) call.resolve(reply.value)
      else call.reject(errorFrom(reply.error))
    }
  }

  private ask<T>(request: HostAsk): Promise<T> {
    if (this.closed) {
      return Promise.reject(new ClipUnreadableError('the export worker’s host is closed'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: (value) => resolve(value as T), reject })
      this.port.postMessage({ ...request, id })
    })
  }

  open(item: VideoItem, options: EngineOpenOptions = {}): Promise<EngineOpenResult> {
    const key = stabilizationEngineKey(item)
    if (key === null) {
      return Promise.resolve({
        kind: 'failed',
        error: new ClipUnreadableError('the clip has no source file or no stabilization settings'),
      })
    }
    const known = this.entries.get(key)
    if (known && !(options.retry === true && known.result !== null && !isUsable(known.result))) {
      return known.pending
    }
    const entry: RelayedEntry = {
      result: null,
      pending: Promise.resolve({ kind: 'failed', error: new Error('not started') }),
      size: null,
      frameCount: null,
      assets: undefined,
      assetsPending: undefined,
      frames: new Map(),
      inflight: new Map(),
      failures: new Map(),
    }
    this.entries.set(key, entry)
    entry.pending = this.ask<OpenReply>({ op: 'open', item, fps: options.fps }).then(
      (reply) => {
        entry.size = reply.size
        const result = openResultFrom(reply.result)
        if (result.kind === 'ready' || result.kind === 'no-lens-profile') {
          entry.frameCount = result.info.frames
        }
        return this.settle(key, entry, result)
      },
      (error: Error) => this.settle(key, entry, { kind: 'failed', error }),
    )
    return entry.pending
  }

  private settle(key: string, entry: RelayedEntry, result: EngineOpenResult): EngineOpenResult {
    entry.result = result
    const waiting = this.waiters.get(key)
    if (waiting) {
      this.waiters.delete(key)
      for (const resolve of waiting) resolve()
    }
    return result
  }

  engineState(key: string): EngineState {
    const entry = this.entries.get(key)
    if (!entry) return { status: 'absent' }
    const result = entry.result
    if (result === null) return { status: 'opening', settled: entry.pending.then(() => undefined) }
    if (result.kind === 'ready' || result.kind === 'no-lens-profile') {
      return { status: 'ready', info: result.info }
    }
    return { status: 'failed', error: result.error }
  }

  outputSizeOf(key: string): StabilizationOutputSize | null {
    const entry = this.entries.get(key)
    return entry && isUsable(entry.result) ? entry.size : null
  }

  whenSettled(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry) return entry.pending.then(() => undefined)
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? []
      list.push(resolve)
      this.waiters.set(key, list)
    })
  }

  frame(key: string, sourceFrame: number): StabilizationFrameData | undefined {
    return this.entries.get(key)?.frames.get(sourceFrame)
  }

  requestFrame(key: string, sourceFrame: number): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry || !isUsable(entry.result)) return Promise.resolve()
    const asked = this.fetchFrame(entry, key, sourceFrame)
    const end = entry.frameCount ?? Number.POSITIVE_INFINITY
    for (let next = sourceFrame + 1; next <= sourceFrame + LOOKAHEAD && next < end; next++) {
      void this.fetchFrame(entry, key, next)
    }
    return asked
  }

  private fetchFrame(entry: RelayedEntry, key: string, sourceFrame: number): Promise<void> {
    if (entry.frames.has(sourceFrame)) return Promise.resolve()
    const known = entry.inflight.get(sourceFrame)
    if (known) return known
    entry.failures.delete(sourceFrame)
    const fetching = this.ask<StabilizationFrameData>({ op: 'frame', key, sourceFrame })
      .then(
        (frame) => {
          if (this.entries.get(key) !== entry) return
          entry.frames.set(sourceFrame, frame)
          while (entry.frames.size > FRAME_CACHE) {
            const oldest = entry.frames.keys().next().value
            if (oldest === undefined || oldest === sourceFrame) break
            entry.frames.delete(oldest)
          }
        },
        (error: Error) => {
          if (this.entries.get(key) === entry) entry.failures.set(sourceFrame, error)
        },
      )
      .finally(() => {
        if (entry.inflight.get(sourceFrame) === fetching) entry.inflight.delete(sourceFrame)
      })
    entry.inflight.set(sourceFrame, fetching)
    return fetching
  }

  takeFrameFailure(key: string, sourceFrame: number): Error | undefined {
    const entry = this.entries.get(key)
    const error = entry?.failures.get(sourceFrame)
    entry?.failures.delete(sourceFrame)
    return error
  }

  stageAssets(key: string): Promise<StabilizationAssets> {
    const entry = this.entries.get(key)
    if (!entry || !isUsable(entry.result)) {
      return Promise.reject(new ClipUnreadableError('the clip’s engine is not open'))
    }
    entry.assetsPending ??= this.ask<StabilizationAssets>({ op: 'assets', key }).then(
      (assets) => {
        entry.assets = assets
        return assets
      },
      (error: Error) => {
        entry.assetsPending = undefined
        throw error
      },
    )
    return entry.assetsPending
  }

  loadedAssets(key: string): StabilizationAssets | undefined {
    return this.entries.get(key)?.assets
  }

  smoothingMethods(): Promise<SmoothingMethod[]> {
    return Promise.reject(new Error('the export worker reads the page’s engines; it has no clip panel'))
  }

  setSettings(): Promise<void> {
    return Promise.reject(new Error('the export worker reads the page’s engines; it changes no settings'))
  }

  sync(): void {
    // The worker renders a snapshot: there is no timeline to follow
  }

  release(key: string): Promise<void> {
    this.entries.delete(key)
    return Promise.resolve()
  }

  close(): Promise<void> {
    // The worker holds no claim on the page's engines
    return Promise.resolve()
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.port.onmessage = null
    this.port.close()
    const closed = new ClipUnreadableError('the export worker’s host is closed')
    for (const call of this.calls.values()) call.reject(closed)
    this.calls.clear()
    this.entries.clear()
    for (const list of this.waiters.values()) for (const resolve of list) resolve()
    this.waiters.clear()
  }
}

/** The worker's host: the page's, asked through `port` (which the host owns from now on) */
export function createRelayedStabilizationHost(port: RelayPort): StabilizationSeat {
  return new RelayedHost(port)
}
