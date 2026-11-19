import { createFileRoute, redirect } from '@tanstack/react-router'

// The editor opens on the projects page: there is no landing page of its own.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/projects', replace: true })
  },
})
