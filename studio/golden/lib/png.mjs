// Minimal PNG reader/writer for the golden-frame kit (8-bit RGBA, no dependencies).
//
// The kit must not depend on a package that happens to be installed because
// something else pulled it in, so this is the whole codec: node:zlib plus the
// five PNG scanline filters. It reads what Chrome's `convertToBlob` writes and
// what this kit writes; anything exotic (16-bit, palette, interlaced) is refused
// loudly instead of being decoded wrongly.
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

/** Encode `{ width, height, data }` (RGBA, 8 bits per channel) as a PNG. */
export function encodePng({ width, height, data }) {
  if (data.length !== width * height * 4)
    throw new Error('encodePng: data length does not match size')
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
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

/** Decode a PNG to `{ width, height, data }` (RGBA, 8 bits per channel). */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePng: not a PNG')
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
  if (!header) throw new Error('decodePng: missing IHDR')
  const { width, height, depth, colorType, interlace } = header
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (depth !== 8 || channels === 0 || interlace !== 0) {
    throw new Error(
      `decodePng: unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`,
    )
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= channels ? prev[x - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) predictor = paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`decodePng: bad filter ${filter}`)
      out[x] = (line[x] + predictor) & 0xff
    }
  }
  if (channels === 4) return { width, height, data: new Uint8Array(pixels) }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3]
    rgba[i * 4 + 1] = pixels[i * 3 + 1]
    rgba[i * 4 + 2] = pixels[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return { width, height, data: rgba }
}
