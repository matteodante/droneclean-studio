/**
 * The app's router, created once for the whole page.
 *
 * It lives here rather than in `app.tsx` so code outside React can navigate:
 * the MCP's page bridge (`src/studio/agent/export.ts`) opens a project's editor
 * route before queueing an export, because the render queue only runs there. The
 * router's `Register` declaration sits beside it, as it must name this instance.
 */
import { createRouter } from '@tanstack/react-router'
import { RouteErrorScreen } from './route-error'
import { routeTree } from '../routeTree.gen'
import { ROUTER_BASEPATH } from '../studio/web/base-path'

// Route errors (thrown from beforeLoad/loader) never reach React's error
// boundary — TanStack catches them first — so the app's error screen is its
// fallback rather than TanStack's untranslated built-in one.
export const router = createRouter({
  routeTree,
  basepath: ROUTER_BASEPATH,
  defaultErrorComponent: RouteErrorScreen,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
