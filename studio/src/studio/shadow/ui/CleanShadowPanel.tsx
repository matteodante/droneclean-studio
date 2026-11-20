// The clean action of the shadow section: the press that pays for the seconds the tracking pass found,
// what the clip's record says about those seconds once they are cleaned, and the paid cleans still
// on their way (design 4.1, sections 5.4 and 5.6; slice E6; review findings C1–C4 and C7).
//
// The press is the only thing that creates a full job. The price it will reserve is the API's
// quote for exactly the ranges it sends, on the upload the pass made (`quoteJob`, shown by the
// section above, never a copy of the cloud's formula), and the session compares the job's
// reservation with that number before anything is downloaded. With a short balance the press is
// off and the link opens the website's profile page, where credits are bought; during the free beta
// (`GET /v1/config`'s `freeBeta`) the same page is where they are asked for, because the beta sells
// nothing (design 4.1, section 5.6). When the window regains focus after that, the price and the
// balance are asked again, so the press comes back on its own once the credits are there.
//
// A piece that already covers the pass's window means these seconds are cleaned and paid for: the
// panel says so and offers no second job. A clean of the same frames still on its way (the record's
// `pending`) blocks the press too, so the same seconds are never paid for twice; the panel says
// where each one stands. One still running can be canceled until its job succeeds; one nothing is
// working on can be tried again; and one whose job the service does not know (404) can be
// forgotten, after a confirmation that names where its paid result can still be found, so the
// press is never blocked for good. The press saves the project; when that fails, the panel says so.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { VideoItem } from '@/types/timeline'
import type { ShadowPendingClean, ShadowPiece } from '../model'
import { pendingCleansOver } from '../run'
import {
  cancelPendingClean,
  cleanKey,
  forgetPendingClean,
  isShadowBusy,
  resumePendingCleans,
  useRunningCleans,
  useShadowSession,
  useShadowSessionStore,
} from './use-shadow-session'

/** The piece that already covers a window of source frames, when there is one. */
function pieceCovering(item: VideoItem, startFrame: number, endFrame: number): ShadowPiece | null {
  return (
    item.shadowRemoval?.pieces.find(
      (piece) => piece.startFrame <= startFrame && piece.startFrame + piece.frames >= endFrame,
    ) ?? null
  )
}

/**
 * While the balance does not cover the price, asks the price again whenever the window regains
 * focus: the pilot comes back from buying credits in the browser, and the press works at once.
 */
function useRefreshQuoteOnFocus(item: VideoItem, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const refresh = () => void useShadowSessionStore.getState().refreshQuote(item)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [item, active])
}

/** The sentence for one pending clean: running, waiting, unreachable or repriced. */
function pendingSentence(
  t: ReturnType<typeof useTranslation>['t'],
  pending: ShadowPendingClean,
  running: boolean,
): string {
  const frames = { start: pending.startFrame, end: pending.startFrame + pending.frames - 1 }
  if (pending.state === 'repriced') {
    return t('editor.shadowSection.pendingRepriced', {
      reserved: pending.reservedCredits ?? 0,
      credits: pending.credits,
    })
  }
  if (running) return t('editor.shadowSection.pendingRunning', frames)
  if (pending.state === 'unreachable') return t('editor.shadowSection.pendingUnreachable', frames)
  if (pending.state === 'missing') return t('editor.shadowSection.pendingMissing', frames)
  return t('editor.shadowSection.pendingWaiting', frames)
}

/** The confirmation before a pending clean is forgotten: its paid result may be lost to the project. */
function ForgetPendingDialog({
  target,
  onClose,
  onForget,
}: {
  target: ShadowPendingClean | null
  onClose: () => void
  onForget: (pending: ShadowPendingClean) => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('editor.shadowSection.forgetTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('editor.shadowSection.forgetBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => target && onForget(target)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="shadow-pending-forget-confirm"
          >
            {t('editor.shadowSection.forgetConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The controls of one pending clean: Cancel while it runs, Try again and Forget when it waits. */
function PendingCleanActions({
  pending,
  running,
  paid,
  onCancel,
  onForget,
}: {
  pending: ShadowPendingClean
  running: boolean
  paid: boolean
  onCancel: () => void
  onForget: () => void
}) {
  const { t } = useTranslation()
  if (running) {
    // Once its job succeeded it was paid for: it is brought in, and there is nothing to cancel.
    if (paid) return null
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={onCancel}
        data-testid="shadow-pending-cancel"
      >
        {t('common.cancel')}
      </Button>
    )
  }
  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        size="sm"
        className="h-7 px-2"
        onClick={() => void resumePendingCleans()}
        data-testid="shadow-pending-retry"
      >
        {t('editor.shadowSection.pendingRetry')}
      </Button>
      {pending.state === 'missing' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={onForget}
          data-testid="shadow-pending-forget"
        >
          {t('editor.shadowSection.pendingForget')}
        </Button>
      )}
    </div>
  )
}

/** Where each paid clean of the clip that is not recorded yet stands, with what can be done about it. */
function PendingCleans({ item }: { item: VideoItem }) {
  const { t } = useTranslation()
  const { running, paid, errors } = useRunningCleans()
  const [forgetTarget, setForgetTarget] = useState<ShadowPendingClean | null>(null)
  const pending = item.shadowRemoval?.pending ?? []
  if (pending.length === 0) return null
  return (
    <div className="space-y-1">
      {pending.map((entry) => {
        const key = cleanKey(item.id, entry.attemptId)
        const isRunning = running.includes(key)
        return (
          <div key={entry.attemptId} className="space-y-1" data-testid="shadow-pending">
            <p className="text-muted-foreground">{pendingSentence(t, entry, isRunning)}</p>
            {!isRunning && errors[key] !== undefined && (
              <p className="text-destructive" data-testid="shadow-pending-error">
                {errors[key]}
              </p>
            )}
            <PendingCleanActions
              pending={entry}
              running={isRunning}
              paid={paid.includes(key)}
              onCancel={() => cancelPendingClean(item.id, entry.attemptId)}
              onForget={() => setForgetTarget(entry)}
            />
          </div>
        )
      })}
      <ForgetPendingDialog
        target={forgetTarget}
        onClose={() => setForgetTarget(null)}
        onForget={(target) => {
          forgetPendingClean(item.id, target.attemptId)
          setForgetTarget(null)
        }}
      />
    </div>
  )
}

/**
 * The section's clean for one clip: "Clean" over the ranges the tracking pass proposed, blocked
 * with the way to get credits when the balance is short, the state of the seconds once they are
 * cleaned, and the paid cleans still on their way. Renders nothing until the clip has a priced pass
 * or a pending clean.
 */
export function CleanShadowPanel({ item }: { item: VideoItem }) {
  const { t } = useTranslation()
  const session = useShadowSession()
  const open = session.isOpen && session.clipId === item.id
  const pass = open ? session.pass : null
  const quote = open ? session.quote : null
  const busy = isShadowBusy(session.stage)
  useRefreshQuoteOnFocus(item, pass !== null && quote !== null && !quote.enough)

  // The running clean of this section says where it is on the stage line; the others are listed.
  const pendingLines = (
    <>
      {open && session.projectNotSaved && (
        <p className="text-destructive" data-testid="shadow-project-not-saved">
          {t('editor.shadowSection.projectNotSaved')}
        </p>
      )}
      {!busy && <PendingCleans item={item} />}
    </>
  )
  if (!pass || pass.window.endFrame <= pass.window.startFrame) return pendingLines

  const covered = pieceCovering(item, pass.window.startFrame, pass.window.endFrame)
  if (covered) {
    return (
      <>
        {pendingLines}
        <p data-testid="shadow-cleaned">
          {t('editor.shadowSection.cleaned', {
            start: pass.window.startFrame,
            end: pass.window.endFrame - 1,
          })}
        </p>
      </>
    )
  }

  // Without a price there is nothing the pilot could agree to pay: no press is offered.
  if (!quote) return pendingLines
  const onTheirWay =
    pendingCleansOver(item.shadowRemoval, pass.window.startFrame, pass.window.endFrame).length > 0
  const canPress = pass.ranges.length > 0 && quote.enough && !busy && !onTheirWay
  return (
    <div className="space-y-1">
      {pendingLines}
      <Button
        size="sm"
        className="w-full"
        onClick={() => void useShadowSessionStore.getState().clean(item)}
        disabled={!canPress}
        data-testid="shadow-clean-button"
      >
        {t('editor.shadowSection.clean')}
      </Button>
      {!quote.enough && (
        <Button
          variant="link"
          size="sm"
          className="h-auto w-full p-0"
          onClick={() => void useShadowSessionStore.getState().getCredits()}
          data-testid="shadow-get-credits"
        >
          {t('editor.shadowSection.getCredits')}
        </Button>
      )}
    </div>
  )
}
