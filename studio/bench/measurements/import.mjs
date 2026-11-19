// 6. Import: the six clips of Sunday 15 Nov 2026, dropped on the media library at once, imported through the
// editor's own drop path (`extractValidMediaFileEntriesFromDataTransfer` -> `useMediaLibraryStore.importHandles`).
// Recorded: the drop-to-ready total, each clip's import call, the descriptors the workspace gains, and the growth
// of the workspace (OPFS) and of the Chrome profile.
import { openBenchPage } from '../lib/browser.mjs'
import { duBytes } from '../lib/proc.mjs'
import { resolveImportClips, summariseImport } from '../lib/imports.mjs'

export const name = 'import'

const TIME_LIMIT_SECONDS = 10
const GROWTH_LIMIT_BYTES = 50 * 2 ** 20
const IMPORT_TIMEOUT_MS = 180_000

/** Dispatch an OS-style file drop at the centre of the page; Chrome turns the paths into real file handles. */
async function dropFiles(context, page, files) {
  const cdp = await context.newCDPSession(page)
  const data = { items: [], files, dragOperationsMask: 1 }
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', {
      type,
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
      data,
    })
  }
}

export async function measure(ctx) {
  const clips = resolveImportClips(ctx.config.importDir)
  const run = await openBenchPage({
    cache: ctx.config.cache,
    media: {},
    pagePath: '/bench/page/import.html',
    requireGpu: false,
  })
  try {
    const prepared = await run.page.evaluate(() => window.benchImport.prepare())
    const profileBefore = duBytes(run.profileDir)

    await dropFiles(
      run.context,
      run.page,
      clips.map((clip) => clip.path),
    )
    await run.page.waitForFunction(
      () => {
        const phase = window.benchImport?.getState().phase
        return phase === 'done' || phase === 'failed'
      },
      null,
      { timeout: IMPORT_TIMEOUT_MS },
    )
    const state = await run.page.evaluate(() => window.benchImport.getState())
    const workspaceAfter = await run.page.evaluate(() => window.benchImport.workspaceStats())
    const { links, copiedSourceFiles } = await run.page.evaluate(() =>
      window.benchImport.linkDescriptors(),
    )
    const profileAfter = duBytes(run.profileDir)

    const workspaceGrowthBytes = workspaceAfter.bytes - prepared.workspaceBytes
    const summary = summariseImport({
      timings: state.timings,
      totalSeconds: state.totalSeconds,
      workspaceGrowthBytes,
      timeLimitSeconds: TIME_LIMIT_SECONDS,
      growthLimitBytes: GROWTH_LIMIT_BYTES,
    })

    if (state.phase === 'failed') {
      throw new Error(`the import failed: ${state.error}`)
    }

    return {
      ...(await ctx.header(name, {
        importFolder: ctx.config.importDir,
        clips: clips.map((clip) => ({
          fileName: clip.fileName,
          path: clip.path,
          bytes: clip.bytes,
          lastModifiedMs: clip.lastModifiedMs,
        })),
      })),
      browser: {
        chromeVersion: run.chromeVersion,
        webgpuAdapter: null,
      },
      parameters: {
        how: "the app's own drop path: extractValidMediaFileEntriesFromDataTransfer -> useMediaLibraryStore.importHandles; the files are a CDP Input.dispatchDragEvent drop, so DataTransferItem.getAsFileSystemHandle() returns real disk handles",
        storageMode: 'link (the default for every import that has a FileSystemFileHandle)',
        workspace:
          'OPFS directory selected with setWorkspaceRoot (a native folder picker cannot be automated)',
        clips: clips.map((clip) => clip.fileName),
        timeLimitSeconds: TIME_LIMIT_SECONDS,
        growthLimitBytes: GROWTH_LIMIT_BYTES,
      },
      result: {
        ...summary,
        phase: state.phase,
        dropErrors: state.dropErrors,
        libraryCount: state.libraryCount,
        perClip: state.timings,
        imported: state.imported,
        workspace: {
          beforeBytes: prepared.workspaceBytes,
          afterBytes: workspaceAfter.bytes,
          growthBytes: workspaceGrowthBytes,
          filesAfter: workspaceAfter.files,
          originUsageBeforeBytes: prepared.originUsageBytes,
          originUsageAfterBytes: workspaceAfter.originUsageBytes,
        },
        profileFolder: {
          profileDir: run.profileDir,
          beforeBytes: profileBefore,
          afterBytes: profileAfter,
          growthBytes: profileAfter - profileBefore,
        },
        linkDescriptors: {
          count: links.length,
          links,
          /** Empty means every media is linked: no source bytes were copied into the workspace. */
          copiedSourceFiles,
        },
        bytesRead: null,
        bytesReadNote:
          'The media worker reads the file through Blob.stream/slice inside a worker; the page cannot instrument those reads without changing the editor. Not measured.',
      },
    }
  } finally {
    await run.close()
  }
}
