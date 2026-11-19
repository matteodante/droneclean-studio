// @vitest-environment node

// The gyro build step's facts (task 6.3, slice C2): the paths the app serves, the staleness rule
// that decides whether `build.sh` runs, and the URL guard that keeps a dev request inside
// `gyroflow/wasm/`. The build itself is exercised by `vp build` and the app proof.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  gyroContentType,
  gyroSourceStamp,
  gyroWasm,
  gyroWasmFiles,
  gyroWasmIsStale,
  resolveGyroRequest,
} from './gyro-wasm'

let repo: string

function write(relative: string, contents = 'x'): string {
  const path = join(repo, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
  return path
}

function touch(path: string, seconds: number): void {
  utimesSync(path, seconds, seconds)
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gyro-wasm-'))
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('gyroWasmIsStale', () => {
  /** The stamp the plugin records beside a package it built from the sources in the tree */
  function stampPackage(): void {
    write('gyroflow/wasm/pkg/source-stamp.txt', `${gyroSourceStamp(repo)}\n`)
  }

  it('is stale when the package is missing', () => {
    write('gyroflow/wasm/build.sh')
    expect(gyroWasmIsStale(repo)).toBe(true)
  })

  it('is fresh when the package carries the stamp of the sources, whatever their modification times', () => {
    const script = write('gyroflow/wasm/build.sh')
    const source = write('gyroflow/src/core/lib.rs')
    const wasm = write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm')
    stampPackage()
    touch(wasm, 1_000)
    touch(script, 3_000)
    touch(source, 3_000)
    expect(gyroWasmIsStale(repo)).toBe(false)
  })

  it('is stale when a source’s bytes changed, or a source was added', () => {
    write('gyroflow/wasm/build.sh')
    write('gyroflow/wasm/src/lib.rs', 'pub fn a() {}')
    write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm')
    stampPackage()

    write('gyroflow/wasm/src/lib.rs', 'pub fn b() {}')
    expect(gyroWasmIsStale(repo)).toBe(true)
    stampPackage()
    write('gyroflow/src/core/new.rs', 'pub fn c() {}')
    expect(gyroWasmIsStale(repo)).toBe(true)
  })

  it('is stale for a package with no stamp: nothing says what it was built from', () => {
    write('gyroflow/wasm/build.sh')
    write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm')
    expect(gyroWasmIsStale(repo)).toBe(true)
  })

  it('is not moved by a dot file a desktop or an editor leaves among the sources', () => {
    write('gyroflow/wasm/build.sh')
    write('gyroflow/src/core/lib.rs')
    write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm')
    stampPackage()
    write('gyroflow/src/core/.DS_Store', 'finder')
    expect(gyroWasmIsStale(repo)).toBe(false)
  })
})

describe('gyroWasmFiles', () => {
  it('keeps the worker and the package at the paths their imports use', () => {
    write('gyroflow/wasm/js/gyro-worker.js')
    write('gyroflow/wasm/js/gyro-messages.js')
    write('gyroflow/wasm/js/gyro-worker.d.ts')
    write('gyroflow/wasm/pkg/gyroflow_wasm.js')
    write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm', 'wasm')
    write('gyroflow/wasm/pkg/gyroflow_wasm.d.ts')
    write('gyroflow/wasm/pkg/source-stamp.txt')

    // The worker's modules, without the editor's types for them; the package as build.sh wrote it, without the stamp
    expect(gyroWasmFiles(repo).map((file) => file.relativePath).sort()).toEqual([
      'gyroflow/wasm/js/gyro-messages.js',
      'gyroflow/wasm/js/gyro-worker.js',
      'gyroflow/wasm/pkg/gyroflow_wasm.d.ts',
      'gyroflow/wasm/pkg/gyroflow_wasm.js',
      'gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm',
    ])
  })

  it('lists nothing for a package that was never built', () => {
    write('gyroflow/wasm/js/gyro-worker.js')
    expect(gyroWasmFiles(repo).map((file) => file.relativePath)).toEqual([
      'gyroflow/wasm/js/gyro-worker.js',
    ])
  })
})

describe('resolveGyroRequest', () => {
  it('answers the worker, a query string or not', () => {
    const worker = write('gyroflow/wasm/js/gyro-worker.js')
    expect(resolveGyroRequest(repo, '/gyroflow/wasm/js/gyro-worker.js')).toBe(worker)
    expect(resolveGyroRequest(repo, '/gyroflow/wasm/js/gyro-worker.js?t=1')).toBe(worker)
  })

  it('leaves every other URL to the app', () => {
    expect(resolveGyroRequest(repo, '/src/main.tsx')).toBeUndefined()
    expect(resolveGyroRequest(repo, '/')).toBeUndefined()
  })

  it('refuses a path that leaves the wasm directory', () => {
    write('studio/index.html')
    expect(resolveGyroRequest(repo, '/gyroflow/wasm/../../studio/index.html')).toBeNull()
    expect(resolveGyroRequest(repo, '/gyroflow/wasm/')).toBeNull()
  })

  it('names a file the build has not written yet: whether it is there is asked after the build', () => {
    expect(resolveGyroRequest(repo, '/gyroflow/wasm/pkg/gyroflow_wasm.js')).toBe(
      join(repo, 'gyroflow/wasm/pkg/gyroflow_wasm.js'),
    )
  })

  it('serves a module as JavaScript and the binary as wasm', () => {
    expect(gyroContentType('/a/gyro-worker.js')).toBe('text/javascript; charset=utf-8')
    expect(gyroContentType('/a/gyroflow_wasm_bg.wasm')).toBe('application/wasm')
    expect(gyroContentType('/a/other.bin')).toBe('application/octet-stream')
  })
})

describe('the plugin', () => {
  it('is the one hook vite.config.ts adds, and it builds and emits under its own name', () => {
    const plugin = gyroWasm()
    expect(plugin.name).toBe('droneclean-gyro-wasm')
    expect(typeof plugin.buildStart).toBe('function')
    expect(typeof plugin.configureServer).toBe('function')
    expect(typeof plugin.generateBundle).toBe('function')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Review finding S11: a build starts only for a missing package or a recorded source stamp that differs, and a dev
// request waits for it

type Hook = (...args: never[]) => unknown

/** The plugin, configured as Vite configures it for `studio/` in this repository, building with `build` */
function configured(
  command: 'build' | 'serve',
  build: (repoRoot: string) => Promise<void>,
): ReturnType<typeof gyroWasm> {
  const plugin = gyroWasm({ build })
  ;(plugin.configResolved as Hook)({ root: join(repo, 'studio'), command } as never)
  return plugin
}

/** A stand-in for build.sh: it writes the package, as the script does, and counts its runs */
function fakeBuild(): { build: (repoRoot: string) => Promise<void>; runs: string[] } {
  const runs: string[] = []
  return {
    runs,
    build: async (repoRoot) => {
      runs.push(repoRoot)
      write('gyroflow/wasm/pkg/gyroflow_wasm.js', 'export default async function init() {}')
      write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm', 'wasm')
    },
  }
}

describe('when vite build builds the package', () => {
  beforeEach(() => {
    // Not executable: if the plugin ever ran the real script here, the test would fail on it
    write('gyroflow/wasm/build.sh', '#!/bin/sh\nexit 1\n')
    write('gyroflow/wasm/src/lib.rs', 'pub fn engine() {}')
    write('gyroflow/src/core/lib.rs', 'pub fn core() {}')
  })

  it('builds a missing package, and not again because a checkout touched its sources', async () => {
    const { build, runs } = fakeBuild()

    await (configured('build', build).buildStart as Hook)()
    expect(runs).toEqual([repo])

    // A checkout, a merge or a new worktree: every source newer than the package, the same text
    touch(join(repo, 'gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm'), 1_000)
    touch(join(repo, 'gyroflow/src/core/lib.rs'), 9_000)
    touch(join(repo, 'gyroflow/wasm/src/lib.rs'), 9_000)
    await (configured('build', build).buildStart as Hook)()
    expect(runs).toEqual([repo])
  })

  it('builds again when the text of a source it is built from changed', async () => {
    const { build, runs } = fakeBuild()
    await (configured('build', build).buildStart as Hook)()

    write('gyroflow/src/core/lib.rs', 'pub fn core() { /* changed */ }')
    await (configured('build', build).buildStart as Hook)()

    expect(runs).toHaveLength(2)
  })
})

describe('a dev request for the package', () => {
  /** The dev server's middleware, with a build that writes the package */
  function devServer(): {
    runs: string[]
    get: (url: string) => Promise<{ status: number; headers: Record<string, string>; body: string }>
  } {
    write('gyroflow/wasm/build.sh', '#!/bin/sh\nexit 1\n')
    write('gyroflow/wasm/js/gyro-worker.js', '// the worker')
    const { build, runs } = fakeBuild()
    const plugin = configured('serve', build)
    let middleware: ((request: unknown, response: unknown, next: () => void) => void) | undefined
    ;(plugin.configureServer as Hook)({
      config: { server: { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' } } },
      middlewares: { use: (handler: typeof middleware) => (middleware = handler) },
    } as never)
    const get = async (url: string) => {
      const response = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string) {
          this.headers[name] = value
        },
      })
      const body: Buffer[] = []
      response.on('data', (chunk: Buffer) => body.push(chunk))
      const done = new Promise((resolve) => response.on('end', resolve))
      middleware?.({ url, method: 'GET' }, response, () => {
        throw new Error('the request was handed on, not served')
      })
      await done
      return { status: response.statusCode, headers: response.headers, body: Buffer.concat(body).toString() }
    }
    return { runs, get }
  }

  it('waits for the build instead of answering 404', async () => {
    const { runs, get } = devServer()

    const response = await get('/gyroflow/wasm/pkg/gyroflow_wasm.js')

    expect(runs).toEqual([repo])
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['Cross-Origin-Embedder-Policy']).toBe('require-corp')
    expect(response.body).toBe('export default async function init() {}')
  })

  it('answers 404 for a file the build did not write either, and builds once for every request', async () => {
    const { runs, get } = devServer()

    const [missing, worker] = await Promise.all([
      get('/gyroflow/wasm/pkg/missing.wasm'),
      get('/gyroflow/wasm/js/gyro-worker.js'),
    ])

    expect(missing.status).toBe(404)
    expect(worker.status).toBe(200)
    expect(runs).toEqual([repo])
  })
})

describe('the stamp a build run by hand writes', () => {
  const script = resolve(__dirname, '../../../../gyroflow/wasm/scripts/source-stamp.mjs')
  const buildSh = resolve(__dirname, '../../../../gyroflow/wasm/build.sh')

  it('build.sh calls the shared script after the package is written', () => {
    const text = readFileSync(buildSh, 'utf8')
    expect(text).toMatch(/scripts\/source-stamp\.mjs/)
    expect(text.indexOf('source-stamp.mjs')).toBeGreaterThan(text.indexOf('mv pkg/'))
  })

  it('the script writes the stamp the plugin computes for the same sources, so the package is fresh', () => {
    write('gyroflow/wasm/build.sh', '#!/bin/sh\n')
    write('gyroflow/wasm/Cargo.toml')
    write('gyroflow/wasm/src/lib.rs', 'fn main() {}\r\n')
    write('gyroflow/src/core/a.rs', 'a')
    write('gyroflow/wasm/pkg/gyroflow_wasm_bg.wasm')
    execFileSync('node', [script, repo])
    const written = readFileSync(join(repo, 'gyroflow/wasm/pkg/source-stamp.txt'), 'utf8')
    expect(written.trim()).toBe(gyroSourceStamp(repo))
    expect(gyroWasmIsStale(repo)).toBe(false)
  })
})
