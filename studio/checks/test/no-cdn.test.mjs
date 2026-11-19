// Tests for the no-CDN check (`checks/no-cdn.mjs`): a CDN URL in code fails and is named, a comment that
// explains the old behaviour passes only with the marker, and the scanned folders are the app's own.
// Run with `node --test checks/test/*.test.mjs`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'no-cdn.mjs')
const STUDIO = path.resolve(import.meta.dirname, '..', '..')

/** A temporary studio-shaped folder holding `files`; paths in `files` are relative to it. */
function folderWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-no-cdn-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return dir
}

function run(folder) {
  const args = folder === undefined ? [SCRIPT] : [SCRIPT, folder]
  return spawnSync(process.execPath, args, { encoding: 'utf8' })
}

test('a CDN URL in code is a finding: exit 1, file and line named', () => {
  const dir = folderWith({
    'src/features/voice.ts': [
      "import { env } from '@huggingface/transformers'",
      'export function boot() {',
      "  env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'",
      '}',
    ].join('\n'),
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /src\/features\/voice\.ts:3\s+cdn\.jsdelivr\.net/)
    assert.match(result.stderr, /no-cdn-ok/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a comment that names an old URL passes when it carries the marker', () => {
  const dir = folderWith({
    'src/shared/runtime.ts': [
      '/**',
      ' * The library default was a cdn.jsdelivr.net URL (no-cdn-ok: replaced by an app asset).',
      ' */',
      'export const notAUrl = 1',
    ].join('\n'),
    'index.html': '<!-- esm.sh used to serve this (no-cdn-ok: it is bundled now) -->\n',
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /no CDN host named/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a comment without the marker still fails, and the marker on a line of code does not count', () => {
  const dir = folderWith({
    'src/a.ts': '// the old runtime came from https://esm.sh/@huggingface/transformers\n',
    'src/b.ts': "const url = 'https://unpkg.com/lib' // no-cdn-ok\nexport { url }\n",
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /src\/a\.ts:1\s+esm\.sh/)
    assert.match(result.stderr, /src\/b\.ts:1\s+unpkg\.com/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('public/ and index.html are scanned too, and files outside them are not', () => {
  const dir = folderWith({
    'public/vendor/legacy.js': "fetch('https://cdnjs.cloudflare.com/ajax/libs/x.js')\n",
    'index.html': '<script src="https://unpkg.com/lib"></script>\n',
    'docs/notes.md': 'remember https://cdn.jsdelivr.net/npm/x\n',
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /public\/vendor\/legacy\.js:1\s+cdnjs/)
    assert.match(result.stderr, /index\.html:1\s+unpkg\.com/)
    assert.doesNotMatch(result.stderr, /docs\/notes\.md/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a folder with none of the scanned paths cannot be checked', () => {
  const dir = folderWith({ 'notes.md': 'nothing here\n' })
  try {
    const result = run(dir)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /nothing was scanned/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("the app's own tree names no CDN host", () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`under ${STUDIO.replaceAll('\\', '\\\\')}`))
})
