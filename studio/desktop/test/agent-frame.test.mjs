/**
 * `frame`: the argument rules and the result shapes (task 2.2 slice 3).
 *
 * The page is a fake bridge here: it records the script the tool would send and
 * answers a canned result, which is the same boundary as
 * `webContents.executeJavaScript` (a string in, JSON out) without Electron and
 * without a GPU. What the page actually renders — the pixels, the sizes and the
 * times — is measured in Chrome against the dev server and reported with the
 * slice; this file pins what the tool accepts, refuses, and passes through.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PageTimeoutError,
  PageUnavailableError,
} from '../out/main/mcp/page.js'
import { framePlan, frameTool } from '../out/main/mcp/tools/frame.js'

/** A page bridge that records each call and answers what it is told to. */
function fakePage(answer) {
  const calls = []
  return {
    calls,
    execute(code, timeoutMs) {
      calls.push({ code, timeoutMs })
      return Promise.resolve(typeof answer === 'function' ? answer(code) : answer)
    },
  }
}

/** The plan object a script carries, parsed back out of the page call. */
function planOf(call) {
  const match = /return await frame\.render\((.*)\)\n\}\)\(\)$/s.exec(call.code)
  assert.ok(match, `the script carries a plan: ${call.code}`)
  return JSON.parse(match[1])
}

/** A PNG result as the page answers it: two bytes of "PNG", base64 "UE5H". */
function pngResult(overrides = {}) {
  return { result: { png: 'UE5H', bytes: 3, width: 1280, height: 720, ...overrides } }
}

test('neither frame nor contactSheet is INVALID_ARGUMENT naming frame', async () => {
  const page = fakePage(pngResult())
  const outcome = await frameTool({}, page)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.name, 'StudioError')
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'frame')
  assert.equal(page.calls.length, 0, 'a rejected call never reaches the page')
})

test('frame and contactSheet together is INVALID_ARGUMENT naming contactSheet', async () => {
  const outcome = await frameTool({ frame: 0, contactSheet: { from: 0, to: 1 } }, fakePage(pngResult()))
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'contactSheet')
})

test('a frame that is not a whole number from 0 is INVALID_ARGUMENT naming frame', async () => {
  for (const frame of [-1, 1.5, '120']) {
    const page = fakePage(pngResult())
    const outcome = await frameTool({ frame }, page)
    assert.ok('error' in outcome, `frame ${JSON.stringify(frame)} is refused`)
    assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
    assert.equal(outcome.error.argument, 'frame')
    assert.equal(page.calls.length, 0)
  }
})

test('a width outside 16…8192 is INVALID_ARGUMENT naming width', async () => {
  for (const width of [0, 15, 8193, 12.5]) {
    const outcome = await frameTool({ frame: 0, width }, fakePage(pngResult()))
    assert.ok('error' in outcome)
    assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
    assert.equal(outcome.error.argument, 'width')
    assert.deepEqual(outcome.error.valid, undefined)
  }
})

test('full with an explicit width is INVALID_ARGUMENT naming width', async () => {
  const outcome = await frameTool({ frame: 0, full: true, width: 640 }, fakePage({ result: {} }))
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'width')
})

test('a default frame plans 1280 px and answers the page’s base64 result unchanged', async () => {
  const answer = pngResult()
  const page = fakePage(answer)
  const outcome = await frameTool({ frame: 120 }, page)
  assert.ok('result' in outcome)
  assert.deepEqual(outcome.result, answer.result)
  assert.equal(page.calls.length, 1)
  assert.equal(page.calls[0].timeoutMs, 120000)
  assert.match(page.calls[0].code, /globalThis\.studioAgentFrame/)
  assert.deepEqual(planOf(page.calls[0]), { kind: 'frame', frame: 120, width: 1280, full: false })
})

test('full plans the project size and answers the written path', async () => {
  const path = 'projects/p1/frames/frame-42.png'
  const page = fakePage({ result: { path, bytes: 14_600_000, width: 3840, height: 2880 } })
  const outcome = await frameTool({ frame: 42, full: true }, page)
  assert.ok('result' in outcome)
  assert.equal(outcome.result.path, path)
  assert.equal(outcome.result.bytes, 14_600_000)
  assert.deepEqual(planOf(page.calls[0]), { kind: 'frame', frame: 42, width: 1280, full: true })
})

test('a range with no step samples at most twelve frames, ends included', async () => {
  const page = fakePage(pngResult({ width: 1278, height: 480 }))
  const outcome = await frameTool({ contactSheet: { from: 0, to: 100 } }, page)
  assert.ok('result' in outcome)
  const plan = planOf(page.calls[0])
  assert.equal(plan.kind, 'sheet')
  assert.deepEqual(plan.frames, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  assert.equal(plan.columns, 4)
  assert.equal(plan.rows, 3)
  assert.equal(plan.width, 1280)
})

test('a six-frame sheet from a step is a 3 × 2 grid in reading order', async () => {
  const page = fakePage(pngResult({ width: 1278, height: 480 }))
  const outcome = await frameTool({ contactSheet: { from: 0, to: 10, step: 2 } }, page)
  assert.ok('result' in outcome)
  assert.deepEqual(planOf(page.calls[0]), {
    kind: 'sheet',
    frames: [0, 2, 4, 6, 8, 10],
    columns: 3,
    rows: 2,
    width: 1280,
  })
})

test('thirteen sampled frames is INVALID_ARGUMENT naming contactSheet.step', async () => {
  const page = fakePage(pngResult())
  const outcome = await frameTool({ contactSheet: { from: 0, to: 12, step: 1 } }, page)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'contactSheet.step')
  assert.match(outcome.error.message, /13 frames/)
  assert.equal(page.calls.length, 0)
})

test('a sheet whose grid has fewer tiles than frames is INVALID_ARGUMENT naming rows', async () => {
  const outcome = await frameTool(
    { contactSheet: { from: 0, to: 10, step: 2, columns: 2, rows: 2 } },
    fakePage(pngResult()),
  )
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'contactSheet.rows')
})

test('a sheet with too many columns or rows is INVALID_ARGUMENT naming that argument', async () => {
  const tooManyColumns = await frameTool(
    { contactSheet: { from: 0, to: 1, columns: 13 } },
    fakePage(pngResult()),
  )
  assert.ok('error' in tooManyColumns)
  assert.equal(tooManyColumns.error.argument, 'contactSheet.columns')
  const tooManyRows = await frameTool(
    { contactSheet: { from: 0, to: 1, rows: 13 } },
    fakePage(pngResult()),
  )
  assert.ok('error' in tooManyRows)
  assert.equal(tooManyRows.error.argument, 'contactSheet.rows')
})

test('a sheet with full is INVALID_ARGUMENT naming full', async () => {
  const outcome = await frameTool({ contactSheet: { from: 0, to: 5 }, full: true }, fakePage(pngResult()))
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'full')
})

test('a range that ends before it starts is INVALID_ARGUMENT naming contactSheet.to', async () => {
  const outcome = await frameTool({ contactSheet: { from: 5, to: 1 } }, fakePage(pngResult()))
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'contactSheet.to')
})

test('a StudioError from the page comes back as its JSON', async () => {
  const error = {
    name: 'StudioError',
    code: 'INVALID_ARGUMENT',
    message: 'frame: "frame" must be an integer timeline frame from 0 to 299 (got 300)',
    argument: 'frame',
  }
  const outcome = await frameTool({ frame: 300 }, fakePage({ error }))
  assert.ok('error' in outcome)
  assert.deepEqual(outcome.error, error)
})

test('a page that is not open answers UNSUPPORTED, a timeout answers TIMEOUT', async () => {
  const unavailable = await frameTool(
    { frame: 0 },
    {
      execute() {
        return Promise.reject(new PageUnavailableError('the editor window is not open'))
      },
    },
  )
  assert.ok('error' in unavailable)
  assert.equal(unavailable.error.code, 'UNSUPPORTED')
  assert.match(unavailable.error.message, /not open/)

  const timedOut = await frameTool(
    { frame: 0 },
    {
      execute() {
        return Promise.reject(new PageTimeoutError('the editor did not answer within 120000 ms'))
      },
    },
  )
  assert.ok('error' in timedOut)
  assert.equal(timedOut.error.code, 'TIMEOUT')
})

test('a tool registered without the editor page answers UNSUPPORTED, not a broken promise', async () => {
  const outcome = await frameTool({ frame: 0 })
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'UNSUPPORTED')
  assert.match(outcome.error.message, /without the editor page/)
})

test('a PNG over eight mebibytes of base64 is INVALID_ARGUMENT naming width', async () => {
  const huge = 'A'.repeat(8 * 1024 * 1024 + 1)
  const outcome = await frameTool({ frame: 0 }, fakePage(pngResult({ png: huge })))
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'width')
  assert.match(outcome.error.message, /base64/)
})

test('a page answer that is not a frame result is INTERNAL', async () => {
  for (const answer of [null, {}, { result: { bytes: 3, width: 1, height: 1 } }, { result: 'x' }]) {
    const outcome = await frameTool({ frame: 0 }, fakePage(answer))
    assert.ok('error' in outcome, `answer ${JSON.stringify(answer)} is refused`)
    assert.equal(outcome.error.code, 'INTERNAL')
  }
})

test('the plan validates without a page, for callers that only want the rules', () => {
  assert.deepEqual(framePlan({ frame: 7, width: 640 }), {
    plan: { kind: 'frame', frame: 7, width: 640, full: false },
  })
  const rejected = framePlan({ contactSheet: { from: 0, to: 0, step: 0 } })
  assert.ok('error' in rejected)
  assert.equal(rejected.error.argument, 'contactSheet.step')
})
