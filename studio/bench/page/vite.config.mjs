// Builds the benchmark page (bench/page/bench.html) into bench/.cache/page-dist. It is a separate entry, like the
// headless page, so that no file of the editor has to change: the page imports the app's own export modules.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  root: repoRoot,
  publicDir: false,
  // Same settings as the app's build (vite.config.ts): minified ES modules, ES module workers.
  build: {
    target: 'esnext',
    sourcemap: false,
    outDir: fileURLToPath(new URL('../.cache/page-dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        bench: fileURLToPath(new URL('./bench.html', import.meta.url)),
        import: fileURLToPath(new URL('./import.html', import.meta.url)),
        sideWork: fileURLToPath(new URL('./side-work.html', import.meta.url)),
        'long-export': fileURLToPath(new URL('./long-export.html', import.meta.url)),
      },
    },
  },
  worker: { format: 'es' },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  optimizeDeps: {
    exclude: [
      'mediabunny',
      '@mediabunny/ac3',
      '@mediabunny/mp3-encoder',
      '@mediabunny/aac-encoder',
    ],
  },
})
