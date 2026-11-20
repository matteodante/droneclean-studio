/**
 * `frame`: a rendered PNG of the timeline (task 2.2 slice 3, design §4.6).
 *
 * The tool renders nothing itself. It validates the caller's arguments, turns
 * them into the plan the page renders (one frame, or a sheet's sampled frames
 * and grid), and sends that plan through `webContents.executeJavaScript` to
 * `globalThis.studioAgentFrame`, which `src/studio/agent/frame.ts` installs.
 * That page module builds the composition exactly as the export does and calls
 * the export's own `renderSingleFrame`, so a frame is what the export would
 * write at that integer frame index: unsaved edits included, no seconds
 * anywhere.
 *
 * What crosses back is the contract's `FrameResult`: base64 PNG bytes with
 * their size and pixel size, or — when the plan said `full` — the
 * workspace-relative path of the PNG written to `projects/{id}/frames/`. The
 * argument rules live here so a bad call costs no render: at most
 * `MAX_FRAME_COUNT` sampled frames, one of `frame` and `contactSheet`, a width
 * in 16…8192, and `full` only for a single frame (a sheet is always
 * downscaled; `full` at the project's size would be a canvas of many thousand
 * pixels per edge).
 */
import type { FrameRequest, FrameResult, StudioErrorJson } from '../../../../../mcp/protocol'
import { DEFAULT_FRAME_WIDTH, MAX_FRAME_COUNT } from '../protocol'
import { agentError, isStudioErrorJson } from '../errors'
import { PageTimeoutError, PageUnavailableError, RUN_ABORT_GLOBAL } from '../page'
import { pageFailureOutcome, timeoutOutcome } from './page-failure'
import type { PageBridge, ToolOutcome } from '../types'

/** Narrowest and widest long edge a caller may ask for (the server's schema agrees). */
const MIN_FRAME_WIDTH = 16
const MAX_FRAME_WIDTH = 8192

/**
 * Largest base64 PNG one call may answer. Claude Code caps one response at
 * 16 MiB, and the default 1280 px frame measured 3.13 MB of base64 on a 4K
 * frame; 8 MiB leaves the default far from the limit while still refusing a
 * `width` no client could carry.
 */
const MAX_FRAME_BASE64_BYTES = 8 * 1024 * 1024

/** How long main waits for the page: a full frame and a sheet are seconds, not minutes. */
const FRAME_TIMEOUT_MS = 120000

/** What `frame` advises after a timeout. */
const FRAME_RETRY = 'try a smaller width or a single frame.'

/**
 * The plan the page renders. It mirrors `FramePlan` in
 * `src/studio/agent/frame.ts` field for field — the two files cannot share the
 * type (the desktop's `tsc` program is rooted at its own `src`), so the tool
 * test and the page test pin the same JSON.
 */
export type FramePlanJson =
  | { kind: 'frame'; frame: number; width: number; full: boolean }
  | { kind: 'sheet'; frames: number[]; columns: number; rows: number; width: number }

/** A validated request: the plan, or the error the tool answers. */
type PlanOutcome = { plan: FramePlanJson } | { error: StudioErrorJson }

/** `INVALID_ARGUMENT` for an argument this file can judge without the page. */
function invalidArgument(
  message: string,
  argument: string,
  hint?: string,
  valid?: readonly string[],
): { error: StudioErrorJson } {
  return {
    error: agentError('INVALID_ARGUMENT', message, {
      argument,
      ...(valid !== undefined && { valid }),
      ...(hint !== undefined && { hint }),
    }).json,
  }
}

/** A whole number of at least `min`. */
function isWholeAtLeast(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

/** The width of the answered frame, checked against the same bounds the schema has. */
function planWidth(request: FrameRequest): number | { error: StudioErrorJson } {
  const width = request.width ?? DEFAULT_FRAME_WIDTH
  if (!isWholeAtLeast(width, MIN_FRAME_WIDTH) || width > MAX_FRAME_WIDTH) {
    return invalidArgument(
      `frame: "width" must be an integer from ${MIN_FRAME_WIDTH} to ${MAX_FRAME_WIDTH} (got ${JSON.stringify(width)})`,
      'width',
      `The long edge of the PNG; the default is ${DEFAULT_FRAME_WIDTH}.`,
    )
  }
  return width
}

/** The frames a sheet samples: every `step`-th frame of `from … to`, ends included. */
function sampledFrames(from: number, to: number, step: number | undefined): {
  frames: number[]
  step: number
} {
  // An absent step is chosen to fit the cap: a caller asking for a whole
  // timeline by range alone gets at most MAX_FRAME_COUNT cells.
  const chosen = step ?? Math.max(1, Math.ceil((to - from) / (MAX_FRAME_COUNT - 1)))
  const frames: number[] = []
  for (let frame = from; frame <= to; frame += chosen) {
    frames.push(frame)
  }
  return { frames, step: chosen }
}

/** The grid a sheet is laid out in, checked against the frames it must hold. */
function planGrid(
  request: NonNullable<FrameRequest['contactSheet']>,
  count: number,
): { columns: number; rows: number } | { error: StudioErrorJson } {
  const { columns, rows } = request
  if (columns !== undefined && (!isWholeAtLeast(columns, 1) || columns > MAX_FRAME_COUNT)) {
    return invalidArgument(
      `frame: "contactSheet.columns" must be an integer from 1 to ${MAX_FRAME_COUNT} (got ${JSON.stringify(columns)})`,
      'contactSheet.columns',
    )
  }
  if (rows !== undefined && (!isWholeAtLeast(rows, 1) || rows > MAX_FRAME_COUNT)) {
    return invalidArgument(
      `frame: "contactSheet.rows" must be an integer from 1 to ${MAX_FRAME_COUNT} (got ${JSON.stringify(rows)})`,
      'contactSheet.rows',
    )
  }
  const resolvedColumns = columns ?? Math.min(MAX_FRAME_COUNT, Math.ceil(Math.sqrt(count)))
  const resolvedRows = rows ?? Math.ceil(count / resolvedColumns)
  if (resolvedColumns * resolvedRows < count) {
    return invalidArgument(
      `frame: a ${resolvedColumns}×${resolvedRows} grid has ${resolvedColumns * resolvedRows} tiles for ${count} frames`,
      'contactSheet.rows',
      `Pass rows at least ${Math.ceil(count / resolvedColumns)}, or fewer columns.`,
    )
  }
  return { columns: resolvedColumns, rows: resolvedRows }
}

/** The plan of a `contactSheet` request, or the error to answer. */
function sheetPlan(
  request: FrameRequest,
  sheet: NonNullable<FrameRequest['contactSheet']>,
  width: number,
): PlanOutcome {
  if (request.full === true) {
    return invalidArgument(
      'frame: "full" writes one frame at the project size; a contact sheet is always downscaled',
      'full',
      'Ask for a single frame with frame + full, or drop full for a sheet.',
    )
  }
  if (!isWholeAtLeast(sheet.from, 0)) {
    return invalidArgument(
      `frame: "contactSheet.from" must be an integer frame from 0 (got ${JSON.stringify(sheet.from)})`,
      'contactSheet.from',
    )
  }
  if (!isWholeAtLeast(sheet.to, 0)) {
    return invalidArgument(
      `frame: "contactSheet.to" must be an integer frame from 0 (got ${JSON.stringify(sheet.to)})`,
      'contactSheet.to',
    )
  }
  if (sheet.to < sheet.from) {
    return invalidArgument(
      `frame: "contactSheet.to" must be at least "contactSheet.from" (got from ${sheet.from}, to ${sheet.to})`,
      'contactSheet.to',
    )
  }
  if (sheet.step !== undefined && !isWholeAtLeast(sheet.step, 1)) {
    return invalidArgument(
      `frame: "contactSheet.step" must be an integer from 1 (got ${JSON.stringify(sheet.step)})`,
      'contactSheet.step',
    )
  }
  const sampled = sampledFrames(sheet.from, sheet.to, sheet.step)
  if (sampled.frames.length > MAX_FRAME_COUNT) {
    const fewestStep = Math.ceil((sheet.to - sheet.from) / (MAX_FRAME_COUNT - 1))
    return invalidArgument(
      `frame: "contactSheet.step" ${sampled.step} samples ${sampled.frames.length} frames from ${sheet.from} to ${sheet.to}; the limit is ${MAX_FRAME_COUNT}`,
      'contactSheet.step',
      `Pass step ${fewestStep} or more, or a shorter range.`,
    )
  }
  const grid = planGrid(sheet, sampled.frames.length)
  if ('error' in grid) return grid
  return {
    plan: {
      kind: 'sheet',
      frames: sampled.frames,
      columns: grid.columns,
      rows: grid.rows,
      width,
    },
  }
}

/** The plan of a one-frame request, or the error to answer. */
function singlePlan(
  request: FrameRequest,
  frame: number,
  width: number,
): PlanOutcome {
  if (!isWholeAtLeast(frame, 0)) {
    return invalidArgument(
      `frame: "frame" must be an integer frame from 0 (got ${JSON.stringify(frame)})`,
      'frame',
      'Frame numbers are timeline frames; studio.project.duration() gives the length.',
    )
  }
  if (request.full === true && request.width !== undefined) {
    return invalidArgument(
      'frame: "width" cannot be combined with "full"; full writes at the project\'s own size',
      'width',
      'Drop width for the project size, or drop full and take the PNG as base64 at a long edge.',
    )
  }
  return { plan: { kind: 'frame', frame, width, full: request.full === true } }
}

/**
 * Validate the call and resolve it into the page's plan. Every rule here is
 * answerable without the editor; the project's length is checked on the page,
 * which is the only side that knows it.
 */
export function framePlan(request: FrameRequest): PlanOutcome {
  if (typeof request !== 'object' || request === null) {
    return invalidArgument('frame: the arguments must be an object', 'frame')
  }
  const hasFrame = request.frame !== undefined
  const hasSheet = request.contactSheet !== undefined
  if (hasFrame && hasSheet) {
    return invalidArgument(
      'frame: pass one of "frame" (one frame) or "contactSheet" (a sheet), not both',
      'contactSheet',
    )
  }
  if (!hasFrame && !hasSheet) {
    return invalidArgument(
      'frame: pass one of "frame" (one frame) or "contactSheet" (a sheet of up to ' +
        `${MAX_FRAME_COUNT} sampled frames)`,
      'frame',
    )
  }
  const width = planWidth(request)
  if (typeof width !== 'number') return width
  if (request.full !== undefined && typeof request.full !== 'boolean') {
    return invalidArgument(
      `frame: "full" must be true or false (got ${JSON.stringify(request.full)})`,
      'full',
    )
  }
  if (request.contactSheet !== undefined) {
    if (typeof request.contactSheet !== 'object' || request.contactSheet === null) {
      return invalidArgument(
        'frame: "contactSheet" must be an object with from and to',
        'contactSheet',
      )
    }
    return sheetPlan(request, request.contactSheet, width)
  }
  if (request.frame === undefined) {
    return invalidArgument('frame: "frame" is missing', 'frame')
  }
  return singlePlan(request, request.frame, width)
}

/**
 * The JavaScript expression sent to the editor page. It is a self-contained
 * IIFE returning a promise of plain JSON: no identifier of this file is visible
 * in the page, and `globalThis.studioAgentFrame` is the module
 * `src/studio/agent/frame.ts` installs.
 */
export function buildFrameScript(plan: FramePlanJson): string {
  return `(async () => {
  const frame = globalThis.studioAgentFrame
  if (!frame || typeof frame.render !== 'function') {
    return { error: { name: 'StudioError', code: 'UNSUPPORTED', message: 'frame: this editor page has no frame renderer installed', hint: 'Reload the editor; if it keeps happening, the app build is older than the tool.' } }
  }
  globalThis.${RUN_ABORT_GLOBAL} = new AbortController()
  return await frame.render(${JSON.stringify(plan)})
})()`
}

/** Whether a value is the contract's `FrameResult`. */
function isFrameResult(value: unknown): value is FrameResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const sized =
    typeof candidate.bytes === 'number' &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number'
  if (!sized) return false
  return typeof candidate.png === 'string' || typeof candidate.path === 'string'
}

/**
 * The bridge a tool registered without the editor page answers through: it
 * refuses every call with the message that the wiring is missing, so a build
 * that forgot the `server.ts` line fails loudly instead of rendering nothing.
 */
const UNBOUND_PAGE: PageBridge = {
  execute() {
    return Promise.reject(
      new PageUnavailableError('the tool was registered without the editor page'),
    )
  },
}

/**
 * Validate the call, render it through the page, and answer the contract's
 * result or the `StudioError` JSON. A PNG over `MAX_FRAME_BASE64_BYTES` is
 * refused rather than silently shrunk: the caller's `width` picked it, so the
 * caller can pick a smaller one.
 *
 * `page` is the server's one window bridge; the registration in `server.ts`
 * passes it (`frame: (request) => frameTool(request, options.page)`), and the
 * default only exists so the tool's own registration type-checks and reports
 * its missing wiring as a typed `UNSUPPORTED`.
 */
export async function frameTool(
  request: FrameRequest,
  page: PageBridge = UNBOUND_PAGE,
): Promise<ToolOutcome> {
  const planned = framePlan(request)
  if ('error' in planned) return { error: planned.error }
  const plan = planned.plan

  if (page === UNBOUND_PAGE) {
    return {
      error: agentError(
        'UNSUPPORTED',
        'frame: the tool was registered without the editor page, so a frame cannot be rendered',
        {
          hint: 'This app build does not wire frame to the editor window; update the app, or use run/search for now.',
        },
      ).json,
    }
  }

  let answer: unknown
  try {
    answer = await page.execute(buildFrameScript(plan), FRAME_TIMEOUT_MS, { recover: true })
  } catch (error) {
    if (error instanceof PageTimeoutError) {
      return timeoutOutcome('frame', error, FRAME_TIMEOUT_MS, FRAME_RETRY)
    }
    const failure = pageFailureOutcome('frame', error)
    if (failure !== null) return failure
    throw error
  }

  if (typeof answer !== 'object' || answer === null) {
    return {
      error: agentError('INTERNAL', 'frame: the editor answered no result', {
        hint: 'Try again; if it keeps happening, reload the app.',
      }).json,
    }
  }
  const record = answer as Record<string, unknown>
  if (record.error !== undefined) {
    if (isStudioErrorJson(record.error)) return { error: record.error }
    return {
      error: agentError(
        'INTERNAL',
        `frame: the editor answered an unknown error ${JSON.stringify(record.error)}`,
      ).json,
    }
  }
  if (!isFrameResult(record.result)) {
    return {
      error: agentError(
        'INTERNAL',
        'frame: the editor answered a result this build does not understand',
      ).json,
    }
  }
  const result = record.result
  if ('png' in result && result.png.length > MAX_FRAME_BASE64_BYTES) {
    return {
      error: agentError(
        'INVALID_ARGUMENT',
        `frame: the PNG at width ${result.width} is ${result.bytes} bytes ` +
          `(${result.png.length} base64); the limit is ${MAX_FRAME_BASE64_BYTES}`,
        {
          argument: 'width',
          hint: 'Pass a smaller width (640 or 960), or full: true to have the PNG written to the workspace.',
        },
      ).json,
    }
  }
  return { result }
}
