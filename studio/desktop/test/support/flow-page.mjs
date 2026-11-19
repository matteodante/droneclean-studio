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
        const name = String(options.defaultPath || 'export.mp4').split('/').pop()
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
 * Exports the timeline with the export dialog's own defaults and saves the file: Export, Export Video (menu item),
 * Export Video (dialog button), wait for the finished dialog, then Download (web) or the file it saved to (desktop). Returns the saved file's path and the dialog's text at the end.
 */
export async function exportAndDownload(page, nextDownload, { timeout = 300000 } = {}) {
  // The toolbar's Export button opens a menu (Export Video, Download Project); the item opens the dialog.
  await page.getByRole('button', { name: 'Export', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Export Video' }).click()
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor({ timeout: 30000 })
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
  return { file, finished: finished.slice(0, 200), bytes: fs.statSync(file).size, name: path.basename(file) }
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
