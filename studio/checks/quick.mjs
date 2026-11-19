#!/usr/bin/env node
// Quick checks: every fast check of `npm run verify`, in verify's order, stopping at the first failure.
//
//   npm run check:quick
//
// `npm run verify` calls this for its first part, so the two cannot drift. Not in it: the unit tests, the
// build, the network check (needs the build and Chrome), the desktop checks and the headless suites.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Each entry is an npm script of studio/package.json. */
export const QUICK_CHECKS = [
  ['vp', 'check'],
  ['vp', 'check:boundaries'],
  ['vp', 'check:deps-contracts'],
  ['vp', 'check:layer-boundaries'],
  ['vp', 'check:deps-wrapper-health'],
  ['vp', 'check:unused-exports'],
  ['vp', 'check:unused-class-members'],
  ['vp', 'check:changed-health'],
  ['npm', 'check:feature-map'],
  ['vp', 'check:edge-budgets'],
  ['npm', 'check:secrets'],
  ['npm', 'check:no-cdn'],
  ['npm', 'check:licenses'],
  ['npm', 'check:upstream-rows'],
  ['npm', 'check:fork-folders'],
  ['npm', 'check:reachable'],
  ['npm', 'check:i18n-keys'],
  ['npm', 'check:checks'],
]

function main() {
  const started = Date.now()
  for (const [runner, script] of QUICK_CHECKS) {
    const args = runner === 'vp' ? ['vp', 'run', script] : ['npm', 'run', script]
    const t = Date.now()
    console.log(`\n=== check:quick: ${script} ===`)
    const result = spawnSync(args[0], args.slice(1), { cwd: STUDIO, stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`\ncheck:quick FAILED at ${script} (exit ${result.status ?? result.signal}) after ${seconds(started)} s`)
      process.exit(1)
    }
    console.log(`--- ${script} ok in ${seconds(t)} s`)
  }
  console.log(`\ncheck:quick OK: ${QUICK_CHECKS.length} checks in ${seconds(started)} s`)
}

function seconds(since) {
  return ((Date.now() - since) / 1000).toFixed(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
