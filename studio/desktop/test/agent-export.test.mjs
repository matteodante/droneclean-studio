/**
 * `export`: start, poll and cancel without blocking (task 2.2, design §4.7).
 *
 * The tool's script is evaluated in a `node:vm` context with a fake
 * `window.studioAgent`, which is the same boundary as
 * `webContents.executeJavaScript` (a string in, JSON out) without Electron. The
 * page bridge is the real one, so the deadlines these tests time are the ones
 * the app enforces: a call that names no `waitMs` answers or fails within a
 * second, and one that names a wait may wait for it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { RUN_BUSY_GLOBAL, createPageBridge } from '../out/main/mcp/page.js'
import { buildExportScript, exportTool } from '../out/main/mcp/tools/export.js'

/** A job as the page's bridge answers it. */
function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    name: 'Flight',
    projectId: 'project-1',
    status: 'queued',
    progress: 0,
    inPoint: 0,
    outPoint: 150,
    durationFrames: 150,
    exportMode: 'video',
    fileName: 'Flight.mp4',
    createdAt: 1,
    ...overrides,
  }
}

/** A page window whose `studioAgent.export` runs `handler`. */
function createVmWindow(handler) {
  const calls = []
  const studioAgent = {
    export(request) {
      calls.push(request)
      return handler(request)
    },
  }
  return {
    calls,
    webContents: {
      executeJavaScript: (code) =>
        Promise.resolve(
          vm.runInNewContext(code, {
            studio: { transaction() {}, workspace: { isOpen: () => true } },
            studioAgent,
            setTimeout,
            clearTimeout,
            console,
            AbortController,
          }),
        ),
    },
  }
}

/** The tool driven through the real page bridge. */
function pageFor(window) {
  return createPageBridge(() => window)
}

/** Milliseconds `run` took. */
async function timed(run) {
  const startedAt = Date.now()
  const value = await run()
  return { value, elapsed: Date.now() - startedAt }
}

test('a start answers the job it queued, in under a second', async () => {
  const window = createVmWindow(async () => makeJob())
  const request = {
    start: { inPoint: 0, outPoint: 150, name: 'Five seconds', settings: { codec: 'h265' } },
  }

  const { value, elapsed } = await timed(() => exportTool(request, pageFor(window)))

  assert.deepEqual(value, { result: makeJob() })
  // The request crossed into the vm and back, so compare its JSON form.
  assert.deepEqual(JSON.parse(JSON.stringify(window.calls)), [request])
  assert.ok(elapsed < 1000, `a start took ${elapsed} ms`)
})

test('a poll answers the job, so progress rises between calls', async () => {
  let progress = 0
  const window = createVmWindow(async () => makeJob({ status: 'rendering', progress }))
  const page = pageFor(window)

  progress = 10
  const first = await timed(() => exportTool({ jobId: 'job-1' }, page))
  progress = 55
  const second = await timed(() => exportTool({ jobId: 'job-1' }, page))

  assert.equal(first.value.result.progress, 10)
  assert.equal(second.value.result.progress, 55)
  assert.ok(first.elapsed < 1000, `a poll took ${first.elapsed} ms`)
  assert.ok(second.elapsed < 1000, `a poll took ${second.elapsed} ms`)
})

test('a finished job names its file on disk when the workspace folder is known', async () => {
  const done = makeJob({ status: 'completed', progress: 100, savedPath: 'projects/p1/exports/Flight.mp4' })
  const window = createVmWindow(async () => done)

  const known = await exportTool({ jobId: 'job-1' }, pageFor(window), () => '/Users/pilot/Video workspace')
  assert.equal(known.result.absolutePath, '/Users/pilot/Video workspace/projects/p1/exports/Flight.mp4')
  assert.equal(known.result.savedPath, 'projects/p1/exports/Flight.mp4')

  // Unknown folder, or a saved path that would leave it: the job as the page answered it
  const unknown = await exportTool({ jobId: 'job-1' }, pageFor(window), () => null)
  assert.equal(unknown.result.absolutePath, undefined)
  const outside = createVmWindow(async () => ({ ...done, savedPath: '../elsewhere/Flight.mp4' }))
  const escaped = await exportTool({ jobId: 'job-1' }, pageFor(outside), () => '/Users/pilot/Video workspace')
  assert.equal(escaped.result.absolutePath, undefined)
})

test('a cancel answers the cancelled job', async () => {
  const window = createVmWindow(async () => makeJob({ status: 'cancelled', finishedAt: 2 }))

  const { value, elapsed } = await timed(() =>
    exportTool({ jobId: 'job-1', cancel: true }, pageFor(window)),
  )

  assert.equal(value.result.status, 'cancelled')
  assert.deepEqual(JSON.parse(JSON.stringify(window.calls)), [{ jobId: 'job-1', cancel: true }])
  assert.ok(elapsed < 1000, `a cancel took ${elapsed} ms`)
})

test('a second start while one runs comes back as the page’s CONFLICT', async () => {
  const conflict = Object.assign(new Error('export.start: job "job-1" is already rendering'), {
    toJSON() {
      return {
        name: 'StudioError',
        code: 'CONFLICT',
        message: 'export.start: job "job-1" is already rendering for this project (40%); one export runs at a time',
        hint: 'export({ jobId }) reports it; export({ jobId, cancel: true }) stops it before starting another.',
      }
    },
  })
  const window = createVmWindow(async () => {
    throw conflict
  })

  const outcome = await exportTool({ start: {} }, pageFor(window))

  assert.equal(outcome.error.code, 'CONFLICT')
  assert.match(outcome.error.message, /"job-1"/)
  assert.ok(outcome.error.hint.includes('jobId'))
})

test('a page without the bridge answers UNSUPPORTED instead of failing', async () => {
  const outcome = await exportTool(
    { jobId: 'job-1' },
    {
      execute: (code) =>
        Promise.resolve(vm.runInNewContext(code, { setTimeout, clearTimeout, AbortController })),
    },
  )

  assert.equal(outcome.error.code, 'UNSUPPORTED')
  assert.match(outcome.error.message, /still starting/)
})

test('a page that never answers fails a poll as TIMEOUT within a second', async () => {
  // A started page (it answers the readiness probe) whose script never returns.
  const window = {
    webContents: {
      executeJavaScript: (code) =>
        code.includes(RUN_BUSY_GLOBAL) ? Promise.resolve('ready') : new Promise(() => {}),
    },
  }

  const { value, elapsed } = await timed(() => exportTool({ jobId: 'job-1' }, pageFor(window)))

  assert.equal(value.error.code, 'TIMEOUT')
  // The deadline is 1000 ms; the headroom is for a loaded machine's timers.
  assert.ok(elapsed < 1600, `the poll took ${elapsed} ms; it must not block past a second`)
  assert.ok(elapsed >= 900, `the poll gave up after ${elapsed} ms; the deadline is 1000`)
})

test('waitMs lets the call wait for the page, and the deadline grows with it', async () => {
  const window = {
    webContents: {
      executeJavaScript: (code) =>
        code.includes(RUN_BUSY_GLOBAL)
          ? Promise.resolve('ready')
          : new Promise((resolve) => {
              setTimeout(() => resolve({ job: makeJob({ status: 'completed', progress: 100 }) }), 1200)
            }),
    },
  }

  const { value, elapsed } = await timed(() =>
    exportTool({ jobId: 'job-1', waitMs: 2000 }, pageFor(window)),
  )

  assert.equal(value.result.status, 'completed')
  assert.ok(elapsed >= 1200, `the call came back after ${elapsed} ms, before the page answered`)
  assert.ok(elapsed < 2200, `the call took ${elapsed} ms`)
})

test('an out-of-range waitMs does not buy a longer deadline', async () => {
  // A started page (it answers the readiness probe) whose script never returns.
  const window = {
    webContents: {
      executeJavaScript: (code) =>
        code.includes(RUN_BUSY_GLOBAL) ? Promise.resolve('ready') : new Promise(() => {}),
    },
  }

  const { value, elapsed } = await timed(() =>
    exportTool({ jobId: 'job-1', waitMs: 999_999 }, pageFor(window)),
  )

  assert.equal(value.error.code, 'TIMEOUT')
  assert.ok(elapsed < 1600, `the call took ${elapsed} ms; an invalid waitMs must not extend it`)
})

test('no bridge to the editor answers UNSUPPORTED without throwing', async () => {
  const outcome = await exportTool({ start: {} })

  assert.equal(outcome.error.code, 'UNSUPPORTED')
  assert.match(outcome.error.message, /no editor page/)
})

test('a window that is gone answers UNSUPPORTED', async () => {
  const window = {
    isDestroyed: () => true,
    webContents: { executeJavaScript: () => Promise.reject(new Error('unreachable')) },
  }

  const outcome = await exportTool({ jobId: 'job-1' }, pageFor(window))

  assert.equal(outcome.error.code, 'UNSUPPORTED')
  assert.match(outcome.error.message, /not open|editor window/)
})

test('a page answer that is not a job is INTERNAL', async () => {
  const window = createVmWindow(async () => 'not a job')

  const outcome = await exportTool({ jobId: 'job-1' }, pageFor(window))

  assert.equal(outcome.error.code, 'INTERNAL')
})

test('the script carries the request as JSON and calls the page bridge', () => {
  const script = buildExportScript({ start: { name: 'Five seconds' }, waitMs: 250 })

  assert.match(script, /globalThis\.studioAgent/)
  assert.ok(script.includes('"name":"Five seconds"'), script)
  assert.ok(script.includes('"waitMs":250'), script)
})

test('a start may take its save: a page that queues after 1.5 s still answers the job', async () => {
  // A start saves the project first (src/studio/agent/export.ts); in the hidden app the save renders a cover frame,
  // which takes more than the second a poll is allowed.
  const window = createVmWindow(
    () => new Promise((resolve) => setTimeout(() => resolve(makeJob()), 1500)),
  )

  const { value, elapsed } = await timed(() => exportTool({ start: {} }, pageFor(window)))

  assert.deepEqual(value, { result: makeJob() })
  assert.ok(elapsed >= 1500, `the call came back after ${elapsed} ms, before the page answered`)
})

test('a read gets no more than its second even though a start may take longer', async () => {
  const window = createVmWindow(
    () => new Promise((resolve) => setTimeout(() => resolve(makeJob()), 1500)),
  )

  const { value, elapsed } = await timed(() => exportTool({ jobId: 'job-1' }, pageFor(window)))

  assert.equal(value.error.code, 'TIMEOUT')
  assert.ok(elapsed < 1400, `the read took ${elapsed} ms`)
})
