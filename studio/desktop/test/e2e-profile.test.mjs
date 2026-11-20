/**
 * The e2e launcher's guard (review finding E1): `npm run e2e` once ran against
 * the real profile and left it pointing at its temporary workspace, where the
 * owner then made a real project. The launcher must refuse the real profile, and
 * every launch it builds must carry a throwaway one. No Electron here: the guard
 * is plain Node, in `test/support/e2e-profile.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import {
  TEST_APP_NAME,
  e2eLaunch,
  assertTestVariantPackage,
  e2ePackagedLaunch,
  readPackagedPackageJson,
  realProfileDirs,
  testProfileDir,
} from './support/e2e-profile.mjs'

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-e2e-profile-test-'))
after(() => fs.rmSync(work, { recursive: true, force: true }))

const DESKTOP = '/desktop'
const ELECTRON = '/desktop/node_modules/electron/dist/electron'
const MAC = { platform: 'darwin', home: '/Users/someone', env: {} }

function launch(profileRoot, extra = {}) {
  return e2eLaunch({ profileRoot, desktopDir: DESKTOP, electronPath: ELECTRON, ...MAC, ...extra })
}

test('E1: the real profile locations per platform', () => {
  assert.deepEqual(realProfileDirs(MAC), [
    '/Users/someone/Library/Application Support',
    '/Users/someone/Library/Application Support/DroneClean Studio',
  ])
  assert.deepEqual(realProfileDirs({ platform: 'win32', home: 'C:\\Users\\a', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' } }), [
    'C:\\Users\\a\\AppData\\Roaming',
    path.join('C:\\Users\\a\\AppData\\Roaming', 'DroneClean Studio'),
  ])
  assert.equal(realProfileDirs({ platform: 'linux', home: '/home/a', env: { XDG_CONFIG_HOME: '/cfg' } })[0], '/cfg')
})

test('E1: the launcher throws when the profile is the real one', () => {
  for (const real of realProfileDirs(MAC)) {
    assert.throws(() => launch(real), /real profile/, real)
  }
  // `throwaway-profile.cjs` makes <root>/DroneClean Studio the profile: a root that is the real
  // application-support folder lands exactly on the real profile.
  assert.throws(() => launch('/Users/someone/Library/Application Support/'), /real profile/)
  assert.throws(() => launch('/Users/someone/Library/Application Support/../Application Support'), /real profile/)
  assert.throws(() => launch(''), /profile/)
  assert.throws(() => launch(undefined), /profile/)
})

test('E1: a symlink to the real profile is the real profile', () => {
  const home = path.join(work, 'home')
  const appData = path.join(home, 'Library', 'Application Support')
  fs.mkdirSync(path.join(appData, 'DroneClean Studio'), { recursive: true })
  const link = path.join(work, 'innocent-looking')
  fs.symlinkSync(appData, link)
  assert.throws(() => launch(link, { home }), /real profile/)
  const second = path.join(work, 'second')
  fs.symlinkSync(path.join(appData, 'DroneClean Studio'), second)
  assert.throws(() => launch(second, { home }), /real profile/)
})

test('E1: a throwaway profile launches the built main, with its own profile in the environment', () => {
  const root = path.join(work, 'profile')
  const options = launch(root, { env: { DRONECLEAN_USER_DATA: '/Users/someone/Library/Application Support/DroneClean Studio', KEEP: 'yes' } })
  assert.equal(options.executablePath, ELECTRON)
  assert.deepEqual(options.args, [path.join(DESKTOP, 'test', 'support', 'throwaway-profile.cjs')])
  assert.equal(options.cwd, DESKTOP)
  assert.equal(options.env.DRONECLEAN_PROFILE_ROOT, root)
  assert.equal(options.env.DRONECLEAN_USER_DATA, path.join(root, 'DroneClean Studio'), 'an inherited profile is overridden')
  assert.equal(options.env.KEEP, 'yes')
})

const TEST_PACKAGE = { productName: 'DroneClean Studio Test', droneCleanVariant: 'test' }
const TEST_BINARY = `/d/dist/test-app/mac-arm64/${TEST_APP_NAME}.app/Contents/MacOS/${TEST_APP_NAME}`

test('E1: the packaged e2e launches only the test variant', () => {
  const options = e2ePackagedLaunch({ appBinary: TEST_BINARY, readPackageJson: () => TEST_PACKAGE, ...MAC, env: { DRONECLEAN_USER_DATA: '/x', KEEP: 'yes' } })
  assert.equal(options.executablePath, TEST_BINARY)
  assert.deepEqual(options.env, { KEEP: 'yes' }, 'no DRONECLEAN_ variable is passed on')
  assert.throws(
    () => e2ePackagedLaunch({ appBinary: '/d/dist/mac-arm64/DroneClean Studio.app/Contents/MacOS/DroneClean Studio', readPackageJson: () => TEST_PACKAGE, ...MAC }),
    /never the real app/,
  )
  assert.throws(() => e2ePackagedLaunch({ appBinary: '', readPackageJson: () => TEST_PACKAGE, ...MAC }), /not given/)
})

test('8.1: on Windows the packaged e2e launches only DroneClean Studio Test.exe, never the real app', () => {
  const WIN = { platform: 'win32', home: 'C:\\Users\\pilot', env: { APPDATA: 'C:\\Users\\pilot\\AppData\\Roaming' } }
  const testExe = 'C:\\p\\dist\\test-app\\win-unpacked\\DroneClean Studio Test.exe'
  const options = e2ePackagedLaunch({ appBinary: testExe, readPackageJson: () => TEST_PACKAGE, ...WIN })
  assert.equal(options.executablePath, testExe)
  assert.throws(
    () =>
      e2ePackagedLaunch({
        appBinary: 'C:\\p\\dist\\win-unpacked\\DroneClean Studio.exe',
        readPackageJson: () => TEST_PACKAGE,
        ...WIN,
      }),
    /refusing to launch/,
  )
})

test('E1: the test variant has a profile of its own', () => {
  const [appData, real] = realProfileDirs(MAC)
  assert.equal(testProfileDir(MAC), path.join(appData, 'DroneClean Studio Test'))
  assert.notEqual(testProfileDir(MAC), real)
})

test('E1: a test bundle whose package.json still says the real product is refused before launch', () => {
  // The failure of 19 Nov 2026: `-c.productName` renamed the bundle but the packaged package.json kept the real name.
  assert.throws(
    () => e2ePackagedLaunch({ appBinary: TEST_BINARY, readPackageJson: () => ({ productName: 'DroneClean Studio' }), ...MAC }),
    /test variant must say/,
  )
  assert.throws(() => assertTestVariantPackage({ productName: 'DroneClean Studio Test' }), /test variant must say/)
  assert.throws(() => assertTestVariantPackage({ droneCleanVariant: 'test' }), /test variant must say/)
  assert.doesNotThrow(() => assertTestVariantPackage(TEST_PACKAGE))
})

test('E1: the package.json is read from the bundle\'s real app.asar', async () => {
  const asar = (await import('node:module')).createRequire(import.meta.url)('@electron/asar')
  const source = path.join(work, 'asar-source')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(TEST_PACKAGE))
  const resources = path.join(work, `${TEST_APP_NAME}.app`, 'Contents', 'Resources')
  fs.mkdirSync(resources, { recursive: true })
  await asar.createPackage(source, path.join(resources, 'app.asar'))
  const binary = path.join(work, `${TEST_APP_NAME}.app`, 'Contents', 'MacOS', TEST_APP_NAME)
  assert.deepEqual(readPackagedPackageJson(binary), TEST_PACKAGE)
  assert.doesNotThrow(() => e2ePackagedLaunch({ appBinary: binary, ...MAC }))
})
