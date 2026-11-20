// Renders golden frames through the editor's own render code, on the real GPU.
//
// This reuses the headless machinery (headless/server.mjs serves the built app and
// the media, headless/lib/cli.mjs gives the Chrome flags) and calls
// `window.freecut.renderFrame` in src/headless/main.ts, which calls
// `renderSingleFrame` -> `createCompositionRenderer`: the same renderer factory the
// export uses, per frame.
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { chromium } from 'playwright'
import { chromeLaunchArgs } from '../../headless/lib/cli.mjs'
import { createHarnessServer } from '../../headless/server.mjs'
import { RAW_SUFFIX } from './float.mjs'
import { warpStageOnPage } from './stage-warp.mjs'

const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|softpipe|software|basic render|mesa/i

/** What the page's WebGPU adapter is. */
async function readAdapter(page) {
  // Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
  // fallow-ignore-next-line complexity
  return page.evaluate(async () => {
    if (!navigator.gpu) return { available: false, reason: 'navigator.gpu is undefined' }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return { available: false, reason: 'requestAdapter() returned null' }
    const info = adapter.info ?? {}
    return {
      available: true,
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
      isFallbackAdapter: Boolean(adapter.isFallbackAdapter ?? info.isFallbackAdapter),
    }
  })
}

/** A software adapter is refused: its output is not what a user's GPU produces. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function assertHardwareGpu(adapter) {
  if (!adapter.available)
    throw new Error(`No WebGPU adapter (${adapter.reason}). Golden frames need a real GPU.`)
  const label = [adapter.vendor, adapter.architecture, adapter.device, adapter.description].join(
    ' ',
  )
  if (adapter.isFallbackAdapter || SOFTWARE_ADAPTER.test(label)) {
    throw new Error(
      `The WebGPU adapter is software (${label.trim() || 'fallback adapter'}). Golden frames are only valid on a real GPU; refusing to continue.`,
    )
  }
}

const sh = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** Machine description stored beside the frames. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function describeMachine({ adapter, chromeVersion }) {
  const mac = process.platform === 'darwin'
  return {
    gpu: {
      vendor: adapter.vendor,
      architecture: adapter.architecture,
      device: adapter.device,
      description: adapter.description,
    },
    chrome: chromeVersion,
    os: mac
      ? `macOS ${sh('sw_vers', ['-productVersion'])} (${sh('sw_vers', ['-buildVersion'])})`
      : `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: mac
      ? sh('sysctl', ['-n', 'machdep.cpu.brand_string'])
      : (os.cpus()[0]?.model ?? 'unknown'),
    model: mac ? sh('sysctl', ['-n', 'hw.model']) : 'unknown',
    angleBackend: chromeLaunchArgs().find((arg) => arg.startsWith('--use-angle=')) ?? 'default',
  }
}

/** The fields that decide whether stored frames can be expected to match bit for bit. */
export function machineKey(machine) {
  const chromeMajor = String(machine.chrome).match(/(\d+)\./)?.[1] ?? machine.chrome
  return [
    machine.gpu.vendor,
    machine.gpu.architecture,
    machine.os.split(' (')[0],
    `chrome ${chromeMajor}`,
  ].join(' | ')
}

/**
 * Start the harness server and Chrome. `mediaFiles` maps media id -> absolute path.
 * Requests to anything but the local server are aborted and counted: a golden
 * render must not depend on the network.
 */
export async function openRenderer({ distDir, mediaFiles }) {
  const server = await createHarnessServer({
    distDir,
    resolveMedia: (id) => mediaFiles.get(id) ?? null,
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  const blocked = new Set()
  const pageErrors = []
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith(server.base) || url.startsWith('blob:') || url.startsWith('data:'))
        return route.continue()
      blocked.add(new URL(url).origin)
      return route.abort()
    })
    const page = await context.newPage()
    // The harness delivers a frame as a browser download. Capture the Blob instead and cancel the
    // download: no file dialogs, no download limits, and the bytes come back through evaluate().
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL)
      window.__goldenBlobs = []
      URL.createObjectURL = (object) => {
        if (object instanceof Blob) window.__goldenBlobs.push(object)
        return create(object)
      }
      HTMLAnchorElement.prototype.click = function () {}
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (process.env.GOLDEN_CONSOLE) console.error(`[page ${message.type()}]`, message.text().slice(0, 600))
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    const adapter = await readAdapter(page)
    assertHardwareGpu(adapter)
    const machine = describeMachine({ adapter, chromeVersion: browser.version() })
    return {
      machine,
      blockedOrigins: blocked,
      pageErrors,
      /** Render one frame of a project; returns the PNG bytes and the render warnings. */
      async renderFrame(project, frame, mediaIds) {
        const media = mediaIds.map((mediaId) => ({ mediaId, url: server.mediaUrl(mediaId) }))
        const { summary, base64 } = await page.evaluate(
          async (payload) => {
            window.__goldenBlobs.length = 0
            const result = await window.freecut.renderFrame(payload)
            const blob = window.__goldenBlobs.at(-1)
            if (!blob) throw new Error('renderFrame produced no image')
            const bytes = new Uint8Array(await blob.arrayBuffer())
            let binary = ''
            for (let i = 0; i < bytes.length; i += 0x8000)
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            return { summary: result, base64: btoa(binary) }
          },
          { project, media, frame, format: 'image/png', strict: true },
        )
        return { png: Buffer.from(base64, 'base64'), summary }
      },
      /**
       * Render one frame of a project through the precise path (design 3.6 section 2.13): the float composite on, the
       * clips' pictures from raw 10-bit files of `raw.width` x `raw.height`. Returns the accumulator as unorm16 RGBA
       * (`{ width, height, data: Uint16Array, outOfRange }`) and the render's warnings.
       */
      async renderFloat(project, frame, mediaIds, raw) {
        const media = mediaIds.map((mediaId) => ({ mediaId, url: server.mediaUrl(mediaId) }))
        await page.evaluate((options) => window.freecutPrecise.begin(options), {
          ...raw,
          rawSuffix: RAW_SUFFIX,
        })
        let rendered
        try {
          rendered = await page.evaluate(
            async (payload) => ({ summary: await window.freecut.renderFrame(payload) }),
            { project, media, frame, format: 'image/png', strict: true },
          )
        } finally {
          rendered = { ...rendered, result: await page.evaluate(() => window.freecutPrecise.end()) }
        }
        const { frames } = rendered.result
        if (frames.length !== 1) {
          throw new Error(`the float render delivered ${frames.length} frames to the sink, expected exactly 1`)
        }
        const [delivered] = frames
        const bytes = Buffer.from(delivered.rgba16, 'base64')
        const data = new Uint16Array(bytes.length / 2)
        for (let i = 0; i < data.length; i++) data[i] = bytes.readUInt16LE(i * 2)
        return {
          image: { width: delivered.width, height: delivered.height, data, float: true },
          outOfRange: delivered.outOfRange,
          summary: rendered.summary,
        }
      },
      /** Warp the synthetic stabilization case with the shipped stage; returns the picture as RGBA8 (or unorm16). */
      async stageWarp(options) {
        return warpStageOnPage(page, options)
      },
      async close() {
        await browser.close().catch(() => {})
        await server.close()
      },
    }
  } catch (error) {
    await browser.close().catch(() => {})
    await server.close()
    throw error
  }
}
