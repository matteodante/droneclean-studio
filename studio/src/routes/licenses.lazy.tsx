import { createLazyFileRoute } from '@tanstack/react-router'
import { LicensesPage } from '@/studio/licenses/licenses-page'

export const Route = createLazyFileRoute('/licenses')({
  component: LicensesPage,
})
