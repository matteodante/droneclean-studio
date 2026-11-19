import { createRootRoute, Outlet } from '@tanstack/react-router'
import { RenderQueuePersistence } from '@/features/export/components/render-queue-persistence'
import { RenderQueueRunner } from '@/features/export/components/render-queue-runner'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { AgentActivityNotice } from '@/studio/agent/notice/agent-activity-notice'

/**
 * The render queue belongs to the app, not to the editor route: a job carries
 * its own snapshot of the timeline, so the runner drains the queue whichever
 * route is open, and an agent export never has to navigate (mounting the editor
 * route reloads the timeline and clears the undo history). The runner drains
 * serially from one module-level flag, however many runners are mounted.
 */
function AppRoot() {
  const projectId = useProjectStore((state) => state.currentProject?.id)
  return (
    <>
      <Outlet />
      {projectId !== undefined && <RenderQueuePersistence projectId={projectId} />}
      <RenderQueueRunner />
      <AgentActivityNotice />
    </>
  )
}

export const Route = createRootRoute({
  component: AppRoot,
})
