// The signed-in account of the shadow section, with the way out (slice E7): the desktop app
// keeps the DroneClean session in its main process, so a pilot who signed in stays signed in
// across restarts and needs a button to end it. Renders nothing in the web editor (its token
// lives in the tab and goes when the tab closes) and while signed out.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { desktopShadowCloud, type DesktopShadowCloud } from '../session-desktop'

type AccountState = { stage: 'loading' } | { stage: 'signed-out' } | { stage: 'signed-in' }

/**
 * Whether a pilot is signed in, from the session's flag alone. The account's address is not asked for
 * here: that call carries the token, and reading it makes macOS ask for keychain access (the desktop app
 * is not signed, so at every update), which a pilot who never uses shadow removal must not see.
 */
async function readAccount(cloud: DesktopShadowCloud): Promise<AccountState> {
  return (await cloud.session.getToken()) === null
    ? { stage: 'signed-out' }
    : { stage: 'signed-in' }
}

export function ShadowAccount({
  cloud = desktopShadowCloud(),
}: {
  cloud?: DesktopShadowCloud | null
}) {
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
        {t('editor.shadowSection.account.signedIn', { defaultValue: 'Signed in' })}
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
