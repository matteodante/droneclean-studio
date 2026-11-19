/**
 * Mounts the agent activity notice (`./agent-activity`) on the page: the real
 * command store, the app's toast, and the user's own pointer and key presses as
 * the "next user action" that clears it. Renders nothing.
 */
import { useEffect } from 'react'
import i18n from 'i18next'
import { createLogger } from '@/shared/logging/logger'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import {
  createAgentActivityNotice,
  type NoticePhase,
  type NoticeToast,
} from './agent-activity'

const log = createLogger('AgentNotice')

/** "Agent: N edits", in the user's language. */
export function agentNoticeMessage(count: number): string {
  return i18n.t('editor.agentNotice.edits', {
    count,
    defaultValue_one: 'Agent: {{count}} edit',
    defaultValue_other: 'Agent: {{count}} edits',
  })
}

/**
 * The app's toast. The toaster mounts lazily on `freecut:ensure-toaster`
 * (`src/app.tsx`), like every other toast outside a feature.
 */
const pageToast: NoticeToast = {
  show(id: string, message: string, phase: NoticePhase) {
    window.dispatchEvent(new Event('freecut:ensure-toaster'))
    void import('sonner')
      .then(({ toast }) => {
        const options = { id, duration: Infinity }
        if (phase === 'end') toast.success(message, options)
        else toast(message, options)
      })
      .catch((error: unknown) => log.warn('Failed to show the agent activity notice', error))
  },
  dismiss(id: string) {
    void import('sonner')
      .then(({ toast }) => toast.dismiss(id))
      .catch((error: unknown) => log.warn('Failed to clear the agent activity notice', error))
  },
}

export function AgentActivityNotice(): null {
  useEffect(() => {
    const notice = createAgentActivityNotice({
      store: useTimelineCommandStore,
      toast: pageToast,
      message: agentNoticeMessage,
    })
    const stop = notice.start()
    // Only the user's own input counts; a script cannot clear the notice with a synthetic event.
    const onUserInput = (event: Event) => {
      if (event.isTrusted) notice.userAction()
    }
    document.addEventListener('pointerdown', onUserInput, true)
    document.addEventListener('keydown', onUserInput, true)
    return () => {
      document.removeEventListener('pointerdown', onUserInput, true)
      document.removeEventListener('keydown', onUserInput, true)
      stop()
    }
  }, [])
  return null
}
