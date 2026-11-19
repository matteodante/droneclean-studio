/* eslint-disable no-console -- a command-line tool */
// 14. The stabilization controls in a real browser (task 6.4): the clip panel's own section (component, hook, timeline
// store) mounted in the benchmark page over a clip, with the real gyro engine behind it and the render path drawing the
// clip from what the section stores. A mouse and a keyboard drive it (Playwright); each step draws output frame 1000 and
// hashes the PNG, so "changes the picture" is a fact and not a look.
//
//   node bench/run.mjs stabilization-controls     (opt-in; a few minutes; copies the 3.76 GB clip into the browser's storage)
//
//  - Clip 0020, the original file: the switch on (the engine opens, the controls appear), smoothness, horizon lock, horizon
//    roll, zoom and adaptive zoom, each one change that must change the picture and add one undo step; then every undo,
//    which must bring back exactly the previous picture; then the switch off, which must give back the plain picture.
//  - A clip with no motion data (10 s of clip 0020 cut by FFmpeg `-c copy`, which drops the DJI metadata): the switch
//    shows the plain message, stays off, stores nothing and adds no undo step, and the frame still draws.
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../lib/config.mjs'
import { openBenchPage } from '../lib/browser.mjs'
import { PROJECT_FPS } from '../lib/context.mjs'
import { preparePage } from '../lib/exports.mjs'
import { busyness, gitState, machineInfo } from '../lib/machine.mjs'

export const name = 'stabilization-controls'

const MEDIA_ID = 'bench-clip'
const PROJECT = { width: 3840, height: 2880, fps: PROJECT_FPS }
const FRAME = 1000
const WINDOW_FRAMES = 1200
const TMP_DIR = path.join(REPO_ROOT, 'tmp', 'stabilization-controls')
const OPEN_TIMEOUT_MS = 180_000
const T = (id) => `[data-testid="${id}"]`

/**
 * The verdict of a sequence of steps: each step says what it expects of the picture.
 * @param {Array<{step:string, hash:string, expect:'differs'|'equals', than:string|null, undoDepth:number, expectedUndoDepth:number}>} steps
 */
export function judgeSteps(steps) {
  const byName = new Map(steps.map((s) => [s.step, s]))
  const problems = []
  for (const s of steps) {
    if (s.undoDepth !== s.expectedUndoDepth)
      problems.push(`${s.step}: ${s.undoDepth} undo steps, expected ${s.expectedUndoDepth}`)
    if (!s.than) continue
    const other = byName.get(s.than)
    if (!other) {
      problems.push(`${s.step}: no step named ${s.than}`)
      continue
    }
    const same = other.hash === s.hash
    if (s.expect === 'differs' && same) problems.push(`${s.step}: the picture did not change from ${s.than}`)
    if (s.expect === 'equals' && !same) problems.push(`${s.step}: the picture is not the one of ${s.than}`)
  }
  return { ok: problems.length === 0, problems }
}

async function openOn(config, mediaFile) {
  const bench = await openBenchPage({ cache: config.cache, media: { [MEDIA_ID]: mediaFile }, requireGyro: true })
  return bench
}

const sliderAt = async (page, id, fraction) => {
  const box = await page.locator(`${T(id)} .touch-none`).first().boundingBox()
  if (!box) throw new Error(`slider ${id} is not drawn`)
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
}

const numberInto = async (page, id, value) => {
  const input = page.locator(`${T(id)} input`).first()
  await input.click()
  await input.fill(String(value))
  await input.press('Enter')
}

/** Waits until the store holds a change the test made (the section stores on release, asynchronously). */
const stored = async (page, test) => {
  await page.waitForFunction(
    async (source) => {
      const state = await window.bench.controlsState()
      // eslint-disable-next-line no-new-func
      return new Function('state', `return (${source})(state)`)(state)
    },
    test.toString(),
    { timeout: OPEN_TIMEOUT_MS },
  )
  return page.evaluate(() => window.bench.controlsState())
}

export async function measure(ctx) {
  const { config } = ctx
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const stat = fs.statSync(config.clip)
  const header = {
    measurement: name,
    schemaVersion: 1,
    date: new Date().toISOString(),
    git: gitState(),
    machine: machineInfo(),
    machineBusyAtStart: busyness(),
  }
  const steps = []
  const record = async (page, step, expect, than, expectedUndoDepth) => {
    const [hash, state] = await Promise.all([
      page.evaluate((f) => window.bench.stillHash(f), FRAME),
      page.evaluate(() => window.bench.controlsState()),
    ])
    steps.push({
      step,
      hash,
      expect,
      than,
      undoDepth: state.undoDepth,
      expectedUndoDepth,
      stored: state.stabilization,
    })
    console.log(`   ${step}: ${hash.slice(0, 12)}, undo steps ${state.undoDepth}`)
  }

  let panelScreenshot
  let pageErrors = []
  {
    const bench = await openOn(config, config.clip)
    try {
      const { page } = bench
      await preparePage(bench, MEDIA_ID, {
        mediaFile: config.clip,
        project: PROJECT,
        fileLastModified: Math.floor(stat.mtimeMs),
        sourceWindow: { startFrame: 0, frames: WINDOW_FRAMES },
      })
      await page.evaluate(() => window.bench.mountControls())
      await page.waitForSelector(T('stabilization-section'), { timeout: 30_000 })
      await record(page, 'plain', null, null, 0)

      await page.locator(T('stabilization-enabled')).click()
      await page.waitForSelector(T('stabilization-controls'), { timeout: OPEN_TIMEOUT_MS })
      await stored(page, (s) => s.stabilization?.enabled === true)
      await record(page, 'switch on', 'differs', 'plain', 1)

      await sliderAt(page, 'stabilization-smoothness', 0.95)
      await stored(page, (s) => s.undoDepth === 2)
      await record(page, 'smoothness', 'differs', 'switch on', 2)

      await sliderAt(page, 'stabilization-horizon-percent', 0.9)
      await stored(page, (s) => s.undoDepth === 3)
      await record(page, 'horizon lock', 'differs', 'smoothness', 3)

      await sliderAt(page, 'stabilization-horizon-roll', 0.75)
      await stored(page, (s) => s.undoDepth === 4)
      await record(page, 'horizon roll', 'differs', 'horizon lock', 4)

      await numberInto(page, 'stabilization-fov', 1.3)
      await stored(page, (s) => s.undoDepth === 5)
      await record(page, 'zoom', 'differs', 'horizon roll', 5)

      await numberInto(page, 'stabilization-adaptive-zoom', 0)
      await stored(page, (s) => s.undoDepth === 6)
      await record(page, 'adaptive zoom', 'differs', 'zoom', 6)
      await page.screenshot({ path: path.join(TMP_DIR, 'panel-controls.png') })
      panelScreenshot = path.join(TMP_DIR, 'panel-controls.png')

      // Every undo brings back the picture before the change.
      const order = ['zoom', 'horizon roll', 'horizon lock', 'smoothness', 'switch on']
      let depth = 6
      for (const target of order) {
        await page.evaluate(() => window.bench.undoControl())
        depth -= 1
        await stored(page, (s) => s.undoDepth === 0 || s.undoDepth > 0)
        await record(page, `undo to ${target}`, 'equals', target, depth)
      }
      await page.evaluate(() => window.bench.undoControl())
      await record(page, 'undo to plain', 'equals', 'plain', 0)

      // The switch off after a redo of the switch: switch on again, then off, must give the plain picture.
      await page.locator(T('stabilization-enabled')).click()
      await page.waitForSelector(T('stabilization-controls'), { timeout: OPEN_TIMEOUT_MS })
      await stored(page, (s) => s.stabilization?.enabled === true)
      await record(page, 'switch on again', 'equals', 'switch on', 1)
      await page.locator(T('stabilization-enabled')).click()
      await stored(page, (s) => s.stabilization?.enabled === false)
      await record(page, 'switch off', 'equals', 'plain', 2)
      pageErrors.push(...bench.pageErrors.splice(0))
    } finally {
      await bench.close()
    }
  }

  // A clip with no motion data.
  const segment = await ctx.segment(config.segmentSeconds)
  let noMotion
  {
    const bench = await openOn(config, segment.file)
    try {
      const { page } = bench
      await preparePage(bench, MEDIA_ID, { mediaFile: segment.file, project: PROJECT })
      await page.evaluate(() => window.bench.mountControls())
      await page.waitForSelector(T('stabilization-section'), { timeout: 30_000 })
      await page.locator(T('stabilization-enabled')).click()
      await page.waitForSelector(T('stabilization-no-motion-data'), { timeout: OPEN_TIMEOUT_MS })
      const message = await page.locator(T('stabilization-no-motion-data')).innerText()
      const state = await page.evaluate(() => window.bench.controlsState())
      const checked = await page.locator(T('stabilization-enabled')).getAttribute('aria-checked')
      const controlsShown = await page.locator(T('stabilization-controls')).count()
      const hash = await page.evaluate((f) => window.bench.stillHash(f), 30)
      await page.screenshot({ path: path.join(TMP_DIR, 'panel-no-motion-data.png') })
      noMotion = {
        message,
        switchChecked: checked,
        controlsShown,
        stored: state.stabilization,
        undoDepth: state.undoDepth,
        frameDrawn: hash.length === 64,
        pageErrors: bench.pageErrors.splice(0),
      }
    } finally {
      await bench.close()
    }
  }
  const noMotionProblems = []
  if (noMotion.switchChecked !== 'false') noMotionProblems.push(`the switch is ${noMotion.switchChecked}`)
  if (noMotion.controlsShown !== 0) noMotionProblems.push('the controls are shown')
  if (noMotion.stored !== null) noMotionProblems.push('settings were stored')
  if (noMotion.undoDepth !== 0) noMotionProblems.push(`${noMotion.undoDepth} undo steps`)
  if (!noMotion.frameDrawn) noMotionProblems.push('the frame did not draw')
  if (noMotion.pageErrors.length) noMotionProblems.push(`page errors: ${noMotion.pageErrors.join('; ')}`)

  const judged = judgeSteps(steps)
  const failures = [...judged.problems, ...noMotionProblems.map((p) => `no motion data: ${p}`)]
  const failure = failures.length ? failures.join(' | ') : null
  return {
    ...header,
    inputs: { clip: { path: config.clip, bytes: stat.size }, noMotionDataClip: segment.file },
    parameters: {
      frame: FRAME,
      windowFrames: WINDOW_FRAMES,
      project: '3840x2880 at 59.94 fps',
      method:
        'the clip panel section (the app component and hook, the timeline store) in the benchmark page; clicks and typing by Playwright; each step draws the output frame through the render path and hashes the PNG',
      pictureEquality: 'PNG bytes of the render path, so "equals" is exact and "differs" is any difference',
    },
    result: { passed: failure === null, failure, steps, noMotionData: noMotion, panelScreenshot, pageErrors },
    failure,
  }
}
