/**
 * The controls waves 22 and 23 added, clicked in the packaged app (PLAN.md, tonight's N3), on the clip the looks flow
 * left on the timeline:
 *
 * 1. a clip whose file name is DJI's makes the app ask once whether it was shot in D-Log M (5.2), and "No, normal"
 *    closes the question;
 * 2. the clip panel's Curve… opens the speed panel, which shows the frames a second the clip delivers (11.18);
 * 3. Smooth ramp + zoom gives the clip a fast-slow-fast curve with smooth segments and optical flow (11.10, 11.11,
 *    11.24);
 * 4. the Smooth slow motion select offers Frame blending and Optical flow, and choosing one sets the clip's mode
 *    (11.12);
 * 5. with Optical flow, the Motion detail and Hard edges rows appear, and choosing High and Nearest frame stores them
 *    (11.24, option 2b).
 *
 * What each click did is read back through `window.studio`, the SDK the page installs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { makeColourClip } from '../support/flow-media.mjs'
import { importClipByDrop } from '../support/flow-page.mjs'

/** A DJI Avata 2 file name: what the D-Log M question looks for (`_D` is DJI's suffix for both log profiles). */
const DJI_NAME = 'DJI_20261120000000_0001_D.mp4'

const firstClip = (page) => page.locator('[data-timeline-item][data-item-id]').first()

export async function runNewControlsFlow({ page, check, observations, work, dropFiles }) {
  const notes = (observations.newControls = {})

  // 1. The D-Log M question
  const dji = path.join(work, DJI_NAME)
  fs.copyFileSync(makeColourClip(path.join(work, 'controls-colour.mp4')), dji)
  await importClipByDrop(page, dji, dropFiles)
  const question = page.getByText('Were these DJI clips shot in D-Log M?')
  const asked = await question.waitFor({ timeout: 20000 }).then(
    () => true,
    () => false,
  )
  check('controls: importing a DJI clip asks whether it was shot in D-Log M', asked)
  if (asked) {
    await page.getByRole('button', { name: 'No, normal' }).click()
    const closed = await question.waitFor({ state: 'detached', timeout: 10000 }).then(
      () => true,
      () => false,
    )
    check('controls: "No, normal" closes the D-Log M question', closed)
  }

  // 2. The speed panel and its frame-rate readout
  await firstClip(page).click()
  const clipId = await page.evaluate(() => window.studio.clips.list().find((item) => item.type === 'video')?.id ?? null)
  notes.clipId = clipId
  if (!clipId) {
    check('controls: a video clip is on the timeline', false)
    return
  }
  await page.getByRole('button', { name: 'Curve…' }).click()
  const panel = page.getByTestId('speed-curve-panel')
  const opened = await panel.waitFor({ timeout: 15000 }).then(
    () => true,
    () => false,
  )
  check('controls: Curve… opens the speed panel', opened)
  if (!opened) return
  const readout = await page
    .getByTestId('speed-readout-fps')
    .innerText({ timeout: 5000 })
    .catch(() => null)
  notes.fpsReadout = readout
  check('controls: the speed panel shows the frames a second the clip delivers', readout !== null && /\d/.test(readout), {
    readout,
  })

  // 3. Smooth ramp + zoom
  const lengthBefore = await page.evaluate((id) => window.studio.clips.get(id).durationInFrames, clipId)
  await page.getByRole('button', { name: 'Smooth ramp + zoom' }).click()
  const smoothed = await page
    .waitForFunction(
      (id) => {
        const curve = window.studio.clips.getSpeedCurve(id)
        if (!curve || !curve.keys?.length) return null
        return {
          keys: curve.keys,
          blur: window.studio.clips.getMotionBlur(id),
          length: window.studio.clips.get(id).durationInFrames,
        }
      },
      clipId,
      { timeout: 15000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null)
  notes.smoothEdit = { lengthBefore, ...smoothed }
  check(
    'controls: Smooth ramp + zoom gives the clip a fast-slow-fast curve with smooth segments and optical flow',
    smoothed !== null &&
      smoothed.keys.some((key) => key.ease === 'smooth') &&
      Math.max(...smoothed.keys.map((key) => key.speed)) > 1 &&
      Math.min(...smoothed.keys.map((key) => key.speed)) < 1 &&
      smoothed.blur?.smoothSlowMotion === 'optical-flow',
    notes.smoothEdit,
  )

  // 4. Smooth slow motion's select: the recipe left the clip on Optical flow, so Frame blending is chosen, then Optical
  // flow again, each read back through the SDK
  const choose = async (label, wanted) => {
    await page.getByTestId('motion-blur-smooth-slow').click()
    await page.getByRole('option', { name: label }).click()
    return page
      .waitForFunction((args) => window.studio.clips.getMotionBlur(args.id)?.smoothSlowMotion === args.wanted, { id: clipId, wanted }, {
        timeout: 10000,
      })
      .then(
        () => wanted,
        () => page.evaluate((id) => window.studio.clips.getMotionBlur(id)?.smoothSlowMotion ?? null, clipId),
      )
  }
  const blended = await choose('Frame blending', 'blend')
  const mode = await choose('Optical flow', 'optical-flow')
  notes.smoothSlowMotion = { blended, mode }
  check('controls: Frame blending can be chosen for smooth slow motion', blended === 'blend', { blended })
  check('controls: Optical flow can be chosen for smooth slow motion', mode === 'optical-flow', { mode })

  // 5. Optical flow's two rows: High detail, then Nearest frame, each read back through the SDK
  const tune = async (testId, label, field, wanted) => {
    await page.getByTestId(testId).click()
    await page.getByRole('option', { name: label }).click()
    return page
      .waitForFunction((args) => window.studio.clips.getMotionBlur(args.id)?.[args.field] === args.wanted, { id: clipId, field, wanted }, {
        timeout: 10000,
      })
      .then(
        () => wanted,
        () => page.evaluate((args) => window.studio.clips.getMotionBlur(args.id)?.[args.field] ?? null, { id: clipId, field }),
      )
  }
  const detail = await tune('motion-blur-flow-detail', 'High', 'flowDetail', 'high')
  const edges = await tune('motion-blur-flow-edges', 'Nearest frame', 'flowEdges', 'nearest')
  notes.opticalFlowSettings = { detail, edges }
  check('controls: Motion detail can be set to High under Optical flow', detail === 'high', { detail })
  check('controls: Hard edges can be set to Nearest frame under Optical flow', edges === 'nearest', { edges })
}
