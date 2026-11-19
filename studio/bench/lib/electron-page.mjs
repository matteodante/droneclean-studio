// The benchmark page in the desktop app (task 3.5): the shell's own main process, started the way the e2e starts it
// (a throwaway profile, `desktop/test/support/e2e-profile.mjs`), with its window pointed at the benchmark page the
// way `npm run dev` points it at the dev server (`DRONECLEAN_DEV_URL`). The page then has the real preload bridge,
// the real `droneclean-export:` scheme and the real save dialog's code; only the dialog's window is answered by the
// driver (`pickFile`), because a native dialog cannot be clicked from a script.
//
// It returns what `openBenchPage` (lib/browser.mjs) returns, so a measurement can use either: `profileDir` is the
// throwaway profile, `context.close()` quits the app, and `sampleTree` reads the memory of the app's whole process tree
// (the Electron main process and its children), which `sampleBrowserMemory` cannot find because the main process has
// no `--user-data-dir` on its command line.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { e2eLaunch } from '../../desktop/test/support/e2e-profile.mjs'
import { createHarnessServer } from '../../headless/server.mjs'
import { REPO_ROOT } from './config.mjs'
import { buildPage, listProcesses } from './browser.mjs'

const DESKTOP_DIR = path.join(REPO_ROOT, 'desktop')

/** Resident memory of the process tree under `rootPid`, from `ps`; null when the root is gone. */
function sampleTreeMemory(rootPid) {
  const rows = listProcesses()
  if (!rows.some((r) => r.pid === rootPid)) return null
  const inTree = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const r of rows) {
      if (!inTree.has(r.pid) && inTree.has(r.ppid)) {
        inTree.add(r.pid)
        grew = true
      }
    }
  }
  let total = 0
  const byType = {}
  for (const r of rows) {
    if (!inTree.has(r.pid)) continue
    const type = /--type=([\w-]+)/.exec(r.command)?.[1] ?? 'main'
    byType[type] = (byType[type] ?? 0) + r.rssKb * 1024
    total += r.rssKb * 1024
  }
  return { total, byType }
}

/**
 * Start the server and the desktop app, load the page. `media` maps an id to a file on disk (served to the page, which
 * copies it into the app's storage as the import does).
 */
export async function openBenchPageInElectron({ cache, media, pagePath }) {
  const electronPath = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron')
  if (!fs.existsSync(path.join(DESKTOP_DIR, 'out', 'main', 'index.js'))) {
    throw new Error('the desktop shell is not built: run `npm --prefix desktop run build:main` first')
  }
  const distDir = buildPage(cache)
  const server = await createHarnessServer({ distDir, resolveMedia: (id) => media[id] ?? null })
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-bench-electron-'))
  const options = e2eLaunch({ profileRoot, desktopDir: DESKTOP_DIR, electronPath })
  const { _electron } = await import('playwright')
  const app = await _electron.launch({
    ...options,
    env: { ...options.env, DRONECLEAN_DEV_URL: `${server.base}${pagePath}` },
  })
  const page = await app.firstWindow()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('WORKER_REQUIRES_MAIN_THREAD')) pageErrors.push(m.text())
  })
  const close = async () => {
    await app.close().catch(() => {})
    await server.close().catch(() => {})
    fs.rmSync(profileRoot, { recursive: true, force: true })
  }
  try {
    await page.waitForFunction(() => Boolean(window.bench?.ready), null, { timeout: 60_000 })
    const gpu = await page.evaluate(() => window.bench.gpuInfo())
    if (!gpu.available || gpu.isFallbackAdapter) throw new Error(`No hardware WebGPU adapter (${JSON.stringify(gpu)})`)
    const bridge = await page.evaluate(() => ({
      hasBridge: Boolean(window.dronecleanDesktop),
      hasExportFile: Boolean(window.dronecleanDesktop?.exportFile),
    }))
    if (!bridge.hasExportFile) throw new Error(`the page has no desktop export bridge: ${JSON.stringify(bridge)}`)
    const chromeVersion = await app.evaluate(() => process.versions.chrome)
    return {
      page,
      gpu,
      server,
      app,
      context: { close: () => app.close() },
      profileDir: path.join(profileRoot, 'DroneClean Studio'),
      chromeVersion: `Electron ${await app.evaluate(() => process.versions.electron)} (Chromium ${chromeVersion})`,
      pageErrors,
      mediaUrl: (id) => server.mediaUrl(id),
      /** Answers the save dialog's next windows with `file` instead of showing one. */
      pickFile: (file) =>
        app.evaluate(({ dialog }, chosen) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: chosen })
        }, file),
      /** Answers the save dialog's next windows as if the user closed it. */
      declineFile: () =>
        app.evaluate(({ dialog }) => {
          dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
        }),
      memoryReader: () => sampleTreeMemory(app.process().pid),
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
