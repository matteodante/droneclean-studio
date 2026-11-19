/**
 * The looks flow of the packaged e2e (task 5.2): a `.cube` the test makes is added to the looks library, chosen on a
 * clip, seen in the preview, exported, seen in the exported file, and undone.
 *
 * The clip is flat (200, 80, 40) and the look swaps red and blue, so the three readings are unmistakable: the
 * preview before the look is the clip's own colour, after the look it is the same colour with red and blue swapped,
 * and the exported frame has the swapped colour too. The preview is read from a screenshot (what the user sees);
 * the exported frame is read by FFmpeg from the file the Download button saved.
 */
import path from 'node:path'
import {
  LOOK_CLIP_RGB,
  colourWithin,
  frameColour,
  makeColourClip,
  probeVideo,
  swapRedBlue,
  writeSwapCube,
} from '../support/flow-media.mjs'
import {
  exportAndDownload,
  importClipByDrop,
  previewSamplePoint,
  screenColour,
} from '../support/flow-page.mjs'
import { createProject } from '../feature-pass/lib/ui.mjs'
import { dragCardToTimeline, waitForMatchDialog } from '../support/timeline-drag.mjs'
import { dropFiles } from '../support/drop-files.mjs'

/** How far a read colour may be from the expected one, per channel (8-bit): the preview's and the export's own rounding. */
const PREVIEW_TOLERANCE = 12
const EXPORT_TOLERANCE = 20

/** The drop is at the track's left edge: the clip lands on frame 0, so the export is the clip and nothing before it. */
const START_OFFSET = 0

const selectedClip = (page) => page.locator('[data-timeline-item][data-item-id]').first()

/** The transport's current time, for the notes. */
const playhead = (page) => page.evaluate(() => document.body.innerText.match(/\d\d:\d\d:\d\d/)?.[0] ?? null)

/** Reads the preview colour once the picture has settled (two reads 400 ms apart agree). */
async function settledPreviewColour(page) {
  const point = await previewSamplePoint(page)
  if (!point) throw new Error('the preview canvas was not found')
  let previous = await screenColour(page, point.x, point.y)
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.waitForTimeout(400)
    const next = await screenColour(page, point.x, point.y)
    if (colourWithin(next, previous, 2)) return next
    previous = next
  }
  return previous
}

export async function runLooksFlow({ page, check, observations, work, nextDownload }) {
  const clip = makeColourClip(path.join(work, 'looks-colour.mp4'))
  const cube = writeSwapCube(path.join(work, 'looks-swap.cube'))
  const expectedSwap = swapRedBlue(LOOK_CLIP_RGB)

  await createProject(page, 'Looks check')
  await importClipByDrop(page, clip, dropFiles)
  await waitForMatchDialog(page)
  await dragCardToTimeline(page, path.basename(clip), observations, { dropOffset: START_OFFSET })
  await waitForMatchDialog(page)
  await page.waitForFunction(() => document.querySelectorAll('[data-timeline-item][data-item-id]').length > 0, null, {
    timeout: 60000,
  })
  // One click on the clip's body selects it and puts the playhead inside it (the project's first frames are empty).
  // After that nothing in the flow clicks the clip again: the playhead must stay where this click left it.
  await selectedClip(page).click()
  await page.getByTestId('looks-section').waitFor({ timeout: 30000 })
  // The transport shows the frame under the pointer while it hovers a clip (skimming); read the playhead only once
  // the pointer is off the timeline.
  await page.getByTestId('looks-section').hover()
  check('looks: the clip panel shows the Looks section for a selected clip', true)

  // Before a look: the preview shows the clip's own colour.
  const baseline = await settledPreviewColour(page)
  observations.looks = { clipRgb: LOOK_CLIP_RGB, previewBefore: baseline, playheadBefore: await playhead(page) }
  check('looks: the preview shows the clip colour before any look', colourWithin(baseline, LOOK_CLIP_RGB, PREVIEW_TOLERANCE), {
    expected: LOOK_CLIP_RGB,
    read: baseline,
  })

  // The library: Manage looks, drop the .cube on the dialog. Opening a dropdown must never move the playhead.
  const trace = (observations.looks.playheadTrace = [])
  const frameBefore = await playhead(page)
  await page.getByTestId('look-select').click()
  trace.push(['select opened', await playhead(page)])
  check('looks: opening the Looks select leaves the playhead where it was', trace.at(-1)[1] === frameBefore, {
    before: frameBefore,
    after: trace.at(-1)[1],
  })
  await page.getByTestId('look-manage').click()
  const zone = page.getByTestId('looks-drop-zone')
  await zone.waitFor({ timeout: 15000 })
  trace.push(['library opened', await playhead(page)])
  const box = await zone.boundingBox()
  await dropFiles(page, box.x + box.width / 2, box.y + box.height / 2, [cube])
  await page.getByTestId('look-row').first().waitFor({ timeout: 30000 })
  trace.push(['cube dropped', await playhead(page)])
  const rows = await page.getByTestId('look-row').allInnerTexts()
  const errors = await page.getByTestId('looks-error').allInnerTexts()
  check('looks: the .cube is added to the library', rows.length === 1 && /swap/i.test(rows[0]) && errors.length === 0, {
    rows,
    errors,
  })
  await page.keyboard.press('Escape')
  await page.getByTestId('looks-library-dialog').waitFor({ state: 'detached', timeout: 15000 })
  trace.push(['library closed', await playhead(page)])

  // Choose it on the clip.
  await page.getByTestId('look-select').click()
  await page.getByRole('option', { name: /swap/i }).click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="look-select"]')?.textContent?.match(/swap/i) !== null,
    null,
    { timeout: 15000 },
  )
  trace.push(['look chosen', await playhead(page)])
  check('looks: opening and choosing in the Looks select leaves the playhead where it was', trace.at(-1)[1] === frameBefore, {
    before: frameBefore,
    after: trace.at(-1)[1],
    trace,
  })
  const shown = {
    select: (await page.getByTestId('look-select').innerText()).trim(),
    intensity: await page.getByTestId('looks-section').innerText().then((text) => text.match(/\d+%/)?.[0] ?? null),
  }
  check('looks: the clip panel shows the chosen look at 100 %', /swap/i.test(shown.select) && shown.intensity === '100%', shown)

  // The preview changed the way the look says.
  let during = await settledPreviewColour(page)
  for (let attempt = 0; attempt < 10 && !colourWithin(during, expectedSwap, PREVIEW_TOLERANCE); attempt += 1) {
    during = await settledPreviewColour(page)
  }
  observations.looks.previewWith = during
  check('looks: the preview shows red and blue swapped with the look on', colourWithin(during, expectedSwap, PREVIEW_TOLERANCE), {
    expected: expectedSwap,
    read: during,
    before: baseline,
  })

  // Export with the look, and read the exported frame's colour.
  const exported = await exportAndDownload(page, nextDownload)
  const info = probeVideo(exported.file)
  const colour = frameColour(exported.file, 1)
  observations.looks.export = { ...exported, ...info, frameColour: colour }
  check('looks: the exported file is a 3 s H.264 video', info.codec === 'h264' && Math.abs(info.duration - 3) < 0.2, info)
  check('looks: the exported frame has red and blue swapped', colourWithin(colour, expectedSwap, EXPORT_TOLERANCE) && colour[0] < colour[2], {
    expected: expectedSwap,
    read: colour,
  })

  // Undo: the look is gone from the clip and the preview is the clip's colour again.
  await page.keyboard.press('ControlOrMeta+z')
  await page.waitForFunction(
    () => /none/i.test(document.querySelector('[data-testid="look-select"]')?.textContent ?? ''),
    null,
    { timeout: 15000 },
  )
  const afterSelect = (await page.getByTestId('look-select').innerText()).trim()
  check('looks: undo removes the look from the clip', /none/i.test(afterSelect), { select: afterSelect })
  let after = await settledPreviewColour(page)
  for (let attempt = 0; attempt < 10 && !colourWithin(after, baseline, PREVIEW_TOLERANCE); attempt += 1) {
    after = await settledPreviewColour(page)
  }
  observations.looks.previewAfterUndo = after
  check('looks: the preview shows the clip colour again after undo', colourWithin(after, baseline, PREVIEW_TOLERANCE), {
    expected: baseline,
    read: after,
  })
}
