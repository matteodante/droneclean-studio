import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { TrackedShadowOverlay } from './TrackedShadowOverlay'

const CIRCLES = [
  { frame: 12, left: 376, top: 276, width: 48, height: 48, rotation: 0 },
  { frame: 13, left: 380, top: 278, width: 48, height: 48, rotation: 90 },
]

describe('TrackedShadowOverlay', () => {
  it('draws the circle of the frame being shown, in the overlay’s own pixels', () => {
    render(<TrackedShadowOverlay circles={CIRCLES} sourceFrame={12} />)

    const circle = screen.getByTestId('shadow-tracked-circle')
    expect(circle.style.left).toBe('376px')
    expect(circle.style.top).toBe('276px')
    expect(circle.style.width).toBe('48px')
    expect(circle.style.transform).toBe('rotate(0deg)')
  })

  it('turns the circle with the clip', () => {
    render(<TrackedShadowOverlay circles={CIRCLES} sourceFrame={13} />)
    expect(screen.getByTestId('shadow-tracked-circle').style.transform).toBe('rotate(90deg)')
  })

  it('draws nothing on a frame the pass did not find the shadow on', () => {
    render(<TrackedShadowOverlay circles={CIRCLES} sourceFrame={14} />)
    expect(screen.queryByTestId('shadow-tracked-circle')).toBeNull()
  })
})
