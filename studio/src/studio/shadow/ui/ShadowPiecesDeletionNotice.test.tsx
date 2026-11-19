import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import {
  asHandle,
  createRoot,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { ShadowPiecesDeletionNotice } from './ShadowPiecesDeletionNotice'
import { useShadowPieceCount } from './use-shadow-piece-count'

function Notice({ ids }: { ids: string[] }) {
  return <ShadowPiecesDeletionNotice count={useShadowPieceCount(ids)} />
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  const root = createRoot()
  setWorkspaceRoot(asHandle(root))
  const handle = asHandle(root)
  await writeBlob(handle, ['media', 'm1', 'shadow', 'a.mp4'], new Uint8Array([1]))
  await writeBlob(handle, ['media', 'm1', 'shadow', 'b.mp4'], new Uint8Array([2]))
  await writeBlob(handle, ['media', 'm2', 'metadata.json'], '{}')
})

describe('ShadowPiecesDeletionNotice', () => {
  it('says how many paid cleaned pieces go with the media and that they can be downloaded again', async () => {
    render(<Notice ids={['m1', 'm2']} />)
    const notice = await screen.findByTestId('shadow-pieces-deletion-notice')
    expect(notice.textContent).toContain('2 cleaned pieces')
    expect(notice.textContent).toContain('You paid for them')
    expect(notice.textContent).toContain('30 days')
  })

  it('shows nothing for media without pieces', async () => {
    render(<Notice ids={['m2']} />)
    await waitFor(() => expect(screen.queryByTestId('shadow-pieces-deletion-notice')).toBeNull())
  })
})
