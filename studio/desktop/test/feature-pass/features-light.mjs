/**
 * The features that make no download, or a tiny one: what the packaged desktop app does with each, step by step,
 * with real clicks and drops. Each `run` returns `{ status, notes?, manualStep? }`; a thrown error becomes
 * "script error", which says the script could not finish, not that the app is broken.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { STATUS } from './lib/report.mjs'
import { answerMatchDialog, clickMenuItem, clipCount, closeDialogs, importByDrop, mediaCard, openCardMenu, openItemMenu, openTab, pageText, toasts } from './lib/ui.mjs'
import { ensureClipOnTimeline, ensureMedia, ensureProject, selectFirstClip } from './lib/steps.mjs'
import { waitForRender } from './lib/app.mjs'

const ok = (notes) => ({ status: STATUS.works, notes })
const broken = (notes) => ({ status: STATUS.broken, notes })

async function readTransport(page) {
  return page.evaluate(() => {
    const matches = document.body.innerText.match(/\d\d:\d\d:\d\d/g) ?? []
    const frames = (value) => {
      const [minutes = '0', seconds = '0', rest = '0'] = (value ?? '00:00:00').split(':')
      return (Number(minutes) * 60 + Number(seconds)) * 30 + Number(rest)
    }
    return { current: matches[0] ?? null, currentFrame: frames(matches[0]) }
  })
}

async function toolbarDialog(ctx, label) {
  const { page } = ctx
  await page.getByRole('button', { name: label, exact: true }).first().click({ timeout: 15000 })
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 })
  await ctx.shot(label.replace(/\W+/g, '-').toLowerCase())
  await closeDialogs(page)
}

export const lightFeatures = [
  {
    id: 'launch',
    name: 'App launch and projects page',
    where: 'start of the app, /projects',
    async run(ctx) {
      await ctx.page.reload()
      await waitForRender(ctx.page)
      await ctx.page.waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, { timeout: 120000 })
      const info = await ctx.page.evaluate(() => ({ isolated: window.crossOriginIsolated, bridge: window.dronecleanDesktop?.version ?? null, href: location.href }))
      ctx.note(`${info.href}, cross-origin isolated ${info.isolated}, bridge v${info.bridge}.`)
      return info.isolated ? ok() : broken('the page is not cross-origin isolated')
    },
  },
  {
    id: 'create-project',
    name: 'Create project',
    where: 'Projects → New Project',
    async run(ctx) {
      ctx.act('click New Project')
      await ensureProject(ctx)
      return ok(`opened ${ctx.page.url()}`)
    },
  },
  {
    id: 'save-reopen',
    name: 'Save, quit, reopen project',
    where: 'editor toolbar → Save; restart',
    async run(ctx) {
      await ensureProject(ctx)
      ctx.act('click Save')
      await ctx.page.getByRole('button', { name: 'Save project' }).click()
      await ctx.page.waitForTimeout(1500)
      const saved = await toasts(ctx.page)
      await ctx.relaunch()
      await ctx.page.waitForFunction(() => document.querySelectorAll('a[href="/projects/new"]').length > 0, null, { timeout: 120000 })
      const listed = await ctx.page.getByText('Feature pass', { exact: true }).first().isVisible().catch(() => false)
      if (!listed) return broken('the project is not listed after a restart')
      await ctx.page.getByText('Feature pass', { exact: true }).first().dblclick()
      await ctx.page.waitForURL(/\/editor\//, { timeout: 120000 })
      return ok(`toasts after Save: ${JSON.stringify(saved)}; the project reopened after a restart`)
    },
  },
  {
    id: 'import-drop',
    name: 'Import media by drop (copy into the workspace)',
    where: 'Media panel, drop of files',
    async run(ctx) {
      await ensureProject(ctx)
      ctx.act('drop files on the media panel')
      await importByDrop(ctx.page, [ctx.fixtures.clip, ctx.fixtures.clip2])
      return ok('two clips imported; see "Stored in" for what the workspace received')
    },
  },
  {
    id: 'media-info',
    name: 'Media info',
    where: 'media card (info button)',
    async run(ctx) {
      await ensureMedia(ctx, [ctx.fixtures.clip])
      await answerMatchDialog(ctx.page)
      const card = mediaCard(ctx.page, path.basename(ctx.fixtures.clip))
      ctx.act('click the info button')
      await card.locator('button[title="Media info"]').click({ timeout: 10000 })
      await ctx.page.getByText(/codec|resolution|dimensions|duration/i).first().waitFor({ timeout: 10000 })
      await ctx.shot('popover')
      return ok('the info popover opened with the clip details')
    },
  },
  {
    id: 'timeline',
    name: 'Timeline: drag a clip, play, marker, split, undo',
    where: 'timeline',
    async run(ctx) {
      await ensureClipOnTimeline(ctx)
      ctx.act('press Play')
      const before = await readTransport(ctx.page)
      await ctx.page.getByRole('button', { name: 'Play', exact: true }).first().click()
      await ctx.page.waitForTimeout(2000)
      const after = await readTransport(ctx.page)
      await ctx.page.getByRole('button', { name: 'Pause', exact: true }).first().click()
      const advanced = after.currentFrame - before.currentFrame
      await ctx.page.keyboard.press('m')
      const clips = await clipCount(ctx.page)
      await ctx.page.keyboard.press('Alt+c')
      await ctx.page.waitForTimeout(500)
      const split = await clipCount(ctx.page)
      await ctx.page.keyboard.press('Meta+z')
      await ctx.page.waitForTimeout(500)
      const undone = await clipCount(ctx.page)
      ctx.note(`played ${advanced} frames in 2 s; clips ${clips} → ${split} after split → ${undone} after undo.`)
      return advanced > 20 && split > clips && undone === clips ? ok() : broken(`playback or editing did not behave: advanced ${advanced}, clips ${clips}/${split}/${undone}`)
    },
  },
  {
    id: 'text',
    name: 'Text tab / Add Text',
    where: 'sidebar → Text',
    async run(ctx) {
      await ensureProject(ctx)
      await openTab(ctx.page, 'Text')
      const before = await clipCount(ctx.page)
      ctx.act('click Add text')
      await ctx.page.getByRole('button', { name: /add text/i }).first().click()
      await ctx.page.waitForTimeout(800)
      return (await clipCount(ctx.page)) > before ? ok('a text layer was added') : broken('Add text added nothing')
    },
  },
  {
    id: 'shapes',
    name: 'Shapes tab',
    where: 'sidebar → Shapes',
    async run(ctx) {
      await ensureProject(ctx)
      await openTab(ctx.page, 'Shapes')
      const before = await clipCount(ctx.page)
      ctx.act('click Rectangle')
      await ctx.page.getByRole('button', { name: /rectangle/i }).first().click()
      await ctx.page.waitForTimeout(800)
      return (await clipCount(ctx.page)) > before ? ok('a rectangle was added') : broken('the Rectangle tile added nothing')
    },
  },
  {
    id: 'effects',
    name: 'Effects tab (GPU effects, presets)',
    where: 'sidebar → Effects',
    async run(ctx) {
      await ensureClipOnTimeline(ctx)
      await openTab(ctx.page, 'Effects')
      await selectFirstClip(ctx)
      ctx.act('click Vignette')
      await ctx.page.getByRole('button', { name: /vignette/i }).first().click()
      await ctx.page.waitForTimeout(800)
      return ok('Vignette applied to the selected clip (the effect list in the clip properties was not read back)')
    },
  },
  {
    id: 'transitions',
    name: 'Transitions tab',
    where: 'sidebar → Transitions',
    async run(ctx) {
      await ensureProject(ctx)
      await openTab(ctx.page, 'Transitions')
      const tiles = await ctx.page.locator('[aria-disabled], [draggable="true"]').count()
      return ok(`the tab opened (${tiles} tiles); a transition is applied by dragging a tile onto a cut between two adjacent clips, which was not scripted`)
    },
  },
  {
    id: 'lottie',
    name: 'Lottie browser (stickers): the prompt, then browsing',
    where: 'sidebar → Lottie',
    async run(ctx) {
      await ensureProject(ctx)
      await openTab(ctx.page, 'Lottie')
      await ctx.page.waitForTimeout(3000)
      const prompt = await ctx.page.getByRole('button', { name: /browse lottiefiles/i }).first().isVisible().catch(() => false)
      if (!prompt) return broken('opening the tab shows no "Browse LottieFiles" prompt')
      await ctx.shot('prompt')
      ctx.act('click Browse LottieFiles')
      await ctx.page.getByRole('button', { name: /browse lottiefiles/i }).first().click()
      await ctx.page.waitForTimeout(8000)
      return ok('the prompt waits for a click; browsing then requests the catalogue and previews (see Requests); no search or add was done')
    },
  },
  {
    id: 'transcript-tab',
    name: 'Transcript tab and AI tab (opened only)',
    where: 'sidebar → Transcript, AI',
    async run(ctx) {
      await ensureProject(ctx)
      await openTab(ctx.page, 'Transcript')
      const transcript = await pageText(ctx.page, 300)
      await openTab(ctx.page, 'AI')
      const ai = await pageText(ctx.page, 300)
      await ctx.shot('ai')
      ctx.note(`Transcript tab: "${transcript.slice(0, 80)}". AI tab: "${ai.slice(0, 80)}".`)
      return ok('both tabs opened with no request (running them is in the models pass)')
    },
  },
  {
    id: 'dialogs',
    name: 'Settings, keyboard shortcuts, What’s new',
    where: 'editor toolbar',
    async run(ctx) {
      await ensureProject(ctx)
      const failed = []
      for (const label of ['Settings', 'Keyboard shortcuts', 'What\'s new']) {
        try {
          await toolbarDialog(ctx, label)
        } catch (error) {
          failed.push(`${label}: ${String(error.message).split('\n')[0]}`)
          await closeDialogs(ctx.page)
        }
      }
      return failed.length ? { status: STATUS.scriptError, notes: `did not open: ${failed.join('; ')}` } : ok('all three opened')
    },
  },
  {
    id: 'debug-panel',
    name: 'Debug panel',
    where: 'editor toolbar (bug icon)',
    async run(ctx) {
      await ensureProject(ctx)
      const shown = await ctx.page.getByRole('button', { name: 'Debug panel' }).first().isVisible().catch(() => false)
      if (shown) {
        await ctx.page.getByRole('button', { name: 'Debug panel' }).first().click()
        await ctx.page.waitForTimeout(800)
        await ctx.shot('open')
        await closeDialogs(ctx.page)
        return ok('the debug panel opened')
      }
      return broken('the toolbar has no Debug panel button: the packaged build is a production build and the button is compiled in only for development builds (`import.meta.env.DEV`, studio/src/features/editor/components/toolbar.tsx:226), the same as in the web production build')
    },
  },
  {
    id: 'language',
    name: 'Interface language switcher',
    where: 'editor toolbar',
    async run(ctx) {
      await ensureProject(ctx)
      const trigger = ctx.page.getByRole('button', { name: /language/i }).first()
      await trigger.click({ timeout: 10000 })
      const items = await ctx.page.getByRole('menuitem').count()
      await ctx.shot('menu')
      await closeDialogs(ctx.page)
      return items >= 9 ? ok(`${items} languages in the menu`) : broken(`only ${items} menu items`)
    },
  },
  {
    id: 'workspaces',
    name: 'Workspaces Edit / Color / Motion',
    where: 'editor toolbar tabs',
    async run(ctx) {
      await ensureProject(ctx)
      for (const label of ['Color', 'Motion', 'Edit']) {
        await ctx.page.getByRole('tab', { name: label, exact: true }).or(ctx.page.getByRole('button', { name: label, exact: true })).first().click({ timeout: 10000 })
        await ctx.page.waitForTimeout(1200)
        await ctx.shot(label.toLowerCase())
      }
      return ok('each workspace opened (screenshots in the output folder)')
    },
  },
  {
    id: 'user-guide',
    name: 'User Guide link',
    where: 'editor toolbar (book icon)',
    async run(ctx) {
      await ensureProject(ctx)
      const before = ctx.app.windows().length
      ctx.act('click User Guide')
      await ctx.page.getByRole('link', { name: 'User Guide' }).click()
      await ctx.page.waitForTimeout(3000)
      const windows = ctx.app.windows()
      const urls = windows.map((window) => window.url())
      return ok(`windows ${before} → ${windows.length}: ${JSON.stringify(urls)}`)
    },
  },
  {
    id: 'mic',
    name: 'Mic recording (voiceover), with the fake microphone',
    where: 'timeline toolbar → Record voiceover',
    async run(ctx) {
      await ensureClipOnTimeline(ctx)
      const cards = () => ctx.page.locator('[draggable="true"]').filter({ hasText: /\.(mp4|wav|webm|m4a|ogg)/ }).count()
      await openTab(ctx.page, 'Media')
      const before = await cards()
      const record = ctx.page.getByRole('button', { name: 'Record voiceover' })
      await record.waitFor({ timeout: 15000 })
      ctx.act('click Record voiceover')
      await record.click({ timeout: 15000 })
      const stop = ctx.page.getByRole('button', { name: 'Stop and save' })
      const recording = await stop.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
      if (!recording) {
        // The app is still "requesting" the microphone: find out which step does not finish.
        const probe = await ctx.page.evaluate(async () => {
          const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))])
          const out = { devices: null, getUserMedia: null, mediaRecorderStart: null, mime: null }
          try {
            out.devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => `${d.kind}:${d.label || 'no label'}`)
            const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true, video: false }), 8000)
            out.getUserMedia = stream === 'timeout' ? 'timeout after 8 s' : `ok, ${stream.getAudioTracks().length} track(s)`
            if (stream !== 'timeout') {
              const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? null
              out.mime = mime
              const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
              const started = new Promise((resolve) => recorder.addEventListener('start', () => resolve('started'), { once: true }))
              recorder.start()
              out.mediaRecorderStart = await withTimeout(started, 5000)
              if (recorder.state !== 'inactive') recorder.stop()
              stream.getTracks().forEach((track) => track.stop())
            }
          } catch (error) {
            out.error = String(error)
          }
          return out
        })
        await ctx.shot('stuck')
        const spinner = await ctx.page.locator('button[aria-label="Record voiceover"]').isDisabled().catch(() => null)
        return broken(`the Record voiceover click never reached "recording": the button stays disabled (disabled=${spinner}), i.e. the app waits for the microphone. A direct probe in the same page: ${JSON.stringify(probe)}`)
      }
      await ctx.page.waitForTimeout(3000)
      await stop.click()
      await ctx.page.waitForTimeout(5000)
      const after = await cards()
      return after > before ? ok(`a new audio item was added (${before} → ${after} cards)`) : broken(`recording stopped but no media item appeared (${before} → ${after})`)
    },
  },
  {
    id: 'proxy',
    name: 'Proxy generation',
    where: 'media card menu → Generate Proxy',
    async run(ctx) {
      await ensureMedia(ctx, [ctx.fixtures.clip])
      const name = path.basename(ctx.fixtures.clip)
      await openCardMenu(ctx.page, name)
      ctx.act('click Generate Proxy')
      await clickMenuItem(ctx.page, /generate proxy/i)
      // The editor shows no toast for a proxy (see docs/feature-pass.md), so look at the card's menu: it offers
      // "Delete Proxy" once a proxy exists.
      const deadline = Date.now() + 150000
      while (Date.now() < deadline) {
        await ctx.page.waitForTimeout(5000)
        await openCardMenu(ctx.page, name)
        const ready = await ctx.page.getByRole('menuitem', { name: /delete proxy/i }).first().isVisible().catch(() => false)
        await closeDialogs(ctx.page)
        if (ready) return ok('the card now offers Delete Proxy: a proxy exists (no toast or progress was shown; see "Stored in")')
      }
      return broken('no proxy after 150 s: the card still offers Generate Proxy')
    },
  },
  {
    id: 'reverse',
    name: 'Reverse clip',
    where: 'timeline clip menu → Reverse',
    async run(ctx) {
      await ensureClipOnTimeline(ctx)
      const videoId = await ctx.page.evaluate(() => window.studio.clips.list().find((clip) => clip.type === 'video')?.id ?? null)
      if (!videoId) return { status: STATUS.scriptError, notes: 'no video clip on the timeline' }
      await openItemMenu(ctx.page, videoId)
      ctx.act('click Reverse')
      await clickMenuItem(ctx.page, /^reverse$/i)
      await ctx.page.waitForTimeout(8000)
      await openItemMenu(ctx.page, videoId)
      const unreverse = await ctx.page.getByRole('menuitem', { name: /unreverse/i }).first().isVisible().catch(() => false)
      await closeDialogs(ctx.page)
      return unreverse ? ok('the clip is reversed (the menu now offers Unreverse)') : broken('the clip was not reversed after 8 s')
    },
  },
  {
    id: 'url-import',
    name: 'Import media from a URL',
    where: 'Media → URL',
    async run(ctx) {
      await ensureProject(ctx)
      await openTab(ctx.page, 'Media')
      const body = fs.readFileSync(ctx.fixtures.urlClip)
      const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*' })
        response.end(body)
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${server.address().port}/fp-url-unique.mp4`
      try {
        // The URL button's text is hidden when the panel is narrow; its tooltip names it "Import Media From URL".
        await ctx.page.locator('button:has(svg.lucide-link)').filter({ hasNot: ctx.page.locator('[role=menuitem]') }).first().click({ timeout: 10000 })
        const dialog = ctx.page.getByRole('dialog').filter({ hasText: /import from url/i })
        await dialog.locator('input[type="url"]').fill(url)
        ctx.act('submit the URL')
        await dialog.locator('button[type="submit"]').click()
        await ctx.page.getByText('fp-url-unique.mp4', { exact: true }).first().waitFor({ timeout: 60000 })
        return ok('the file was fetched from the address typed by the user and added')
      } finally {
        server.close()
      }
    },
  },
  {
    id: 'embedded-subtitles',
    name: 'Captions from an embedded subtitle track',
    where: 'media card → Extract Embedded Subtitles; timeline clip → Extract Embedded Subtitles',
    async run(ctx) {
      const { page } = ctx
      const name = path.basename(ctx.fixtures.subtitled)
      await ensureClipOnTimeline(ctx)
      await ensureMedia(ctx, [ctx.fixtures.subtitled])
      // Step 1, in the media library: the menu scans the file and caches its tracks.
      await openCardMenu(page, name)
      ctx.act('click Extract Embedded Subtitles on the media card')
      await clickMenuItem(page, /extract embedded subtitles/i)
      const scan = page.getByRole('dialog').filter({ hasText: /subtitle scan/i })
      await scan.first().waitFor({ timeout: 60000 })
      await page.getByText(/subtitles cached|cached/i).first().waitFor({ timeout: 60000 })
      ctx.note('the media card scan finished ("Subtitle scan complete", the file shows Cached).')
      await scan.getByRole('button', { name: /^close$/i }).first().click()
      // Step 2, on the timeline: the clip's own menu opens the track list and inserts the captions. Placing the .mkv
      // is set-up (through the SDK, at the timeline's end): a drag fails once earlier features filled the timeline
      const placedId = await page.evaluate((fileName) => {
        const s = window.studio
        const media = s.media.list().find((item) => item.fileName === fileName)
        const track = s.tracks.list().find((candidate) => candidate.kind === 'video')
        if (!media || !track) return null
        return s.clips.add({ mediaId: media.id, trackId: track.id, from: s.project.duration(), onOverlap: 'move' }).id
      }, name)
      if (!placedId) return { status: STATUS.scriptError, notes: 'the .mkv clip could not be placed on the timeline' }
      await openItemMenu(page, placedId)
      await clickMenuItem(page, /extract embedded subtitles/i)
      const dialog = page.getByRole('dialog').filter({ hasText: /embedded subtitles/i })
      await dialog.first().waitFor({ timeout: 30000 })
      const dialogText = (await dialog.first().innerText()).replace(/\s+/g, ' ').slice(0, 200)
      if (dialogText.includes('{{')) ctx.note('the track row shows an untranslated placeholder ("{{lang}}"): a UI string bug.')
      await ctx.shot('tracks')
      const beforeInsert = await clipCount(page)
      await dialog.getByRole('button', { name: /^insert/i }).first().click({ timeout: 10000 })
      await page.waitForTimeout(3000)
      const after = await clipCount(page)
      return after > beforeInsert ? ok(`subtitle clip(s) inserted from the embedded track (${beforeInsert} → ${after}); dialog: ${dialogText}`) : broken(`the track dialog opened (${dialogText}) but choosing a track inserted nothing (${beforeInsert} → ${after})`)
    },
  },
  {
    id: 'bundle-export',
    name: 'Project bundle — export',
    where: 'Export menu → Download Project (.zip)',
    async run(ctx) {
      await ensureClipOnTimeline(ctx)
      await ctx.page.getByRole('button', { name: 'Export' }).first().click()
      ctx.act('click Download Project (.zip)')
      await clickMenuItem(ctx.page, /download project/i)
      await ctx.page.waitForTimeout(2500)
      const pickers = await ctx.pickers()
      return {
        status: STATUS.manual,
        notes: `the picker recorder saw ${pickers.length} call(s) after the click (${JSON.stringify(pickers.map((p) => p.name))}); a call is answered as a cancelled dialog`,
        manualStep: 'Export → Download Project (.zip), choose a folder in the macOS save dialog, then check the .zip opens and holds the media',
      }
    },
  },
  {
    id: 'bundle-import',
    name: 'Project bundle — import',
    where: 'Projects → Import Project',
    async run(ctx) {
      await ctx.page.goto('droneclean://app/projects')
      const button = ctx.page.getByRole('button', { name: /import project/i }).first()
      await button.waitFor({ timeout: 60000 })
      ctx.act('click Import Project')
      const [chooser] = await Promise.all([ctx.page.waitForEvent('filechooser', { timeout: 15000 }), button.click()])
      ctx.note(`the click opens a file chooser (multiple: ${chooser.isMultiple()}); the harness left it without a file.`)
      await chooser.setFiles([])
      return {
        status: STATUS.manual,
        notes: 'the Import Project button opens the system file chooser; a bundle needs the .zip that Export → Download Project makes, and that export ends in a macOS save dialog',
        manualStep: 'export a project bundle (see bundle-export), then Projects → Import Project, choose the .zip, pick a destination folder, Start Import, open the imported project',
      }
    },
  },
]
