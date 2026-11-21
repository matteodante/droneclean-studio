/**
 * The packaging hooks of review findings F3 and F13: `afterPack` takes the unused usage strings out of a macOS
 * Info.plist and keeps the microphone's, and electron-builder.yml flips the two Node fuses off and keeps RunAsNode.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const afterPack = require('../scripts/after-pack.cjs')
const config = fs.readFileSync(path.join(here, '..', 'electron-builder.yml'), 'utf8')

test('F13: the camera, Bluetooth and audio-capture strings go, the microphone one stays', { skip: process.platform !== 'darwin' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'))
  const plist = path.join(dir, 'Info.plist')
  const keys = [...afterPack.UNUSED_USAGE_KEYS, 'NSMicrophoneUsageDescription']
  fs.writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${keys
      .map((key) => `<key>${key}</key><string>text</string>`)
      .join('')}</dict></plist>`,
  )
  afterPack.removeUnusedUsageStrings(plist)
  const text = execFileSync('plutil', ['-p', plist], { encoding: 'utf8' })
  for (const key of afterPack.UNUSED_USAGE_KEYS) assert.ok(!text.includes(key), key)
  assert.ok(text.includes('NSMicrophoneUsageDescription'))
  afterPack.removeUnusedUsageStrings(plist) // a second run, and a missing file, are harmless
  afterPack.removeUnusedUsageStrings(path.join(dir, 'missing.plist'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('F13: the config names the hook and keeps the voice-over sentence', () => {
  assert.match(config, /^afterPack: scripts\/after-pack\.cjs$/m)
  assert.match(config, /NSMicrophoneUsageDescription: DroneClean Studio records your voice-over/)
})

test('F3: NODE_OPTIONS and --inspect are off, RunAsNode stays on', () => {
  assert.match(config, /^electronFuses:\n {2}runAsNode: true\n {2}enableNodeOptionsEnvironmentVariable: false\n {2}enableNodeCliInspectArguments: false$/m)
})
