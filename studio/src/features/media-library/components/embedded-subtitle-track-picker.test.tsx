import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { EmbeddedSubtitleTrackPicker } from './embedded-subtitle-track-picker'

const track = {
  trackNumber: 3,
  codecId: 'S_TEXT/UTF8',
  language: 'ita',
  default: false,
  forced: false,
  cues: [{ startSeconds: 0, endSeconds: 1, text: 'ciao' }],
}

vi.mock('../services/subtitle-sidecar-service', () => ({
  chooseEmbeddedSubtitleTrackForMedia: (tracks: unknown[]) => tracks[0] ?? null,
  getEmbeddedSubtitleTrackLabel: () => 'Italian',
  subtitleSidecarService: {
    scanEmbeddedSubtitleTracks: vi.fn(async () => ({ tracks: [track], fromCache: false })),
  },
}))

describe('EmbeddedSubtitleTrackPicker', () => {
  it('fills in the track number, language and codec of each row', async () => {
    render(
      <EmbeddedSubtitleTrackPicker
        media={{ id: 'm1', fileName: 'film.mkv' } as MediaMetadata}
        blob={new Blob(['x'])}
        onClose={() => {}}
        onTrackPicked={() => {}}
      />,
    )

    expect(await screen.findByText('Track 3 · ita · UTF8')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('{{')
  })
})
