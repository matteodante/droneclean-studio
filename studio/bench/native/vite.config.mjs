/**
 * Builds the native 10-bit path's measurement page (design 3.6 slice 7). A separate entry, like the benchmark kit's,
 * so no file of the editor changes; `bench/measurements/native-export.mjs` builds it and drives it in Electron through
 * `main.mjs`. A plain object rather than `defineConfig(...)`, as `desktop/test/native-decode-harness/vite.config.mjs`.
 */
import { fileURLToPath } from 'node:url'

const studioRoot = fileURLToPath(new URL('../..', import.meta.url))

export default {
  root: studioRoot,
  publicDir: false,
  build: {
    target: 'esnext',
    sourcemap: false,
    outDir: fileURLToPath(new URL('../.cache/native-page', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: { harness: fileURLToPath(new URL('./harness.html', import.meta.url)) },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
}
