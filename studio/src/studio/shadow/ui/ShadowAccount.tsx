// The signed-in account of the shadow section, with the way out (slice E7): the desktop app
// keeps the DroneClean session in its main process, so a pilot who signed in stays signed in
// across restarts and needs a button to end it. Renders nothing in the web editor (its token
// lives in the tab and goes when the tab closes) and while signed out.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { desktopShadowCloud, type DesktopShadowCloud } from '../session-desktop'

type AccountState =
  | { stage: 'loading' }
  | { stage: 'signed-out' }
  | { stage: 'signed-in'; email: string | null }

/** Who is signed in: the session's state, and the account's address when the cloud answers. */
async function readAccount(cloud: DesktopShadowCloud): Promise<AccountState> {
  if ((await cloud.session.getToken()) === null) return { stage: 'signed-out' }
  try {
    const account = await cloud.client.getAccount()
    return { stage: 'signed-in', email: account.user.email }
  } catch {
    // Offline, or the session ended (the client has already signed out): show what is true now.
    return (await cloud.session.getToken()) === null
      ? { stage: 'signed-out' }
      : { stage: 'signed-in', email: null }
  }
}

export function ShadowAccount({ cloud = desktopShadowCloud() }: { cloud?: DesktopShadowCloud | null }) {
  const { t } = useTranslation()
  const [state, setState] = useState<AccountState>({ stage: 'loading' })

  useEffect(() => {
    if (cloud === null) return
    let current = true
    void readAccount(cloud).then((next) => {
      if (current) setState(next)
    })
    return () => {
      current = false
    }
  }, [cloud])

  const signOut = useCallback(async () => {
    if (cloud === null) return
    await cloud.session.setToken(null)
    setState({ stage: 'signed-out' })
  }, [cloud])

  if (cloud === null || state.stage !== 'signed-in') return null
  return (
    <div className="flex items-center justify-between gap-2 text-xs" data-testid="shadow-account">
      <span className="truncate" data-testid="shadow-account-status">
        {state.email === null
          ? t('editor.shadowSection.account.signedIn', { defaultValue: 'Signed in' })
          : t('editor.shadowSection.account.signedInAs', {
              email: state.email,
              defaultValue: 'Signed in as {{email}}',
            })}
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0"
        onClick={() => void signOut()}
        data-testid="shadow-sign-out"
      >
        {t('editor.shadowSection.account.signOut', { defaultValue: 'Sign out' })}
      </Button>
    </div>
  )
}
