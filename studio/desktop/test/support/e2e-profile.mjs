/**
 * The e2e launcher's guard (review finding E1).
 *
 * `npm run e2e` once drove the app against the real profile and left it pointing
 * at the run's temporary workspace; the owner then made a real project there.
 * Every launch the e2e makes goes through {@link e2eLaunch}, which refuses the
 * real profile and builds a launch that cannot reach it: the built main process
 * under `throwaway-profile.cjs`, with the profile in `DRONECLEAN_PROFILE_ROOT`
 * (that script moves `appData`, so the profile is `<root>/DroneClean Studio`)
 * and `DRONECLEAN_USER_DATA` set to the same folder, so a value inherited from
 * the shell cannot point the run anywhere else.
 *
 * Plain Node, no Electron: `test/e2e-profile.test.mjs` runs it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const APP_NAME = 'DroneClean Studio'

/**
 * The packaged test variant (`npm run package:test`): the same build with another
 * product name and app id; the shell names its profile folder after that product
 * name (`main/index.ts`), so `appData/<name>` is not the real one.
 */
export const TEST_APP_NAME = `${APP_NAME} Test`
const TEST_APP_ID = 'com.droneclean.studio.test'

/**
 * The folders that are, or contain, the real profile: the application-data
 * folder (a profile root equal to it puts the profile exactly there) and the
 * profile itself.
 */
export function realProfileDirs({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  let appData
  if (platform === 'darwin') appData = path.join(home, 'Library', 'Application Support')
  else if (platform === 'win32') appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  else appData = env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  return [appData, path.join(appData, APP_NAME)]
}

/** The real path of `target`, or of its nearest existing parent with the rest appended. */
function realPathOf(target) {
  const absolute = path.resolve(target)
  const missing = []
  let current = absolute
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return absolute
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase()

/** Throws unless `profileRoot` is a folder whose `DroneClean Studio` child is not the real profile. */
function assertThrowawayProfile(profileRoot, system = {}) {
  if (typeof profileRoot !== 'string' || profileRoot.trim() === '') {
    throw new Error('the e2e needs a throwaway profile folder; none was given')
  }
  const root = realPathOf(profileRoot)
  const profile = path.join(root, APP_NAME)
  for (const real of realProfileDirs(system).map(realPathOf)) {
    if (same(root, real) || same(profile, real)) {
      throw new Error(`refusing to run the e2e against the real profile (${real}); use a throwaway profile folder`)
    }
  }
}

/**
 * The options for `_electron.launch`: the built main under the throwaway-profile
 * script. Throws when `profileRoot` is the real profile.
 */
export function e2eLaunch({
  profileRoot,
  desktopDir,
  electronPath,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
}) {
  assertThrowawayProfile(profileRoot, { platform, home, env })
  return {
    executablePath: electronPath,
    args: [path.join(desktopDir, 'test', 'support', 'throwaway-profile.cjs')],
    cwd: desktopDir,
    env: {
      ...env,
      DRONECLEAN_PROFILE_ROOT: profileRoot,
      DRONECLEAN_USER_DATA: path.join(profileRoot, APP_NAME),
    },
  }
}

/** The packaged test variant's profile: `<appData>/DroneClean Studio Test`, never the real one. */
export function testProfileDir(system = {}) {
  const profile = path.join(realProfileDirs(system)[0], TEST_APP_NAME)
  const real = realProfileDirs(system)[1]
  if (same(realPathOf(profile), realPathOf(real))) throw new Error(`the test profile is the real profile (${real})`)
  return profile
}

/**
 * The options for `_electron.launch` of the packaged test variant. Throws unless
 * the binary is inside `DroneClean Studio Test.app`: the real app is never launched.
 */
export function e2ePackagedLaunch({
  appBinary,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  readPackageJson = readPackagedPackageJson,
}) {
  if (typeof appBinary !== 'string' || appBinary.trim() === '') throw new Error('the packaged test app was not given')
  const parts = path.resolve(appBinary).split(path.sep)
  const bundle = parts.find((part) => part.endsWith('.app'))
  if (bundle !== `${TEST_APP_NAME}.app`) {
    throw new Error(
      `refusing to launch ${appBinary}: the packaged e2e runs only ${TEST_APP_NAME}.app (npm run package:test), ` +
        'never the real app and its real profile',
    )
  }
  testProfileDir({ platform, home, env })
  // The bundle's own name is not enough: the shell names its profile folder after the product name
  // inside the packaged `package.json`, so that is what must say "test", checked before launching.
  assertTestVariantPackage(readPackageJson(appBinary), appBinary)
  const clean = { ...env }
  for (const name of Object.keys(clean)) if (name.startsWith('DRONECLEAN_')) delete clean[name]
  return { executablePath: appBinary, args: [], env: clean }
}

/** What `package:test` writes into the packaged `package.json` (`-c.extraMetadata.*`). */
const TEST_VARIANT_FIELD = 'droneCleanVariant'

/** Throws unless the packaged `package.json` says this build is the test variant. */
export function assertTestVariantPackage(packageJson, appBinary = 'the packaged app') {
  if (packageJson?.productName !== TEST_APP_NAME || packageJson?.[TEST_VARIANT_FIELD] !== 'test') {
    throw new Error(
      `refusing to launch ${appBinary}: its package.json says productName=${JSON.stringify(packageJson?.productName)}, ` +
        `${TEST_VARIANT_FIELD}=${JSON.stringify(packageJson?.[TEST_VARIANT_FIELD])}; the test variant must say ` +
        `"${TEST_APP_NAME}" and "test" (npm run package:test), or it would use the real profile`,
    )
  }
}

/** The `package.json` inside the packaged app's `app.asar` (or `app/` folder) of the bundle `appBinary` is in. */
export function readPackagedPackageJson(appBinary) {
  const parts = path.resolve(appBinary).split(path.sep)
  const index = parts.findIndex((part) => part.endsWith('.app'))
  if (index === -1) throw new Error(`${appBinary} is not inside an .app bundle`)
  const resources = path.join(parts.slice(0, index + 1).join(path.sep) || path.sep, 'Contents', 'Resources')
  const asarFile = path.join(resources, 'app.asar')
  if (fs.existsSync(asarFile)) {
    const asar = createRequire(import.meta.url)('@electron/asar')
    return JSON.parse(asar.extractFile(asarFile, 'package.json').toString('utf8'))
  }
  return JSON.parse(fs.readFileSync(path.join(resources, 'app', 'package.json'), 'utf8'))
}
