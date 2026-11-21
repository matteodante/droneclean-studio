// The Render preview shortcut (Enter, as Premiere's "Render In to Out"; rebindable in Settings > Shortcuts). It
// does not fire while a button, a link, a menu or an editable element has the keyboard: Enter belongs to them there.

import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { prerenderFromInterface } from './actions'

const OWNS_ENTER_SELECTOR =
  'button, a[href], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="tab"], [contenteditable="true"]'

function enterBelongsToFocusedElement(event: KeyboardEvent): boolean {
  const target = event.target
  return target instanceof Element && target.closest(OWNS_ENTER_SELECTOR) !== null
}

export function usePrerenderShortcut(): void {
  const binding = useResolvedHotkeys().RENDER_PREVIEW
  useHotkeys(
    binding,
    () => {
      void prerenderFromInterface()
    },
    {
      ...HOTKEY_OPTIONS,
      ignoreEventWhen: (event) =>
        HOTKEY_OPTIONS.ignoreEventWhen(event) || enterBelongsToFocusedElement(event),
    },
    [binding],
  )
}
