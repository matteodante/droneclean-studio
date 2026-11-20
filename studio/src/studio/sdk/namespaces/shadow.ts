/**
 * `studio.shadow`: DroneClean shadow removal on a clip (plan decision D7), over the clip panel's own session
 * store (`useShadowSessionStore`), so a script and a mouse take the same path.
 *
 * `follow` and `clean` spend the user's credits (the tracking pass since 20 Nov 2026). Each takes the credits the
 * caller expects to spend and refuses, before anything is cut, uploaded or reserved, unless they equal the current
 * price: for `follow`, what the follow button shows (`clipFollowCredits`: the clip's part of its source), or the exact
 * price of the piece once the session asked for it (`followCreditsNow`); for `clean`, the price the service quotes at
 * that moment. A follow whose piece turns out to cost more stops with nothing spent and names the exact price, and the
 * job carries the agreed price as its `maxCredits`. So an agent with access (on by default) never spends credits the
 * user was not shown. An agent cannot sign in: when the session needs it, the call fails and says the user must approve it
 * in the app.
 */

import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { getMediaSourceFps } from '@/features/timeline/utils/media-item-frames'
import { usePlaybackStore } from '@/shared/state/playback'
import { isFeatureShown } from '@/studio/feature-switches'
import { clipSourcePosition } from '@/studio/speed'
import type { JobQuote } from '@/studio/shadow/api/types'
import { validateShadowRemoval, type ShadowMark } from '@/studio/shadow/model'
import { shadowAvailability } from '@/studio/shadow/ui/availability'
import {
  SHADOW_SESSION_IDLE,
  followCreditsNow,
  useShadowSessionStore,
} from '@/studio/shadow/ui/use-shadow-session'
import { requireClip } from '../context'
import { invalidArgumentError, studioError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipId,
  ShadowApi,
  ShadowCleanResult,
  ShadowFollowResult,
  ShadowMarkInput,
  ShadowQuote,
  ShadowRangeInfo,
  ShadowState,
} from '../types'

/** The mark's default radius as a share of the source's shorter side (the preview overlay's own, `MarkShadowOverlay`). */
const MARK_RADIUS_FRACTION = 0.035

const SIGN_IN_HINT =
  'The user must approve the sign-in in the app (the shadow section offers "Sign in again"); an agent cannot sign in.'

/**
 * The video clip a shadow method works on, with its availability.
 * @throws NOT_FOUND when no clip has that id
 * @throws UNSUPPORTED when the clip is not a video clip or is reversed
 */
function requireShadowClip(id: ClipId, method: string): VideoItem {
  const item = requireClip(id, method, 'id')
  if (item.type !== 'video' || item.isReversed === true) {
    throw studioError({
      code: 'UNSUPPORTED',
      method,
      message:
        item.type !== 'video'
          ? `a clip of kind "${item.type}" cannot have its shadow removed`
          : 'a reversed clip cannot have its shadow removed',
      entity: { kind: 'clip', id },
      hint: 'Shadow removal is for video clips that are not reversed.',
    })
  }
  return item
}

/** The clip for an action of the session: also needs the feature on and a readable file. */
function requireActionClip(id: ClipId, method: string): VideoItem {
  const item = requireShadowClip(id, method)
  if (!isFeatureShown('shadowRemovalClean')) {
    throw studioError({
      code: 'UNSUPPORTED',
      method,
      message: 'shadow removal is switched off in this build',
      entity: { kind: 'clip', id },
    })
  }
  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  const broken = item.mediaId
    ? useMediaLibraryStore.getState().brokenMediaIds.includes(item.mediaId)
    : false
  if (shadowAvailability(item, media, { broken }).state !== 'ready') {
    throw studioError({
      code: 'MEDIA_UNAVAILABLE',
      method,
      message: "the clip's file cannot be read",
      entity: { kind: 'clip', id },
      hint: "Relink or re-import the clip's media.",
    })
  }
  return item
}

/** The quote in the SDK's words. */
function quoteInfo(quote: JobQuote): ShadowQuote {
  return {
    seconds: quote.seconds,
    costCredits: quote.costCredits,
    creditsPerSecond: quote.creditsPerSecond,
    availableCredits: quote.availableCredits,
    enough: quote.enough,
  }
}

/** The ranges of the session's pass in the SDK's words. */
function rangesOf(id: ClipId): ShadowRangeInfo[] {
  const state = useShadowSessionStore.getState()
  if (state.clipId !== id || !state.pass) return []
  return state.pass.ranges.map((range) => ({
    startFrame: range.startFrame,
    endFrame: range.endFrame,
  }))
}

/** The session, when it belongs to this clip; the idle one otherwise. */
function sessionOf(id: ClipId) {
  const state = useShadowSessionStore.getState()
  return state.clipId === id ? state : SHADOW_SESSION_IDLE
}

/** Throw what the session reports after a call, if it reports a failure: a sign-in to approve, or the service's words. */
function throwSessionFailure(id: ClipId, method: string): void {
  const state = sessionOf(id)
  if (state.needsSignIn || state.signIn !== null) {
    throw studioError({
      code: 'CONFLICT',
      method,
      message: 'the user must approve the DroneClean sign-in in the app',
      entity: { kind: 'clip', id },
      hint: SIGN_IN_HINT,
    })
  }
  if (state.error !== null) {
    throw studioError({
      code: 'INTERNAL',
      method,
      message: state.error,
      entity: { kind: 'clip', id },
      hint: 'studio.shadow.get(id) shows the session.',
    })
  }
}

/**
 * The credits a paying call was given: a whole number, 0 or more.
 * @throws INVALID_ARGUMENT otherwise, before anything is spent
 */
function requireExpectedCredits(method: string, value: unknown, priceFrom: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw invalidArgumentError({
    method,
    argument: 'expectedCredits',
    expectation: `a whole number of credits, 0 or more: ${priceFrom}`,
    value,
  })
}

/**
 * The price a follow may pay: what following the shadow in the clip costs now must equal the credits the caller
 * expects, as `clean`'s price must.
 * @throws CONFLICT otherwise, naming the price, before anything is cut, uploaded or reserved
 */
function requireFollowPrice(id: ClipId, item: VideoItem, expectedCredits: number): number {
  const price = followCreditsNow(item)
  if (price === expectedCredits) return price
  throw studioError({
    code: 'CONFLICT',
    method: 'shadow.follow',
    argument: 'expectedCredits',
    message: `following the shadow in this clip costs ${price} credits, not the ${expectedCredits} expected; nothing was spent`,
    entity: { kind: 'clip', id },
    hint: `Show the user the price (${price} credits: studio.shadow.get(id).followCredits) and pass it again.`,
  })
}

/** The number of cleaned pieces the live clip records. */
function cleanedPiecesOf(id: ClipId): number {
  const live = useItemsStore.getState().itemById[id]
  return live?.type === 'video' ? (live.shadowRemoval?.pieces.length ?? 0) : 0
}

/** The frame the playhead shows on the clip, in source frames, or null when it is outside the clip. */
function playheadSourceFrame(item: VideoItem): number | null {
  const fps = useTimelineSettingsStore.getState().fps
  const local = usePlaybackStore.getState().currentFrame - item.from
  if (local < 0 || local >= item.durationInFrames) return null
  return clipSourcePosition({ ...item, sourceFps: getMediaSourceFps(item, fps) }, local, fps).frame
}

/** The finite number of an argument, or the error. */
function requireNumber(value: unknown, argument: string, expectation: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw invalidArgumentError({ method: 'shadow.mark', argument, expectation, value })
}

/** The clip's source size in pixels: its own record, or the media library's. */
function sourceSizeOf(item: VideoItem): { width: number; height: number } {
  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  return {
    width: item.sourceWidth ?? media?.width ?? 0,
    height: item.sourceHeight ?? media?.height ?? 0,
  }
}

/** Whether a point lies inside a picture of this size. */
function isInside(x: number, y: number, size: { width: number; height: number }): boolean {
  return x >= 0 && y >= 0 && x < size.width && y < size.height
}

/** The point of a mark: inside the source picture. */
function requirePoint(item: VideoItem, input: ShadowMarkInput): { x: number; y: number } {
  const size = sourceSizeOf(item)
  const x = requireNumber(input.x, 'mark.x', 'a number of source pixels from the left edge')
  const y = requireNumber(input.y, 'mark.y', 'a number of source pixels from the top edge')
  if (isInside(x, y, size)) return { x, y }
  throw invalidArgumentError({
    method: 'shadow.mark',
    argument: 'mark',
    expectation: `a point inside the source picture, ${size.width}x${size.height} pixels`,
    value: { x, y },
  })
}

/** The source frame of a mark: the one given, or the frame the playhead shows on the clip. */
function requireMarkFrame(item: VideoItem, input: ShadowMarkInput): number {
  const frame = input.sourceFrame ?? playheadSourceFrame(item)
  if (frame !== null && Number.isInteger(frame) && frame >= 0) return frame
  throw invalidArgumentError({
    method: 'shadow.mark',
    argument: 'mark.sourceFrame',
    expectation:
      input.sourceFrame === undefined
        ? 'given, because the playhead is outside the clip (studio.playback.seek puts it inside)'
        : 'an integer source frame >= 0',
    value: input.sourceFrame,
  })
}

/** The radius of a mark: the one given, or the preview's default share of the source's shorter side. */
function requireMarkRadius(item: VideoItem, input: ShadowMarkInput): number {
  const size = sourceSizeOf(item)
  const shorter = Math.min(size.width, size.height)
  const radius = input.radius ?? Math.max(1, Math.round(MARK_RADIUS_FRACTION * shorter))
  if (typeof radius === 'number' && Number.isFinite(radius) && radius > 0) return radius
  throw invalidArgumentError({
    method: 'shadow.mark',
    argument: 'mark.radius',
    expectation: 'a number of source pixels greater than 0',
    value: input.radius,
  })
}

/** The mark a call asks for, validated as the clip's record will be. */
function resolveMark(item: VideoItem, input: ShadowMarkInput): ShadowMark {
  if (typeof input !== 'object' || input === null) {
    throw invalidArgumentError({
      method: 'shadow.mark',
      argument: 'mark',
      expectation: 'an object { x, y, sourceFrame?, radius? }',
      value: input,
    })
  }
  const mark = {
    ...requirePoint(item, input),
    sourceFrame: requireMarkFrame(item, input),
    radius: requireMarkRadius(item, input),
  }
  try {
    // Validated before the transaction, so a refused mark leaves nothing behind.
    validateShadowRemoval({ mark, ranges: [], pieces: [] })
  } catch (error) {
    throw invalidArgumentError({
      method: 'shadow.mark',
      argument: 'mark',
      expectation: error instanceof Error ? error.message : 'a valid mark',
      value: input,
    })
  }
  return mark
}

/**
 * The quote a clean may pay for: it must equal the credits the caller expects and be covered by the balance.
 * @throws CONFLICT otherwise, before anything is spent
 */
function requireConfirmedQuote(id: ClipId, expectedCredits: number): JobQuote {
  const method = 'shadow.clean'
  const quote = sessionOf(id).quote
  if (!quote || quote.costCredits !== expectedCredits) {
    throw studioError({
      code: 'CONFLICT',
      method,
      argument: 'expectedCredits',
      message: quote
        ? `the price is ${quote.costCredits} credits, not the ${expectedCredits} expected; nothing was spent`
        : 'the followed shadow has no price; nothing was spent',
      entity: { kind: 'clip', id },
      hint: 'Show the user the current price (studio.shadow.quote) and pass it again.',
    })
  }
  if (!quote.enough) {
    throw studioError({
      code: 'CONFLICT',
      method,
      message: `the balance (${quote.availableCredits} credits) does not cover the ${quote.costCredits} credits; nothing was spent`,
      entity: { kind: 'clip', id },
      hint: 'The user can get credits from the shadow section.',
    })
  }
  return quote
}

/**
 * Create the `studio.shadow` namespace over the shadow session store.
 * @example const shadow = createShadowApi()
 */
export function createShadowApi(): ShadowApi {
  return {
    get(id: ClipId): ShadowState {
      const item = requireShadowClip(id, 'shadow.get')
      const session = sessionOf(id)
      const mark = item.shadowRemoval?.mark
      return {
        mark: mark
          ? { x: mark.x, y: mark.y, sourceFrame: mark.sourceFrame, radius: mark.radius }
          : null,
        stage: session.stage,
        progress: session.progress,
        ranges: rangesOf(id),
        quote: session.quote ? quoteInfo(session.quote) : null,
        error: session.error,
        needsSignIn: session.needsSignIn || session.signIn !== null,
        cleanedPieces: item.shadowRemoval?.pieces.length ?? 0,
        followCredits: followCreditsNow(item),
      }
    },

    mark(id: ClipId, input: ShadowMarkInput): void {
      const item = requireActionClip(id, 'shadow.mark')
      const mark = resolveMark(item, input)
      transaction('SHADOW_MARK', () => useShadowSessionStore.getState().setMark(item, mark))
    },

    async follow(id: ClipId, expectedCredits: number): Promise<ShadowFollowResult> {
      const expected = requireExpectedCredits(
        'shadow.follow',
        expectedCredits,
        'the followCredits shadow.get returned, shown to the user',
      )
      const item = requireActionClip(id, 'shadow.follow')
      if (!item.shadowRemoval?.mark) {
        throw studioError({
          code: 'CONFLICT',
          method: 'shadow.follow',
          message: 'the shadow is not marked',
          entity: { kind: 'clip', id },
          hint: 'Call studio.shadow.mark(id, { x, y }) first.',
        })
      }
      requireFollowPrice(id, item, expected)
      // The pass and its price belong to the clip the session is open on.
      if (useShadowSessionStore.getState().clipId !== id) useShadowSessionStore.getState().open(id)
      // A finished pass for the same mark is reused (`track`): that call spends nothing.
      const before = sessionOf(id).pass
      await useShadowSessionStore.getState().track(item, expected)
      throwSessionFailure(id, 'shadow.follow')
      const session = sessionOf(id)
      if (session.priceAsk) {
        const exact = session.priceAsk.credits
        throw studioError({
          code: 'CONFLICT',
          method: 'shadow.follow',
          argument: 'expectedCredits',
          message: `following the shadow in this clip costs ${exact} credits, not the ${expected} expected: the piece sent reaches the keyframes around its part; nothing was spent`,
          entity: { kind: 'clip', id },
          hint: `Show the user ${exact} credits and call studio.shadow.follow(id, ${exact}); the piece already sent is reused.`,
        })
      }
      if (!session.pass) {
        throw studioError({
          code: 'CONFLICT',
          method: 'shadow.follow',
          message: 'the tracking pass was stopped before it finished',
          entity: { kind: 'clip', id },
        })
      }
      return {
        ranges: rangesOf(id),
        quote: session.quote ? quoteInfo(session.quote) : null,
        creditsSpent: session.pass === before ? 0 : session.pass.chargedCredits,
      }
    },

    async quote(id: ClipId): Promise<ShadowQuote> {
      const item = requireActionClip(id, 'shadow.quote')
      if (!sessionOf(id).pass) {
        throw studioError({
          code: 'CONFLICT',
          method: 'shadow.quote',
          message: 'the shadow has not been followed yet',
          entity: { kind: 'clip', id },
          hint: 'Call studio.shadow.follow(id) first.',
        })
      }
      await useShadowSessionStore.getState().refreshQuote(item)
      throwSessionFailure(id, 'shadow.quote')
      const quote = sessionOf(id).quote
      if (!quote) {
        throw studioError({
          code: 'CONFLICT',
          method: 'shadow.quote',
          message: 'the followed shadow has nothing to price',
          entity: { kind: 'clip', id },
        })
      }
      return quoteInfo(quote)
    },

    async clean(id: ClipId, expectedCredits: number): Promise<ShadowCleanResult> {
      const method = 'shadow.clean'
      requireExpectedCredits(
        method,
        expectedCredits,
        'the price shadow.follow or shadow.quote returned',
      )
      const item = requireActionClip(id, method)
      const before = sessionOf(id)
      if (!before.pass || before.pass.ranges.length === 0) {
        throw studioError({
          code: 'CONFLICT',
          method,
          message: 'there is no followed shadow to clean',
          entity: { kind: 'clip', id },
          hint: 'Call studio.shadow.follow(id) first; it must find at least one range.',
        })
      }
      // The price is asked again right before paying: what is compared is the service's current answer.
      await useShadowSessionStore.getState().refreshQuote(item)
      throwSessionFailure(id, method)
      const quote = requireConfirmedQuote(id, expectedCredits)
      const live = requireShadowClip(id, method)
      await useShadowSessionStore.getState().clean(live)
      throwSessionFailure(id, method)
      if (sessionOf(id).stage !== 'ready') {
        throw studioError({
          code: 'CONFLICT',
          method,
          message: 'the clean was stopped before it finished',
          entity: { kind: 'clip', id },
          hint: 'studio.shadow.get(id) shows the session.',
        })
      }
      return {
        creditsSpent: quote.costCredits,
        ranges: rangesOf(id),
        cleanedPieces: cleanedPiecesOf(id),
      }
    },
  }
}
