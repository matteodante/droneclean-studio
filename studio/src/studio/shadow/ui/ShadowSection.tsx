// The shadow section of the clip panel: mark the shadow, watch the cloud follow it for free, see
// the stretches it found and what cleaning them costs, and pay for the seconds with one press
// (design 4.1, section 7, slices E5 and E6).
//
// The whole section is behind the `shadowRemovalClean` feature switch: while it is off nothing is
// rendered, so no session opens and no press can start a request to the cloud (review finding C6:
// the free tracking uploads about 160 MB per press to a path not yet proved live). With the switch
// on, the section appears only where it can work (`availability.ts`): a video clip, not reversed,
// whose source can be read. The free pass costs nothing; the paid press is `CleanShadowPanel`. Nothing here reserves credits: the price
// comes from `POST /v1/jobs/quote`, which creates no job, and only the clean's own press creates
// one. Cancel stops either flow, and a session the API ended offers a new sign-in.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScanEye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PropertySection } from '@/shared/ui/property-controls/property-section'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { getMediaSourceFps } from '@/features/timeline/utils/media-item-frames'
import { frameToSeconds, toRate } from '@/studio/time'
import { removeCleanedPieces } from '../run'
import { unavailableShadowPieces } from '../hydrate'
import { pieceExpired, pieceRedownloadDeps, redownloadShadowPiece } from '../pieces-redownload'
import { SignInRequiredError, type JobQuote, type ServiceConfig } from '../api/types'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { isFeatureShown } from '@/studio/feature-switches'
import { shadowAvailability } from './availability'
import { CleanShadowPanel } from './CleanShadowPanel'
import { ShadowAccount } from './ShadowAccount'
import {
  isShadowBusy,
  useShadowSession,
  useShadowSessionItem,
  useShadowSessionStore,
  type ShadowSessionStore,
  type ShadowStage,
} from './use-shadow-session'

interface ShadowSectionProps {
  /** The selected items; the section works on the first video clip among them. */
  items: TimelineItem[]
}

/** A length in seconds, rounded for display: "0.5", "3", "1.65". */
function formatSeconds(seconds: number): string {
  return Number(seconds.toFixed(2)).toString()
}

/** The mark's row: the button that arms the preview, or the hint that the next click is the mark. */
function MarkRow({
  marking,
  markFrame,
  busy,
  onMark,
  onCancel,
}: {
  marking: boolean
  markFrame: number | null
  busy: boolean
  onMark: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  if (marking) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span>{t('editor.shadowSection.armed')}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onCancel}>
          {t('editor.shadowSection.cancelMark')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span data-testid="shadow-mark-state">
        {markFrame === null
          ? t('editor.shadowSection.markShadow')
          : t('editor.shadowSection.markedAt', { frame: markFrame })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 px-2"
        onClick={onMark}
        disabled={busy}
        data-testid="shadow-mark-button"
      >
        {t(
          markFrame === null ? 'editor.shadowSection.markShadow' : 'editor.shadowSection.markAgain',
        )}
      </Button>
    </div>
  )
}

/** The device flow's code and the wait for the approval in the browser. */
function SignInBlock({ signIn }: { signIn: { userCode: string; verificationUrl: string } }) {
  const { t } = useTranslation()
  return (
    <div
      className="space-y-1 rounded-md border border-border bg-muted/30 p-2"
      data-testid="shadow-sign-in"
    >
      <p className="font-medium">
        {t('editor.shadowSection.signInCode', { code: signIn.userCode })}
      </p>
      <p className="text-muted-foreground">{t('editor.shadowSection.signInWaiting')}</p>
      <a
        className="underline underline-offset-2"
        href={signIn.verificationUrl}
        target="_blank"
        rel="noreferrer"
      >
        {t('editor.shadowSection.signInOpen')}
      </a>
    </div>
  )
}

/** The one line that says what the flow is doing. */
function StageLine({ stage, progress }: { stage: ShadowStage; progress: number }) {
  const { t } = useTranslation()
  const percent = Math.round(progress * 100)
  if (stage === 'cutting')
    return <p data-testid="shadow-stage">{t('editor.shadowSection.cutting')}</p>
  if (stage === 'uploading') {
    return <p data-testid="shadow-stage">{t('editor.shadowSection.uploading', { percent })}</p>
  }
  if (stage === 'tracking') {
    return <p data-testid="shadow-stage">{t('editor.shadowSection.tracking')}</p>
  }
  if (stage === 'cleaning') {
    return <p data-testid="shadow-stage">{t('editor.shadowSection.cleaning', { percent })}</p>
  }
  if (stage === 'downloading') {
    return <p data-testid="shadow-stage">{t('editor.shadowSection.downloading')}</p>
  }
  if (stage === 'saving') {
    return <p data-testid="shadow-stage">{t('editor.shadowSection.saving')}</p>
  }
  return null
}

/** The ranges the tracker found, with their seconds, and what cleaning them would cost. */
function PassResults({
  ranges,
  quote,
  config,
  rate,
}: {
  ranges: { startFrame: number; endFrame: number }[]
  quote: JobQuote | null
  config: ServiceConfig | null
  rate: { num: number; den: number }
}) {
  const { t } = useTranslation()
  return (
    <>
      {ranges.length > 0 ? (
        <div className="space-y-1" data-testid="shadow-ranges">
          <p className="text-muted-foreground">{t('editor.shadowSection.rangesTitle')}</p>
          <ul className="space-y-0.5">
            {ranges.map((range) => (
              <li key={`${range.startFrame}-${range.endFrame}`} data-testid="shadow-range">
                {t('editor.shadowSection.range', {
                  start: range.startFrame,
                  end: range.endFrame,
                  seconds: formatSeconds(
                    frameToSeconds(rate, range.endFrame) - frameToSeconds(rate, range.startFrame),
                  ),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground" data-testid="shadow-not-found">
          {t('editor.shadowSection.notFound')}
        </p>
      )}

      {quote && (
        <div className="space-y-1" data-testid="shadow-price">
          {config?.freeBeta && (
            <p data-testid="shadow-free-beta">{t('editor.shadowSection.freeBeta')}</p>
          )}
          <p>
            {t('editor.shadowSection.price', {
              seconds: formatSeconds(quote.seconds),
              credits: quote.costCredits,
            })}
          </p>
          {quote.enough ? (
            <p className="text-muted-foreground" data-testid="shadow-balance">
              {t('editor.shadowSection.balance', { credits: quote.availableCredits })}
            </p>
          ) : (
            <p className="text-muted-foreground" data-testid="shadow-short">
              {t('editor.shadowSection.notEnough', {
                credits: quote.costCredits,
                available: quote.availableCredits,
              })}
            </p>
          )}
        </div>
      )}
    </>
  )
}

/** What the section has to say while a flow runs or once it has: sign-in, progress, results. */
function ShadowStatus({
  session,
  rate,
}: {
  session: {
    signIn: { userCode: string; verificationUrl: string } | null
    account: { user: { email: string | null; name: string | null } } | null
    stage: ShadowStage
    progress: number
    error: string | null
    needsSignIn: boolean
    pass: { ranges: { startFrame: number; endFrame: number }[] } | null
    quote: JobQuote | null
    config: ServiceConfig | null
  }
  rate: { num: number; den: number }
}) {
  const { t } = useTranslation()
  const busy = isShadowBusy(session.stage)
  return (
    <>
      {session.signIn !== null && <SignInBlock signIn={session.signIn} />}
      {session.account !== null && (
        <p data-testid="shadow-signed-in">
          {t('editor.shadowSection.signedIn', {
            email: session.account.user.email ?? session.account.user.name ?? '',
          })}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <StageLine stage={session.stage} progress={session.progress} />
        {busy && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => void useShadowSessionStore.getState().cancel()}
            data-testid="shadow-cancel"
          >
            {t('common.cancel')}
          </Button>
        )}
      </div>
      {session.error !== null && (
        <p className="text-destructive" data-testid="shadow-error">
          {session.error}
        </p>
      )}
      {session.needsSignIn && (
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2"
          onClick={() => void useShadowSessionStore.getState().signInAgain()}
          data-testid="shadow-sign-in-again"
        >
          {t('editor.shadowSection.signInAgain')}
        </Button>
      )}
      {session.pass !== null && (
        <PassResults
          ranges={session.pass.ranges}
          quote={session.quote}
          config={session.config}
          rate={rate}
        />
      )}
    </>
  )
}

/**
 * The one press that takes the clip's cleaned seconds away: the pieces leave the record in one
 * undo step, and their files leave the project folder. The mark and the paid ranges stay, so the
 * clip can be cleaned again.
 */
function RemoveCleaningRow({ item, busy }: { item: VideoItem; busy: boolean }) {
  const { t } = useTranslation()
  if ((item.shadowRemoval?.pieces.length ?? 0) === 0) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-full px-2"
      onClick={() => removeCleanedPieces(item)}
      disabled={busy}
      data-testid="shadow-remove-cleaning"
    >
      {t('editor.shadowSection.removeCleaning')}
    </Button>
  )
}

/**
 * A piece the clip records whose file is not in the project folder (a bundle or a copy that left
 * it behind, a file deleted by hand): the range plays the original. While the service still keeps
 * its copy (30 days after the cleaning) one press downloads it again without paying; after that
 * the line says so, and the range stays as the original until it is cleaned again.
 */
function MissingPiecesRow({ item, busy }: { item: VideoItem; busy: boolean }) {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null)
  const missing = unavailableShadowPieces(item)
  if (missing.length === 0) return null

  const now = Date.now()
  const gonePaths = new Set(
    missing
      .filter((piece) => gone.has(piece.path) || pieceExpired(piece.availableUntil, now))
      .map((piece) => piece.path),
  )
  const fetchable = missing.filter((piece) => !gonePaths.has(piece.path))

  const redownload = async () => {
    setWorking(true)
    setError(null)
    const lost = new Set(gone)
    try {
      for (const piece of fetchable) {
        const outcome = await redownloadShadowPiece(piece, pieceRedownloadDeps())
        if (outcome.status === 'unavailable') lost.add(piece.path)
      }
    } catch (failure) {
      setError({
        message: failure instanceof Error ? failure.message : String(failure),
        signIn: failure instanceof SignInRequiredError,
      })
    } finally {
      setGone(lost)
      setWorking(false)
    }
  }

  return (
    <div className="space-y-1" data-testid="shadow-missing-pieces">
      {fetchable.length > 0 && (
        <>
          <p data-testid="shadow-missing-line">
            {t('editor.shadowSection.missingPieces', {
              count: fetchable.length,
              defaultValue_one: '{{count}} cleaned piece is missing.',
              defaultValue_other: '{{count}} cleaned pieces are missing.',
            })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-full px-2"
            onClick={() => void redownload()}
            disabled={busy || working}
            data-testid="shadow-redownload"
          >
            {working
              ? t('editor.shadowSection.redownloading', { defaultValue: 'Downloading again…' })
              : t('editor.shadowSection.redownload', { defaultValue: 'Download again' })}
          </Button>
        </>
      )}
      {gonePaths.size > 0 && (
        <p className="text-muted-foreground" data-testid="shadow-pieces-gone">
          {t('editor.shadowSection.piecesGone', {
            count: gonePaths.size,
            defaultValue_one:
              '{{count}} cleaned piece is no longer available on the service. Its seconds play the original until you clean them again.',
            defaultValue_other:
              '{{count}} cleaned pieces are no longer available on the service. Their seconds play the original until you clean them again.',
          })}
        </p>
      )}
      {error !== null && (
        <p className="text-destructive" data-testid="shadow-redownload-error">
          {error.message}
        </p>
      )}
      {error?.signIn === true && (
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2"
          onClick={() => void useShadowSessionStore.getState().signInAgain()}
          data-testid="shadow-redownload-sign-in"
        >
          {t('editor.shadowSection.signInAgain')}
        </Button>
      )}
    </div>
  )
}

/** The clip's shadow controls: the mark, the free pass, what it found and the paid clean. */
function ShadowControls({
  item,
  active,
  canClean,
}: {
  item: VideoItem
  active: ShadowSessionStore | null
  canClean: boolean
}) {
  const { t } = useTranslation()
  const markFrame = item.shadowRemoval?.mark.sourceFrame ?? null
  const busy = active !== null && isShadowBusy(active.stage)
  const rate = toRate(getMediaSourceFps(item, useTimelineSettingsStore.getState().fps))
  return (
    <>
      <MarkRow
        marking={active?.marking === true}
        markFrame={markFrame}
        busy={busy}
        onMark={() => useShadowSessionStore.getState().startMarking()}
        onCancel={() => useShadowSessionStore.getState().cancelMarking()}
      />
      <Button
        size="sm"
        className="w-full"
        onClick={() => void useShadowSessionStore.getState().track(item)}
        disabled={markFrame === null || busy}
        data-testid="shadow-follow-button"
      >
        {t('editor.shadowSection.follow')}
      </Button>
      {active !== null && <ShadowStatus session={active} rate={rate} />}
      {active !== null && canClean && <CleanShadowPanel item={item} />}
      <ShadowAccount />
      <MissingPiecesRow item={item} busy={busy} />
      <RemoveCleaningRow item={item} busy={busy} />
    </>
  )
}

/**
 * The shadow section: the clip panel's one place for the shadow. It renders nothing at all for a
 * text clip or a reversed clip, and a plain sentence for a video whose file is gone.
 */
export function ShadowSection({ items }: ShadowSectionProps) {
  if (!isFeatureShown('shadowRemovalClean')) return null
  return <ShadowSectionBody items={items} />
}

/** The video the section is about, its media's availability, and the shadow session open on it */
function useShadowSectionState(items: ShadowSectionProps['items']) {
  const requested = items.find((candidate): candidate is VideoItem => candidate.type === 'video')
  const item = useShadowSessionItem(requested?.id ?? null)
  const mediaById = useMediaLibraryStore((state) => state.mediaById)
  const brokenMediaIds = useMediaLibraryStore((state) => state.brokenMediaIds)
  const session = useShadowSession()

  const mediaId = item?.mediaId
  const media = mediaId ? mediaById[mediaId] : undefined
  const availability = shadowAvailability(item, media, {
    broken: mediaId ? brokenMediaIds.includes(mediaId) : false,
  })
  const itemId = item?.id ?? null

  useEffect(() => {
    if (!itemId || availability.state !== 'ready') return
    useShadowSessionStore.getState().open(itemId)
    return () => useShadowSessionStore.getState().close()
  }, [itemId, availability.state])

  return { item, availability, session }
}

type ShadowAvailability = ReturnType<typeof shadowAvailability>

function ShadowSectionContent({
  item,
  availability,
  active,
}: {
  item: VideoItem
  availability: ShadowAvailability
  active: ReturnType<typeof useShadowSession> | null
}) {
  const { t } = useTranslation()
  if (availability.state === 'no-source') {
    return (
      <p className="text-muted-foreground" data-testid="shadow-no-source">
        {t('editor.shadowSection.noSource')}
      </p>
    )
  }
  return (
    <ShadowControls
      item={item}
      active={active}
      canClean={availability.state === 'ready' && availability.canClean}
    />
  )
}

function ShadowSectionBody({ items }: ShadowSectionProps) {
  const { t } = useTranslation()
  const { item, availability, session } = useShadowSectionState(items)

  if (!item || availability.state === 'hidden') return null

  const active = session.isOpen && session.clipId === item.id ? session : null
  return (
    <PropertySection title={t('editor.shadowSection.title')} icon={ScanEye}>
      <div className="space-y-2 text-xs" data-testid="shadow-section">
        <p className="text-muted-foreground">{t('editor.shadowSection.intro')}</p>
        <ShadowSectionContent item={item} availability={availability} active={active} />
      </div>
    </PropertySection>
  )
}
