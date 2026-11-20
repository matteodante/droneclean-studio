/**
 * A drone edit clicked in the packaged app (PLAN.md N8): what an editor does with the e2e clip, through the panels a
 * user clicks, each click read back through `window.studio`:
 *
 * 1. two parts of the clip end to end and a kick track under them (set up through the SDK, then the editor's route);
 * 2. Stabilization switched on in the clip panel (on a DJI clip with gyro data: the controls and the lens appear and
 *    the preview changes; on a clip without motion data, the PC's generated one, the panel says so);
 * 3. Framing, up and down, typed into its slider, then a keyframe from its diamond (DJI clip only);
 * 4. the Sky effect from the Effects tab (on clip 0020's white sky the top of the preview turns blue);
 * 5. a title from the Text tab, a keyframe from the Rotation diamond, a Fade from the Transitions tab on the cut;
 * 6. Mark Beats from the kick track's menu: beats at the kicks' tempo;
 * 7. the export with the Instagram Reel preset chosen in the dialog: H.264 and AAC laid out as Meta asks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { probeVideo } from '../support/flow-media.mjs'
import { exportAndDownload, pictureDifference, previewPicture } from '../support/flow-page.mjs'
import { beatsFollowKicks, makeKickTrack, mp4Layout, probeAudio } from '../support/mcp-media.mjs'

/** A preview that changed: the mean absolute difference of its pixels, 0..255, above this. */
const CHANGED = 2
/** The top of the preview, where clip 0020's frames have their white sky. */
const SKY_REGION = { x: 0.3, y: 0.05, w: 0.4, h: 0.12 }

const item = (page, id) => page.locator(`[data-timeline-item][data-item-id="${id}"]`)

/** Click a clip on the timeline and make it the only one selected (a click can keep a linked or earlier selection). */
async function selectOnly(page, id) {
  await item(page, id).click()
  const selected = await page.evaluate(() => window.studio.selection.get().clips ?? [])
  if (selected.length !== 1 || selected[0] !== id) await page.evaluate((clip) => window.studio.selection.set({ clips: [clip] }), id)
  await page.waitForTimeout(500)
}

async function openTab(page, label) {
  await page.locator(`button[data-tooltip="${label}"]`).first().click()
  await page.waitForTimeout(600)
}

/** Wait until `fn(arg)` in the page returns something truthy; its value, or null after `timeout`. */
function pageValue(page, fn, arg, timeout = 15000) {
  return page
    .waitForFunction(fn, arg, { timeout })
    .then((handle) => handle.jsonValue())
    .catch(() => null)
}

/** The preview once it has settled after an edit: the first picture that differs from `before`, or the last one. */
async function previewAfter(page, before, timeout = 20000) {
  const deadline = Date.now() + timeout
  let picture = await previewPicture(page)
  while (Date.now() < deadline) {
    const { difference } = await pictureDifference(page, before, picture)
    if (difference !== null && difference > CHANGED) break
    await page.waitForTimeout(500)
    picture = await previewPicture(page)
  }
  await page.waitForTimeout(800)
  return previewPicture(page)
}

/** The diamond of the clip panel's row labelled `label`: its "Add keyframe" button. */
async function keyframeButton(page, label) {
  const marker = `e2e-keyframe-${label.replace(/\W+/g, '-')}`
  const found = await page.evaluate(
    ({ text, attribute }) => {
      const host = document.querySelector('[data-testid="properties-clip-panel-host"]') ?? document.body
      const labelElement = [...host.querySelectorAll('*')].find(
        (element) => element.children.length === 0 && element.textContent?.trim() === text,
      )
      let node = labelElement
      while (node && node !== host && !node.querySelector('button[aria-label="Add keyframe"]')) node = node.parentElement
      const button = node?.querySelector('button[aria-label="Add keyframe"]')
      button?.setAttribute('data-e2e-keyframe', attribute)
      return {
        label: Boolean(labelElement),
        button: Boolean(button),
        tabs: [...host.querySelectorAll('[role="tab"]')].map((tab) => `${tab.textContent?.trim()}:${tab.getAttribute('aria-selected')}`),
        text: host.textContent?.replace(/\s+/g, ' ').slice(0, 160),
      }
    },
    { text: label, attribute: marker },
  )
  return { locator: page.locator(`[data-e2e-keyframe="${marker}"]`), found }
}

async function setUp(page, clip, kicks) {
  const projectId = await page.evaluate(
    async () =>
      (await window.studio.project.create({ name: 'E2E drone', width: 1920, height: 1080, fps: { num: 30, den: 1 } })).id,
  )
  // The editor's own route, so the window shows the project the way a user opens it
  await page.evaluate((id) => {
    history.pushState({}, '', `/editor/${id}`)
    dispatchEvent(new PopStateEvent('popstate'))
  }, projectId)
  await page.waitForFunction((id) => location.pathname === `/editor/${id}` && window.studio.project.current()?.id === id, projectId, {
    timeout: 30000,
  })
  await page.waitForTimeout(1500)
  const ids = await page.evaluate(
    async ({ file, song }) => {
      const s = window.studio
      const [video, audio] = await s.media.import([file, song])
      const tracks = s.tracks.list()
      const videoTrack = tracks.find((track) => track.kind === 'video').id
      const audioTrack = tracks.find((track) => track.kind === 'audio').id
      const second = Math.round(video.fps)
      const a = s.clips.add({ mediaId: video.id, trackId: videoTrack, from: 0, sourceStart: 20 * second, sourceEnd: 25 * second })
      const b = s.clips.add({
        mediaId: video.id,
        trackId: videoTrack,
        from: s.clips.get(a).durationInFrames,
        sourceStart: 33 * second,
        sourceEnd: 38 * second,
      })
      const k = s.clips.add({ mediaId: audio.id, trackId: audioTrack, from: 0, sourceStart: 0, sourceEnd: 300 })
      s.playback.seek(30)
      return { a, b, k, fps: video.fps, width: video.width, height: video.height }
    },
    { file: clip, song: kicks },
  )
  // A DJI file name asks once about D-Log M; this flow keeps the clip as it is
  const question = page.getByText('Were these DJI clips shot in D-Log M?')
  if (await question.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: 'No, normal' }).click()
  }
  return { projectId, ...ids }
}

export async function runDroneFlow({ page, check, observations, work, nextDownload, clip }) {
  const notes = (observations.drone = {})
  const dji = /^DJI_/i.test(path.basename(clip))
  const ids = await setUp(page, clip, makeKickTrack(path.join(work, 'drone-kicks.wav')))
  notes.setup = { ...ids, dji }
  await page.waitForTimeout(2000)

  // 2. Stabilization from the clip panel
  await selectOnly(page, ids.a)
  const unstabilized = await previewPicture(page)
  await page.getByTestId('stabilization-enabled').click()
  if (dji) {
    const on = await pageValue(page, (id) => window.studio.clips.getStabilization(id)?.enabled === true, ids.a, 120000)
    const lens = await page.getByTestId('stabilization-lens').innerText({ timeout: 30000 }).catch(() => '')
    const stabilized = await previewAfter(page, unstabilized)
    const change = await pictureDifference(page, unstabilized, stabilized)
    notes.stabilization = { on: on === true, lens, previewChange: change.difference }
    check(
      'drone: Stabilization switched on in the clip panel stabilizes a DJI clip, names its lens and changes the preview',
      on === true && lens.trim().length > 0 && change.difference > CHANGED,
      notes.stabilization,
    )

    // 3. Framing, up and down, then its keyframe
    const row = page.getByTestId('stabilization-framing-y')
    await row.locator('span.cursor-text').click()
    const input = row.locator('input[type="text"]')
    await input.fill('0.5')
    await input.press('Enter')
    const framing = await pageValue(page, (id) => window.studio.clips.getStabilization(id)?.framingY === 0.5, ids.a)
    const framed = await previewAfter(page, stabilized)
    const moved = await pictureDifference(page, stabilized, framed)
    await row.getByRole('button', { name: 'Add keyframe' }).click()
    const keyed = await pageValue(page, (id) => window.studio.keyframes.list(id, 'framingY').length === 1, ids.a)
    notes.framing = { value: framing === true, previewChange: moved.difference, keyframe: keyed === true }
    check(
      'drone: Framing, up and down, typed into its slider moves the stabilized picture, and its diamond adds a keyframe',
      framing === true && moved.difference > CHANGED && keyed === true,
      notes.framing,
    )
  } else {
    const said = await page
      .getByTestId('stabilization-no-motion-data')
      .waitFor({ timeout: 60000 })
      .then(() => true, () => false)
    notes.stabilization = { noMotionData: said }
    check('drone: on a clip without motion data the Stabilization switch says so', said, notes.stabilization)
  }

  // 4. Sky from the Effects tab
  {
    const before = await previewPicture(page)
    const top = await pictureDifference(page, before, before, SKY_REGION)
    await openTab(page, 'Effects')
    await selectOnly(page, ids.a)
    await page.getByRole('button', { name: 'Sky', exact: true }).first().click()
    const added = await pageValue(page, (id) => window.studio.effects.list(id).some((effect) => effect.type === 'gpu-sky'), ids.a)
    const after = await previewAfter(page, before)
    const sky = await pictureDifference(page, before, after, SKY_REGION)
    notes.sky = { added: added === true, previewChange: sky.difference, topBefore: top.region, topAfter: sky.region }
    const bluer = sky.region && top.region && sky.region[2] - sky.region[0] > top.region[2] - top.region[0] + 10
    check(
      dji
        ? 'drone: Sky from the Effects tab is on the clip and turns the white sky at the top of the preview blue'
        : 'drone: Sky from the Effects tab is on the clip',
      added === true && (!dji || bluer),
      notes.sky,
    )
  }

  // 5. A title, a Rotation keyframe, a Fade on the cut
  {
    const before = await page.evaluate(() => window.studio.titles.list().length)
    await openTab(page, 'Text')
    await page.getByRole('button', { name: /add text/i }).first().click()
    const titles = await pageValue(page, (count) => window.studio.titles.list().length > count && window.studio.titles.list().length, before)
    notes.title = { before, after: titles }
    check('drone: Add text in the Text tab puts a title on the timeline', titles !== null, notes.title)
    // The default title runs a minute; it goes, so the export below is the ten seconds of the clips and the kicks
    await page.evaluate(() => window.studio.clips.remove(window.studio.titles.list().map((title) => title.id)))
  }
  {
    // A diamond adds a keyframe only with the playhead inside the clip ("Playhead outside clip bounds" otherwise)
    await page.evaluate((id) => window.studio.playback.seek(window.studio.clips.get(id).from + 30), ids.b)
    await selectOnly(page, ids.b)
    // The clip panel stays on the tab it showed last (Effects, after the Sky): the Rotation row is on Video
    const videoTab = page.getByTestId('properties-clip-panel-host').getByRole('tab', { name: /^video$/i })
    if ((await videoTab.count()) > 0) await videoTab.first().click()
    const diamond = await keyframeButton(page, 'Rotation')
    if (diamond.found.button) await diamond.locator.click()
    const keyed = await pageValue(page, (id) => window.studio.keyframes.list(id, 'rotation').length === 1, ids.b)
    notes.rotationKeyframe = { ...diamond.found, keyed: keyed === true }
    check('drone: the Rotation diamond in the clip panel adds a rotation keyframe', keyed === true, notes.rotationKeyframe)
  }
  {
    await selectOnly(page, ids.a)
    await openTab(page, 'Transitions')
    await page.getByText('Fade', { exact: true }).first().click()
    const transition = await pageValue(
      page,
      ({ a, b }) => window.studio.transitions.list().find((t) => t.leftClipId === a && t.rightClipId === b) ?? null,
      { a: ids.a, b: ids.b },
    )
    notes.transition = transition ?? (await page.evaluate(() => window.studio.transitions.list()))
    check('drone: Fade in the Transitions tab, with the first clip selected, puts a transition on its cut', transition !== null, notes.transition)
  }

  // 6. Mark Beats from the kick track's menu
  {
    await item(page, ids.k).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark Beats' }).click()
    const frames = await pageValue(page, () => {
      const markers = window.studio.markers.list()
      return markers.length >= 8 ? markers.map((marker) => marker.frame) : null
    }, undefined, 60000)
    notes.beats = { count: frames?.length ?? 0, first: frames?.slice(0, 8) ?? [] }
    check(
      'drone: Mark Beats from the kick track\'s menu marks the kicks at their tempo',
      frames !== null && frames.length <= 45 && beatsFollowKicks(frames, 30),
      notes.beats,
    )
  }

  // 7. The export with the Instagram Reel preset
  {
    await page.evaluate(() => window.studio.selection.clear())
    const exported = await exportAndDownload(page, nextDownload, { preset: 'Instagram Reel', timeout: 600000 })
    const layout = mp4Layout(fs.readFileSync(exported.file))
    const audio = probeAudio(exported.file)
    const video = probeVideo(exported.file)
    const size = /(\d+)x(\d+)/.exec(exported.preset?.numbers ?? '')
    notes.export = { name: exported.name, bytes: exported.bytes, preset: exported.preset, layout, audio, video }
    check(
      'drone: Export with the Instagram Reel preset writes H.264 at the preset\'s size, AAC at most 150 kbps, moov first, no edit list',
      exported.preset?.pressed === true &&
        video.codec === 'h264' &&
        size !== null &&
        video.width === Number(size[1]) &&
        video.height === Number(size[2]) &&
        audio.codec === 'aac' &&
        audio.bitRate > 0 &&
        audio.bitRate <= 150000 &&
        layout.moovFirst &&
        !layout.edts,
      notes.export,
    )
  }
}
