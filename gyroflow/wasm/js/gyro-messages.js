// SPDX-License-Identifier: GPL-3.0-or-later
//
// The worker's message switch: what `gyro-worker.js` answers, as a function of the engine it is handed, so the editor's
// contract test (`studio/src/studio/stabilization/worker-contract.test.ts`) drives this very switch with the wasm faked
// at its boundary. `gyro-worker.js` is only the wiring: the package, `self` and a `FileReaderSync`.
//
// One message in, one reply out, each reply carrying the request's `id` and either a `result` or an `error`:
//
//   in  { id, type: 'open', file, progress, motionTrace? }  the `File` of the clip: it is read through `FileReaderSync` in 256 KiB
//                                           slices, so the browser never holds the whole file in memory. A file the
//                                           desktop links by path has no `File`: `file` is then `{ url, size, name }`
//                                           and the worker reads it from that same-origin URL with `Range`, 8 MiB at a
//                                           time (`readRange`). With
//                                           `progress: true` the worker posts { type: 'progress', id, progress }
//                                           messages while it reads, before this call's reply
//   out { id, result: { info, ms, motionTrace? } }
//                                           `motionTrace` is the bytes the parsers consumed, an ArrayBuffer transferred, when
//                                           this open recorded one. The next `open` of the same file can carry it back as
//                                           `motionTrace` (an ArrayBuffer): the engine is then opened from it without reading
//                                           the file (a trace that does not fit the file is ignored and the file is read)
//
//   in  { id, type: 'info' }                out { id, result: info }
//   in  { id, type: 'lensProfile' }         out { id, result: profile }, as the object of a Gyroflow profile file
//   in  { id, type: 'shaderAssets', model, digitalLens }  out { id, result: { lensModel, kernelWgsl, lensWgsl,
//                                           digitalLensWgsl, coeffs, interpolation } }, `coeffs` transferred
//   in  { id, type: 'smoothingMethods' }    out { id, result: methods }, `Stabilizer.smoothingMethods()`: every method
//                                           with its parameters, defaults and limits; needs no `open`
//   in  { id, type: 'memory' }              out { id, result: { bytes } }, the engine's wasm heap, before an `open`
//   in  { id, type: 'setSmoothing', method, params }   out { id, result: null }
//   in  { id, type: 'setFov', fov }                    out { id, result: null }
//   in  { id, type: 'setAdaptiveZoom', windowSeconds } out { id, result: null }
//   in  { id, type: 'setHorizonLock', lockPercent, rollDegrees } out { id, result: null }
//   in  { id, type: 'setLensProfile', json }           out { id, result: null }
//   in  { id, type: 'setOutputSize', width, height }   out { id, result: null }   the output becomes the largest frame of
//                                           that aspect that fits the video; `info` reports it at once
//   in  { id, type: 'recompute' }           out { id, result: null }   applies the settings sent before it
//   in  { id, type: 'frameData', timestampsUs }        out { id, result: { frames, ms } }, the typed arrays transferred
//   in  { id, type: 'processRgba8', timestampUs, input }  out { id, result: { output, fov, minimal_fov, backend, ms } },
//                                           `input` an ArrayBuffer of the source frame (RGBA8), `output` transferred
//   in  { id, type: 'close' }               out { id, result: null }   frees the engine's memory
//
// A `progress` message carries no `result` and no `error`: a caller that asked for progress must recognize it by its
// `type` before it reads a reply. The message and reply types are in `gyro-worker.d.ts`.

/** How much of a linked file one request reads: the engine asks 256 KiB at a time, mostly in order */
export const LINKED_CHUNK_BYTES = 8 * 1024 * 1024

/** Whether `file` is a linked file's description, `{ url, size, name }`, rather than a `File` */
function isLinkedFile(file) {
  return (
    typeof file === 'object' &&
    file !== null &&
    typeof file.url === 'string' &&
    file.url.length > 0 &&
    Number.isSafeInteger(file.size) &&
    file.size > 0 &&
    typeof file.name === 'string'
  )
}

/**
 * The engine's `read(offset, length)` over a linked file: whole aligned chunks fetched with `readRange(url, start,
 * end)` (end exclusive, answering an ArrayBuffer of exactly those bytes), the last one kept, so the engine's small
 * reads in order cost one request per chunk.
 */
function linkedReader(file, readRange) {
  let chunkStart = -1
  let chunk = null
  return (offset, length) => {
    const out = new Uint8Array(length)
    let written = 0
    while (written < length) {
      const at = offset + written
      if (at >= file.size) throw new Error(`${file.name}: the engine read past the end of the file (${at} of ${file.size})`)
      if (chunk === null || at < chunkStart || at >= chunkStart + chunk.byteLength) {
        chunkStart = at - (at % LINKED_CHUNK_BYTES)
        const end = Math.min(chunkStart + LINKED_CHUNK_BYTES, file.size)
        chunk = new Uint8Array(readRange(file.url, chunkStart, end))
        if (chunk.byteLength !== end - chunkStart) {
          throw new Error(`${file.name}: bytes ${chunkStart}-${end - 1} answered ${chunk.byteLength} bytes`)
        }
      }
      const from = at - chunkStart
      const count = Math.min(length - written, chunk.byteLength - from)
      out.set(chunk.subarray(from, from + count), written)
      written += count
    }
    return out
  }
}

/**
 * Answers the engine's messages on `scope` (the worker's `self`): `ready` is the package's `init()`, `Stabilizer` its
 * class, `reader` the `FileReaderSync` a `File` is read with and `readRange` how a linked file's bytes are read.
 */
export function serveGyroMessages(scope, { ready, Stabilizer, reader, readRange }) {
  let stabilizer = null

  const sliceReader = (file) => {
    if (isLinkedFile(file)) {
      if (!readRange) throw new Error('this worker cannot read a linked file: it was given no `readRange`')
      return linkedReader(file, readRange)
    }
    if (!(file instanceof File)) throw new Error('open needs `file`: the clip as a File, or a linked file as { url, size, name }')
    // The engine calls this with (offset, length) and wants those bytes synchronously: a slice of the File, read now
    return (offset, length) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length)))
  }

  const opened = () => {
    if (!stabilizer) throw new Error('no clip is open: send { type: "open", file } first')
    return stabilizer
  }

  const handle = async (message) => {
    // Every message waits for the module: a worker may be asked something (the smoothing methods) before any `open`,
    // and the package's exports may not be called before `init()` has resolved
    const wasm = await ready
    switch (message.type) {
      case 'open': {
        stabilizer?.free()
        stabilizer = null
        const t = performance.now()
        // Progress is posted as the engine reads (the callback runs inside `open`, on this thread): a caller that asked
        // for it gets these messages before this call's reply
        const onProgress = message.progress
          ? (progress) => scope.postMessage({ type: 'progress', id: message.id, progress })
          : undefined
        const slices = sliceReader(message.file)
        let stab
        try {
          const trace = message.motionTrace ? new Uint8Array(message.motionTrace) : undefined
          stab = Stabilizer.open(message.file.size, message.file.name, slices, onProgress, trace)
        } catch (error) {
          // A trace that is not this file's (another size, cut short) is not the clip's failure: the file is read
          if (!message.motionTrace || !String(error?.message ?? error).includes('the motion trace is not usable')) throw error
          stab = Stabilizer.open(message.file.size, message.file.name, slices, onProgress, undefined)
        }
        const ms = performance.now() - t
        stabilizer = stab
        const trace = stab.motionTrace()
        return {
          result: { info: stab.info(), ms, ...(trace ? { motionTrace: trace.buffer } : {}) },
          transfer: trace ? [trace.buffer] : [],
        }
      }
      case 'info':
        return { result: opened().info() }
      case 'lensProfile':
        return { result: opened().lensProfile() }
      case 'shaderAssets': {
        const assets = Stabilizer.shaderAssets(message.model ?? null, message.digitalLens ?? null)
        const result = {
          lensModel: assets.lensModel,
          kernelWgsl: assets.kernelWgsl,
          lensWgsl: assets.lensWgsl,
          digitalLensWgsl: assets.digitalLensWgsl,
          coeffs: assets.coeffs,
          interpolation: assets.interpolation,
        }
        const transfer = [assets.coeffs.buffer]
        assets.free()
        return { result, transfer }
      }
      case 'smoothingMethods':
        // The same for every clip, so the client may ask a worker that has opened none (`Stabilizer.smoothingMethods`)
        return { result: Stabilizer.smoothingMethods() }
      case 'memory':
        // The engine's wasm heap, as `init()` resolves to the module's exports: what one opened clip costs (task 6.3)
        return { result: { bytes: wasm.memory ? wasm.memory.buffer.byteLength : null } }
      case 'setSmoothing':
        opened().setSmoothing(message.method, message.params)
        return { result: null }
      case 'setFov':
        opened().setFov(message.fov)
        return { result: null }
      case 'setAdaptiveZoom':
        opened().setAdaptiveZoom(message.windowSeconds)
        return { result: null }
      case 'setHorizonLock':
        opened().setHorizonLock(message.lockPercent, message.rollDegrees)
        return { result: null }
      case 'setLensProfile':
        opened().setLensProfile(message.json)
        return { result: null }
      case 'setOutputSize':
        opened().setOutputSize(message.width, message.height)
        return { result: null }
      case 'recompute': {
        const t = performance.now()
        opened().recompute()
        return { result: { ms: performance.now() - t } }
      }
      case 'frameData': {
        const stab = opened()
        const frames = []
        const transfer = []
        const t = performance.now()
        for (const timestampUs of message.timestampsUs) {
          const t0 = performance.now()
          const data = stab.frameData(timestampUs)
          const ms = performance.now() - t0
          frames.push({
            frame: data.frame,
            fov: data.fov,
            minimalFov: data.minimalFov,
            matrixStride: data.matrixStride,
            matrices: data.matrices,
            params: data.params,
            mesh: data.mesh,
            ms,
          })
          transfer.push(data.matrices.buffer, data.params.buffer, data.mesh.buffer)
          data.free()
        }
        return { result: { frames, ms: performance.now() - t }, transfer }
      }
      case 'processRgba8': {
        const stab = opened()
        const input = new Uint8Array(message.input)
        const [w, h] = stab.info().input
        if (input.length !== w * h * 4) throw new Error(`the frame must be ${w * h * 4} bytes of RGBA8 (${w}x${h}), not ${input.length}`)
        const output = new Uint8Array(stab.outputWidth() * stab.outputHeight() * 4)
        const t = performance.now()
        const result = stab.processRgba8(message.timestampUs, input, output)
        const ms = performance.now() - t
        return { result: { output: output.buffer, ms, ...result }, transfer: [output.buffer] }
      }
      case 'close':
        stabilizer?.free()
        stabilizer = null
        return { result: null }
      default:
        throw new Error(`unknown message type ${JSON.stringify(message.type)}`)
    }
  }

  scope.onmessage = async (event) => {
    const { id } = event.data
    try {
      const { result, transfer = [] } = await handle(event.data)
      scope.postMessage({ id, result }, transfer)
    } catch (error) {
      scope.postMessage({ id, error: error?.message ?? String(error) })
    }
  }
}
