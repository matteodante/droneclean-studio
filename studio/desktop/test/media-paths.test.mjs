/**
 * The media path route (task 2.2 slice 5, design §4.5): the allow-list, the id
 * table and the Range answers.
 *
 * The files are real files in a temporary folder, so the stat, the realpath,
 * the stream and the `Content-Range` are the ones the running app sends. The
 * preload's copy of the channel name is held to `main/media.ts` here too.
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MEDIA_PATH_ALLOW_CHANNEL,
  MEDIA_PATH_DESCRIBE_CHANNEL,
  MediaPathAccess,
  mediaContentType,
  mediaIdForPath,
  serveMediaRequest,
} from '../out/main/media.js'
import { MEDIA_ID_PATTERN, parseMediaRoute } from '../out/main/protocol.js'

const here = path.dirname(new URL(import.meta.url).pathname)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-media-paths-'))
after(() => fs.rmSync(work, { recursive: true, force: true }))

/** Bytes `seed` repeated `length` times, so a range's body is checkable. */
function bytes(seed, length) {
  const out = new Uint8Array(length)
  out.fill(seed)
  return out
}

const A_SIZE = 1000
const B_SIZE = 500

fs.writeFileSync(path.join(work, 'a.mp4'), bytes(0xaa, A_SIZE))
fs.writeFileSync(path.join(work, 'b.MP4'), bytes(0xbb, B_SIZE))
fs.writeFileSync(path.join(work, 'notes.txt'), 'not media\n')
fs.mkdirSync(path.join(work, 'sub'))
fs.writeFileSync(path.join(work, 'sub', 'c.mov'), bytes(0xcc, 200))

const real = (name) => fs.realpathSync(path.join(work, name))
const A = real('a.mp4')
const B = real('b.MP4')
const C = real(path.join('sub', 'c.mov'))

/** One request against the route, as the app's own scheme sends it. */
function request(url, { method = 'GET', range } = {}) {
  const headers = range === undefined ? undefined : { range }
  return new Request(url, headers === undefined ? { method } : { method, headers })
}

async function bodyBytes(response) {
  return new Uint8Array(await response.arrayBuffer())
}

test('the media content types are the editor’s readable set, by a lower-case extension', () => {
  assert.equal(mediaContentType('/x/DJI_0020_D.MP4'), 'video/mp4')
  assert.equal(mediaContentType('/x/clip.mov'), 'video/quicktime')
  assert.equal(mediaContentType('/x/clip.mkv'), 'video/x-matroska')
  assert.equal(mediaContentType('/x/song.m4a'), 'audio/mp4')
  assert.equal(mediaContentType('/x/photo.JPG'), 'image/jpeg')
  for (const refused of ['/x/notes.txt', '/x/project.json', '/x/clip', '/x/drawing.svg']) {
    assert.equal(mediaContentType(refused), null, `${refused} should not be served`)
  }
})

test('the route parses only /__media/<id> on the app’s scheme', () => {
  const id = mediaIdForPath(A)
  assert.match(id, MEDIA_ID_PATTERN)
  assert.deepEqual(parseMediaRoute(`droneclean://app/__media/${id}`), { kind: 'media', id })
  assert.deepEqual(parseMediaRoute(`droneclean://app/%5F%5Fmedia/${id}?v=1`), { kind: 'media', id })
  assert.equal(parseMediaRoute('droneclean://app/projects'), null)
  assert.equal(parseMediaRoute('https://app/__media/x'), null)
  assert.equal(parseMediaRoute('droneclean://other/__media/x'), null)
  assert.equal(parseMediaRoute('droneclean://app/__media/x/y').kind, 'rejected')
  assert.equal(parseMediaRoute('droneclean://app/__media/').kind, 'rejected')
  assert.equal(parseMediaRoute('droneclean://app/__media/not.a.path').kind, 'rejected')
})

test('describe answers one URL per file, with the file’s own facts', async () => {
  const access = new MediaPathAccess()
  const [file] = await access.describe([A])
  const [again] = await access.describe([A])

  assert.equal(file.path, A)
  assert.equal(file.name, 'a.mp4')
  assert.equal(file.size, A_SIZE)
  assert.equal(typeof file.lastModified, 'number')
  assert.ok(file.lastModified > 0)
  assert.equal(file.url, `droneclean://app/__media/${mediaIdForPath(A)}`)
  assert.equal(again.url, file.url, 'the same file answers the same URL')
})

test('describe refuses what it cannot serve, naming the path', async () => {
  const access = new MediaPathAccess()
  const cases = [
    ['./relative.mp4', /not an absolute path/],
    [path.join(work, 'missing.mp4'), /no such file/],
    [path.join(work, 'notes.txt'), /not video, audio or image/],
    [path.join(work, 'sub'), /not a regular file/],
    ['/', /not a regular file/],
    [42, /not a usable path/],
  ]
  for (const [input, expected] of cases) {
    await assert.rejects(() => access.describe([input]), expected, JSON.stringify(input))
  }
})

test('allow takes folders and refuses files and disk roots', async () => {
  const access = new MediaPathAccess()
  assert.deepEqual(await access.allow([path.join(work, 'sub')]), [real('sub')])
  await assert.rejects(() => access.allow([A]), /not a folder/)
  await assert.rejects(() => access.allow(['/']), /disk root/)
  await assert.rejects(() => access.allow(['relative']), /not an absolute folder/)
  await assert.rejects(() => access.allow([path.join(work, 'missing')]), /no such folder/)
})

test('a file outside the allow-list has no id, so the route answers 404', async () => {
  const access = new MediaPathAccess()
  await access.describe([A])

  const sibling = await serveMediaRequest(
    access,
    { kind: 'media', id: mediaIdForPath(B) },
    request(`droneclean://app/__media/${mediaIdForPath(B)}`),
  )
  assert.equal(sibling.status, 404)

  const unknown = await serveMediaRequest(
    access,
    { kind: 'media', id: 'not-registered' },
    request('droneclean://app/__media/not-registered'),
  )
  assert.equal(unknown.status, 404)

  const rejected = await serveMediaRequest(
    access,
    { kind: 'rejected', reason: 'invalid media id' },
    request('droneclean://app/__media/not.a.path'),
  )
  assert.equal(rejected.status, 404)
})

test('the folders of a project’s records are allowed, and still need their files named', async () => {
  const access = new MediaPathAccess()
  await access.allow([real('sub')])

  // The folder is the grant; the file inside it still needs a name to get an id.
  assert.equal(await access.resolve(mediaIdForPath(C)), null)
  const [described] = await access.describe([C])
  assert.equal(described.path, C)
  assert.equal((await access.resolve(mediaIdForPath(C)))?.contentType, 'video/quicktime')
})

test('a described file that is no longer a regular file answers 404', async () => {
  const folder = fs.mkdtempSync(path.join(work, 'gone-'))
  const file = path.join(folder, 'clip.mp4')
  fs.writeFileSync(file, bytes(1, 10))
  const access = new MediaPathAccess()
  const [described] = await access.describe([file])
  assert.ok(described)
  fs.rmSync(file)
  assert.equal(await access.resolve(mediaIdForPath(file)), null)
})

test('no Range header answers 200 with the whole file', async () => {
  const access = new MediaPathAccess()
  await access.describe([A])
  const id = mediaIdForPath(A)
  const response = await serveMediaRequest(access, { kind: 'media', id }, request(`droneclean://app/__media/${id}`))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.equal(response.headers.get('content-length'), String(A_SIZE))
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-range'), null)
  assert.deepEqual(await bodyBytes(response), bytes(0xaa, A_SIZE))
})

test('a Range answers 206 with Content-Range and exactly those bytes', async () => {
  const access = new MediaPathAccess()
  await access.describe([A])
  const id = mediaIdForPath(A)
  const url = `droneclean://app/__media/${id}`

  const first = await serveMediaRequest(access, { kind: 'media', id }, request(url, { range: 'bytes=0-99' }))
  assert.equal(first.status, 206)
  assert.equal(first.headers.get('content-range'), `bytes 0-99/${A_SIZE}`)
  assert.equal(first.headers.get('content-length'), '100')
  assert.deepEqual(await bodyBytes(first), bytes(0xaa, 100))

  const rest = await serveMediaRequest(access, { kind: 'media', id }, request(url, { range: 'bytes=990-' }))
  assert.equal(rest.status, 206)
  assert.equal(rest.headers.get('content-range'), `bytes 990-999/${A_SIZE}`)
  assert.equal((await bodyBytes(rest)).length, 10)

  const suffix = await serveMediaRequest(access, { kind: 'media', id }, request(url, { range: 'bytes=-10' }))
  assert.equal(suffix.status, 206)
  assert.equal(suffix.headers.get('content-range'), `bytes 990-999/${A_SIZE}`)
  assert.equal((await bodyBytes(suffix)).length, 10)
})

test('HEAD answers the range’s headers with no body', async () => {
  const access = new MediaPathAccess()
  await access.describe([A])
  const id = mediaIdForPath(A)
  const response = await serveMediaRequest(
    access,
    { kind: 'media', id },
    request(`droneclean://app/__media/${id}`, { method: 'HEAD', range: 'bytes=0-99' }),
  )
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 0-99/${A_SIZE}`)
  assert.equal((await bodyBytes(response)).length, 0)
})

test('an unsatisfiable or malformed Range answers 416 with the file’s length', async () => {
  const access = new MediaPathAccess()
  await access.describe([A])
  const id = mediaIdForPath(A)
  const url = `droneclean://app/__media/${id}`

  for (const range of [`bytes=${A_SIZE}-`, 'bytes=abc', 'bytes=0-1,5-9']) {
    const response = await serveMediaRequest(access, { kind: 'media', id }, request(url, { range }))
    assert.equal(response.status, 416, range)
    assert.equal(response.headers.get('content-range'), `bytes */${A_SIZE}`, range)
    assert.equal((await bodyBytes(response)).length, 0, range)
  }
})

test('the preload carries the same channel names, and loads nothing but electron', () => {
  const preload = fs.readFileSync(path.resolve(here, '..', 'out', 'preload', 'index.js'), 'utf8')
  for (const channel of [MEDIA_PATH_DESCRIBE_CHANNEL, MEDIA_PATH_ALLOW_CHANNEL]) {
    assert.ok(preload.includes(`'${channel}'`), `the preload should carry ${channel}`)
  }
  assert.ok(preload.includes('mediaPaths'), 'the bridge carries the media path member')
  const required = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(required)], ['electron'])
})

test('R7: the home folder, and a folder above it, cannot be allowed', async () => {
  const home = path.join(work, 'home')
  fs.mkdirSync(path.join(home, 'Movies'), { recursive: true })
  const access = new MediaPathAccess({ homeDir: home })
  await assert.rejects(access.allow([home]), /home folder/)
  await assert.rejects(access.allow([work]), /home folder/)
  // A folder inside it is what a project's media lives in.
  assert.deepEqual(await access.allow([path.join(home, 'Movies')]), [
    fs.realpathSync(path.join(home, 'Movies')),
  ])
})

test('R7: only a path the registry holds is a registered media file', async () => {
  const access = new MediaPathAccess({ homeDir: path.join(work, 'nobody') })
  assert.equal(await access.registeredFile(A), null, 'not named yet')
  await access.describe([A])
  assert.equal(await access.registeredFile(A), A)
  assert.equal(await access.registeredFile(B), null, 'another file of the same folder')
  assert.equal(await access.registeredFile(path.join(work, 'sub')), null, 'a folder')
  assert.equal(await access.registeredFile(path.join(work, 'notes.txt')), null, 'not media')

  await access.allow([path.join(work, 'sub')])
  assert.equal(await access.registeredFile(C), C, 'a file of an allowed folder')
  assert.equal(await access.registeredFile(path.join(work, 'missing.mp4')), null)
  assert.equal(await access.registeredFile('relative.mp4'), null)
})

test('D9: a UNC path is refused by describe and allow on Windows', async () => {
  const access = new MediaPathAccess({ platform: 'win32' })
  await assert.rejects(access.describe(['\\\\server\\share\\a.mp4']), /network|UNC/i)
  await assert.rejects(access.describe(['//server/share/a.mp4']), /network|UNC/i)
  await assert.rejects(access.allow(['\\\\?\\UNC\\server\\share']), /network|UNC/i)
})
