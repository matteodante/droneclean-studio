/**
 * The guard that keeps the feature pass out of the owner's real profile.
 *
 * On 18 Nov 2026 `e2e.mjs` ran against `~/Library/Application Support/DroneClean Studio` and left it pointing at a
 * temporary workspace. Every launch of the feature pass uses a fresh profile; this file decides, from paths alone,
 * whether the profile an app reports is the throwaway one.
 */
import os from 'node:os'
import path from 'node:path'

export const APP_NAME = 'DroneClean Studio'

/** Where the real profile lives for the user running this script. */
export function realProfilePath(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', APP_NAME)
}

/** Whether `child` is `parent` or inside it (after resolving `..`, not symlinks). */
export function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Throws unless `userData` is inside `throwawayRoot` and is neither the real profile nor inside it.
 * `real` defaults to the real profile of the OS user (resolved from the passwd entry, not from `$HOME`, which the
 * harness itself changes for a packaged app).
 */
export function assertThrowawayProfile({ userData, throwawayRoot, real = realProfilePath(realHome()) }) {
  if (typeof userData !== 'string' || userData === '') throw new Error('the app did not report its profile path')
  if (isInside(real, userData)) {
    throw new Error(`STOP: the app uses the real profile (${userData}); the feature pass never touches it`)
  }
  if (!isInside(throwawayRoot, userData)) {
    throw new Error(`STOP: the app's profile (${userData}) is not inside the throwaway folder (${throwawayRoot})`)
  }
}

/** The home directory of the OS user, whatever `$HOME` says. */
export function realHome() {
  return os.userInfo().homedir
}
