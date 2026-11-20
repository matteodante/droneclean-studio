// Moving a media card onto the timeline with real mouse events, shared by the e2e and its flows (looks, subclips).
// Moved out of `e2e.mjs`; the drop point is written into the `observations` the caller passes, and the drop's
// distance from the track's left edge is a parameter (40 px by default, as it was).
import { answerMatchDialog } from '../feature-pass/lib/ui.mjs'

async function timelineDropPoint(page, dropOffset) {
  return page.evaluate((offset) => {
    const bands = [...document.querySelectorAll('[data-timeline-drop-target]')]
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          element,
          rect,
          trackId: element.getAttribute('data-track-id'),
          visible: rect.height >= 40 && rect.width > 200 && rect.top > 0 && rect.bottom < innerHeight,
        }
      })
      .filter((band) => band.visible)
    const band = bands[0]
    if (!band) return null
    // Near the start of the track: a clip dropped past the end of the content is not
    // something a pilot does, and the editor refuses it ("no compatible track").
    // Vertically, the middle of the part of the band the pointer can actually reach: the
    // ruler and the composition tabs can cover the top of a track element, so its own
    // middle may be under them. Hit-test the band's column every 2 px and take the middle
    // of the longest run of points that land in the band.
    const x = Math.round(band.rect.x + offset)
    let best = null
    let run = null
    for (let y = Math.ceil(band.rect.top); y < band.rect.bottom; y += 2) {
      const hit = document.elementFromPoint(x, y)
      if (hit && band.element.contains(hit)) {
        run = run ?? { from: y, to: y }
        run.to = y
        if (!best || run.to - run.from > best.to - best.from) best = { ...run }
      } else {
        run = null
      }
    }
    const y = best ? (best.from + best.to) / 2 : band.rect.y + band.rect.height / 2
    return {
      x,
      y: Math.round(y),
      trackId: band.trackId,
      bands: bands.map((entry) => ({
        trackId: entry.trackId,
        x: Math.round(entry.rect.x),
        y: Math.round(entry.rect.y),
        width: Math.round(entry.rect.width),
        height: Math.round(entry.rect.height),
      })),
    }
  }, dropOffset)
}

/** The media card of `fileName`: the element that owns the card's `dragstart` handler (`data-testid="media-card"`). */
function mediaCardOf(page, fileName) {
  return page.getByTestId('media-card').filter({ hasText: fileName }).first()
}

/**
 * Waits until the card is fully drawn: its thumbnail is decoded and its box has not moved for 300 ms. A card that
 * is still loading its thumbnail changes size when the picture arrives, and a drag begun from a box measured
 * before that grabs whatever is under the pointer afterwards.
 */
async function waitForCardSettled(page, fileName) {
  const card = mediaCardOf(page, fileName)
  await card.waitFor({ timeout: 60000 })
  const handle = await card.elementHandle()
  await page.waitForFunction(
    (element) => {
      const image = element.querySelector('img')
      return Boolean(image) && image.complete && image.naturalWidth > 0
    },
    handle,
    { timeout: 60000 },
  )
  await waitForBoxSteady(page, card, fileName)
}

/** Waits until the card's box has not moved for 300 ms. */
async function waitForBoxSteady(page, card, label) {
  let previous = null
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const box = await card.boundingBox()
    const key = box ? [box.x, box.y, box.width, box.height].map(Math.round).join() : null
    if (key !== null && key === previous) return
    previous = key
    await page.waitForTimeout(300)
  }
  throw new Error(`the card of ${label} did not settle`)
}

/**
 * Drags the media card onto the timeline with mouse events (Chromium starts the HTML5 drag). The drag starts on the
 * card that owns the `dragstart` handler, and the payload the handler put on the drag is checked in the page
 * before the pointer goes to the timeline: a drag that does not carry the media item is never dropped.
 */
export async function dragCardToTimeline(page, fileName, observations = {}, { card = null, dropOffset = 40 } = {}) {
  // A subclip card is not a media card: the caller passes its locator, and `fileName` is the name its drag carries.
  if (card) {
    await card.waitFor({ timeout: 60000 })
    await waitForBoxSteady(page, card, fileName)
  } else {
    await waitForCardSettled(page, fileName)
  }
  const cardOf = () => card ?? mediaCardOf(page, fileName)
  await page.evaluate(() => {
    window.__e2eDrag = []
    window.__e2ePayload = null
    if (window.__e2eDragListeners) return
    window.__e2eDragListeners = true
    for (const type of ['dragstart', 'drop', 'dragend']) {
      // Bubble phase, after React's root listener has run the card's handler and set the payload.
      document.addEventListener(type, (event) => {
        let payload = null
        if (type === 'dragstart') {
          try {
            payload = JSON.parse(event.dataTransfer?.getData('application/json') || 'null')
          } catch {
            payload = null
          }
          window.__e2ePayload = payload
        }
        window.__e2eDrag.push({
          type,
          target: event.target?.tagName + '.' + String(event.target?.className).slice(0, 40),
          inDropTarget: Boolean(event.target?.closest?.('[data-timeline-drop-target]')),
          types: event.dataTransfer ? [...event.dataTransfer.types] : [],
          payload,
        })
      })
    }
  })
  // The pointer moves that start an HTML5 drag: on Windows the system's drag loop sometimes does not start from
  // synthetic moves (no dragstart at all, measured on the PC on 20 Nov 2026), so a drag that did not start is begun
  // again, up to three times. A drag that started with the wrong payload is never retried.
  let payload = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const cardBox = await cardOf().boundingBox()
    if (!cardBox) throw new Error('the media card has no box')
    const cx = cardBox.x + cardBox.width / 2
    const cy = cardBox.y + cardBox.height / 2
    await page.evaluate(() => {
      window.__e2ePayload = null
    })
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.waitForTimeout(100)
    await page.mouse.move(cx + 8, cy + 8, { steps: 4 })
    await page.waitForTimeout(100)
    await page.mouse.move(cx + 28, cy + 28, { steps: 6 })
    await page.waitForTimeout(100)
    payload = await page.evaluate(() => window.__e2ePayload)
    observations.dragAttempts = attempt
    if (payload !== null) break
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
  if (payload?.type !== 'media-item' || payload.fileName !== fileName) {
    await page.mouse.up()
    throw new Error(`the drag does not carry the media item of ${fileName}: ${JSON.stringify(payload)}`)
  }
  // The timeline can still move while the drag is under way (a toast above it comes and goes and shifts it by
  // the toast's height). Release only when the band has not moved between two measurements 300 ms apart: a
  // drop that lands below the track hits another track.
  let band = null
  let steady = false
  for (let attempt = 0; attempt < 20 && !steady; attempt += 1) {
    const next = await timelineDropPoint(page, dropOffset)
    if (!next) {
      await page.mouse.up()
      throw new Error('the timeline drop band was not found')
    }
    steady = band !== null && next.x === band.x && next.y === band.y && next.trackId === band.trackId
    band = next
    await page.mouse.move(band.x, band.y, { steps: attempt === 0 ? 25 : 3 })
    await page.waitForTimeout(300)
  }
  if (!steady) {
    await page.mouse.up()
    throw new Error(`the timeline did not hold still under the drag: ${JSON.stringify(band)}`)
  }
  // The composition tabs row above the timeline can appear after the band held still (51 px), so measure once more
  // right before the release and follow the band until two reads agree.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const last = await timelineDropPoint(page, dropOffset)
    if (last && last.x === band.x && last.y === band.y && last.trackId === band.trackId) break
    if (last) band = last
    await page.mouse.move(band.x, band.y, { steps: 3 })
    await page.waitForTimeout(300)
  }
  observations.dropPoint = band
  // A last small move, so the page sees a fresh dragover over the track just before the release.
  await page.mouse.move(band.x, band.y + 2, { steps: 3 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(500)
  return page.evaluate(() => ({
    events: window.__e2eDrag,
    toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((toast) =>
      (toast.textContent ?? '').trim().slice(0, 120),
    ),
  }))
}

/** Answers the dialog if it shows within 3 s (it does not always: the editor decides when to ask). */
export async function waitForMatchDialog(page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await answerMatchDialog(page)) return true
    await page.waitForTimeout(500)
  }
  return false
}

