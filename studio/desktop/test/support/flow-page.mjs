// Page-side helpers of the e2e flows: reading what the preview shows, saving the editor's downloads to a folder, and
// the export dialog. Everything goes through the real interface (clicks, keys, files dropped) and the real
// Electron download path; nothing here calls the editor's code.
import fs from 'node:fs'
import path from 'node:path'

/**
 * The mean colour of a small square of the screen around (x, y) in page pixels, as [r, g, b]. It is read from a
 * screenshot, so it is what is drawn on screen (the preview's canvases, whichever of them is on top), not what
 * one canvas holds.
 */
export async function screenColour(page, x, y, half = 6) {
  const png = await page.screenshot({
    clip: { x: Math.round(x) - half, y: Math.round(y) - half, width: half * 2, height: half * 2 },
  })
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const sum = [0, 0, 0]
    const count = data.length / 4
    for (let index = 0; index < data.length; index += 4) {
      sum[0] += data[index]
      sum[1] += data[index + 1]
      sum[2] += data[index + 2]
    }
    return sum.map((total) => Math.round(total / count))
  }, png.toString('base64'))
}

/**
 * Makes every download of the app land in `folder` without a dialog: the main process's `will-download` sets the
 * save path. Returns a function that waits for the next finished download and gives its path.
 */
export async function routeDownloadsTo(app, folder) {
  fs.mkdirSync(folder, { recursive: true })
  await app.evaluate(({ session, dialog }, target) => {
    globalThis.__e2eDownloadFolder = target
    // The desktop export asks for its destination with the native save dialog (task 3.5), which a script cannot
    // click: answer it with a path in the same folder, and keep what was chosen.
    if (!globalThis.__e2eSaves) {
      globalThis.__e2eSaves = []
      dialog.showSaveDialog = async (...args) => {
        const options = args.find((arg) => arg && typeof arg === 'object' && !('webContents' in arg)) ?? {}
        // The file name alone: Windows hands a path with backslashes (C:\Users\...\Downloads\name.mp4)
        const name = String(options.defaultPath || 'export.mp4').split(/[\\/]/).pop()
        const filePath = `${globalThis.__e2eDownloadFolder}/${name}`
        globalThis.__e2eSaves.push(filePath)
        return { canceled: false, filePath }
      }
    }
    if (globalThis.__e2eDownloads) return
    globalThis.__e2eDownloads = []
    session.defaultSession.on('will-download', (_event, item) => {
      const record = { file: `${globalThis.__e2eDownloadFolder}/${item.getFilename()}`, state: 'started' }
      globalThis.__e2eDownloads.push(record)
      item.setSavePath(record.file)
      item.once('done', (_done, state) => {
        record.state = state
      })
    })
  }, folder)
  let seen = await app.evaluate(() => globalThis.__e2eDownloads.length)
  const nextDownload = async function nextDownload(timeout = 120000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const downloads = await app.evaluate(() => globalThis.__e2eDownloads)
      const record = downloads[seen]
      if (record && record.state !== 'started') {
        seen += 1
        if (record.state !== 'completed') throw new Error(`the download ${record.file} ended as ${record.state}`)
        return record.file
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    throw new Error('no download finished in time')
  }
  /** The path the last stubbed save dialog answered, or null. */
  nextDownload.lastSaved = () => app.evaluate(() => globalThis.__e2eSaves.at(-1) ?? null)
  return nextDownload
}

/**
 * A point of the main preview to read a colour from: the largest visible canvas or video of the preview area, a quarter of the
 * way in from its top-left corner (the centre holds the selected clip's anchor handle), in page pixels.
 */
export async function previewSamplePoint(page) {
  return page.evaluate(() => {
    // A canvas when the picture goes through the renderer, a <video> when FreeCut plays a plain clip directly: the
    // colour is read from the screen, so either is a valid place to read it.
    const boxes = [...document.querySelectorAll('canvas, video')]
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ canvas, rect }) => rect.width > 200 && rect.height > 100 && getComputedStyle(canvas).visibility !== 'hidden')
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
    const best = boxes[0]
    return best ? { x: best.rect.x + best.rect.width * 0.25, y: best.rect.y + best.rect.height * 0.25 } : null
  })
}

/**
 * Exports the timeline and saves the file: Export, Export Video (menu item), the preset's button when `preset` names
 * one (else the dialog's own defaults), Export Video (dialog button), wait for the finished dialog, then Download (web)
 * or the file it saved to (desktop). Returns the saved file's path, the dialog's text at the end and, with a preset,
 * whether its button was pressed and the numbers the dialog showed for it.
 */
export async function exportAndDownload(page, nextDownload, { timeout = 300000, preset } = {}) {
  // The toolbar's Export button opens a menu (Export Video, Download Project); the item opens the dialog.
  await page.getByRole('button', { name: 'Export', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Export Video' }).click()
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor({ timeout: 30000 })
  let chosen = null
  if (preset) {
    const button = dialog.getByRole('button', { name: preset, exact: true })
    await button.click()
    chosen = {
      pressed: (await button.getAttribute('aria-pressed')) === 'true',
      numbers: await dialog.getByTestId('export-preset-numbers').innerText({ timeout: 5000 }).catch(() => null),
    }
  }
  await dialog.getByRole('button', { name: 'Export Video' }).click()
  // The web build ends with a Download button; the desktop app writes straight to the chosen file (task 3.5) and
  // ends with "Saved to <path>".
  const ended = await Promise.race([
    dialog.getByRole('button', { name: 'Download' }).waitFor({ timeout }).then(() => 'download', () => null),
    dialog.getByText(/Saved to/).first().waitFor({ timeout }).then(() => 'saved', () => null),
  ])
  if (!ended) throw new Error('the export did not finish in time')
  const finished = (await dialog.innerText()).replace(/\s+/g, ' ')
  let file
  if (ended === 'download') {
    const waiting = nextDownload()
    await dialog.getByRole('button', { name: 'Download' }).click()
    file = await waiting
  } else {
    file = await nextDownload.lastSaved()
    if (!file || !fs.existsSync(file)) throw new Error(`the export says it saved, but no file is at ${file}`)
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
  await dialog.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  return { file, finished: finished.slice(0, 200), bytes: fs.statSync(file).size, name: path.basename(file), preset: chosen }
}

/** A PNG of what the main preview shows on screen (the largest visible canvas or video of the preview area). */
export async function previewPicture(page) {
  const box = await page.evaluate(() => {
    const best = [...document.querySelectorAll('canvas, video')]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 200 && rect.height > 100)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0]
    return best ? { x: best.x, y: best.y, width: best.width, height: best.height } : null
  })
  if (!box) throw new Error('no preview picture on screen')
  return page.screenshot({ clip: box })
}

/**
 * How different two preview PNGs of the same size are: the mean absolute difference of their red, green and blue,
 * 0 (identical) to 255; and the mean colour of a region { x, y, w, h } (fractions) of the second one, when given.
 */
export async function pictureDifference(page, before, after, region) {
  return page.evaluate(
    async ({ a, b, region: area }) => {
      const decode = async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [first, second] = [await decode(a), await decode(b)]
      if (first.width !== second.width || first.height !== second.height) return { difference: null }
      let sum = 0
      for (let index = 0; index < first.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) sum += Math.abs(first.data[index + channel] - second.data[index + channel])
      }
      const result = { difference: sum / ((first.data.length / 4) * 3) }
      if (area) {
        const totals = [0, 0, 0]
        let count = 0
        const x0 = Math.round(area.x * second.width)
        const y0 = Math.round(area.y * second.height)
        for (let y = y0; y < y0 + Math.round(area.h * second.height); y += 1) {
          for (let x = x0; x < x0 + Math.round(area.w * second.width); x += 1) {
            const index = (y * second.width + x) * 4
            for (let channel = 0; channel < 3; channel += 1) totals[channel] += second.data[index + channel]
            count += 1
          }
        }
        result.region = totals.map((total) => Math.round(total / count))
      }
      return result
    },
    { a: before.toString('base64'), b: after.toString('base64'), region },
  )
}

/** The media panel's empty-area centre, where a file dropped is imported (the same point `e2e.mjs` drops on). */
async function mediaPanelCentre(page) {
  return page.evaluate(() => {
    const container = document.querySelector('div.relative.h-full.overflow-y-auto.px-4.pb-4')
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return { x: Math.round(rect.x + Math.min(120, rect.width / 2)), y: Math.round(rect.y + 60) }
  })
}

/**
 * Imports a disk file into the project's media library by dropping it on the media panel, and waits until its card
 * shows the duration (the media has been probed, so the timeline can place it).
 */
export async function importClipByDrop(page, file, dropFiles) {
  const panel = await mediaPanelCentre(page)
  if (!panel) throw new Error('the media library panel was not found')
  await dropFiles(page, panel.x, panel.y, [file])
  const name = path.basename(file)
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 300000 })
  await page.waitForFunction(
    (fileName) => {
      const card = [...document.querySelectorAll('[data-testid="media-card"]')].find((element) =>
        element.textContent?.includes(fileName),
      )
      return Boolean(card) && /\d+:\d\d/.test(card.textContent ?? '')
    },
    name,
    { timeout: 300000 },
  )
}
