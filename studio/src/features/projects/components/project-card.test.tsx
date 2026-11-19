import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ReactNode } from 'react'
import type { Project } from '@/types/project'
import { ProjectCard } from './project-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('../hooks/use-project-actions', () => ({
  useDeleteProject: () => vi.fn(),
  useDuplicateProject: () => vi.fn(),
  useRestoreProject: () => vi.fn(),
}))

vi.mock('../hooks/use-project-thumbnail', () => ({
  useProjectThumbnail: () => null,
}))

function makeProject(fps: number): Project {
  return {
    id: 'project-1',
    name: 'Drone flight',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps },
  }
}

describe('ProjectCard frame rate', () => {
  it('shows a stored 59.94005994005994 as 59.94fps', () => {
    render(<ProjectCard project={makeProject(59.94005994005994)} />)

    expect(screen.getByText('59.94fps')).toBeInTheDocument()
    expect(screen.queryByText('59.94005994005994fps')).not.toBeInTheDocument()
  })

  it('shows an integer rate unchanged', () => {
    render(<ProjectCard project={makeProject(60)} />)

    expect(screen.getByText('60fps')).toBeInTheDocument()
  })
})
