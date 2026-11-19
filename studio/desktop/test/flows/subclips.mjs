/**
 * The subclips flow of the packaged e2e (task 1.6), in two halves because the project is closed and the app
 * restarted in between:
 *
 * 1. {@link createSubclipFlow}: in the source monitor, mark an in and an out point and press Alt+S (Create subclip);
 *    the subclip shows in the library's Subclips section; the project is saved.
 * 2. {@link reopenSubclipFlow}: after the restart the project is opened from the projects page; the subclip is in
 *    the library section and valid; it is dragged onto the timeline; the project is exported; the exported file's
 *    duration and frame count are the subclip's range.
 *
 * The clip is a generated 10 s, 25 fps counting test pattern, so the range is exact in frames and a clip that came
 * out whole (10 s) cannot pass.
 */
import path from 'node:path'
import { createProject } from '../feature-pass/lib/ui.mjs'
import { dropFiles } from '../support/drop-files.mjs'
import { makeCountingClip, probeVideo, psnrAgainstSourceFrame } from '../support/flow-media.mjs'
import { exportAndDownload, importClipByDrop } from '../support/flow-page.mjs'
import { dragCardToTimeline, waitForMatchDialog } from '../support/timeline-drag.mjs'

const PROJECT = 'Subclips check'
const SOURCE_FPS = 25

/** Seeks the source monitor by a click at `fraction` of its seek bar; the bar's box is read again each time (an in mark adds a strip above it and moves it). */
async function seekSource(page, fraction) {
  const bar = page.getByTestId('source-monitor-seek-bar')
  const box = await bar.boundingBox()
  if (!box) throw new Error('the source monitor seek bar has no box')
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
  await page.waitForTimeout(500)
}

const listSubclips = (page) => page.evaluate(() => window.studio.subclips.list())

export async function createSubclipFlow({ page, check, observations, work }) {
  const clip = makeCountingClip(path.join(work, 'subclips-count.mp4'))
  await createProject(page, PROJECT)
  await importClipByDrop(page, clip, dropFiles)
  await waitForMatchDialog(page)

  // The source monitor window: double-click the card.
  await page.getByTestId('media-card').first().dblclick()
  await page.getByTestId('source-monitor-seek-bar').waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)
  await seekSource(page, 0.2)
  await page.keyboard.press('i')
  await page.waitForTimeout(300)
  await seekSource(page, 0.5)
  await page.keyboard.press('o')
  await page.waitForTimeout(300)
  await page.keyboard.press('Alt+KeyS')
  await page.locator('[data-subclip-id]').first().waitFor({ timeout: 15000 })

  const subclips = await listSubclips(page)
  const made = subclips[0]
  const frames = made ? made.endFrame - made.startFrame : 0
  observations.subclip = made ?? null
  check(
    'subclips: Alt+S in the source monitor makes a subclip of the marked range, shown in the library',
    subclips.length === 1 && made.valid === true && made.sourceFps === SOURCE_FPS && frames >= 50 && frames <= 100,
    { subclips, frames },
  )

  await page.keyboard.press('ControlOrMeta+s')
  await page.getByText('Project saved').first().waitFor({ timeout: 30000 })
  check('subclips: the project is saved with the subclip', true)
}

export async function reopenSubclipFlow({ page, check, observations, work, nextDownload, savedSubclip }) {
  const clip = path.join(work, 'subclips-count.mp4')
  await page.goto('droneclean://app/projects')
  const card = page.locator('[data-project-card]').filter({ hasText: PROJECT }).first()
  await card.waitFor({ timeout: 120000 })
  await card.dblclick()
  await page.waitForURL(/\/editor\//, { timeout: 120000 })
  await page.locator('[data-subclip-id]').first().waitFor({ timeout: 120000 })

  // The card shows at once; it is valid once the parent file's record is in the library.
  let reopened = await listSubclips(page)
  for (let attempt = 0; attempt < 60 && reopened[0]?.valid !== true; attempt += 1) {
    await page.waitForTimeout(500)
    reopened = await listSubclips(page)
  }
  const same =
    reopened.length === 1 &&
    reopened[0].id === savedSubclip.id &&
    reopened[0].startFrame === savedSubclip.startFrame &&
    reopened[0].endFrame === savedSubclip.endFrame &&
    reopened[0].valid === true
  check('subclips: after closing and reopening the app and the project, the subclip is in the library section', same, {
    saved: savedSubclip,
    reopened,
  })

  await waitForMatchDialog(page)
  const subclipCard = page.locator('[data-subclip-id]').first()
  await dragCardToTimeline(page, savedSubclip.name, observations, { card: subclipCard, dropOffset: 0 })
  await waitForMatchDialog(page)
  await page.waitForFunction(() => document.querySelectorAll('[data-timeline-item][data-item-id]').length > 0, null, {
    timeout: 60000,
  })
  const clips = await page.evaluate(() => window.studio.clips.list())
  const rangeFrames = savedSubclip.endFrame - savedSubclip.startFrame
  const onTimeline = clips.find((entry) => entry.type === 'video')
  check(
    'subclips: the dropped subclip is a clip of the parent with the subclip range',
    clips.length === 1 &&
      onTimeline?.from === 0 &&
      onTimeline?.sourceStart === savedSubclip.startFrame &&
      onTimeline?.sourceEnd === savedSubclip.endFrame,
    {
      clips: clips.map((entry) => ({
        type: entry.type,
        from: entry.from,
        sourceStart: entry.sourceStart,
        sourceEnd: entry.sourceEnd,
        frames: entry.durationInFrames,
      })),
    },
  )

  const exported = await exportAndDownload(page, nextDownload)
  const info = probeVideo(exported.file)
  const expected = rangeFrames / SOURCE_FPS
  observations.subclipExport = { ...exported, ...info, expectedSeconds: expected }
  // The whole file would be 10 s; one frame of the project's rate (30 fps) is 0.034 s.
  check(
    'subclips: the exported duration is the subclip range',
    Math.abs(info.duration - expected) < 0.1 && Math.abs(info.frames - expected * info.fps) <= 1.5,
    { expectedSeconds: expected, duration: info.duration, frames: info.frames, fps: info.fps },
  )

  // And it is the range's pictures: one second into the export is the file's frame `startFrame + 25`, not its frame 25.
  const shifted = savedSubclip.startFrame + SOURCE_FPS
  const atRange = psnrAgainstSourceFrame(exported.file, 1, clip, shifted)
  const unshifted = psnrAgainstSourceFrame(exported.file, 1, clip, SOURCE_FPS)
  observations.subclipExport.psnr = { range: atRange, unshifted }
  check('subclips: one second into the export is the file frame at the subclip start plus one second, not at the file start', atRange > unshifted + 4, {
    frame: shifted,
    psnrAtRange: atRange,
    psnrUnshifted: unshifted,
  })
}
