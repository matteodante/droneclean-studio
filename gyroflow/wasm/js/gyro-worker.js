// SPDX-License-Identifier: GPL-3.0-or-later
//
// Gyroflow's engine in a dedicated worker, for the editor's web build and its desktop shell.
//
// The engine blocks (it reads and parses the clip, and smooths it, in one go), so it lives here and never on the page
// thread. The messages it answers, and how, are `gyro-messages.js`'s (one message in, one reply out); this file only
// hands that switch the package, the worker's `self` and the `FileReaderSync` the clip is read with. The message and
// reply types are in `gyro-worker.d.ts`.
import init, { Stabilizer } from '../pkg/gyroflow_wasm.js'
import { serveGyroMessages } from './gyro-messages.js'

/**
 * Bytes `start` to `end` (exclusive) of a linked file, read now: the engine reads synchronously, and a worker may block
 * on a synchronous request. The URL is the desktop shell's same-origin media route, which answers `Range` with 206.
 */
function readRange(url, start, end) {
  const request = new XMLHttpRequest()
  request.open('GET', url, false)
  request.responseType = 'arraybuffer'
  request.setRequestHeader('Range', `bytes=${start}-${end - 1}`)
  request.send()
  if (request.status !== 206) throw new Error(`reading bytes ${start}-${end - 1} answered ${request.status}, not 206`)
  return request.response
}

// The package's default: it fetches `gyroflow_wasm_bg.wasm` next to its module, which works over http(s) in the page
// and in Electron's renderer (where the file is served from the app, not from a `file://` URL)
serveGyroMessages(self, { ready: init(), Stabilizer, reader: new FileReaderSync(), readRange })
