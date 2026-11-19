// The page the proof drives: it hands the picked file to the planner and the cutter, posts the
// piece back to the proof's own server, and reports what the two steps took. Nothing is uploaded
// anywhere else, and the file is never read into the page's own memory.

import { mediabunnyShadowCutter } from '../cut'
import type { ShadowCutWindow } from '../interface'

interface ProofReport {
  ok: boolean
  error?: string
  window?: ShadowCutWindow
  planMs?: number
  cutMs?: number
  saveMs?: number
  pieceBytes?: number
  fileBytes?: number
}

const params = new URLSearchParams(window.location.search)

function numberParam(name: string): number {
  const raw = params.get(name)
  const value = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`the proof's page needs a numeric ?${name}`)
  }
  return value
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) {
    throw new Error(`the proof's page has no ${selector}`)
  }
  return found
}

const startFrame = numberParam('startFrame')
const endFrame = numberParam('endFrame')
const sourceRate = { num: numberParam('num'), den: numberParam('den') }

const input = element<HTMLInputElement>('#source')
const cutButton = element<HTMLButtonElement>('#cut')
const log = element<HTMLPreElement>('#log')

function say(line: string): void {
  log.textContent = `${log.textContent ?? ''}${line}\n`
}

async function report(result: ProofReport): Promise<void> {
  if (result.ok) {
    say(`done: ${result.pieceBytes} bytes in ${result.cutMs?.toFixed(0)} ms`)
  } else {
    say(`failed: ${result.error}`)
  }
  await fetch('/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  })
}

async function cutAndReport(file: File): Promise<void> {
  const planStarted = performance.now()
  const window = await mediabunnyShadowCutter.plan(file, { startFrame, endFrame }, sourceRate)
  const planMs = performance.now() - planStarted
  say(
    `window: frames ${window.startFrame}..${window.endFrame} (${window.startSeconds} s .. ${window.endSeconds} s) in ${planMs.toFixed(0)} ms`,
  )

  const cutStarted = performance.now()
  const piece = await mediabunnyShadowCutter.cut(file, window)
  const cutMs = performance.now() - cutStarted
  say(`cut: ${piece.size} bytes in ${cutMs.toFixed(0)} ms`)

  const saveStarted = performance.now()
  const response = await fetch('/piece', { method: 'POST', body: piece })
  const saveMs = performance.now() - saveStarted
  if (!response.ok) {
    throw new Error(`saving the piece failed with HTTP ${response.status}`)
  }
  await report({
    ok: true,
    window,
    planMs,
    cutMs,
    saveMs,
    pieceBytes: piece.size,
    fileBytes: file.size,
  })
}

async function fail(error: unknown): Promise<void> {
  await report({ ok: false, error: error instanceof Error ? error.message : String(error) })
}

input.addEventListener('change', () => {
  const file = input.files?.[0]
  cutButton.disabled = !file
  if (file) {
    say(`source: ${file.name}, ${file.size} bytes`)
  }
})

cutButton.addEventListener('click', async () => {
  const file = input.files?.[0]
  if (!file) {
    return
  }
  cutButton.disabled = true
  try {
    await cutAndReport(file)
  } catch (error) {
    await fail(error)
  }
})
