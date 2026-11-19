/**
 * The page side of the `frame` tool (task 2.2 slice 3, design §4.6).
 *
 * The MCP server in the Electron main process renders nothing itself: it sends
 * a plan through `webContents.executeJavaScript` to this page, which reads the
 * live stores, builds the composition exactly as the export does
 * (`getExportableSequence` + `convertTimelineToComposition` +
 * `resolveMediaUrls`), and calls `renderSingleFrame` — the export's own renderer
 * (`canvas-render-orchestrator.ts`), fed with an integer timeline frame. What
 * the agent sees is therefore what the export will write, including unsaved
 * edits, and no frame index is turned into seconds on the way. The timeline is
 * the one the SDK edits — the Main timeline, or the composition that is open
 * for editing — so a frame number means the same thing to `frame` and to
 * `studio.clips`.
 *
 * One call renders one frame at a long edge (1280 px by default) and answers it
 * as base64 (`FramePngResult`), writes the project's own size to
 * `projects/{id}/frames/frame-N.png` and answers the path (`FramePathResult`)
 * when the plan says `full`, or tiles up to 12 sampled frames into one PNG and
 * answers that (the contact sheet). Every cell of a sheet is a full-size render
 * downscaled by `renderSingleFrame`, not a cheap thumbnail: the sheet is for
 * judging the edit, so its cells come from the same pixels as a single frame.
 *
 * The module is installed on the page by `installAgentFrame()`, which the app
 * entry point calls beside `installStudio()`; `frameTool` in the desktop shell
 * is its only caller. Rendering is serial by construction (the WebGPU device is
 * a tab-wide singleton); two MCP calls never overlap because main serialises
 * them.
 */
import type { FrameResult, StudioErrorJson } from '../../../mcp/protocol'
import { getExportableSequence } from '@/features/export/deps/timeline-compositions'
import { getActiveCompositionId } from '@/features/timeline/stores/composition-navigation-active'
import { resolveMediaUrls } from '@/features/export/deps/media-library'
import { useProjectStore } from '@/features/export/deps/projects'
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { projectDir } from '@/infrastructure/storage/workspace-fs/paths'
import { getWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { invalidArgumentError, studioError, StudioError } from '@/studio/sdk/errors'

/** Folder of written frames inside one project (design §4.6). */
const FRAMES_DIR = 'frames'

/**
 * One frame, at a long edge or at the project's own size (`full`).
 *
 * The plan is the MCP tool's resolved request: the tool has already validated
 * the caller's arguments and, for a sheet, chosen the sampled frames and the
 * grid. It crosses the page boundary as JSON, so it is plain data only.
 */
export interface SingleFramePlan {
  readonly kind: 'frame'
  /** Timeline frame to render, an integer from 0. */
  readonly frame: number
  /** Long edge of the answered PNG; ignored when `full` is set. */
  readonly width: number
  /** Write the PNG at the project's own size into `projects/{id}/frames/`. */
  readonly full: boolean
}

/** Frames sampled from a range and tiled into one PNG. */
export interface ContactSheetPlan {
  readonly kind: 'sheet'
  /** Timeline frames to render, in reading order. */
  readonly frames: readonly number[]
  /** Tile columns, 1 or more. */
  readonly columns: number
  /** Tile rows, 1 or more. */
  readonly rows: number
  /** Long edge of the composed sheet, in pixels. */
  readonly width: number
}

/** What the tool asks the page for. */
export type FramePlan = SingleFramePlan | ContactSheetPlan

/** What the page answers: the contract's result, or a `StudioError` JSON. */
export type FramePageAnswer =
  | { readonly result: FrameResult; readonly durationMs: number }
  | { readonly error: StudioErrorJson; readonly durationMs: number }

/** The live timeline the export would render, as much of it as a frame needs. */
export interface FrameSequenceView {
  /** Workspace id of the open project, or `null` when none is open. */
  readonly projectId: string | null
  /** Timeline length in frames; a valid frame is `0 … frames - 1`. */
  readonly frames: number
  /** Canvas width of the project, in pixels. */
  readonly width: number
  /** Canvas height of the project, in pixels. */
  readonly height: number
}

/**
 * The page work a plan needs, behind an interface so a test can run the rules
 * without a GPU. The default is `liveFrameEnvironment()`.
 */
export interface FrameEnvironment {
  /** Read the live sequence, as the export sees it. */
  sequence(): FrameSequenceView
  /** Render frames of the live sequence, in order, as PNG blobs at `width` × `height`. */
  render(frames: readonly number[], width: number, height: number): Promise<Blob[]>
  /** Write a PNG into the project's `frames/` folder; returns its workspace-relative path. */
  write(projectId: string, fileName: string, png: Blob): Promise<string>
  /** Tile cell PNGs into one sheet PNG of `columns` × `rows` cells. */
  compose(
    cells: readonly Blob[],
    columns: number,
    rows: number,
    cellWidth: number,
    cellHeight: number,
  ): Promise<Blob>
}

/** What the app entry point installs on the page for the MCP tool to call. */
export interface AgentFrame {
  /** Render one plan; never throws: a failure is a `StudioError` JSON. */
  render(plan: FramePlan): Promise<FramePageAnswer>
}

declare global {
  // The MCP `frame` tool in the desktop shell reaches this through executeJavaScript.
  var studioAgentFrame: AgentFrame | undefined
}

/** A size in pixels, both edges whole numbers of at least one. */
interface PixelSize {
  readonly width: number
  readonly height: number
}

/**
 * The size of a frame whose long edge is `longEdge`, keeping the project's
 * aspect: 3840×2880 at 1280 is 1280×960, 1080×1920 at 1280 is 720×1280.
 */
function fitToLongEdge(longEdge: number, width: number, height: number): PixelSize {
  if (width >= height) {
    return { width: longEdge, height: Math.max(1, Math.round((longEdge * height) / width)) }
  }
  return { width: Math.max(1, Math.round((longEdge * width) / height)), height: longEdge }
}

/** The sheet's cell and image sizes for a grid over a project of `width` × `height`. */
interface SheetGeometry {
  readonly cellWidth: number
  readonly cellHeight: number
  readonly width: number
  readonly height: number
}

/**
 * Lay a grid of project-shaped cells out so the sheet's long edge is `longEdge`:
 * cells are as large as that edge allows, and a grid taller than it is wide is
 * shrunk so neither edge of the sheet passes it.
 */
function sheetGeometry(
  longEdge: number,
  columns: number,
  rows: number,
  width: number,
  height: number,
): SheetGeometry {
  let cellWidth = Math.max(1, Math.floor(longEdge / columns))
  let cellHeight = Math.max(1, Math.round((cellWidth * height) / width))
  const longest = Math.max(cellWidth * columns, cellHeight * rows)
  if (longest > longEdge) {
    const scale = longEdge / longest
    cellWidth = Math.max(1, Math.floor(cellWidth * scale))
    cellHeight = Math.max(1, Math.floor(cellHeight * scale))
  }
  return {
    cellWidth,
    cellHeight,
    width: cellWidth * columns,
    height: cellHeight * rows,
  }
}

/** The file name of one written frame: `frame-42.png`. */
function frameFileName(frame: number): string {
  return `frame-${frame}.png`
}

/**
 * Base64 of a blob's bytes. `FileReader` is in every browser page and in the
 * jsdom tests alike, and encodes a multi-megabyte PNG in one go.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(reader.error ?? new Error('frame: the PNG could not be read'))
    }
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      const comma = url.indexOf(',')
      if (comma < 0) {
        reject(new Error('frame: the PNG could not be encoded as base64'))
        return
      }
      resolve(url.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/** The `StudioError` JSON of a failure inside the page. */
function errorJson(error: unknown): StudioErrorJson {
  if (error instanceof StudioError) return error.toJSON()
  // A StudioError carried across a chunk boundary is still a StudioError.
  if (
    typeof error === 'object' &&
    error !== null &&
    'toJSON' in error &&
    typeof error.toJSON === 'function'
  ) {
    return (error.toJSON as () => StudioErrorJson)()
  }
  return {
    name: 'StudioError',
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
  }
}

/** Every frame a plan renders, in order. */
function planFrames(plan: FramePlan): readonly number[] {
  return plan.kind === 'frame' ? [plan.frame] : plan.frames
}

/** The argument name a rejected frame is reported under. */
function frameArgument(plan: FramePlan): string {
  return plan.kind === 'frame' ? 'frame' : 'contactSheet'
}

/**
 * Check every frame against the live timeline. A frame outside it is the one
 * error only the page can raise, because only the page knows the length.
 */
function requireFramesInRange(plan: FramePlan, sequence: FrameSequenceView): void {
  const lastFrame = sequence.frames - 1
  for (const frame of planFrames(plan)) {
    if (!Number.isInteger(frame) || frame < 0) {
      throw invalidArgumentError({
        method: 'frame',
        argument: frameArgument(plan),
        expectation: 'an integer timeline frame from 0',
        value: frame,
      })
    }
    if (frame > lastFrame) {
      throw invalidArgumentError({
        method: 'frame',
        argument: frameArgument(plan),
        expectation:
          lastFrame < 0
            ? 'a frame of a timeline with at least one clip'
            : `an integer timeline frame from 0 to ${lastFrame}`,
        value: frame,
        hint:
          lastFrame < 0
            ? 'The timeline is empty: add a clip with studio.clips.add first.'
            : `The open project is ${sequence.frames} frames long; pass a frame in 0…${lastFrame}.`,
      })
    }
  }
}

/** The one PNG the renderer answered, or an `INTERNAL` error when it answered none. */
function requirePng(png: Blob | undefined): Blob {
  if (!png) {
    throw studioError({
      code: 'INTERNAL',
      method: 'frame',
      message: 'the renderer answered no PNG for the frame',
    })
  }
  return png
}

/** One frame, at the plan's long edge or at the project's own size. */
async function renderSingle(
  plan: SingleFramePlan,
  sequence: FrameSequenceView,
  projectId: string,
  environment: FrameEnvironment,
): Promise<FrameResult> {
  if (plan.full) {
    const [png] = await environment.render([plan.frame], sequence.width, sequence.height)
    const rendered = requirePng(png)
    const path = await environment.write(projectId, frameFileName(plan.frame), rendered)
    return {
      path,
      bytes: rendered.size,
      width: sequence.width,
      height: sequence.height,
    }
  }
  const size = fitToLongEdge(plan.width, sequence.width, sequence.height)
  const [png] = await environment.render([plan.frame], size.width, size.height)
  const rendered = requirePng(png)
  return {
    png: await blobToBase64(rendered),
    bytes: rendered.size,
    width: size.width,
    height: size.height,
  }
}

/** The sampled frames tiled into one PNG. */
async function renderSheet(
  plan: ContactSheetPlan,
  sequence: FrameSequenceView,
  environment: FrameEnvironment,
): Promise<FrameResult> {
  const geometry = sheetGeometry(plan.width, plan.columns, plan.rows, sequence.width, sequence.height)
  const cells = await environment.render(plan.frames, geometry.cellWidth, geometry.cellHeight)
  if (cells.length !== plan.frames.length) {
    throw studioError({
      code: 'INTERNAL',
      method: 'frame',
      message: `the renderer answered ${cells.length} PNGs for ${plan.frames.length} sampled frames`,
    })
  }
  const sheet = await environment.compose(
    cells,
    plan.columns,
    plan.rows,
    geometry.cellWidth,
    geometry.cellHeight,
  )
  return {
    png: await blobToBase64(sheet),
    bytes: sheet.size,
    width: geometry.width,
    height: geometry.height,
  }
}

/**
 * Render one plan against the live editor and answer the contract's result, or
 * a `StudioError` JSON. It never throws: the MCP tool turns either into a tool
 * result.
 * @example await renderFramePlan({ kind: 'frame', frame: 120, width: 1280, full: false })
 */
export async function renderFramePlan(
  plan: FramePlan,
  environment: FrameEnvironment = liveFrameEnvironment(),
): Promise<FramePageAnswer> {
  const startedAt = Date.now()
  try {
    const sequence = environment.sequence()
    const projectId = sequence.projectId
    if (projectId === null) {
      throw studioError({
        code: 'NOT_FOUND',
        method: 'frame',
        message: 'no project is open',
        hint: 'Open one with studio.project.open(id), or create one with studio.project.create.',
      })
    }
    if (!(sequence.width > 0) || !(sequence.height > 0)) {
      throw studioError({
        code: 'UNSUPPORTED',
        method: 'frame',
        message: 'the open project has no canvas size, so nothing can be rendered',
      })
    }
    requireFramesInRange(plan, sequence)
    const result =
      plan.kind === 'frame'
        ? await renderSingle(plan, sequence, projectId, environment)
        : await renderSheet(plan, sequence, environment)
    return { result, durationMs: Date.now() - startedAt }
  } catch (error) {
    return { error: errorJson(error), durationMs: Date.now() - startedAt }
  }
}

/**
 * Tile rendered cells into one PNG. Cells are drawn in reading order; a grid
 * with more tiles than cells leaves its last tiles transparent (the tool only
 * chooses grids with room for every cell).
 */
async function composeSheetCells(
  cells: readonly Blob[],
  columns: number,
  rows: number,
  cellWidth: number,
  cellHeight: number,
): Promise<Blob> {
  const sheet = new OffscreenCanvas(cellWidth * columns, cellHeight * rows)
  const context = sheet.getContext('2d')
  if (!context) {
    throw new Error('frame: a 2D context for the contact sheet could not be created')
  }
  context.imageSmoothingQuality = 'high'
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]
    if (!cell) continue
    const bitmap = await createImageBitmap(cell)
    try {
      const column = index % columns
      const row = Math.floor(index / columns)
      context.drawImage(bitmap, column * cellWidth, row * cellHeight, cellWidth, cellHeight)
    } finally {
      bitmap.close()
    }
  }
  return sheet.convertToBlob({ type: 'image/png' })
}

/**
 * The real environment: the export's own snapshot and composition, the
 * export's own single-frame renderer, and the workspace writer.
 *
 * Everything heavy is imported when a frame is first asked for (as the
 * thumbnail path does), so carrying `frame` in the page costs nothing at
 * startup.
 */
function liveFrameEnvironment(): FrameEnvironment {
  return {
    sequence() {
      // The context the SDK edits: the Main timeline, or the composition that
      // is open for editing — the same timeline `studio.clips.list()` reads, so
      // a frame number means the same thing to `frame` and to an edit.
      const sequence = getExportableSequence(getActiveCompositionId())
      return {
        projectId: useProjectStore.getState().currentProject?.id ?? null,
        frames: sequence.durationFrames,
        width: sequence.width,
        height: sequence.height,
      }
    },

    async render(frames, width, height) {
      const sequence = getExportableSequence(getActiveCompositionId())
      const composition = convertTimelineToComposition(
        sequence.tracks,
        sequence.items,
        sequence.transitions,
        sequence.fps,
        sequence.width,
        sequence.height,
        null,
        null,
        sequence.keyframes,
        sequence.backgroundColor,
        sequence.busAudioEq,
        sequence.masterBusDb,
      )
      // Export never proxies: a frame must come from the source pixels.
      composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })
      const { renderSingleFrame } = await import('@/runtime/renderer/canvas-render-orchestrator')
      const pngs: Blob[] = []
      for (const frame of frames) {
        pngs.push(
          await renderSingleFrame({ composition, frame, width, height, format: 'image/png' }),
        )
      }
      return pngs
    },

    async write(projectId, fileName, png) {
      const root = getWorkspaceRoot()
      if (!root) {
        throw studioError({
          code: 'UNSUPPORTED',
          method: 'frame',
          message: 'no workspace folder is open, so the PNG has nowhere to go',
          hint: 'Choose the workspace folder in the app first, or drop full and take the PNG as base64.',
        })
      }
      const segments = [...projectDir(projectId), FRAMES_DIR, fileName]
      await writeBlob(root, segments, png)
      return segments.join('/')
    },

    compose: composeSheetCells,
  }
}

/**
 * Put the frame renderer on the page as `globalThis.studioAgentFrame`. The app
 * entry point calls this once, beside `installStudio()`; calling it again
 * replaces the object with an identical one.
 * @example installAgentFrame().render({ kind: 'frame', frame: 0, width: 1280, full: false })
 */
export function installAgentFrame(): AgentFrame {
  const agentFrame: AgentFrame = {
    render(plan) {
      return renderFramePlan(plan)
    },
  }
  globalThis.studioAgentFrame = agentFrame
  return agentFrame
}
