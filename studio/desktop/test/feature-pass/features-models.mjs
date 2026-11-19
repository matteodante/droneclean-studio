/**
 * The features that download a model when the user starts them. Each one is started with a real click, and the
 * pass records which hosts it called, how many bytes came in, and where the model landed in the profile. The
 * downloads go into the throwaway profile and are deleted with it (about 4 GB in all, from Hugging Face).
 *
 * Waiting is by what the screen shows (a toast, a button, a new media card), with a long ceiling per feature.
 */
import path from 'node:path'
import { STATUS } from './lib/report.mjs'
import { clickMenuItem, clipCount, closeDialogs, mediaCard, openCardMenu, openClipMenu, openTab, pageText, toasts } from './lib/ui.mjs'
import { ensureClipOnTimeline, ensureMedia, ensureProject } from './lib/steps.mjs'

const MINUTE = 60_000
const ok = (notes) => ({ status: STATUS.works, notes })
const broken = (notes) => ({ status: STATUS.broken, notes })
const scriptError = (notes) => ({ status: STATUS.scriptError, notes })

async function choose(page, trigger, optionName) {
  await trigger.click()
  await page.getByRole('option', { name: optionName }).first().click()
}

/** Waits for the first of several outcomes on screen; returns its key. */
async function firstOf(page, outcomes, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const [key, probe] of Object.entries(outcomes)) {
      if (await probe().catch(() => false)) return key
    }
    await page.waitForTimeout(1500)
  }
  return null
}

const toastMatches = (page, pattern) => async () => (await toasts(page)).some((text) => pattern.test(text))
const visible = (locator) => async () => locator.first().isVisible()

async function transcribe(ctx, modelName, fileName) {
  const { page } = ctx
  await ensureMedia(ctx, [ctx.fixtures.speech])
  // A transcript from an earlier feature would look like this one's result: remove it first (a user can do the same).
  await openCardMenu(page, fileName)
  if (await page.getByRole('menuitem', { name: /delete transcript/i }).first().isVisible().catch(() => false)) {
    await clickMenuItem(page, /delete transcript/i)
    await page.waitForTimeout(2000)
    ctx.note('an earlier transcript was deleted first.')
    await openCardMenu(page, fileName)
  }
  await clickMenuItem(page, /generate transcript|refresh transcript/i)
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor({ timeout: 15000 })
  const modelTrigger = dialog.getByRole('combobox').first()
  await choose(page, modelTrigger, modelName)
  const notice = await pageText(page, 500)
  await ctx.shot('dialog')
  ctx.act(`Start transcription with ${modelName}`)
  await dialog.getByRole('button', { name: /^start$/i }).click()
  // The result is read from the card's menu, which offers "Delete Transcript" once a transcript exists.
  const deadline = Date.now() + 25 * MINUTE
  let outcome = null
  while (Date.now() < deadline && !outcome) {
    await page.waitForTimeout(10000)
    if (await toastMatches(page, /fail/i)().catch(() => false)) outcome = 'failed'
    else if (await page.getByRole('button', { name: /use whisper instead/i }).first().isVisible().catch(() => false)) outcome = 'fallback'
    else {
      await openCardMenu(page, fileName)
      if (await page.getByRole('menuitem', { name: /delete transcript/i }).first().isVisible().catch(() => false)) outcome = 'ready'
      await closeDialogs(page)
    }
  }
  return { outcome, notice, toasts: await toasts(page) }
}

const SAVE_BUTTON = /save (&|and) insert|insert and link|save to library/i

function ttsFeature(id, name, engineName, label) {
  return {
    id,
    name,
    where: 'sidebar → AI → Text to Speech',
    expectsDownload: true,
    async run(ctx) {
      const { page } = ctx
      await ensureProject(ctx)
      await openTab(page, 'AI')
      const engine = page.getByText('Engine', { exact: true }).locator('xpath=following::*[@role="combobox"][1]')
      await choose(page, engine, engineName)
      // Selecting the engine, then ten quiet seconds: whatever is requested now is "before the user acts".
      await page.waitForTimeout(10000)
      const resultsBefore = await page.getByRole('button', { name: SAVE_BUTTON }).count()
      ctx.act(`Generate with ${label}`)
      await page.getByRole('button', { name: /^generate$/i }).first().click()
      const outcome = await firstOf(
        page,
        {
          done: async () => (await page.getByRole('button', { name: SAVE_BUTTON }).count()) > resultsBefore,
          failed: toastMatches(page, /failed|unsupported|error/i),
        },
        25 * MINUTE,
      )
      if (outcome === 'done') return ok(`${label} generated audio`)
      if (outcome === 'failed') return broken(`${label} failed: ${(await toasts(page)).join(' / ')}`)
      return scriptError(`no result in 25 minutes; page: ${await pageText(page, 300)}`)
    },
  }
}

const features = [
  {
    id: 'whisper',
    name: 'Transcription — Whisper',
    where: 'media card → Transcript → Generate Transcript, model Whisper',
    expectsDownload: true,
    async run(ctx) {
      const result = await transcribe(ctx, /whisper/i, path.basename(ctx.fixtures.speech))
      ctx.shared.whisperTranscript = result.outcome === 'ready'
      if (result.outcome === 'ready') return ok(`transcript ready. ${result.notice.slice(0, 160)}`)
      return result.outcome === 'failed' ? broken(result.toasts.join(' / ')) : scriptError(`no outcome: ${result.toasts.join(' / ')}`)
    },
  },
  {
    id: 'parakeet',
    name: 'Transcription — Parakeet (the default)',
    where: 'same dialog, model Parakeet',
    expectsDownload: true,
    async run(ctx) {
      const result = await transcribe(ctx, /parakeet/i, path.basename(ctx.fixtures.speech))
      if (result.outcome === 'ready') return ok('Parakeet transcript ready')
      if (result.outcome === 'fallback') return broken(`Parakeet failed and the dialog offers "Use Whisper instead": ${result.toasts.join(' / ')}`)
      return result.outcome === 'failed' ? broken(result.toasts.join(' / ')) : scriptError(`no outcome: ${result.toasts.join(' / ')}`)
    },
  },
  {
    id: 'captions-from-transcript',
    name: 'Captions from a transcript',
    where: 'timeline clip menu → Generate Captions',
    async run(ctx) {
      if (!ctx.shared.whisperTranscript) ctx.note('no Whisper transcript from the previous feature (run it first or the item is missing);')
      await ensureClipOnTimeline(ctx, ctx.fixtures.speechVideo)
      await openClipMenu(ctx.page)
      const before = await clipCount(ctx.page)
      ctx.act('click Generate Captions')
      await clickMenuItem(ctx.page, /generate captions|regenerate captions/i)
      await ctx.page.waitForTimeout(5000)
      // With no transcript on the clip the editor opens the transcription dialog first; start it (Whisper is cached).
      const dialog = ctx.page.getByRole('dialog').first()
      const dialogOpen = await dialog.isVisible().catch(() => false)
      if (dialogOpen) {
        await ctx.shot('dialog')
        await choose(ctx.page, dialog.getByRole('combobox').first(), /whisper/i).catch(() => {})
        await dialog.getByRole('button', { name: /^start$/i }).click({ timeout: 10000 }).catch(() => {})
      }
      await firstOf(ctx.page, { added: async () => (await clipCount(ctx.page)) > before }, 6 * MINUTE)
      const after = await clipCount(ctx.page)
      await closeDialogs(ctx.page)
      if (after > before) return ok(`caption clips were added (${before} → ${after})`)
      return broken(`no caption clip appeared (${before} → ${after}); a dialog ${dialogOpen ? 'opened' : 'did not open'}; toasts: ${(await toasts(ctx.page)).join(' / ')}`)
    },
  },
  ttsFeature('kokoro', 'Text to speech — Kokoro', /kokoro/i, 'Kokoro'),
  ttsFeature('supertonic', 'Text to speech — Supertonic 3', /supertonic/i, 'Supertonic 3'),
  ttsFeature('moss', 'Text to speech — MOSS Nano', /moss/i, 'MOSS Nano'),
  {
    id: 'musicgen',
    name: 'Music generation (MusicGen Small)',
    where: 'sidebar → AI → Music Generation',
    expectsDownload: true,
    async run(ctx) {
      const { page } = ctx
      await ensureProject(ctx)
      await openTab(page, 'AI')
      const prompt = page.getByPlaceholder(/describe the kind of music/i)
      await prompt.scrollIntoViewIfNeeded()
      await prompt.fill('calm ambient piano, slow')
      await page.waitForTimeout(10000)
      const resultsBefore = await page.getByRole('button', { name: SAVE_BUTTON }).count()
      ctx.act('click Generate Music')
      await page.getByRole('button', { name: /^generate( music)?$/i }).last().click()
      const outcome = await firstOf(
        page,
        {
          done: async () => (await page.getByRole('button', { name: SAVE_BUTTON }).count()) > resultsBefore,
          failed: toastMatches(page, /failed|unsupported/i),
        },
        30 * MINUTE,
      )
      if (outcome === 'done') return ok('music generated')
      if (outcome === 'failed') return broken((await toasts(page)).join(' / '))
      return scriptError(`no result in 30 minutes; page: ${await pageText(page, 300)}`)
    },
  },
  {
    id: 'filler-words',
    name: 'Filler-word scoring (CLAP)',
    where: 'timeline clip menu → Remove Filler Words → Score Audio',
    expectsDownload: true,
    async run(ctx) {
      await ensureClipOnTimeline(ctx, ctx.fixtures.fillersVideo)
      const items = ctx.page.locator('[data-timeline-item][data-item-id]')
      const fillerClip = items.filter({ hasText: /fillers/i }).first()
      const target = (await fillerClip.count()) ? fillerClip : items.last()
      await target.click({ button: 'right' })
      await ctx.page.getByRole('menu').first().waitFor({ timeout: 10000 })
      // Opening the dialog is the user's first action. With no word-level transcript on the clip the dialog also
      // starts a transcription with the default model (Parakeet, 1.2 GB) by itself (filler-word-removal-preview.ts:294).
      ctx.act('click Remove Filler Words')
      await clickMenuItem(ctx.page, /remove filler words/i)
      const score = ctx.page.getByRole('button', { name: /score audio/i }).first()
      await score.waitFor({ timeout: 60000 })
      await ctx.shot('dialog')
      // The button stays disabled while the clip is being transcribed.
      const enabledBy = Date.now() + 25 * MINUTE
      while (Date.now() < enabledBy && !(await score.isEnabled().catch(() => false))) await ctx.page.waitForTimeout(5000)
      ctx.note('Remove Filler Words transcribed the clip first (default model) before Score Audio could be pressed; the second click is Score Audio.')
      if ((await pageText(ctx.page, 6000)).includes('timeline.fillerRemoval.')) ctx.note('the panel shows untranslated keys ("timeline.fillerRemoval.preset.conservative"): a UI string bug.')
      // The floating panel is taller than this 1440x868 window: scroll it with the wheel like a user, and if the
      // button is still outside the window, make the window taller.
      await ctx.page.mouse.move(1180, 500)
      await ctx.page.mouse.wheel(0, 2000)
      await ctx.page.waitForTimeout(500)
      const box = await score.boundingBox()
      if (!box || box.y + box.height > 860) {
        await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1700))
        await ctx.page.waitForTimeout(1500)
        ctx.note('the Score Audio button was below the 868 px window; the window was made taller.')
      }
      await score.click()
      const outcome = await firstOf(
        ctx.page,
        { done: toastMatches(ctx.page, /confidence scoring done|scoring done/i), failed: toastMatches(ctx.page, /couldn.t analyze|failed/i) },
        10 * MINUTE,
      )
      if (outcome === 'done') return ok('audio confidence scoring finished')
      return outcome === 'failed' ? broken((await toasts(ctx.page)).join(' / ')) : scriptError('no outcome in 10 minutes')
    },
  },
  {
    id: 'scenes',
    name: 'Scene browser — Analyze (LFM 2.5 VL)',
    where: 'Media → Scenes → Analyze',
    expectsDownload: true,
    async run(ctx) {
      const { page } = ctx
      await ensureMedia(ctx, [ctx.fixtures.clip])
      await openTab(page, 'Media')
      await page.getByRole('tab', { name: /scenes/i }).or(page.getByRole('button', { name: /^scenes$/i })).first().click()
      await page.waitForTimeout(1000)
      const analyze = page.getByRole('button', { name: /analy[sz]e/i }).first()
      await analyze.waitFor({ timeout: 15000 })
      ctx.note(`Before the click: "${(await pageText(page, 200)).slice(0, 120)}".`)
      ctx.act('click Analyze')
      await analyze.click()
      // The button opens a menu: "Analyze new media" / "Re-analyze all".
      await page.getByRole('menuitem', { name: /re-analyze all|analyze new media/i }).first().click({ timeout: 10000 })
      const scenesFound = async () => /[1-9]\d* scenes?\b/i.test(await pageText(page, 3000)) && !/analy[sz]ing/i.test(await pageText(page, 3000))
      const outcome = await firstOf(page, { failed: toastMatches(page, /fail|couldn.t/i), done: scenesFound }, 25 * MINUTE)
      ctx.shared.scenesAnalysed = outcome === 'done'
      if (outcome === 'done') return ok('the clip was analysed into scenes')
      return outcome === 'failed' ? broken((await toasts(page)).join(' / ')) : scriptError('no outcome in 25 minutes')
    },
  },
  {
    id: 'semantic-search',
    name: 'Scene browser — semantic search',
    where: 'Scenes → search mode → Semantic',
    expectsDownload: true,
    async run(ctx) {
      const { page } = ctx
      await ensureProject(ctx)
      if (!ctx.shared.scenesAnalysed) ctx.note('the scene analysis did not finish, so there are no captions to index;')
      await openTab(page, 'Media')
      await page.getByRole('tab', { name: /scenes/i }).or(page.getByRole('button', { name: /^scenes$/i })).first().click()
      const search = page.getByPlaceholder(/search scenes/i)
      await search.waitFor({ timeout: 15000 })
      await page.getByRole('button', { name: /semantic|search mode/i }).first().click().catch(() => {})
      await page.getByRole('menuitem', { name: /semantic/i }).first().click().catch(() => {})
      ctx.act('type a query')
      // Search for a word the analysis actually wrote for this clip (read from the scene captions in the workspace).
      const listed = (await pageText(page, 4000)).split('Relevance')[1] ?? ''
      const query = (listed.match(/\b[a-z]{5,}\b/g) ?? []).find((word) => !/^(clip|clips|scenes?|search|sort|matches|relevance)$/.test(word)) ?? null
      if (!query) return scriptError('no scene caption text was on the screen to build a query from')
      ctx.note(`query: "${query}".`)
      await search.fill(query)
      const outcome = await firstOf(page, { found: async () => /[1-9]\d* matches/i.test(await pageText(page, 3000)) }, 5 * MINUTE)
      const text = await pageText(page, 600)
      if (outcome === 'found') return ok(`the query returned results: "${text.slice(0, 160)}"`)
      return ctx.shared.scenesAnalysed ? broken(`the query returned no results after 5 minutes: "${text.slice(0, 200)}"`) : scriptError(`there were no scene captions to search (the scene analysis did not finish): "${text.slice(0, 160)}"`)
    },
  },
  {
    id: 'upscale',
    name: 'Upscale 2×',
    where: 'media card → Upscale → Upscale 2x',
    expectsDownload: true,
    async run(ctx) {
      const { page } = ctx
      await ensureMedia(ctx, [ctx.fixtures.clip])
      await openCardMenu(page, path.basename(ctx.fixtures.clip))
      const cardsBefore = await page.locator('[draggable="true"]').filter({ hasText: /\.(mp4|mov|webm|mkv)/i }).count()
      ctx.act('click Upscale 2x')
      // "Upscale 2x" opens a submenu of variants (Live Action / Animation / 3D): take the first.
      await page.getByRole('menuitem', { name: /upscale 2x/i }).first().click()
      await page.getByRole('menuitem').filter({ hasNotText: /upscale 2x|interpolate|generate|analyze|delete/i }).first().click({ timeout: 10000 })
      const outcome = await firstOf(
        page,
        { done: async () => (await page.locator('[draggable="true"]').filter({ hasText: /\.(mp4|mov|webm|mkv)/i }).count()) > cardsBefore, failed: toastMatches(page, /fail|couldn.t|error/i) },
        10 * MINUTE,
      )
      if (outcome === 'done') return ok('a new (upscaled) item appeared in the media library')
      return outcome === 'failed' ? broken((await toasts(page)).join(' / ')) : scriptError('no outcome in 10 minutes')
    },
  },
  {
    id: 'interpolation',
    name: 'Frame interpolation (RIFE)',
    where: 'media card → Frame Interpolation',
    expectsDownload: true,
    async run(ctx) {
      const { page } = ctx
      await ensureMedia(ctx, [ctx.fixtures.clip2])
      await openCardMenu(page, path.basename(ctx.fixtures.clip2))
      const cardsBefore = await page.locator('[draggable="true"]').filter({ hasText: /\.(mp4|mov|webm|mkv)/i }).count()
      ctx.act('click Interpolate Frames')
      // "Interpolate Frames" opens a submenu of factors (2x / 3x / 4x): take the first.
      await page.getByRole('menuitem', { name: /interpolate frames/i }).first().click()
      await page.getByRole('menuitem').filter({ hasNotText: /interpolate frames|upscale|generate|analyze|delete/i }).first().click({ timeout: 10000 })
      const outcome = await firstOf(
        page,
        { done: async () => (await page.locator('[draggable="true"]').filter({ hasText: /\.(mp4|mov|webm|mkv)/i }).count()) > cardsBefore, failed: toastMatches(page, /fail|couldn.t|error/i) },
        20 * MINUTE,
      )
      if (outcome === 'done') return ok('interpolation finished')
      return outcome === 'failed' ? broken((await toasts(page)).join(' / ')) : scriptError(`no outcome in 20 minutes; toasts: ${(await toasts(page)).join(' / ')}`)
    },
  },
]

// Every model feature starts from a fresh launch (see lib/run.mjs), so no download of a previous feature is still running.
export const modelFeatures = features.map((feature) => ({ ...feature, freshLaunch: true }))
