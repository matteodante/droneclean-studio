import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ReactNode } from 'react'
import type { Project } from '@/types/project'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const listState = vi.hoisted(() => ({ projects: [] as Project[] }))

vi.mock('../hooks/use-project-selectors', () => ({
  useProjects: () => listState.projects,
  useFilteredProjects: () => listState.projects,
  useSortField: () => 'name',
  useSortDirection: () => 'asc',
  useFilterResolution: () => undefined,
  useFilterFps: () => undefined,
  useHasActiveFilters: () => false,
}))

vi.mock('../hooks/use-project-actions', () => ({
  useProjectFilters: () => ({
    setSearchQuery: vi.fn(),
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    setFilterResolution: vi.fn(),
    setFilterFps: vi.fn(),
    clearFilters: vi.fn(),
  }),
  useDeleteProject: () => vi.fn(),
}))

vi.mock('./project-card', () => ({
  ProjectCard: ({ project }: { project: Project }) => <div>{project.name}</div>,
}))

import { ProjectList } from './project-list'

function makeProject(id: string, fps: number): Project {
  return {
    id,
    name: id,
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps },
  }
}

describe('ProjectList frame rate filter', () => {
  it('shows one option per rate, labelled as a rate', () => {
    listState.projects = [
      makeProject('exact', 59.94005994005994),
      makeProject('decimal-name', 59.94),
      makeProject('sixty', 60),
    ]

    render(<ProjectList />)

    expect(screen.getAllByText('59.94 fps')).toHaveLength(1)
    expect(screen.getByText('60 fps')).toBeInTheDocument()
    expect(screen.queryByText('59.94005994005994 fps')).not.toBeInTheDocument()
  })
})
