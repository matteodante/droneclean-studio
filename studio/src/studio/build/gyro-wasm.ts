/**
 * The build step that ships Gyroflow's engine with the app (task 6.3, slice C2).
 *
 * The stabilization client starts `/gyroflow/wasm/js/gyro-worker.js`, a module worker that imports
 * `../pkg/gyroflow_wasm.js` and its `.wasm`. Neither lives under `src/` or `public/`: the package is
 * generated from `gyroflow/` by `gyroflow/wasm/build.sh` and is git-ignored, because it is 8.2 MB of
 * compiled GPL code that no commit should carry. This plugin makes the app serve it from its own
 * origin, as both the web build and the desktop shell (which serves `dist/`) expect:
 *
 * - **build**: `gyroflow/wasm/build.sh` runs when the package is missing or was built from other
 *   sources than the ones in the tree: the plugin records a stamp of the sources each build starts
 *   from (`pkg/source-stamp.txt`, the SHA-256 of their paths and bytes) and compares it, never
 *   modification times, which a checkout, a merge or a new worktree changes without changing a byte.
 *   A package with no stamp (built by hand) is built once more, because nothing says what it was
 *   built from. The worker's modules and every package file are emitted into `dist/` under their
 *   own paths (`gyroflow/wasm/js/...`, `gyroflow/wasm/pkg/...`), so the worker's relative imports and
 *   the wasm's own URL resolve as they do in dev.
 * - **dev**: the same paths are served from `gyroflow/wasm/` by a middleware. The first request
 *   builds the package if needed (the worker is only requested when a clip is stabilized), so the
 *   dev server starts without waiting minutes for a Rust build; every request waits for that build
 *   before it looks for its file, so the package's files are served, not answered 404.
 *
 * The wasm is GPL-3.0-or-later (PLAN.md decision D5): it is shipped as it is, with the license header
 * its source carries, and the desktop build serves the same `dist/`.
 */

import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Plugin } from 'vite-plus'
import {
  GYRO_DIR,
  STAMP_FILE,
  filesUnder,
  gyroSourceStamp,
  writeGyroSourceStamp,
} from '../../../../gyroflow/wasm/scripts/source-stamp.mjs'

export { gyroSourceStamp }

const run = promisify(execFile)

/** The package `gyroflow/wasm/build.sh` writes; without its `.wasm` there is no package */
const WASM_FILE = join('pkg', 'gyroflow_wasm_bg.wasm')

/**
 * The worker's own modules: `gyro-worker.js`, which the stabilization client starts
 * (`src/studio/stabilization/client.ts`), and the message switch it imports (`gyro-messages.js`).
 * Every `.js` file of this folder is shipped; its `.d.ts` files are the editor's types, not the app's.
 */
const WORKER_DIR = 'js'

/** The content types the served files need: a module worker must be JavaScript, the wasm binary */
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** The content type for a path, or `application/octet-stream` for a file the directory may carry */
export function gyroContentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Whether the package must be built: it is missing, it carries no stamp (built by hand, from
 * sources nobody recorded), or its stamp is not the stamp of the sources in the tree
 */
export function gyroWasmIsStale(repoRoot: string, stamp = gyroSourceStamp(repoRoot)): boolean {
  if (!existsSync(join(repoRoot, GYRO_DIR, WASM_FILE))) return true
  const recorded = join(repoRoot, GYRO_DIR, STAMP_FILE)
  if (!existsSync(recorded)) return true
  return readFileSync(recorded, 'utf8').trim() !== stamp
}

/**
 * The files the app serves from its own origin: the worker's modules and everything `build.sh` wrote
 * into the package (the wasm-bindgen module, its `.d.ts` files and the `.wasm`). Their paths are
 * kept, so the worker's `./gyro-messages.js` and `../pkg/gyroflow_wasm.js` imports and the module's
 * own `.wasm` URL resolve unchanged.
 */
export function gyroWasmFiles(repoRoot: string): Array<{ path: string; relativePath: string }> {
  const base = join(repoRoot, GYRO_DIR)
  const files = [
    ...filesUnder(join(base, WORKER_DIR)).filter((file) => extname(file) === '.js'),
    ...filesUnder(join(base, 'pkg')),
  ]
  return files
    .filter((file) => existsSync(file) && file !== join(base, STAMP_FILE))
    .map((file) => ({
      path: file,
      relativePath: join('gyroflow', 'wasm', file.slice(base.length + 1)).split(sep).join('/'),
    }))
}

/**
 * The path a dev request names inside the wasm directory, or `null` when it is outside it (a
 * traversal), or `undefined` when the request is not this plugin's. Whether the file is there is
 * asked only after the package's build, which may be what writes it.
 */
export function resolveGyroRequest(repoRoot: string, url: string): string | null | undefined {
  const pathname = url.split('?')[0]!.split('#')[0]!
  if (!pathname.startsWith('/gyroflow/wasm/')) return undefined
  const base = join(repoRoot, GYRO_DIR)
  const wanted = normalize(join(base, pathname.slice('/gyroflow/wasm/'.length)))
  if (!wanted.startsWith(base + sep)) return null
  return wanted
}

/** Whether a resolved path is a file the dev server serves */
function isServedFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/** Runs `gyroflow/wasm/build.sh` once, printing its output where the caller's build logs go */
async function buildGyroWasm(repoRoot: string): Promise<void> {
  const script = join(repoRoot, GYRO_DIR, 'build.sh')
  if (!existsSync(script)) {
    throw new Error(`the gyro module's build script is missing: ${script}`)
  }
  try {
    const { stdout, stderr } = await run(script, [], {
      cwd: join(repoRoot, GYRO_DIR),
      maxBuffer: 16 * 1024 * 1024,
    })
    if (stdout.trim()) console.log(stdout.trim())
    if (stderr.trim()) console.warn(stderr.trim())
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `gyroflow/wasm/build.sh failed, so the app would start its stabilization worker with no engine.\n` +
        `${detail}\n` +
        `Install Rust, wasm-bindgen-cli 0.2.130 and wasm-opt (gyroflow/wasm/README.md), or run the script by hand.`,
    )
  }
}

/** What the plugin is built with; the tests replace the build */
export interface GyroWasmOptions {
  /** Builds the package; the default runs `gyroflow/wasm/build.sh` */
  build?: (repoRoot: string) => Promise<void>
}

/**
 * The plugin `vite.config.ts` adds: it builds the package when it is missing or was built from
 * other sources, serves it in dev, and emits it into the build's output.
 */
export function gyroWasm(options: GyroWasmOptions = {}): Plugin {
  const build = options.build ?? buildGyroWasm
  let repoRoot = ''
  let command: 'build' | 'serve' = 'build'
  let ensuring: Promise<void> | null = null

  /**
   * The package is built at most once per process: a failure is kept, so the build stops, not
   * retries. The stamp recorded is the one the build started from, so a source edited while it ran
   * is built the next time.
   */
  const ensureWasm = (): Promise<void> => {
    ensuring ??= (async () => {
      const stamp = gyroSourceStamp(repoRoot)
      if (!gyroWasmIsStale(repoRoot, stamp)) return
      await build(repoRoot)
      writeGyroSourceStamp(repoRoot, stamp)
    })()
    return ensuring
  }

  return {
    name: 'droneclean-gyro-wasm',
    configResolved(config) {
      // `studio/` when the app is built or served; the gyro module is its sibling in the repository
      repoRoot = resolve(config.root, '..')
      command = config.command
    },
    async buildStart() {
      if (command === 'build') await ensureWasm()
    },
    configureServer(server) {
      // The dev server's own headers (cross-origin isolation) reach its static files but not a
      // plugin's middleware, and a module worker under `Cross-Origin-Embedder-Policy: require-corp`
      // fails to load without them. The served files get exactly the headers every other response
      // the page loads has.
      const serverHeaders = server.config.server.headers ?? {}
      server.middlewares.use((request, response, next) => {
        const file = resolveGyroRequest(repoRoot, request.url ?? '')
        if (file === undefined) {
          next()
          return
        }
        if (file === null) {
          response.statusCode = 404
          response.end('not found')
          return
        }
        void ensureWasm()
          .then(() => {
            if (!isServedFile(file)) {
              response.statusCode = 404
              response.end('not found')
              return
            }
            for (const [name, value] of Object.entries(serverHeaders)) {
              if (value !== undefined) response.setHeader(name, value)
            }
            response.setHeader('Content-Type', gyroContentType(file))
            if (request.method === 'HEAD') {
              response.end()
              return
            }
            createReadStream(file).pipe(response)
          })
          .catch((error: unknown) => {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : String(error))
          })
      })
    },
    generateBundle() {
      for (const file of gyroWasmFiles(repoRoot)) {
        this.emitFile({
          type: 'asset',
          fileName: file.relativePath,
          source: readFileSync(file.path),
        })
      }
    },
  }
}
