/**
 * The runner both passes share: one throwaway profile and workspace, one app, a list of features run in order,
 * each with its own record (status, requests, data written, screenshot), and two outputs: a JSON record and a
 * Markdown table in the format of `docs/feature-pass.md`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PICKER_RECORDER,
  chooseLaunchMode,
  desktopDir,
  diffSizes,
  drainMainNetworkLog,
  folderSizes,
  installMainNetworkLog,
  launchApp,
  makeFixtures,
  newWorkspaceFiles,
  seedWorkspace,
  timestampSlug,
  waitForRender,
  workspaceFiles,
} from './app.mjs'
import { isTemporaryFolder } from '../../../out/main/workspace-lock.js'
import { STATUS, featureTable, finalStatus, summariseRequests } from './report.mjs'
import { LANGUAGE_KEY, closeDialogs, pageText, toasts } from './ui.mjs'

const outRoot = path.resolve(desktopDir, 'test', 'feature-pass', 'out')

function parseArgs(argv) {
  const args = { only: null, limit: null, mode: 'auto', keep: false, list: false, wait: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--only') args.only = argv[++index].split(',')
    else if (arg === '--limit') args.limit = Number(argv[++index])
    else if (arg === '--mode') args.mode = argv[++index]
    else if (arg === '--keep') args.keep = true
    else if (arg === '--list') args.list = true
    else throw new Error(`unknown argument ${arg}`)
  }
  return args
}

export async function runPass({ passName, features, argv = process.argv.slice(2), prepare }) {
  const args = parseArgs(argv)
  let selected = features
  if (args.only) {
    const unknown = args.only.filter((id) => !features.some((feature) => feature.id === id))
    if (unknown.length) throw new Error(`unknown feature id(s): ${unknown.join(', ')}; --list shows them`)
    selected = features.filter((feature) => args.only.includes(feature.id))
  }
  if (args.limit) selected = selected.slice(0, args.limit)
  if (args.list) {
    for (const feature of features) console.log(`${feature.id.padEnd(24)} ${feature.name}`)
    return 0
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `droneclean-feature-pass-${passName}-`))
  const outDir = path.join(outRoot, `${passName}-${timestampSlug()}`)
  const shotsDir = path.join(outDir, 'shots')
  fs.mkdirSync(shotsDir, { recursive: true })
  // The app refuses a workspace in a temporary folder (the system may delete it), so the workspace lives under
  // `dist/` (git-ignored), as in `e2e.mjs`; the profile and the fixtures stay in the throwaway folder
  fs.mkdirSync(path.join(desktopDir, 'dist'), { recursive: true })
  const workspaceRoot = fs.mkdtempSync(path.join(desktopDir, 'dist', `feature-pass-${passName}-`))
  const workspaceDir = path.join(workspaceRoot, 'workspace')
  fs.mkdirSync(workspaceDir)
  if (isTemporaryFolder(workspaceDir)) throw new Error(`the throwaway workspace is in a temporary folder: ${workspaceDir}`)
  const fixtures = makeFixtures(path.join(work, 'fixtures'))
  if (prepare) Object.assign(fixtures, await prepare(path.join(work, 'fixtures')))

  const choice = chooseLaunchMode({ work, requested: args.mode })
  console.log(`launch mode: ${choice.mode}${choice.probe ? ` (appData probe: ${choice.probe})` : ''}`)

  const session = { app: null, page: null, paths: null, mainOutput: [], sizeByUrl: new Map(), pageErrors: [], consoleErrors: [] }

  async function start() {
    const launched = await launchApp({ work, choice })
    session.app = launched.app
    session.paths = launched.paths
    session.mainOutput.push(...launched.mainOutput)
    await installMainNetworkLog(session.app)
    session.app.context().on('requestfinished', async (request) => {
      try {
        const sizes = await request.sizes()
        session.sizeByUrl.set(request.url(), sizes.responseBodySize + sizes.responseHeadersSize)
      } catch {
        // the request belonged to a page that is gone
      }
    })
    await session.app.context().addInitScript(PICKER_RECORDER)
    session.page = await session.app.firstWindow()
    session.page.on('console', (message) => message.type() === 'error' && session.consoleErrors.push(message.text().slice(0, 300)))
    session.page.on('pageerror', (error) => session.pageErrors.push(error.message.slice(0, 300)))
    await session.page.waitForURL(/^droneclean:\/\/app\//, { timeout: 90000 })
    await waitForRender(session.page)
  }

  async function stop() {
    if (!session.app) return
    await session.app.close().catch(() => {})
    session.app = null
  }

  const records = []
  let exitCode = 0
  try {
    await start()
    console.log(`profile: ${session.paths.userData}`)
    await session.page.evaluate((key) => localStorage.setItem(key, 'en'), LANGUAGE_KEY)
    await seedWorkspace(session.page, workspaceDir)
    await session.page.reload()
    await waitForRender(session.page)
    await session.page.waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, { timeout: 120000 })
    await drainMainNetworkLog(session.app)

    const shared = {}
    for (const feature of selected) {
      const profileBefore = folderSizes(session.paths.userData)
      const workspaceBefore = workspaceFiles(workspaceDir)
      await drainMainNetworkLog(session.app)
      const startedAt = Date.now()
      const state = { actAt: null, label: null, notes: [] }
      const fresh = Boolean(feature.freshLaunch)
      const ctx = {
        get page() {
          return session.page
        },
        get app() {
          return session.app
        },
        work,
        workspaceDir,
        fixtures,
        shared,
        userData: session.paths.userData,
        act(label) {
          if (state.actAt === null) {
            state.actAt = Date.now()
            state.label = label
          }
        },
        note(text) {
          state.notes.push(text)
        },
        async relaunch() {
          await stop()
          await start()
          await closeDialogs(session.page).catch(() => {})
        },
        async shot(name) {
          const file = path.join(shotsDir, `${feature.id}${name ? `-${name}` : ''}.png`)
          await session.page.screenshot({ path: file }).catch(() => {})
          return path.relative(outDir, file)
        },
        async pickers() {
          return session.page.evaluate(() => window.__fpPickers ?? [])
        },
      }
      console.log(`\n== ${feature.id}: ${feature.name}`)
      let result
      try {
        // A model feature starts from a fresh launch of the app: nothing a previous feature started (a download
        // that was still running) can be mistaken for something this feature does. Its launch and the time before the
        // first click are the "open" phase.
        if (fresh) await ctx.relaunch()
        await closeDialogs(session.page).catch(() => {})
        result = (await feature.run(ctx)) ?? { status: STATUS.works }
      } catch (error) {
        const text = await pageText(session.page, 400).catch(() => 'page not reachable')
        result = {
          status: STATUS.scriptError,
          notes: `the script could not finish: ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}. Page text: ${text}`,
        }
      }
      const screenshot = await ctx.shot('end')
      const finishedToasts = await toasts(session.page).catch(() => [])
      await session.page.waitForTimeout(1500)
      const raw = await drainMainNetworkLog(session.app).catch(() => [])
      const requests = raw
        .filter((entry) => entry.t >= startedAt - 50)
        .map((entry) => ({
          url: entry.url,
          method: entry.method,
          status: entry.status,
          bytes: entry.bytes ?? session.sizeByUrl.get(entry.url) ?? null,
          fromCache: entry.fromCache ?? false,
          process: entry.process,
          phase: state.actAt !== null && entry.t >= state.actAt ? 'act' : 'open',
          at: entry.t - startedAt,
        }))
      const summary = summariseRequests(requests)
      const profileAfter = folderSizes(session.paths.userData)
      const record = {
        id: feature.id,
        name: feature.name,
        where: feature.where,
        status: finalStatus(result.status, summary, { expectsDownload: Boolean(feature.expectsDownload) }),
        notes: [result.notes, ...state.notes].filter(Boolean).join(' '),
        manualStep: result.manualStep ?? null,
        firstUserAction: state.label,
        requests: summary,
        requestLog: requests.filter((request) => !/^droneclean:|^blob:|^data:/.test(request.url)),
        stored: {
          profile: diffSizes(profileBefore, profileAfter).slice(0, 8),
          workspace: newWorkspaceFiles(workspaceBefore, workspaceFiles(workspaceDir)),
        },
        toasts: finishedToasts,
        screenshot,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      }
      records.push(record)
      console.log(`   ${record.status}${record.notes ? ' - ' + record.notes.slice(0, 200) : ''}; ${summary.external} external request(s), ${summary.beforeUserAction.length} before the user acts`)
    }
    await session.page.waitForTimeout(500)
  } catch (error) {
    exitCode = 1
    console.error(String(error?.stack ?? error))
    // What the page showed when the pass stopped: a stop before the first feature otherwise leaves nothing to read
    if (session.page) {
      await session.page.screenshot({ path: path.join(shotsDir, 'stopped.png') }).catch(() => {})
      const text = await session.page.evaluate(() => `${location.href}\n${document.body.innerText}`).catch(() => null)
      if (text) fs.writeFileSync(path.join(shotsDir, 'stopped.txt'), text.slice(0, 4000))
    }
  } finally {
    const profileBytes = session.paths ? [...folderSizes(session.paths.userData).values()].reduce((sum, size) => sum + size, 0) : null
    await stop()
    const record = {
      pass: passName,
      date: new Date().toISOString(),
      launchMode: choice.mode,
      appDataProbe: choice.probe,
      profile: session.paths?.userData ?? null,
      realProfileTouched: false,
      appVersion: session.paths?.version ?? null,
      electron: session.paths?.electron ?? null,
      chromium: session.paths?.chromium ?? null,
      packaged: session.paths?.isPackaged ?? null,
      profileBytesAtEnd: profileBytes,
      mainProcessOutputTail: session.mainOutput.join('').slice(-1500),
      pageErrors: session.pageErrors.slice(0, 20),
      consoleErrors: session.consoleErrors.slice(0, 20),
      features: records,
    }
    fs.writeFileSync(path.join(outDir, 'record.json'), JSON.stringify(record, null, 2))
    const table = featureTable(records)
    fs.writeFileSync(path.join(outDir, 'table.md'), table)
    console.log(`\nRECORD ${path.join(outDir, 'record.json')}\nTABLE  ${path.join(outDir, 'table.md')}\n\n${table}`)
    if (!args.keep) {
      fs.rmSync(work, { recursive: true, force: true })
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    } else console.log(`throwaway folders kept: ${work} and ${workspaceRoot}`)
  }
  return exitCode
}
