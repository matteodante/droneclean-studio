#!/usr/bin/env node
// Network origins check: opening the app and a project must not reach any
// origin but the one that served the app (AGENTS.md: "The editor makes no
// network request the user did not ask for"; plan task 1.4).
//
//   node checks/network-origins.mjs                      build the app, then check
//   node checks/network-origins.mjs --dist dist           reuse a build (npm run verify does)
//   node checks/network-origins.mjs --help
//
// What it does: builds the app, serves it on 127.0.0.1 at a random port with
// the cross-origin isolation headers, seeds the workspace FreeCut would have
// after the user picks a folder (an OPFS folder holding one project with one
// text clip, registered in the app's own IndexedDB), then opens `/`, `/projects`
// and `/editor/<id>` in Chrome, selects the clip and opens its font picker, and
// opens the Lottie tab, recording every request the browser context makes until
// the network has been quiet for 3 s. Writes checks/out/network-origins.json
// and lists every request that left the served origin, with the step it
// happened in, plus every request made by a step that must make none.
//
// Exit codes: 0 every request stayed on the served origin and only the steps
// allowed to fetch did, 1 a request went elsewhere or a no-request step
// fetched, 2 the check could not run (build failed, no Chrome, the editor did
// not open the seeded project).

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { describeFailure, runToLog, tailOf } from '../headless/lib/build-log.mjs'
import { chromeLaunchArgs } from '../headless/lib/cli.mjs'
import { createNetworkRecorder, summarizeOffenders } from './lib/recorder.mjs'
import { findUnexpectedRequests } from './lib/expectations.mjs'
import { createStaticServer } from './lib/server.mjs'
import {
  buildSeededProject,
  buildWorkspaceIndex,
  buildWorkspaceMarker,
  PROJECT_ID,
  PROJECT_NAME,
  SEED_DIRECTORY,
  TEXT_CLIP_ID,
  TEXT_CLIP_TEXT,
  TEXT_FONT_FAMILY,
  seedWorkspaceInPage,
} from './lib/seed-workspace.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const CHECKS = import.meta.dirname
const OUT_DIR = path.join(CHECKS, 'out')
const LOG_FILE = path.join(OUT_DIR, 'network-origins.json')
/** The build output a run without `--dist` builds and measures (see buildApp). */
const BUILD_DIR = 'dist'
const QUIET_MS = 3000
const QUIET_TIMEOUT_MS = 30000
const LOAD_TIMEOUT_MS = 60000
const SETTLE_TIMEOUT_MS = 20000

class SetupError extends Error {}

const USAGE = `Usage: node checks/network-origins.mjs [--dist <dir>]

  --dist <dir>  serve a build that already exists instead of building the app
                (npm run verify passes "dist", which it built just before)
`

function parseArguments(argv) {
  const options = { dist: null, help: false }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--dist') {
      const value = argv[++index]
      if (!value) throw new SetupError('--dist needs a folder')
      options.dist = value
    } else if (token === '--help' || token === '-h') {
      options.help = true
    } else {
      throw new SetupError(`Unknown argument: ${token}`)
    }
  }
  return options
}

/**
 * Build the app into `dist/`.
 *
 * `dist/` is the folder `npm run build` and `npm run verify` fill, so a run without
 * `--dist` measures the build the rest of the repository talks about. `--dist` serves
 * an existing build and never runs this.
 */
function buildApp() {
  const startedAt = Date.now()
  // The build prints a line per emitted asset and the bundle carries about 10,000 font files:
  // over spawnSync's 1 MiB maxBuffer, which used to kill the child (ENOBUFS) and read as a
  // build failure. The log goes to checks/out/build.log instead of into this process.
  const logPath = path.join(OUT_DIR, 'build.log')
  const result = runToLog('npx', ['vp', 'build'], { cwd: ROOT, logPath })
  if (result.status !== 0) {
    process.stderr.write(`${tailOf(logPath)}\n`)
    throw new SetupError(
      `The app did not build (${describeFailure(result)}); the build log is ${path.relative(ROOT, logPath)}`,
    )
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`Built the app into ${BUILD_DIR}/ (${seconds} s)`)
}

function resolveDist(option) {
  const distDir = option ? path.resolve(ROOT, option) : path.join(ROOT, BUILD_DIR)
  if (!option) buildApp()
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new SetupError(`${distDir} has no index.html; build the app first.`)
  }
  return distDir
}

/** Wait for the app to show something; a timeout means the step did not happen. */
async function settle(page, description, action) {
  try {
    await action()
  } catch {
    throw new SetupError(`The ${description} did not appear; the step was not measured.`)
  }
}

async function openStep(page, recorder, { name, url, afterLoad }) {
  const startedAt = Date.now()
  recorder.setStep(name)
  await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
  if (afterLoad) await afterLoad()
  const quiet = await recorder.waitForQuiet({
    quietMs: QUIET_MS,
    timeoutMs: QUIET_TIMEOUT_MS,
  })
  return {
    name,
    url,
    quiet: quiet.quiet,
    idleMs: Math.round(quiet.idleMs),
    durationMs: Date.now() - startedAt,
  }
}

/**
 * A step that acts inside the page already open instead of navigating, and
 * waits for the network to go quiet like every other step.
 *
 * `noRequests: true` marks a step that must not fetch anything at all: opening
 * a panel is not the user asking for its contents, so even a request to the
 * app's own origin fails the run (`lib/expectations.mjs`).
 */
async function interactStep(page, recorder, { name, action, noRequests = false }) {
  const startedAt = Date.now()
  recorder.setStep(name)
  await action()
  const quiet = await recorder.waitForQuiet({
    quietMs: QUIET_MS,
    timeoutMs: QUIET_TIMEOUT_MS,
  })
  return {
    name,
    url: page.url(),
    quiet: quiet.quiet,
    idleMs: Math.round(quiet.idleMs),
    durationMs: Date.now() - startedAt,
    noRequests,
  }
}

/**
 * Write the workspace and its project into the browser's own storage, on the
 * app's origin, before the first page of the app loads. See
 * `lib/seed-workspace.mjs` for why an OPFS folder is a faithful workspace.
 */
async function seedWorkspace(page, recorder, base) {
  const project = buildSeededProject()
  recorder.setStep('seed')
  await page.goto(`${base}/favicon.svg`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
  const seeded = await page.evaluate(seedWorkspaceInPage, {
    directoryName: SEED_DIRECTORY,
    project,
    index: buildWorkspaceIndex(project),
    marker: buildWorkspaceMarker(),
  })
  if (seeded.permission !== 'granted') {
    throw new SetupError(
      `The seeded handle is "${seeded.permission}", not granted; the app would ask for the picker.`,
    )
  }
  console.log(`  Seeded workspace "${seeded.name}" (OPFS) with project ${project.id}`)
}

async function runSteps({ page, recorder, base }) {
  const steps = []
  await seedWorkspace(page, recorder, base)
  steps.push({ name: 'seed', url: `${base}/favicon.svg`, quiet: true, idleMs: 0, durationMs: 0 })

  steps.push(await openStep(page, recorder, { name: 'landing', url: `${base}/` }))

  steps.push(
    await openStep(page, recorder, {
      name: 'projects',
      url: `${base}/projects`,
      afterLoad: () =>
        settle(page, 'seeded project in the projects list', () =>
          page.waitForFunction((name) => document.body.innerText.includes(name), PROJECT_NAME, {
            timeout: SETTLE_TIMEOUT_MS,
          }),
        ),
    }),
  )

  steps.push(
    await openStep(page, recorder, {
      name: 'editor',
      url: `${base}/editor/${PROJECT_ID}`,
      // The timeline clip and the clip's text on screen prove the seeded
      // project opened. The text clip's font is what makes the font request
      // this step exists to see; it is recorded like every other request, so
      // the check does not also require the loader's DOM marker (a future
      // bundled-font loader would not create one).
      afterLoad: async () => {
        await settle(page, 'seeded text clip in the editor timeline', () =>
          page.waitForSelector(`[data-item-id="${TEXT_CLIP_ID}"]`, {
            timeout: SETTLE_TIMEOUT_MS,
          }),
        )
        await settle(page, 'seeded text clip on screen', () =>
          page.waitForFunction((text) => document.body.innerText.includes(text), TEXT_CLIP_TEXT, {
            timeout: SETTLE_TIMEOUT_MS,
          }),
        )
      },
    }),
  )

  steps.push(
    await interactStep(page, recorder, {
      name: 'font-picker',
      // Selecting the seeded text clip shows its typography controls; opening
      // the picker asks the font loader for the catalogue and the preview
      // faces, which must all come from the app's own assets.
      action: async () => {
        await settle(page, 'seeded text clip selected in the editor', () =>
          page
            .locator(`[data-item-id="${TEXT_CLIP_ID}"]`)
            .first()
            .click({ timeout: SETTLE_TIMEOUT_MS }),
        )
        await settle(page, 'font picker for the selected text clip', () =>
          page
            .locator('button[aria-haspopup="listbox"]', { hasText: TEXT_FONT_FAMILY })
            .first()
            .click({ timeout: SETTLE_TIMEOUT_MS }),
        )
        await settle(page, 'font catalogue in the font picker', () =>
          page.locator('[role="listbox"] [role="option"]').first().waitFor({
            state: 'visible',
            timeout: SETTLE_TIMEOUT_MS,
          }),
        )
      },
    }),
  )

  steps.push(
    await interactStep(page, recorder, {
      name: 'lottie',
      // Opening the Lottie tab must not load LottieFiles' catalogue or its
      // previews; the panel sits on its "Browse LottieFiles" button until the
      // user clicks it. A request here fails the run even from our own origin.
      noRequests: true,
      action: async () => {
        await settle(page, 'Lottie tab in the editor sidebar', () =>
          page
            .locator('button[data-tooltip="Lottie"]')
            .first()
            .click({ timeout: SETTLE_TIMEOUT_MS }),
        )
        await settle(page, 'Lottie panel', () =>
          page
            .locator('a[href="https://lottiefiles.com/page/license"]')
            .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
        )
      },
    }),
  )

  return steps
}

/** Console errors and page exceptions, recorded for the log but not the verdict. */
function collectPageProblems(page) {
  const problems = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  return problems
}

function writeLog({ servedOrigin, distDir, steps, entries, workers, problems, browser }) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const log = {
    generatedAt: new Date().toISOString(),
    servedOrigin,
    dist: path.relative(ROOT, distDir),
    chrome: browser.version(),
    steps: steps.map((step) => ({
      ...step,
      requests: entries.filter((entry) => entry.step === step.name).length,
    })),
    workers,
    problems,
    requests: entries,
    offenders: summarizeOffenders(entries),
    unexpectedRequests: findUnexpectedRequests(steps, entries),
  }
  fs.writeFileSync(LOG_FILE, `${JSON.stringify(log, null, 2)}\n`)
  return log
}

function printSteps(log) {
  for (const step of log.steps) {
    const network = step.quiet
      ? `quiet ${(step.idleMs / 1000).toFixed(1)} s`
      : `STILL ACTIVE after ${(step.durationMs / 1000).toFixed(1)} s`
    const total = `${(step.durationMs / 1000).toFixed(1)} s`
    console.log(
      `  ${step.name.padEnd(11)} ${String(step.requests).padStart(3)} requests  ` +
        `${network.padEnd(24)} ${total.padStart(6)}  ${step.url}`,
    )
  }
  const workerLabel = summarizeWorkers(log.workers)
  if (workerLabel) console.log(`  workers: ${workerLabel}`)
  if (log.problems.length > 0) {
    console.log(`  ${log.problems.length} page error(s), in ${path.relative(ROOT, LOG_FILE)}`)
  }
}

/** `dedicated worker.js x3, service-worker sw.js`, in first-seen order. */
function summarizeWorkers(workers) {
  const groups = new Map()
  for (const worker of workers) {
    const key = `${worker.kind} ${worker.url}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups]
    .map(([label, count]) => (count === 1 ? label : `${label} x${count}`))
    .join(', ')
}

function printVerdict(log) {
  if (log.offenders.length === 0 && log.unexpectedRequests.length === 0) {
    console.log(`PASS: every request stayed on ${log.servedOrigin}`)
    return
  }

  if (log.unexpectedRequests.length > 0) {
    const count = log.unexpectedRequests.reduce((total, group) => total + group.count, 0)
    console.error(`FAIL: ${count} request(s) made by a step that must make none:`)
    for (const group of log.unexpectedRequests) {
      console.error(`  ${group.step} (${group.count} request(s))`)
      for (const url of group.urls) {
        console.error(`    ${url}`)
      }
    }
  }

  if (log.offenders.length > 0) {
    const count = log.offenders.reduce((total, group) => total + group.count, 0)
    console.error(`FAIL: ${count} request(s) left ${log.servedOrigin}:`)
    for (const group of log.offenders) {
      console.error(`  ${group.origin} (${group.count} request(s))`)
      for (const entry of group.urls) {
        console.error(`    [${entry.steps.join(', ')}] ${entry.url}`)
      }
    }
  }
}

async function run(options) {
  const distDir = resolveDist(options.dist)
  const server = await createStaticServer({ distDir })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  try {
    const context = await browser.newContext({
      serviceWorkers: 'allow',
      viewport: { width: 1600, height: 1000 },
    })
    const recorder = createNetworkRecorder({ context, servedOrigin: server.origin })
    const page = await context.newPage()
    const problems = collectPageProblems(page)

    console.log(`Serving ${path.relative(ROOT, distDir)}/ on ${server.origin}`)
    const steps = await runSteps({ page, recorder, base: server.base })

    const entries = recorder.entries()
    const log = writeLog({
      servedOrigin: server.origin,
      distDir,
      steps,
      entries,
      workers: recorder.workers(),
      problems,
      browser,
    })
    printSteps(log)
    console.log(`Wrote ${path.relative(ROOT, LOG_FILE)} (${entries.length} requests)`)
    printVerdict(log)
    return log.offenders.length === 0 && log.unexpectedRequests.length === 0 ? 0 : 1
  } finally {
    await browser.close().catch(() => {})
    await server.close()
  }
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(USAGE)
    return
  }
  try {
    process.exitCode = await run(options)
  } catch (error) {
    console.error(`SETUP: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}

void main()
