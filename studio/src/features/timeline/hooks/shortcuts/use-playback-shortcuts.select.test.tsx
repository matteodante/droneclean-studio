import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePlaybackShortcuts } from './use-playback-shortcuts'

function Harness() {
  usePlaybackShortcuts({})
  return (
    <div>
      <button type="button" role="combobox" aria-expanded="true" aria-controls="l" data-testid="trigger">
        Colour profile
      </button>
      <div id="l" role="listbox" data-testid="listbox">
        <div role="option" aria-selected="true" tabIndex={-1} data-testid="option">
          Auto
        </div>
      </div>
      <div tabIndex={0} data-testid="plain" />
    </div>
  )
}

describe('playback shortcuts and Select dropdowns', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ currentFrame: 120, previewFrame: null, isPlaying: false })
  })

  it.each(['trigger', 'listbox', 'option'])(
    'Home, End, arrows and J/K/L pressed in the Select %s do not move the playhead',
    (id) => {
      const { getByTestId } = render(<Harness />)
      const el = getByTestId(id)
      for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        fireEvent.keyDown(el, { key, code: key })
      }
      expect(usePlaybackStore.getState().currentFrame).toBe(120)
      expect(usePlaybackStore.getState().isPlaying).toBe(false)
    },
  )

  it('Home still goes to the start from outside a Select', () => {
    const { getByTestId } = render(<Harness />)
    fireEvent.keyDown(getByTestId('plain'), { key: 'Home', code: 'Home' })
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
  })
})
