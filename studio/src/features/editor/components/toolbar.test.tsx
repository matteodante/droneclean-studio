import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ReactNode } from 'react'
import { Toolbar } from './toolbar'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
}))

const PROJECT = {
  id: 'project-1',
  name: 'Drone flight',
  width: 1920,
  height: 1080,
  fps: 59.94005994005994,
}

describe('Toolbar project specs', () => {
  it('shows the project rate as a rate, not the stored double', () => {
    render(<Toolbar projectId="project-1" project={PROJECT} />)

    expect(screen.getByText(/1920x1080/)).toBeInTheDocument()
    expect(screen.getByText(/59\.94fps/)).toBeInTheDocument()
    expect(screen.queryByText(/59\.94005994005994/)).not.toBeInTheDocument()
  })
})
