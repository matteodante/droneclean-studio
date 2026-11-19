/**
 * The launcher path the Agent access panel prints (task 2.2 slice 7).
 *
 * The snippets a user pastes name a file on disk, so the path must be the one
 * this app ships: `Resources/mcp` in a packaged app (`electron-builder.yml`),
 * `studio/mcp` beside the shell's folder in a working copy, and the `.cmd`
 * wrapper on Windows. The last test checks the working-copy answer against the
 * real folder, so a moved `mcp/` fails here rather than in a pasted snippet.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { launcherPathFor } from '../out/main/mcp/launcher-path.js'

const here = path.dirname(new URL(import.meta.url).pathname)

test('a working copy names studio/mcp beside the shell', () => {
  assert.equal(
    launcherPathFor({
      isPackaged: false,
      resourcesPath: '/unused',
      appPath: '/work/studio/desktop',
      platform: 'darwin',
    }),
    '/work/studio/mcp/droneclean-mcp',
  )
})

test('a packaged app names Resources/mcp', () => {
  assert.equal(
    launcherPathFor({
      isPackaged: true,
      resourcesPath: '/Applications/DroneClean Studio.app/Contents/Resources',
      appPath: '/unused',
      platform: 'darwin',
    }),
    '/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp',
  )
})

test('Windows gets the .cmd wrapper', () => {
  assert.equal(
    launcherPathFor({
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\DroneClean Studio\\resources',
      appPath: 'C:\\unused',
      platform: 'win32',
    }),
    'C:\\Program Files\\DroneClean Studio\\resources\\mcp\\droneclean-mcp.cmd',
  )
  assert.equal(
    launcherPathFor({
      isPackaged: false,
      resourcesPath: 'C:\\unused',
      appPath: 'C:\\work\\studio\\desktop',
      platform: 'win32',
    }),
    'C:\\work\\studio\\mcp\\droneclean-mcp.cmd',
  )
})

test('the working-copy answer is the wrapper that exists in this checkout', () => {
  const desktop = path.resolve(here, '..')
  const wrapper = launcherPathFor({
    isPackaged: false,
    resourcesPath: '/unused',
    appPath: desktop,
  })
  assert.equal(wrapper, path.resolve(desktop, '..', 'mcp', 'droneclean-mcp'))
  assert.ok(fs.existsSync(wrapper), `${wrapper} should exist`)
  assert.ok(fs.existsSync(path.resolve(desktop, '..', 'mcp', 'launcher.mjs')))
})
