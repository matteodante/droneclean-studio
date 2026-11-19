// The deciding measurement of task 4.3/E4: is mediabunny's in-browser cut byte-identical to
// FFmpeg's `-c copy` on clip 0020?
//
// It bundles the page beside this file, serves it from a local HTTP server, gives Chrome the clip
// through a file input (the page never reads the whole file), cuts the window the page computes,
// saves the piece next to the reference FFmpeg makes, and compares every packet's size, flags and
// MD5, plus the packet times and the absence of an edit list. It also samples the memory of every
// Chrome process of this run while the cut runs.
//
// The clip is read-only; everything this writes goes to the output folder, which is the system's
// temporary folder (`.../opencode/shadow-cutter` by default) and never the repository.
//
// Run from `studio/`: node src/studio/shadow/cut/proof/proof.mjs --clip <path> [--out <dir>]   (--clip is required)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const START_FRAME = 3600
const END_FRAME = 4200
const SOURCE_RATE = { num: 60000, den: 1001 }
const FFMPEG_START = '60.06'
const FFMPEG_END = '70.07'
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl', 'dinf', 'udta', 'mvex'])

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function log(line) {
  process.stdout.write(`${line}\n`)
}

const CLIP = arg('clip', '')
if (!CLIP) {
  process.stderr.write('usage: node src/studio/shadow/cut/proof/proof.mjs --clip /path/to/clip.mp4 [--out <dir>]\n')
  process.exit(2)
}
const OUT = arg('out', path.join(os.tmpdir(), 'opencode', 'shadow-cutter'))

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function ffprobeText(file, args) {
  return run('ffprobe', ['-v', 'error', ...args, file])
}

function streamInfo(file) {
  const json = JSON.parse(
    ffprobeText(file, [
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,profile,codec_tag_string,time_base,start_time,duration,nb_frames,color_space,color_transfer,color_primaries,color_range',
      '-of',
      'json',
    ]),
  )
  return json.streams[0]
}

function timeBaseSeconds(stream) {
  const [num, den] = stream.time_base.split('/').map(Number)
  return { num, den }
}

function packets(file) {
  const text = ffprobeText(file, [
    '-select_streams',
    'v:0',
    '-show_packets',
    '-show_data_hash',
    'md5',
    '-show_entries',
    'packet=pts,dts,duration,size,flags,data_hash',
    '-of',
    'csv=p=0',
  ]).trim()
  if (!text) return []
  return text.split('\n').map((line) => {
    const fields = line.split(',')
    const md5 = fields.pop() ?? ''
    const [pts, dts, duration, size, flags] = fields
    return {
      pts: Number(pts),
      dts: Number(dts),
      duration: Number(duration),
      size: Number(size),
      flags,
      md5: md5.replace(/^MD5:/, ''),
    }
  })
}

/** One MP4 box at an offset: its type and its size, or null when it does not fit. */
function readBox(bytes, offset, end) {
  if (offset + 8 > end) return null
  const size = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0)
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
  if (size < 8 || offset + size > end) return null
  return { type, size }
}

/** Every MP4 box type in the file, nested containers included, in file order. */
function boxTypes(bytes, start = 0, end = bytes.byteLength, types = []) {
  let offset = start
  for (let box = readBox(bytes, offset, end); box; box = readBox(bytes, offset, end)) {
    types.push(box.type)
    if (CONTAINERS.has(box.type)) boxTypes(bytes, offset + 8, offset + box.size, types)
    offset += box.size
  }
  return types
}

function processRows() {
  const text = run('ps', ['-axww', '-o', 'pid=,ppid=,rss=,command='])
  const rows = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (match) rows.push({ pid: +match[1], ppid: +match[2], rss: +match[3], command: match[4] })
  }
  return rows
}

/** Every process under the given roots, roots included. */
function descendants(roots, byParent) {
  const included = new Set()
  const queue = [...roots]
  while (queue.length > 0) {
    const pid = queue.pop()
    if (included.has(pid)) continue
    included.add(pid)
    queue.push(...(byParent.get(pid) ?? []))
  }
  return included
}

function childrenOf(byParent, ppid) {
  return byParent.get(ppid) ?? []
}

function rssOf(byPid, pid) {
  return byPid.get(pid)?.rss ?? 0
}

/** The resident memory of the Chrome processes of this run, in MB, at this instant. */
function chromeRssMb(profileDir) {
  const rows = processRows()
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const byParent = new Map()
  for (const row of rows) {
    byParent.set(row.ppid, [...childrenOf(byParent, row.ppid), row.pid])
  }
  const roots = rows
    .filter((row) => row.command.includes(`--user-data-dir=${profileDir}`))
    .map((row) => row.pid)
  const included = descendants(roots, byParent)
  let bytes = 0
  for (const pid of included) bytes += rssOf(byPid, pid) * 1024
  return { mb: bytes / 1048576, processes: included.size }
}

function startServer() {
  let resolveReport
  let rejectReport
  const reported = new Promise((resolve, reject) => {
    resolveReport = resolve
    rejectReport = reject
  })
  const piecePath = path.join(OUT, 'piece.mp4')

  const serve = (response, file, type) => {
    response.writeHead(200, { 'content-type': type })
    response.end(fs.readFileSync(file))
  }
  const savePiece = (request, response) => {
    const file = fs.createWriteStream(piecePath)
    request.pipe(file)
    file.on('finish', () => response.writeHead(200, { 'content-type': 'text/plain' }).end('ok'))
    file.on('error', (error) => {
      response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error))
      rejectReport(error)
    })
  }
  const collectReport = (request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      resolveReport(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    })
  }
  const routes = {
    'GET /': (request, response) =>
      serve(response, path.join(HERE, 'page.html'), 'text/html; charset=utf-8'),
    'GET /page.js': (request, response) =>
      serve(response, path.join(OUT, 'page.js'), 'text/javascript; charset=utf-8'),
    'POST /piece': savePiece,
    'POST /report': collectReport,
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const route = routes[`${request.method} ${url.pathname}`]
    if (route) route(request, response)
    else response.writeHead(404).end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        reported,
        piecePath,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

/** Every packet of both files compared: samples first, then the times they play at. */
function comparePackets(reference, piece) {
  const refPackets = packets(reference)
  const piecePackets = packets(piece)
  const refBase = timeBaseSeconds(streamInfo(reference))
  const pieceBase = timeBaseSeconds(streamInfo(piece))
  let identicalSamples = 0
  let identicalRawTimes = 0
  let maxTimeDelta = 0
  const differences = []
  for (let index = 0; index < Math.max(refPackets.length, piecePackets.length); index++) {
    const a = refPackets[index]
    const b = piecePackets[index]
    if (!a || !b) {
      differences.push(`packet ${index}: missing on ${a ? 'the piece' : 'the reference'}`)
      continue
    }
    const samples = a.size === b.size && a.flags === b.flags && a.md5 === b.md5
    if (samples) identicalSamples += 1
    const timesEqual = a.pts === b.pts && a.dts === b.dts && a.duration === b.duration
    if (timesEqual) identicalRawTimes += 1
    maxTimeDelta = Math.max(
      maxTimeDelta,
      Math.abs(a.pts / refBase.den - b.pts / pieceBase.den),
      Math.abs(a.dts / refBase.den - b.dts / pieceBase.den),
      Math.abs(a.duration / refBase.den - b.duration / pieceBase.den),
    )
    if (!samples || !timesEqual) {
      differences.push(
        `packet ${index}: ref size ${a.size} flags ${a.flags} pts ${a.pts} (${a.md5}), piece size ${b.size} flags ${b.flags} pts ${b.pts} (${b.md5})`,
      )
    }
  }
  return {
    count: { reference: refPackets.length, piece: piecePackets.length },
    identicalSamples,
    identicalRawTimes,
    maxTimeDeltaSeconds: maxTimeDelta,
    differenceCount: differences.length,
    differences: differences.slice(0, 10),
    firstPacket: { reference: refPackets[0], piece: piecePackets[0] },
  }
}

function compare(reference, piece) {
  const refStream = streamInfo(reference)
  const pieceStream = streamInfo(piece)
  const refBoxes = boxTypes(fs.readFileSync(reference))
  const pieceBoxes = boxTypes(fs.readFileSync(piece))
  const colourKeys = ['color_space', 'color_transfer', 'color_primaries', 'color_range']
  const colour = (stream) => Object.fromEntries(colourKeys.map((key) => [key, stream[key]]))
  return {
    reference: {
      bytes: fs.statSync(reference).size,
      stream: refStream,
      editList: refBoxes.includes('elst') || refBoxes.includes('edts'),
    },
    piece: {
      bytes: fs.statSync(piece).size,
      stream: pieceStream,
      editList: pieceBoxes.includes('elst') || pieceBoxes.includes('edts'),
    },
    packets: comparePackets(reference, piece),
    colour: {
      same: colourKeys.every((key) => refStream[key] === pieceStream[key]),
      reference: colour(refStream),
      piece: colour(pieceStream),
    },
  }
}

async function makeReference(referencePath) {
  log('reference: ffmpeg -ss 60.06 -to 70.07 -i <clip> -map 0:v:0 -c copy reference.mp4')
  run('ffmpeg', [
    '-v',
    'error',
    '-ss',
    FFMPEG_START,
    '-to',
    FFMPEG_END,
    '-i',
    CLIP,
    '-map',
    '0:v:0',
    '-c',
    'copy',
    '-y',
    referencePath,
  ])
}

async function cutInBrowser(profileDir) {
  const server = await startServer()
  fs.rmSync(profileDir, { recursive: true, force: true })
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: true,
  })
  let peakMb = 0
  let peakProcesses = 0
  const poll = setInterval(() => {
    try {
      const sample = chromeRssMb(profileDir)
      peakMb = Math.max(peakMb, sample.mb)
      peakProcesses = Math.max(peakProcesses, sample.processes)
    } catch {
      // The process table can be mid-change between ps calls; the next sample is enough.
    }
  }, 250)

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    page.on('console', (message) => {
      if (message.type() === 'error') log(`page console: ${message.text()}`)
    })
    page.on('pageerror', (error) => log(`page error: ${error.message}`))

    const query = new URLSearchParams({
      startFrame: String(START_FRAME),
      endFrame: String(END_FRAME),
      num: String(SOURCE_RATE.num),
      den: String(SOURCE_RATE.den),
    })
    await page.goto(`${server.origin}/?${query}`)
    await page.setInputFiles('#source', CLIP)
    const started = Date.now()
    await page.click('#cut')
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('the proof timed out')), RUN_TIMEOUT_MS).unref()
    })
    const report = await Promise.race([server.reported, timeout])
    log(`page reported after ${Date.now() - started} ms`)
    return { report, peakMb, peakProcesses }
  } finally {
    clearInterval(poll)
    await context.close()
    await server.close()
  }
}

function printResult({ report, peakMb, peakProcesses }, comparison) {
  const samplesIdentical =
    comparison.packets.identicalSamples === comparison.packets.count.piece &&
    comparison.packets.count.piece === comparison.packets.count.reference
  const timesIdentical =
    comparison.packets.identicalRawTimes === comparison.packets.count.piece &&
    comparison.packets.identicalRawTimes === comparison.packets.count.reference

  log('')
  log(
    `window:      frames ${report.window.startFrame}..${report.window.endFrame}, ${report.window.startSeconds} s .. ${report.window.endSeconds} s`,
  )
  log(
    `piece:       ${comparison.piece.bytes} bytes, ${comparison.piece.stream.duration} s, time base ${comparison.piece.stream.time_base}, nb_frames ${comparison.piece.stream.nb_frames}`,
  )
  log(
    `reference:   ${comparison.reference.bytes} bytes, ${comparison.reference.stream.duration} s, time base ${comparison.reference.stream.time_base}, nb_frames ${comparison.reference.stream.nb_frames}`,
  )
  log(
    `samples:     ${comparison.packets.identicalSamples}/${comparison.packets.count.piece} packets identical in size, flags and MD5`,
  )
  log(
    `times:       ${comparison.packets.identicalRawTimes}/${comparison.packets.count.piece} packets identical in pts, dts and duration; max difference ${comparison.packets.maxTimeDeltaSeconds} s`,
  )
  log(
    `edit list:   piece ${comparison.piece.editList ? 'HAS one' : 'has none'}; reference ${comparison.reference.editList ? 'HAS one' : 'has none'}`,
  )
  log(`colour tags: ${comparison.colour.same ? 'identical' : 'DIFFERENT'}`)
  log(
    `first pts:   piece ${comparison.packets.firstPacket.piece?.pts}, reference ${comparison.packets.firstPacket.reference?.pts}`,
  )
  log(
    `cut:         ${report.cutMs.toFixed(0)} ms (plan ${report.planMs.toFixed(0)} ms, saving ${report.saveMs.toFixed(0)} ms)`,
  )
  log(`memory:      peak ${peakMb.toFixed(0)} MB over ${peakProcesses} Chrome processes`)
  if (comparison.packets.differenceCount > 0) {
    log(`differences: ${comparison.packets.differenceCount}`)
    for (const difference of comparison.packets.differences) log(`  ${difference}`)
  }
  log('')
  log(
    samplesIdentical && timesIdentical && !comparison.piece.editList
      ? 'VERDICT: byte-identical — mediabunny copies the keyframe-exact piece exactly as FFmpeg does.'
      : 'VERDICT: NOT byte-identical — see the differences above.',
  )
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  log(`clip: ${CLIP}`)
  log(`out:  ${OUT}`)

  run(path.join('node_modules', '.bin', 'esbuild'), [
    path.join(HERE, 'page.ts'),
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2022',
    `--outfile=${path.join(OUT, 'page.js')}`,
    '--log-level=warning',
  ])

  const referencePath = path.join(OUT, 'reference.mp4')
  await makeReference(referencePath)

  const browser = await cutInBrowser(path.join(OUT, 'chrome-profile'))
  if (!browser.report.ok) {
    throw new Error(`the page failed: ${browser.report.error}`)
  }
  const comparison = compare(referencePath, path.join(OUT, 'piece.mp4'))
  const result = {
    clip: CLIP,
    fileBytes: browser.report.fileBytes,
    window: browser.report.window,
    timing: {
      planMs: browser.report.planMs,
      cutMs: browser.report.cutMs,
      saveMs: browser.report.saveMs,
      peakChromeRssMb: browser.peakMb,
      peakChromeProcesses: browser.peakProcesses,
    },
    comparison,
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(result, null, 2))
  printResult(browser, comparison)
}

main().catch((error) => {
  log(`proof failed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
