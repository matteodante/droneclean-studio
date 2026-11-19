// Builds the benchmark page, serves it, and drives it in the installed Google Chrome with a real GPU. It reuses the
// headless harness's launch flags (headless/lib/cli.mjs) and static/media server (headless/server.mjs); it adds a
// persistent profile (like the real app has) and a sampler of the browser's memory.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromeLaunchArgs } from '../../headless/lib/cli.mjs'
import { createHarnessServer } from '../../headless/server.mjs'
import { REPO_ROOT } from './config.mjs'
import { copyGyroPackage } from './side-work.mjs'

const PAGE_PATH = '/bench/page/bench.html'

/** Build the page with the repository's own bundler. Always rebuilt: it takes a couple of seconds. */
export function buildPage(cache) {
  const outDir = path.join(cache, 'page-dist')
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', 'vite-plus', 'bin', 'vp'),
      'build',
      '-c',
      path.join(REPO_ROOT, 'bench', 'page', 'vite.config.mjs'),
      '--outDir',
      outDir,
      '--logLevel',
      'error',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (result.status !== 0 || !fs.existsSync(path.join(outDir, PAGE_PATH))) {
    throw new Error(`building the benchmark page failed:\n${result.stdout}\n${result.stderr}`)
  }
  return outDir
}

/** One row per process of the browser (and only of this browser), from `ps`. */
export function listProcesses() {
  const out = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  }).stdout
  const rows = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), command: m[4] })
  }
  return rows
}

/** Resident memory of the browser's process tree: the root has our profile folder on its command line. */
export function sampleBrowserMemory(profileDir) {
  const rows = listProcesses()
  const root = rows.find(
    (r) => r.command.includes(`--user-data-dir=${profileDir}`) && !r.command.includes('--type='),
  )
  if (!root) return null
  const inTree = new Set([root.pid])
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
  const byType = {}
  let total = 0
  for (const r of rows) {
    if (!inTree.has(r.pid)) continue
    const type = /--type=([\w-]+)/.exec(r.command)?.[1] ?? 'browser'
    byType[type] = (byType[type] ?? 0) + r.rssKb * 1024
    total += r.rssKb * 1024
  }
  return { total, byType }
}

/** Polls the browser's memory while something runs; `stop()` returns the peak and the sample count. */
export function startMemorySampler(profileDir, intervalMs = 250) {
  let peak = { total: 0, byType: {} }
  let samples = 0
  let stopped = false
  const first = sampleBrowserMemory(profileDir)
  if (first) peak = first
  const tick = () => {
    if (stopped) return
    const sample = sampleBrowserMemory(profileDir)
    if (sample) {
      samples++
      if (sample.total > peak.total) peak = sample
    }
    timer = setTimeout(tick, intervalMs)
  }
  let timer = setTimeout(tick, intervalMs)
  return {
    stop() {
      stopped = true
      clearTimeout(timer)
      const last = sampleBrowserMemory(profileDir)
      if (last && last.total > peak.total) peak = last
      return {
        peakBytes: peak.total,
        peakByProcessType: peak.byType,
        samples,
        intervalMs,
        baselineBytes: first?.total ?? null,
      }
    },
  }
}

/**
 * Start the server and the browser, load the page and refuse a software GPU.
 * `media` maps an id to a file on disk (the page copies it into the browser's storage, as the app does on import).
 * `pagePath` selects the page (`import` drives the editor's own file-drop import, which needs no GPU).
 */
export async function openBenchPage({
  cache,
  media,
  pagePath = PAGE_PATH,
  requireGpu = true,
  requireGyro = false,
}) {
  const distDir = buildPage(cache)
  // The gyro engine is served as in the app. A measurement that stabilizes sets `requireGyro`: an unbuilt package
  // then stops it with the reason; the others do not care.
  const gyro = copyGyroPackage(distDir)
  if (requireGyro && !gyro.available) throw new Error(gyro.reason)
  const server = await createHarnessServer({ distDir, resolveMedia: (id) => media[id] ?? null })
  const { chromium } = await import('playwright')
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-bench-profile-'))
  const downloadsDir = path.join(profileDir, 'downloads')
  fs.mkdirSync(downloadsDir)
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
    acceptDownloads: true,
    downloadsPath: downloadsDir,
  })
  const browser = context.browser()
  const page = context.pages()[0] ?? (await context.newPage())
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    // The worker's refusal is expected (and recorded as the reason of the main-thread fallback).
    if (m.type() === 'error' && !m.text().includes('WORKER_REQUIRES_MAIN_THREAD'))
      pageErrors.push(m.text())
  })
  await page.goto(`${server.base}${pagePath}`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.bench?.ready), { timeout: 30_000 })
  const gpu = requireGpu ? await page.evaluate(() => window.bench.gpuInfo()) : null
  if (gpu && (!gpu.available || gpu.isFallbackAdapter)) {
    await closeBenchPage({ context, server, profileDir })
    throw new Error(
      `No hardware WebGPU adapter (${JSON.stringify(gpu)}). The benchmark needs the real GPU: run it on the Mac itself, not in a container or over SSH without a display.`,
    )
  }
  return {
    page,
    gpu,
    gyro,
    server,
    context,
    profileDir,
    chromeVersion: browser.version(),
    pageErrors,
    mediaUrl: (id) => server.mediaUrl(id),
    close: () => closeBenchPage({ context, server, profileDir }),
  }
}

async function closeBenchPage({ context, server, profileDir }) {
  await context.close().catch(() => {})
  await server.close().catch(() => {})
  fs.rmSync(profileDir, { recursive: true, force: true })
}
