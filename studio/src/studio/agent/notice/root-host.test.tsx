/**
 * What the app root mounts (task 2.2 review, section D): the render queue
 * runner and its persistence belong to the app, not to the editor route, so a
 * queued agent export renders whichever route is open and never needs the
 * window to navigate (which reloads the timeline and clears the undo history).
 */
import { render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { Route } from '@/routes/__root'

const mounts = vi.hoisted(() => ({ runner: 0, persistence: [] as string[] }))

vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (options: unknown) => ({ options }),
  Outlet: () => <div data-testid="outlet" />,
}))
vi.mock('@/features/export/components/render-queue-runner', () => ({
  RenderQueueRunner: () => {
    mounts.runner += 1
    return null
  },
}))
vi.mock('@/features/export/components/render-queue-persistence', () => ({
  RenderQueuePersistence: ({ projectId }: { projectId: string }) => {
    mounts.persistence.push(projectId)
    return null
  },
}))
vi.mock('./agent-activity-notice', () => ({ AgentActivityNotice: () => null }))

function Root() {
  const { component: Component } = (Route as unknown as { options: { component: ComponentType } })
    .options
  return <Component />
}

afterEach(() => {
  mounts.runner = 0
  mounts.persistence = []
  useProjectStore.setState({ currentProject: null })
})

describe('the app root', () => {
  it('mounts the render queue runner once, with no project open', () => {
    const view = render(<Root />)

    expect(view.getByTestId('outlet')).toBeTruthy()
    expect(mounts.runner).toBe(1)
    expect(mounts.persistence).toEqual([])
  })

  it('persists the queue of the open project', () => {
    useProjectStore.setState({ currentProject: { id: 'project-1' } as never })

    render(<Root />)

    expect(mounts.runner).toBe(1)
    expect(mounts.persistence).toEqual(['project-1'])
  })
})
