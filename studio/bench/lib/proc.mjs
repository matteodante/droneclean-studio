// Small process helpers shared by the benchmark kit.
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'

/** Run a command to completion and return its stdout (a Buffer). Throws with stderr on a non-zero exit. */
export function run(command, args, { maxBuffer = 1 << 30, input } = {}) {
  const result = spawnSync(command, args, { maxBuffer, input })
  if (result.error) throw new Error(`${command}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}:\n${result.stderr.toString().slice(-2000)}`,
    )
  }
  return result.stdout
}

/**
 * Run a command and stream its stdout in chunks of exactly `frameBytes` to `onFrame` (for raw video). Resolves with
 * the number of frames read. `onFrame` receives a Buffer that is only valid during the call.
 */
export function streamFrames(command, args, frameBytes, onFrame) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let pending = Buffer.alloc(0)
    let count = 0
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.stdout.on('data', (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      while (pending.length >= frameBytes) {
        onFrame(pending.subarray(0, frameBytes), count++)
        pending = pending.subarray(frameBytes)
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${command} exited ${code}:\n${stderr}`))
      else resolve(count)
    })
  })
}

/** SHA-256 of a file, streamed. */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function ffprobeJson(file, extraArgs = []) {
  const out = run('ffprobe', ['-v', 'error', '-of', 'json', ...extraArgs, file])
  return JSON.parse(out.toString())
}

/** Apparent size of a folder on disk, as `du -sk` reports it. */
export function duBytes(dirPath) {
  const out = run('du', ['-sk', dirPath]).toString()
  const kib = Number(out.trim().split(/\s+/)[0])
  if (!Number.isFinite(kib)) throw new Error(`du gave no size for ${dirPath}: ${out}`)
  return kib * 1024
}
