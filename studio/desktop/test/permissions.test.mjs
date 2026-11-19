/**
 * Unit tests of the permission policy (main/permissions.ts).
 *
 * The policy is what replaces Electron's grant-everything default, so both the
 * allowed set and the refused set are written down here.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decidePermissionCheck, decidePermissionRequest } from '../out/main/permissions.js'

const FILE_SYSTEM = {
  filePath: '/Users/someone/Movies/workspace',
  isDirectory: true,
  fileAccessType: 'writable',
}

test('the file system is granted for a path the page holds', () => {
  assert.equal(decidePermissionRequest('fileSystem', FILE_SYSTEM), true)
  assert.equal(decidePermissionCheck('fileSystem', FILE_SYSTEM), true)
  assert.equal(
    decidePermissionCheck('fileSystem', {
      filePath: '/Volumes/Footage/DJI_0001.MP4',
      isDirectory: false,
      fileAccessType: 'readable',
    }),
    true,
  )
})

test('a file-system request without a path is refused', () => {
  assert.equal(decidePermissionRequest('fileSystem'), false)
  assert.equal(decidePermissionRequest('fileSystem', { filePath: '' }), false)
  assert.equal(decidePermissionCheck('fileSystem'), false)
})

test('the microphone is allowed, the camera is not', () => {
  assert.equal(decidePermissionRequest('media', { mediaTypes: ['audio'] }), true)
  assert.equal(decidePermissionRequest('media', { mediaTypes: ['audio', 'video'] }), false)
  assert.equal(decidePermissionRequest('media', { mediaTypes: ['video'] }), false)
  assert.equal(decidePermissionRequest('media', { mediaTypes: [] }), false)
  assert.equal(decidePermissionRequest('media'), false)

  assert.equal(decidePermissionCheck('media', { mediaType: 'audio' }), true)
  assert.equal(decidePermissionCheck('media', { mediaType: 'video' }), false)
  assert.equal(decidePermissionCheck('media', {}), false)
})

test('the clipboard, fullscreen and persistent storage are allowed', () => {
  for (const permission of [
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'persistent-storage',
  ]) {
    assert.equal(decidePermissionRequest(permission), true, permission)
    assert.equal(decidePermissionCheck(permission), true, permission)
  }
})

test('everything else is refused', () => {
  const refused = [
    'ar',
    'automatic-fullscreen',
    'background-fetch',
    'background-sync',
    'captured-surface-control',
    'deprecated-sync-clipboard-read',
    'display-capture',
    'geolocation',
    'geolocation-approximate',
    'hand-tracking',
    'hid',
    'idle-detection',
    'keyboardLock',
    'local-fonts',
    'local-network',
    'local-network-access',
    'loopback-network',
    'mediaKeySystem',
    'midi',
    'midiSysex',
    'nfc',
    'notifications',
    'openExternal',
    'payment-handler',
    'periodic-background-sync',
    'pointerLock',
    'screen-wake-lock',
    'sensors',
    'serial',
    'smart-card',
    'speaker-selection',
    'storage-access',
    'system-wake-lock',
    'top-level-storage-access',
    'usb',
    'vr',
    'web-app-installation',
    'web-printing',
    'window-management',
    'unknown',
  ]
  for (const permission of refused) {
    assert.equal(decidePermissionRequest(permission), false, permission)
    assert.equal(decidePermissionCheck(permission), false, permission)
  }
})

test('D3: a file gets read access only; write access is for a folder', () => {
  const file = (fileAccessType) => ({
    filePath: '/Volumes/Footage/DJI_0001.MP4',
    isDirectory: false,
    fileAccessType,
  })
  assert.equal(decidePermissionRequest('fileSystem', file('readable')), true)
  assert.equal(decidePermissionCheck('fileSystem', file('readable')), true)
  assert.equal(decidePermissionRequest('fileSystem', file('writable')), false)
  assert.equal(decidePermissionCheck('fileSystem', file('writable')), false)
  // No access type is not read access: a file the policy cannot classify is refused.
  assert.equal(decidePermissionRequest('fileSystem', file(undefined)), false)

  const folder = (fileAccessType) => ({
    filePath: '/Users/someone/Movies/workspace',
    isDirectory: true,
    fileAccessType,
  })
  assert.equal(decidePermissionRequest('fileSystem', folder('writable')), true)
  assert.equal(decidePermissionCheck('fileSystem', folder('writable')), true)
  assert.equal(decidePermissionRequest('fileSystem', folder('readable')), true)
})
