/**
 * The interactions the feature scripts share: opening the sidebar tabs, creating a project, importing media by a
 * drop, placing a clip on the timeline with a mouse drag, reading toasts. Selectors come from the editor's own
 * markup and English strings (`src/i18n/locales/partials/en`); the pass sets the language to English first.
 */
import path from 'node:path'
import { dropFiles } from '../../support/drop-files.mjs'

export const LANGUAGE_KEY = 'freecut-language'

export async function toasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((toast) => (toast.textContent ?? '').trim().slice(0, 160)))
}

export async function pageText(page, limit = 600) {
  return page.evaluate((max) => document.body.innerText.replace(/\s+/g, ' ').slice(0, max), limit)
}

export async function closeDialogs(page) {
  for (let index = 0; index < 3; index += 1) {
    const open = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')))
    if (!open) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}

export async function onEditor(page) {
  return /\/editor\//.test(page.url())
}

/** Opens a sidebar tab by its tooltip label (Media, Text, Shapes, Effects, Transitions, Lottie, Transcript, AI). */
export async function openTab(page, label) {
  const button = page.locator(`button[data-tooltip="${label}"]`).first()
  await button.waitFor({ timeout: 30000 })
  // The panel's header text exists even when the panel is collapsed to zero width, so measure the panel itself.
  const headerShown = () =>
    page.evaluate((text) => {
      const header = [...document.querySelectorAll('span.text-sm.font-medium')].find((span) => span.textContent?.trim() === text)
      const panel = header?.closest('.panel-bg')
      return Boolean(panel) && panel.getBoundingClientRect().width > 100
    }, label)
  await button.click()
  await page.waitForTimeout(500)
  if (!(await headerShown())) {
    await button.click()
    await page.waitForTimeout(500)
  }
  if (!(await headerShown())) throw new Error(`the ${label} tab did not open`)
  // The Media tab has a Media / Scenes switch that remembers the last view: the media cards exist only in "Media".
  if (label === 'Media') {
    const segment = page.locator('.panel-bg button, .panel-bg [role="tab"]').filter({ hasText: /^Media$/ }).first()
    if (await segment.isVisible().catch(() => false)) {
      await segment.click()
      await page.waitForTimeout(400)
    }
  }
}

export async function createProject(page, name) {
  await page.goto('droneclean://app/projects')
  await page.waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, { timeout: 120000 })
  await page.locator('a[href="/projects/new"]').first().click({ timeout: 30000 })
  await page.waitForURL(/\/projects\/new/, { timeout: 60000 })
  await page.fill('#name', name)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/editor\//, { timeout: 120000 })
  await page.waitForTimeout(3000)
}

async function mediaPanelCentre(page) {
  return page.evaluate(() => {
    const container = document.querySelector('div.relative.h-full.overflow-y-auto.px-4.pb-4')
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return { x: Math.round(rect.x + Math.min(120, rect.width / 2)), y: Math.round(rect.y + 60) }
  })
}

/**
 * After the first video of a project the editor asks "Match Project To First Video?" in a modal that blocks
 * every other click. The pass answers "Keep Current" (the user's choice to keep the 1920x1080 canvas).
 */
export async function answerMatchDialog(page) {
  const dialog = page.getByRole('dialog').filter({ hasText: /match project to first video/i })
  if (await dialog.first().isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /keep current/i }).click()
    await page.waitForTimeout(500)
    return true
  }
  return false
}

/** Waits for a card with this file name, answering the "match project" modal the import waits on. */
async function waitForCard(page, fileName, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await answerMatchDialog(page)
    if (await page.locator('[draggable="true"]').filter({ hasText: fileName }).first().isVisible().catch(() => false)) return true
    await page.waitForTimeout(700)
  }
  return false
}

/** Drops files on the media library and waits until each card shows its duration (the media was probed). */
export async function importByDrop(page, files) {
  await openTab(page, 'Media')
  // A project that has just been opened is not always ready for a drop: try again once if no card appears.
  const firstName = path.basename(files[0])
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(2000)
    const centre = await mediaPanelCentre(page)
    if (!centre) throw new Error('the media library panel was not found')
    await dropFiles(page, centre.x, centre.y, files)
    const appeared = await waitForCard(page, firstName, 25000)
    if (appeared) break
    if (attempt === 1) throw new Error(`no media card for ${firstName} appeared after two drops`)
  }
  for (const file of files) {
    const name = path.basename(file)
    if (!(await waitForCard(page, name, 120000))) throw new Error(`no media card for ${name}`)
    await page.waitForFunction(
      (fileName) => {
        const card = [...document.querySelectorAll('[draggable="true"]')].find((element) => element.textContent?.includes(fileName))
        return Boolean(card) && /\d+:\d\d/.test(card.textContent ?? '')
      },
      name,
      { timeout: 120000 },
    )
  }
  await answerMatchDialog(page)
}

export function mediaCard(page, fileName) {
  return page.locator('[draggable="true"]').filter({ hasText: fileName }).first()
}

export async function clipCount(page) {
  return page.evaluate(() => document.querySelectorAll('[data-timeline-item][data-item-id]').length)
}

async function timelineDropPoint(page, section) {
  return page.evaluate((wanted) => {
    const scope = wanted ? document.querySelector(`[data-track-section-scroll="${wanted}"]`) ?? document : document
    const collect = (root) =>
      [...root.querySelectorAll('[data-timeline-drop-target]')]
        .map((element) => ({ rect: element.getBoundingClientRect() }))
        .filter((band) => band.rect.height >= (wanted === 'audio' ? 18 : 40) && band.rect.width > 200 && band.rect.top > 0 && band.rect.top < innerHeight - 20)
    // An empty audio section may have no drop band of its own: the timeline's empty-state drop zone takes the file.
    const band = collect(scope)[0] ?? collect(document)[0]
    return band ? { x: Math.round(band.rect.x + 40), y: Math.round(band.rect.y + Math.min(band.rect.height, innerHeight - band.rect.y - 4) / 2) } : null
  }, section)
}

/** Drags a media card onto the first visible track with real mouse events. */
export async function dragCardToTimeline(page, fileName, section = null) {
  await openTab(page, 'Media')
  const card = mediaCard(page, fileName)
  const box = await card.boundingBox()
  const band = await timelineDropPoint(page, section)
  if (!box || !band) throw new Error('the media card or the timeline drop band was not found')
  const before = await clipCount(page)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.move(cx + 8, cy + 8, { steps: 4 })
  await page.waitForTimeout(100)
  await page.mouse.move(cx + 28, cy + 28, { steps: 6 })
  await page.waitForTimeout(100)
  await page.mouse.move(band.x, band.y, { steps: 25 })
  await page.waitForTimeout(300)
  await page.mouse.move(band.x, band.y + 2, { steps: 3 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(800)
  await page.waitForFunction((count) => document.querySelectorAll('[data-timeline-item][data-item-id]').length > count, before, { timeout: 15000 })
}

/** Right-clicks the nth timeline clip and returns once the context menu is open. */
export async function openClipMenu(page, index = 0) {
  const clip = page.locator('[data-timeline-item][data-item-id]').nth(index)
  await clip.scrollIntoViewIfNeeded()
  await clip.click({ button: 'right' })
  await page.getByRole('menu').first().waitFor({ timeout: 10000 })
}

export async function openCardMenu(page, fileName) {
  await openTab(page, 'Media')
  await mediaCard(page, fileName).click({ button: 'right' })
  await page.getByRole('menu').first().waitFor({ timeout: 10000 })
}

export async function clickMenuItem(page, name) {
  const item = page.getByRole('menuitem', { name }).first()
  await item.waitFor({ timeout: 10000 })
  await item.click()
}
