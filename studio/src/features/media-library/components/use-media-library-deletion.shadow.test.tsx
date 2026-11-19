import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { handlesMocks } from '@/infrastructure/storage/test-utils/storage-test-mocks'
import { deleteMedia } from '@/infrastructure/storage/workspace-fs/media'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { useMediaLibraryDeletion } from './use-media-library-deletion'

/**
 * A media that has cleaned pieces (files the user paid for) is deleted from the dialog only on its
 * "Delete": cancelling leaves every file, and the deletion that follows the yes takes the pieces
 * with the media.
 */

vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  deleteCompoundClips: vi.fn(),
  getCompoundClipDeletionImpact: () => ({
    rootReferenceCount: 0,
    nestedReferenceCount: 0,
    totalReferenceCount: 0,
  }),
  getMediaDeletionImpact: () => ({
    itemIds: [],
    rootReferenceCount: 0,
    nestedReferenceCount: 0,
    totalReferenceCount: 0,
  }),
  removeProjectItems: vi.fn(),
  saveTimeline: vi.fn(),
  useSequencesStore: { getState: () => ({ isTopLevelSequence: () => false }) },
}))

let root: MemDir

async function seedMedia(id: string): Promise<void> {
  const handle = asHandle(root)
  await writeBlob(handle, ['media', id, 'metadata.json'], '{}')
  await writeBlob(handle, ['media', id, 'shadow', '30_30.mp4'], new Uint8Array([1, 2, 3]))
}

async function pieceExists(id: string): Promise<boolean> {
  return (await readFileText(root, 'media', id, 'shadow', '30_30.mp4')) !== null
}

function mount(deleteMediaBatch: (ids: string[]) => Promise<void>) {
  return renderHook(() =>
    useMediaLibraryDeletion({
      containerRef: { current: null },
      selectedMediaIds: ['m1'],
      selectedCompositionIds: [],
      selectedAssetCount: 1,
      currentProjectId: 'p1',
      clearSelection: vi.fn(),
      deleteMediaBatch,
    }),
  )
}

beforeEach(async () => {
  handlesMocks.deleteHandle.mockClear()
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  await seedMedia('m1')
})

describe('deleting a media that has cleaned pieces', () => {
  it('asks first: opening the dialog and cancelling deletes nothing', async () => {
    const batch = vi.fn(async (ids: string[]) => {
      for (const id of ids) await deleteMedia(id)
    })
    const { result } = mount(batch)
    act(() => result.current.handleDeleteSelected())
    expect(result.current.showDeleteDialog).toBe(true)
    act(() => result.current.setShowDeleteDialog(false))
    expect(batch).not.toHaveBeenCalled()
    expect(await pieceExists('m1')).toBe(true)
    expect(await readFileText(root, 'media', 'm1', 'metadata.json')).toBe('{}')
  })

  it('does nothing when Delete is pressed before the pieces are counted', async () => {
    const batch = vi.fn(async (ids: string[]) => {
      for (const id of ids) await deleteMedia(id)
    })
    const { result } = mount(batch)
    act(() => result.current.handleDeleteSelected())
    // The count has not resolved: Delete is disabled and a press is ignored.
    expect(result.current.shadowPieceCount).toBeNull()
    await act(async () => {
      await result.current.handleConfirmDelete()
    })
    expect(batch).not.toHaveBeenCalled()
    expect(result.current.showDeleteDialog).toBe(true)
    expect(await pieceExists('m1')).toBe(true)
    await waitFor(() => expect(result.current.shadowPieceCount).toBe(1))
  })

  it('deletes the pieces with the media on an explicit yes', async () => {
    const batch = vi.fn(async (ids: string[]) => {
      for (const id of ids) await deleteMedia(id)
    })
    const { result } = mount(batch)
    act(() => result.current.handleDeleteSelected())
    await waitFor(() => expect(result.current.shadowPieceCount).toBe(1))
    await act(async () => {
      await result.current.handleConfirmDelete()
    })
    expect(batch).toHaveBeenCalledWith(['m1'])
    expect(await pieceExists('m1')).toBe(false)
    expect(await readFileText(root, 'media', 'm1', 'metadata.json')).toBeNull()
  })

  it('keeps the pieces when the media is deleted by any path that was not asked', async () => {
    await deleteMedia('m1')
    expect(await readFileText(root, 'media', 'm1', 'metadata.json')).toBeNull()
    expect(await pieceExists('m1')).toBe(true)
  })

  it('does not leave the approval behind when the deletion fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('disk error')
    })
    const { result } = mount(failing)
    act(() => result.current.handleDeleteSelected())
    await waitFor(() => expect(result.current.shadowPieceCount).toBe(1))
    await act(async () => {
      await result.current.handleConfirmDelete()
    })
    // A later deletion that was not asked takes everything but the pieces.
    await deleteMedia('m1')
    expect(await pieceExists('m1')).toBe(true)
  })
})
