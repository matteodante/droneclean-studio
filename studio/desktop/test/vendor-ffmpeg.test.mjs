// The packaging step that puts the app's own FFmpeg in vendor/ picks the build of the system it runs on (task 8.1).
import assert from 'node:assert/strict'
import test from 'node:test'

import { vendorCommand } from '../scripts/vendor-ffmpeg.mjs'

test('macOS builds FFmpeg from source with the Mac script', () => {
  assert.deepEqual(vendorCommand('darwin'), { command: 'sh', args: ['scripts/build-ffmpeg.sh'] })
})

test('Windows cross-builds it inside WSL, where npm has no sh', () => {
  assert.deepEqual(vendorCommand('win32'), { command: 'wsl', args: ['-e', 'sh', 'scripts/build-ffmpeg-win.sh'] })
})

test('other systems package nothing and use the FFmpeg on PATH', () => {
  assert.equal(vendorCommand('linux'), null)
})
