/**
 * Where the app lives inside its origin.
 *
 * The desktop shell serves the build at the root (`droneclean://app/`); the web build is published under
 * `/studio/` (`npm run build:web`, `STUDIO_BASE_PATH`). Vite hands the chosen base to the code as
 * `import.meta.env.BASE_URL` (always with a leading and a trailing slash); every URL the app builds at
 * runtime for a built file or a route goes through these helpers instead of a literal starting with `/`.
 */

/** The base with its leading and trailing slash: `/` at the root, `/studio/` on the web */
export const BASE_URL: string = import.meta.env.BASE_URL

/** The router's basepath: the base without its trailing slash, `/` at the root */
export const ROUTER_BASEPATH: string = BASE_URL === '/' ? '/' : BASE_URL.replace(/\/+$/, '')

/** The URL path of a file the build serves or of a route: `withBase('/editor/x')` is `/studio/editor/x` on the web */
export function withBase(path: string, base: string = BASE_URL): string {
  return `${base}${path.replace(/^\/+/, '')}`
}

/** A pathname of the page without the base, the path the router knows: `/studio/projects` becomes `/projects` */
export function stripBase(pathname: string, base: string = BASE_URL): string {
  const prefix = base.replace(/\/+$/, '')
  if (prefix === '') return pathname === '' ? '/' : pathname
  if (pathname === prefix) return '/'
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname
}
