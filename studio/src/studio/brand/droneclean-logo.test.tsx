import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'

import { DroneCleanLogo } from './droneclean-logo'

const MONOGRAM_VIEW_BOX = '0 0 118.5 100'

function monogramPath(logo: HTMLElement) {
  const monogram = [...logo.querySelectorAll('svg')].find(
    (svg) => svg.getAttribute('viewBox') === MONOGRAM_VIEW_BOX,
  )
  expect(monogram).toBeDefined()
  return monogram?.querySelector('path')?.getAttribute('d') ?? ''
}

describe('DroneCleanLogo', () => {
  it('renders the whole name as one image', () => {
    render(<DroneCleanLogo />)

    const logo = screen.getByRole('img', { name: 'DroneClean Studio' })
    expect(logo).toBeInTheDocument()
    expect(screen.getByText('Studio')).toBeInTheDocument()

    const wordmark = [...logo.querySelectorAll('svg')].find(
      (svg) => svg.getAttribute('viewBox') === '0 0 6954 737',
    )
    expect(wordmark).toBeDefined()
    expect(wordmark?.getAttribute('class')).toContain('h-7')
  })

  it('uses the small drawing below 20 px and the full one from 20 px', () => {
    const { unmount } = render(<DroneCleanLogo size="sm" />)
    // The small drawing opens the cut between the D and the C: half the arc of the full one.
    expect(monogramPath(screen.getByRole('img'))).toContain('78.3026 4.3075')
    unmount()

    render(<DroneCleanLogo size="md" />)
    expect(monogramPath(screen.getByRole('img'))).toContain('83.8388 7.194')
  })

  it('renders the monogram alone for the icon variant', () => {
    render(<DroneCleanLogo variant="icon" size="lg" />)

    const logo = screen.getByRole('img', { name: 'DroneClean Studio' })
    expect(logo.querySelectorAll('svg')).toHaveLength(1)
    expect(screen.queryByText('Studio')).toBeNull()
    expect(logo.querySelector('svg')?.getAttribute('class')).toContain('h-10')
  })
})
