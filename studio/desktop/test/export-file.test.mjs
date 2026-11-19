/** The export dialog's file (`export-file.ts`): the temporary file, the rename at the end, and what a failure leaves. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ExportFiles, checkExportPath } from '../out/main/export-file.js'
import { OutputGrants, commitOutput, partialPathFor } from '../out/main/media/output-file.js'
import {
  EXPORT_FILE_CHANNELS,
  parseExportFileUrl,
} from '../out/shared/export-file.js'

const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-export-file-'))
test.after(() => rmSync(folder, { recursive: true, force: true }))

/** A fresh `ExportFiles` with `name` granted, and its final path. */
function granted(name) {
  const files = new ExportFiles()
  const final = path.join(folder, name)
  files.grants.grant(final)
  return { files, final }
}

const bytes = (text) => new Uint8Array(Buffer.from(text))
const partialOf = (final) => path.join(folder, `.${path.basename(final)}.droneclean-partial`)

test('success: the final name appears only at the end, by one rename of the temporary file', async () => {
  const { files, final } = granted('cut.mp4')
  await files.open('exp-1', final)
  await files.write('exp-1', 0, bytes('hello '))
  await files.write('exp-1', 6, bytes('world'))
  assert.equal(existsSync(final), false, 'nothing under the final name before the end')
  assert.equal(readFileSync(partialOf(final), 'utf8'), 'hello world')

  const done = await files.commit('exp-1')
  assert.deepEqual(done, { path: final, size: 11 })
  assert.equal(readFileSync(final, 'utf8'), 'hello world')
  assert.equal(existsSync(partialOf(final)), false, 'the temporary file was renamed, not copied')
  assert.equal(files.has('exp-1'), false)
})

test('success replaces a file of that name only at the rename', async () => {
  const { files, final } = granted('replaced.mp4')
  writeFileSync(final, 'the old export')
  await files.open('exp-2', final)
  await files.write('exp-2', 0, bytes('new'))
  assert.equal(readFileSync(final, 'utf8'), 'the old export', 'untouched while the export runs')
  await files.commit('exp-2')
  assert.equal(readFileSync(final, 'utf8'), 'new')
})

test('failure and cancel delete the temporary file and leave an existing file byte for byte', async () => {
  for (const name of ['failed.mp4', 'cancelled.mov']) {
    const { files, final } = granted(name)
    writeFileSync(final, 'the file the user had')
    await files.open('exp-3', final)
    await files.write('exp-3', 0, bytes('half of a new export'))
    await files.discard('exp-3')
    assert.equal(existsSync(partialOf(final)), false, `${name}: the temporary file is gone`)
    assert.equal(readFileSync(final, 'utf8'), 'the file the user had', `${name}: the old file survives`)
    await files.discard('exp-3') // a second discard is not an error
  }
})

test('a cancel with no file of that name leaves nothing at all', async () => {
  const { files, final } = granted('nothing.mp4')
  await files.open('exp-4', final)
  await files.write('exp-4', 0, bytes('abc'))
  await files.discard('exp-4')
  assert.equal(existsSync(final), false)
  assert.equal(existsSync(partialOf(final)), false)
})

test('writes land at their position, in the order asked, even when asked at once', async () => {
  const { files, final } = granted('order.mp4')
  await files.open('exp-5', final)
  // Asked without waiting for each other: the file still gets them one after the other.
  await Promise.all([
    files.write('exp-5', 0, bytes('aaaa')),
    files.write('exp-5', 4, bytes('bbbb')),
    files.write('exp-5', 0, bytes('HEAD')), // the muxer goes back to patch the header
  ])
  await files.commit('exp-5')
  assert.equal(readFileSync(final, 'utf8'), 'HEADbbbb')
})

test('a write queued behind a discard fails instead of recreating the file', async () => {
  const { files, final } = granted('late.mp4')
  await files.open('exp-6', final)
  const first = files.write('exp-6', 0, bytes('x'))
  const discarded = files.discard('exp-6')
  await assert.rejects(first, /cancelled/)
  await discarded
  await assert.rejects(files.write('exp-6', 1, bytes('y')), /not open/)
  assert.equal(existsSync(partialOf(final)), false)
})

test('begin empties the file, so a second attempt never keeps the tail of the first', async () => {
  const { files, final } = granted('retry.mp4')
  await files.open('exp-7', final)
  await files.write('exp-7', 0, bytes('a long first attempt'))
  await files.begin('exp-7')
  await files.write('exp-7', 0, bytes('short'))
  const done = await files.commit('exp-7')
  assert.equal(done.size, 5)
  assert.equal(readFileSync(final, 'utf8'), 'short')
})

test('the sidecar subtitle file is written beside the video, at the end only', async () => {
  const { files, final } = granted('with-subs.mp4')
  await files.open('exp-8', final)
  await files.write('exp-8', 0, bytes('video'))
  await files.commit('exp-8', { content: '1\n00:00:00,000 --> 00:00:01,000\nhi\n' })
  assert.equal(readFileSync(path.join(folder, 'with-subs.srt'), 'utf8'), '1\n00:00:00,000 --> 00:00:01,000\nhi\n')
  assert.deepEqual(
    readdirSync(folder).filter((n) => n.includes('with-subs')).sort(),
    ['with-subs.mp4', 'with-subs.srt'],
  )
})

test('only a path the save dialog granted, once, is opened', async () => {
  const files = new ExportFiles()
  const final = path.join(folder, 'ungranted.mp4')
  await assert.rejects(files.open('exp-9', final), /not a path the user chose/)
  assert.equal(existsSync(partialOf(final)), false, 'a refused path leaves no file')
  files.grants.grant(final)
  await files.open('exp-9', final)
  await assert.rejects(files.open('exp-10', final), /not a path the user chose/, 'the grant is used up')
  await files.discard('exp-9')
})

test('a path outside what the muxer writes is refused with its reason', async () => {
  await checkExportPath(path.join(folder, 'ok.MOV'))
  await assert.rejects(checkExportPath('cut.mp4'), /absolute/)
  await assert.rejects(checkExportPath(path.join(folder, 'cut.exe')), /must end in/)
  await assert.rejects(checkExportPath(path.join(folder, 'nope', 'cut.mp4')), /does not exist/)
  mkdirSync(path.join(folder, 'dir.mp4'))
  await assert.rejects(checkExportPath(path.join(folder, 'dir.mp4')), /not a file/)
  await assert.rejects(checkExportPath('\\\\server\\share\\cut.mp4', 'win32'), /network/)
})

test('a write needs an open export and a sane position', async () => {
  const files = new ExportFiles()
  await assert.rejects(files.write('nothing-open', 0, bytes('x')), /not open/)
  const { files: open, final } = granted('position.mp4')
  await open.open('exp-11', final)
  await assert.rejects(open.write('exp-11', -1, bytes('x')), /position/)
  await assert.rejects(open.write('exp-11', 1.5, bytes('x')), /position/)
  await open.discard('exp-11')
})

test('the URLs are read back and anything else is refused', () => {
  assert.deepEqual(parseExportFileUrl('droneclean-export://file/exp-a/begin'), { ok: true, id: 'exp-a', operation: 'begin' })
  assert.deepEqual(parseExportFileUrl('droneclean-export://file/exp-a/write?position=4194304'), {
    ok: true,
    id: 'exp-a',
    operation: 'write',
    position: 4194304,
  })
  for (const bad of [
    'https://file/exp-a/begin',
    'droneclean-export://other/exp-a/begin',
    'droneclean-export://file/exp-a',
    'droneclean-export://file/exp-a/begin/extra',
    'droneclean-export://file/a b/begin',
    'droneclean-export://file/exp-a/write',
    'droneclean-export://file/exp-a/write?position=-1',
    'droneclean-export://file/exp-a/write?position=1.5',
    'droneclean-export://file/exp-a/erase',
    'not a url',
  ]) {
    assert.equal(parseExportFileUrl(bad).ok, false, bad)
  }
})

test('the preload carries the channels with the main process’s names', () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const preload = readFileSync(path.resolve(here, '..', 'out', 'preload', 'index.js'), 'utf8')
  for (const name of Object.keys(EXPORT_FILE_CHANNELS)) {
    assert.ok(preload.includes(`'${EXPORT_FILE_CHANNELS[name]}'`), `the preload should carry ${name}`)
  }
  assert.ok(preload.includes('exportFile'), 'the bridge carries the exportFile member')
})

/** A fresh `ExportFiles` whose native encoder has its own grants, as the shell has `outputGrants`. */
function native() {
  const encoder = new OutputGrants()
  return { files: new ExportFiles(new OutputGrants(), process.platform, encoder), encoder }
}

test('a native export grants the chosen path to the encoder, for that path only, and opens no temporary file', async () => {
  const { files, encoder } = native()
  const final = path.join(folder, 'native.mp4')
  const other = path.join(folder, 'other.mp4')
  await files.openNative('exp-n1', final)
  assert.equal(encoder.has(final), true, 'the encoder may write there')
  assert.equal(encoder.has(other), false, 'and nowhere else')
  assert.equal(files.grants.has(final), false, 'the muxer route has no grant for it')
  assert.equal(existsSync(partialOf(final)), false, 'the encoder makes its own temporary file, not this code')
  assert.equal(files.has('exp-n1'), true)
  await files.discard('exp-n1')
})

test('a native export ends with the encoder’s own rename: commit answers the size of the file it left', async () => {
  const { files, encoder } = native()
  const final = path.join(folder, 'native-done.mov')
  await files.openNative('exp-n2', final)
  // What the encoder does: claim the grant at `encode.start`, write the partial, rename it at the end.
  assert.equal(encoder.claim(final), true)
  writeFileSync(partialPathFor(final), 'ten bit frames')
  await commitOutput(partialPathFor(final), final)
  assert.deepEqual(await files.commit('exp-n2'), { path: final, size: 14 })
  assert.equal(files.has('exp-n2'), false)
})

test('a native commit with a subtitle sidecar writes it beside the video', async () => {
  const { files, encoder } = native()
  const final = path.join(folder, 'native-subs.mp4')
  await files.openNative('exp-n3', final)
  encoder.claim(final)
  writeFileSync(final, 'video')
  await files.commit('exp-n3', { content: 'srt text' })
  assert.equal(readFileSync(path.join(folder, 'native-subs.srt'), 'utf8'), 'srt text')
})

test('a native commit with no file at the path says so', async () => {
  const { files } = native()
  const final = path.join(folder, 'native-missing.mp4')
  await files.openNative('exp-n4', final)
  await assert.rejects(files.commit('exp-n4'), /left no file/)
  assert.equal(files.has('exp-n4'), false)
})

test('a native failure or cancel withdraws the unused grant, removes the partial and leaves an existing file as it was', async () => {
  for (const name of ['native-failed.mp4', 'native-cancelled.mov']) {
    const { files, encoder } = native()
    const final = path.join(folder, name)
    writeFileSync(final, 'the file the user had')
    await files.openNative('exp-n5', final)
    writeFileSync(partialPathFor(final), 'half of an export')
    await files.discard('exp-n5')
    assert.equal(encoder.has(final), false, `${name}: the grant is gone, a later encode.start for it is refused`)
    assert.equal(existsSync(partialOf(final)), false, `${name}: the temporary file is gone`)
    assert.equal(readFileSync(final, 'utf8'), 'the file the user had', `${name}: the old file survives`)
    await files.discard('exp-n5') // a second discard is not an error
  }
})

test('a native export of a path the muxer route would refuse is refused with its reason, and grants nothing', async () => {
  const { files, encoder } = native()
  await assert.rejects(files.openNative('exp-n6', 'cut.mp4'), /absolute/)
  await assert.rejects(files.openNative('exp-n6', path.join(folder, 'nope', 'cut.mp4')), /does not exist/)
  await assert.rejects(files.openNative('exp n6', path.join(folder, 'a.mp4')), /invalid id/)
  assert.equal(encoder.has(path.join(folder, 'a.mp4')), false)
})
