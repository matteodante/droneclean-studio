// Small deterministic test material.
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** `count` different pseudo-random grey pictures of `size` bytes (neighbouring frames differ a lot). */
export function randomFrames(count, size, seed = 1) {
  const random = lcg(seed)
  return Array.from({ length: count }, () =>
    Uint8Array.from({ length: size }, () => Math.floor(random() * 256)),
  )
}

/** A copy of a picture with +-`amount` of noise. */
export function noisy(frame, amount, seed = 7) {
  const random = lcg(seed)
  return frame.map((v) => Math.max(0, Math.min(255, v + Math.round((random() * 2 - 1) * amount))))
}
