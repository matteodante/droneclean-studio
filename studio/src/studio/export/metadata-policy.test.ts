// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vite-plus/test'
import { exportMetadataTags } from './metadata-policy'

// Fake values standing in for a DJI file's GPS position and serial number.
const SERIAL = 'FAKESERIAL0042'
const LATITUDE = '45.1234'
const COMMENT = 'FAKECOMMENT'
const SECRETS = [SERIAL, LATITUDE, COMMENT, 'FAKEGPS', 'FAKEHANDLER']

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** A one-second MP4 with video, audio, a telemetry-like subtitle track and the tags a drone writes. */
function makeSource(folder: string): string {
  const source = path.join(folder, 'source.mp4')
  writeFileSync(
    path.join(folder, 't.srt'),
    `1\n00:00:00,000 --> 00:00:01,000\nFAKEGPS ${LATITUDE} 9.5678 ${SERIAL}\n\n`,
  )
  execFileSync(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30:duration=1',
      '-f', 'lavfi', '-i', 'sine=d=1',
      '-i', path.join(folder, 't.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '2:s',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text',
      '-metadata', `location=+${LATITUDE}+009.5678/`,
      '-metadata', `comment=${COMMENT} SN:${SERIAL}`,
      '-metadata:s:a', 'handler_name=FAKEHANDLER',
      source,
    ],
    { stdio: 'ignore' },
  )
  return source
}

/** The packet-remux call of the orchestrator, with the `tags` option as given. */
async function convert(source: string, withPolicy: boolean): Promise<Uint8Array> {
  const { Input, Output, Conversion, ALL_FORMATS, BufferSource, BufferTarget, Mp4OutputFormat } =
    await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(readFileSync(source)) })
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const conversion = await Conversion.init({
    input,
    output,
    video: { forceTranscode: false },
    audio: { forceTranscode: false },
    showWarnings: false,
    ...(withPolicy ? { tags: exportMetadataTags } : {}),
  })
  await conversion.execute()
  return new Uint8Array(target.buffer as ArrayBuffer)
}

function containsText(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(text)
}

/** Every non-test TypeScript file under `src/`. */
function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) files.push(...sourceFiles(file))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(file)
  }
  return files
}

const SRC = path.resolve(__dirname, '../..')
/** Where an export is written. Proxy generation (`features/media-library`) makes local working files, not exports. */
const EXPORT_FOLDERS = ['runtime', 'features/export', 'studio'].map((folder) => path.join(SRC, folder))
const exportSourceFiles = () => EXPORT_FOLDERS.flatMap(sourceFiles)

describe('export metadata policy: the sources', () => {
  it('every Conversion.init in the app sets the tags to the policy', () => {
    const offenders: string[] = []
    for (const file of exportSourceFiles()) {
      const text = readFileSync(file, 'utf8')
      let at = text.indexOf('Conversion.init(')
      while (at !== -1) {
        if (!/tags:\s*exportMetadataTags/.test(text.slice(at, at + 1500))) offenders.push(file)
        at = text.indexOf('Conversion.init(', at + 1)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no code sets the tags of an Output by hand', () => {
    const offenders = exportSourceFiles().filter((file) =>
      readFileSync(file, 'utf8').includes('setMetadataTags('),
    )
    expect(offenders).toEqual([])
  })
})

describe.skipIf(!hasFfmpeg())('export metadata policy: the packet-remux path', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-metadata-policy-'))
  afterAll(() => rmSync(folder, { recursive: true, force: true }))

  it('the fixture carries a GPS position, a serial number and a comment', () => {
    const source = makeSource(folder)
    const bytes = new Uint8Array(readFileSync(source))
    for (const secret of SECRETS) expect(containsText(bytes, secret)).toBe(true)
  })

  it('without the policy mediabunny copies the source tags (why the policy exists)', async () => {
    const bytes = await convert(path.join(folder, 'source.mp4'), false)
    expect(containsText(bytes, COMMENT) || containsText(bytes, LATITUDE)).toBe(true)
  })

  it('with the policy the output holds no GPS, serial, comment or telemetry text', async () => {
    const bytes = await convert(path.join(folder, 'source.mp4'), true)
    for (const secret of SECRETS) expect(containsText(bytes, secret)).toBe(false)
  })
})
