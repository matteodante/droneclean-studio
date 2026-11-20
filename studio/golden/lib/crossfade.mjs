// The fade's own check (20 Nov 2026): at its frame the transition is the crossfade of its two images with FreeCut's
// cos² / sin² weights and its 4% drift, the outgoing image grown from 1 to 1.04 and the incoming one settling from 1.04
// to 1, both about the frame's centre, so both always cover the frame. The frame must be as close to that at its edges
// as inside. FreeCut's fade shrank the outgoing clip to 0.96 instead, so a band at the edges showed the incoming clip
// alone: a dark border on every full-frame clip (40 px a side at 4K at the midpoint). That band is what the edge mean
// measures; the interior mean catches a wrong scale or weight.
import { imagePng } from './images.mjs'
import { decodePng } from './png.mjs'

/** How far from the frame's edge a pixel counts as the edge band, in pixels: twice the old drift's band at 320x180 */
const EDGE = 8
/** The largest mean distance, in 8-bit levels, from the expected frame at the edges and inside */
const MEAN_LIMIT = 2

/** One channel of `image` at a texture coordinate (0..1), bilinear and clamped to the edge like the GPU's sampler */
function sample(image, u, v, channel) {
  const x = u * image.width - 0.5
  const y = v * image.height - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const at = (xx, yy) => {
    const cx = Math.min(image.width - 1, Math.max(0, xx))
    const cy = Math.min(image.height - 1, Math.max(0, yy))
    return image.data[(cy * image.width + cx) * 4 + channel]
  }
  const top = (1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)
  const bottom = (1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1)
  return (1 - fy) * top + fy * bottom
}

/** The fade's weights and scales at `progress` */
function fadeAt(progress) {
  const c = Math.cos((progress * Math.PI) / 2)
  return {
    outgoingWeight: c * c,
    incomingWeight: 1 - c * c,
    outgoingScale: 1 + 0.04 * progress,
    incomingScale: 1.04 - 0.04 * progress,
  }
}

/** The largest distance of the pixel at (x, y) of `image`, over its three channels, from the expected fade */
function pixelDistance(image, a, b, x, y, fade) {
  const u = (x + 0.5) / image.width
  const v = (y + 0.5) / image.height
  const scaled = (t, scale) => (t - 0.5) / scale + 0.5
  let distance = 0
  for (let k = 0; k < 3; k++) {
    const expected =
      fade.outgoingWeight * sample(a, scaled(u, fade.outgoingScale), scaled(v, fade.outgoingScale), k) +
      fade.incomingWeight * sample(b, scaled(u, fade.incomingScale), scaled(v, fade.incomingScale), k)
    distance = Math.max(distance, Math.abs(image.data[(y * image.width + x) * 4 + k] - expected))
  }
  return distance
}

/** Whether a pixel lies within `EDGE` of the frame's edges */
function onEdge(image, x, y) {
  return x < EDGE || y < EDGE || x >= image.width - EDGE || y >= image.height - EDGE
}

/** The mean distance of `image` from the expected fade, at the edges and inside */
function distances(image, a, b, fade) {
  const sums = { edge: [0, 0], inner: [0, 0] }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const sum = sums[onEdge(image, x, y) ? 'edge' : 'inner']
      sum[0] += pixelDistance(image, a, b, x, y, fade)
      sum[1]++
    }
  }
  return { edge: sums.edge[0] / sums.edge[1], inner: sums.inner[0] / sums.inner[1] }
}

/**
 * The check of a fade from image `outgoing` to image `incoming`; `progressAt(frame)` is the transition's progress at a
 * rendered frame (FreeCut's: the frame's place in the transition over its length less one).
 */
export function checkCrossfade(outgoing, incoming, progressAt) {
  const a = decodePng(imagePng(outgoing))
  const b = decodePng(imagePng(incoming))
  return (image, frame) => {
    const progress = progressAt(frame)
    const { edge, inner } = distances(image, a, b, fadeAt(progress))
    const problems = []
    if (edge > MEAN_LIMIT) {
      problems.push(
        `within ${EDGE} px of the frame's edges the fade is ${edge.toFixed(2)} levels from the fade of "${outgoing}" and "${incoming}" at progress ${progress.toFixed(3)} (outgoing grown to ${fadeAt(progress).outgoingScale.toFixed(4)}), on average (at most ${MEAN_LIMIT}): a clip drawn smaller than the frame leaves a border`,
      )
    }
    if (inner > MEAN_LIMIT) {
      problems.push(
        `inside, the fade is ${inner.toFixed(2)} levels from the expected fade at progress ${progress.toFixed(3)}, on average (at most ${MEAN_LIMIT}): a clip has the wrong scale or weight`,
      )
    }
    return problems
  }
}
