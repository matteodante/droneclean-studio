/**
 * electron-builder's `afterPack` (runs before signing): takes out of the macOS Info.plist the usage strings Electron
 * ships with and this app does not use. The camera, Bluetooth and audio-capture strings read "This app needs access
 * to ..." and the app never asks for those; only the microphone's (voice-over) stays, set in electron-builder.yml.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/** Strings Electron's template has and DroneClean Studio never uses. */
const UNUSED_USAGE_KEYS = [
  'NSCameraUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSAudioCaptureUsageDescription',
]

/** Removes the keys from one Info.plist; a missing key or file is not an error. */
function removeUnusedUsageStrings(plist) {
  if (!fs.existsSync(plist)) return
  for (const key of UNUSED_USAGE_KEYS) {
    try {
      execFileSync('plutil', ['-remove', key, plist], { stdio: 'ignore' })
    } catch {
      // not in this plist
    }
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  removeUnusedUsageStrings(path.join(app, 'Contents', 'Info.plist'))
}
module.exports.removeUnusedUsageStrings = removeUnusedUsageStrings
module.exports.UNUSED_USAGE_KEYS = UNUSED_USAGE_KEYS
