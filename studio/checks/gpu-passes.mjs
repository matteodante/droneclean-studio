#!/usr/bin/env node
// GPU passes check: the editor's own WebGPU passes that the unit tests can only fake, run on the real GPU of a headless
// Chrome and held to pictures computed by hand (`gpu-passes-page.ts`). 21 Nov 2026: the preview's frame reduction
// named its sampler `smooth`, which WGSL reserves; the shader never compiled and every reduced frame was black, while
// the unit tests (a fake device) and the speed probe (no pixels) passed. This is the check that fails on that.
//
//   node checks/gpu-passes.mjs
//
// Exit codes: 0 every pass compiled, reported no GPU error and drew the expected pixels; 1 one did not; 2 the check
// could not run (no Chrome, no WebGPU).

import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { chromeLaunchArgs } from '../headless/lib/cli.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const studio = path.resolve(here, '..')
const say = (line) => process.stdout.write(`${line}\n`)

let bundle
try {
  bundle = await build({
    entryPoints: [path.join(here, 'gpu-passes-page.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120'],
    write: false,
    logLevel: 'silent',
    tsconfig: path.join(studio, 'tsconfig.json'),
  })
} catch (error) {
  say(`gpu-passes: the page did not build: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const script = bundle.outputFiles[0].text
const page = `<!doctype html><meta charset="utf-8"><title>GPU passes</title><script type="module" src="/page.js"></script>`

const server = createServer((req, res) => {
  if (req.url === '/page.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(script)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(page)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeLaunchArgs() })
} catch (error) {
  server.close()
  say(`gpu-passes: Chrome did not start: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

let code = 0
try {
  const tab = await browser.newPage()
  const pageErrors = []
  tab.on('pageerror', (error) => pageErrors.push(error.message))
  await tab.goto(origin)
  await tab.waitForFunction(() => window.gpuPassesReady === true, null, { timeout: 30000 })
  let result
  try {
    result = await tab.evaluate(() => window.gpuPasses())
  } catch (error) {
    say(`gpu-passes: the passes could not run: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    code = 2
  }
  if (result) {
    for (const outcome of result.outcomes) say(`${outcome.ok ? 'ok  ' : 'FAIL'} ${outcome.name}: ${outcome.detail}`)
    for (const message of result.gpuErrors) say(`FAIL the GPU reported: ${message}`)
    for (const message of pageErrors) say(`FAIL the page threw: ${message}`)
    const failed =
      result.outcomes.filter((outcome) => !outcome.ok).length + result.gpuErrors.length + pageErrors.length
    say(failed === 0 ? `\ngpu-passes OK: ${result.outcomes.length} passes` : `\ngpu-passes: ${failed} failed`)
    if (failed > 0) code = 1
  }
} finally {
  await browser.close()
  server.close()
}
process.exit(code)
