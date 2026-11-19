/**
 * Builds the native decoder's measurement page (task 3.1, slice P4).
 *
 * A separate entry, like the benchmark kit's, so that no file of the editor has
 * to change: the page imports the editor's own `native-source.ts` and P3's
 * `source-pass.ts`. `run.mjs` builds it with this config and drives it in
 * Electron through `main.mjs`.
 *
 * The config is a plain object rather than `defineConfig(...)`, because this file
 * lives under `desktop/`, whose `package.json` (the shell's packaging manifest)
 * does not — and should not — depend on the editor's bundler; importing it here
 * would make the dead-code gate report an unlisted dependency.
 */
import { fileURLToPath } from 'node:url'

const studioRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default {
  root: studioRoot,
  publicDir: false,
  build: {
    target: 'esnext',
    sourcemap: false,
    outDir: fileURLToPath(new URL('../.cache/native-decode/page', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: { harness: fileURLToPath(new URL('./harness.html', import.meta.url)) },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) } },
}
