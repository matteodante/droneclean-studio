/** Steps several features need: a project open, media in the library, a clip on the timeline. All idempotent. */
import path from 'node:path'
import { clipCount, createProject, dragCardToTimeline, importByDrop, mediaCard, onEditor, openTab, closeDialogs } from './ui.mjs'

const PROJECT_NAME = 'Feature pass'

export async function ensureProject(ctx) {
  if (!(await onEditor(ctx.page))) {
    if (ctx.shared.projectCreated) {
      await ctx.page.goto('droneclean://app/projects')
      await ctx.page.getByText(PROJECT_NAME, { exact: true }).first().dblclick({ timeout: 60000 })
      await ctx.page.waitForURL(/\/editor\//, { timeout: 120000 })
      await ctx.page.waitForTimeout(3000)
    } else {
      await createProject(ctx.page, PROJECT_NAME)
      ctx.shared.projectCreated = true
    }
  }
  ctx.shared.projectCreated = true
}

/** Makes sure the files are cards in the media library (dropped once per profile). */
export async function ensureMedia(ctx, files) {
  await ensureProject(ctx)
  await openTab(ctx.page, 'Media')
  const missing = []
  for (const file of files) {
    const present = await mediaCard(ctx.page, path.basename(file)).isVisible().catch(() => false)
    if (!present) missing.push(file)
  }
  if (missing.length) await importByDrop(ctx.page, missing)
}

export async function ensureClipOnTimeline(ctx, file = ctx.fixtures.clip) {
  await ensureMedia(ctx, [file])
  if ((await clipCount(ctx.page)) === 0) await dragCardToTimeline(ctx.page, path.basename(file))
  await closeDialogs(ctx.page)
}

/** Selects the first clip on the timeline with a real click. */
export async function selectFirstClip(ctx) {
  await ctx.page.locator('[data-timeline-item][data-item-id]').first().click()
}
