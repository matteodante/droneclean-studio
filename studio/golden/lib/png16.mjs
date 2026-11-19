// 16-bit RGBA PNG for the float golden cases (no dependencies, like `png.mjs`): the stored frame of a float case holds
// the renderer's `rgba16float` accumulator as unorm16 values, which an 8-bit PNG cannot. Samples are big-endian, as
// PNG says; the in-memory form is a `Uint16Array` of RGBA values, row after row. Anything but 16-bit RGBA is refused.
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encode `{ width, height, data }` (RGBA, a `Uint16Array`) as a 16-bit PNG. */
export function encodePng16({ width, height, data }) {
  if (data.length !== width * height * 4)
    throw new Error('encodePng16: data length does not match size')
  const stride = width * 8
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    for (let x = 0; x < width * 4; x++) {
      raw.writeUInt16BE(data[y * width * 4 + x], y * (stride + 1) + 1 + x * 2)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 16 // bit depth
  header[9] = 6 // colour type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Decode a 16-bit RGBA PNG to `{ width, height, data }` (`data` a `Uint16Array`). */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function decodePng16(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePng16: not a PNG')
  let offset = 8
  let header = null
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header) throw new Error('decodePng16: missing IHDR')
  const { width, height, depth, colorType, interlace } = header
  if (depth !== 16 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `decodePng16: unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace}); a float frame is 16-bit RGBA`,
    )
  }
  const bytesPerPixel = 8
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * bytesPerPixel
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? out[x - bytesPerPixel] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) predictor = paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`decodePng16: bad filter ${filter}`)
      out[x] = (line[x] + predictor) & 0xff
    }
  }
  const data = new Uint16Array(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = pixels.readUInt16BE(i * 2)
  return { width, height, data }
}
