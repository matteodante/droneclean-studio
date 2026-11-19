import { BASE_URL } from '@/studio/web/base-path'

const APP_SHELL_CACHE_PREFIX = 'freecut-app-shell-'

/**
 * The editor ships no service worker. Visitors who opened an earlier web build (or a dev server) still have
 * the worker it registered, which keeps serving stale files: unregister the registrations of this app's own
 * scope and delete the shell caches that worker created. Returns whether a worker was controlling the page,
 * which then has to reload to get fresh files.
 */
async function removeServiceWorkerAppShell(): Promise<boolean> {
  const wasControlled = 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null
  const ownScope = `${window.location.origin}${BASE_URL}`

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registrations
        .filter((registration) => registration.scope === ownScope)
        .map((registration) => registration.unregister()),
    )
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(APP_SHELL_CACHE_PREFIX))
        .map((cacheName) => caches.delete(cacheName)),
    )
  }

  return wasControlled
}

void removeServiceWorkerAppShell()
  .then((requiresReload) => {
    if (requiresReload) {
      window.location.reload()
      return
    }
    return import('./main')
  })
  .catch(() => import('./main'))
