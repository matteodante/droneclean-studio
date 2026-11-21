/**
 * The Content-Security-Policy of the editor's own origin, `droneclean://app` (audit of 21 Nov 2026).
 *
 * `protocol-handler.ts` puts it on every response of the app scheme. A browser reads the header on two kinds of
 * response only: a document, and a worker's script. Sending it everywhere means the page and every worker it starts
 * from the app's files run under this one policy, whichever way Chromium takes a dedicated worker's policy (from the
 * worker's own response, or from the page that created it); a worker started from a `blob:` URL inherits its
 * creator's, which is the same one. A development run loads the Vite server instead and gets no policy from here.
 *
 * Each source below is there because the editor uses it; the comment names where. It was built by reading
 * `studio/src`, the desktop shell and the built `studio/dist` (21 Nov 2026), not by trying the app: a source left
 * out shows up as a "Refused to ..." console error and a feature that fails, so a new kind of request the editor
 * makes needs its source added here, with its reason, and the test that pins this string updated.
 */
import { EXPORT_FILE_SCHEME } from '../shared/export-file'
import { NATIVE_ENCODE_SCHEME, NATIVE_FRAME_SCHEME } from '../shared/native-media'

const SELF = "'self'"
const NONE = "'none'"

/** Directive by directive, in the order the header lists them. */
const DIRECTIVES: ReadonlyArray<readonly [directive: string, sources: readonly string[]]> = [
  // Whatever is not named below: the app's own files only.
  ['default-src', [SELF]],
  [
    'script-src',
    [
      // The built editor: its modules, its workers' modules (`/assets`, `/gyroflow`, `/moss-tts`) and the audio
      // worklet; no inline script anywhere (the built `index.html` has none, and no `on…` attribute is allowed).
      SELF,
      // Code from strings: the MCP `run` tool turns the agent's script into a function with `new Function` in the
      // page (`main/mcp/tools/run.ts`, evaluated through `executeJavaScript`, which the page's policy governs);
      // onnxruntime-web's Emscripten glue builds method callers with `new Function` (TTS, music, filler words on
      // the page; transcription and scene analysis in workers); zod 4 probes `Function('')`.
      "'unsafe-eval'",
      // WebAssembly: the gyro engine, onnxruntime-web, dotLottie, MOSS TTS, mediabunny's encoders. Implied by
      // 'unsafe-eval'; named so that dropping that one never stops the wasm.
      "'wasm-unsafe-eval'",
      // Modules imported from object URLs: transformers.js imports onnxruntime's glue from a `blob:` copy it
      // patches.
      'blob:',
    ],
  ],
  [
    'worker-src',
    [
      // `new Worker(new URL('./x.worker.ts', import.meta.url))` and the gyro and MOSS TTS workers.
      SELF,
      // Workers built from object URLs: mediabunny's MP3, AAC, AC-3, FLAC and ProRes encoders, dotLottie's
      // renderer, the timeline's helper workers.
      'blob:',
    ],
  ],
  [
    'style-src',
    [
      // The built CSS, and the font CSS loaded with the text tool's fonts.
      SELF,
      // `<style>` elements made at run time (React's style hoisting, Radix's scroll lock, the colour picker,
      // Motion's pop layout, Sentry) and `style` attributes set as text (the detached audio meter): there is
      // no nonce to give them.
      "'unsafe-inline'",
    ],
  ],
  [
    'img-src',
    [
      // The app's pictures, and pictures of media linked by path (`/__media/<id>`).
      SELF,
      // Thumbnails, filmstrips, imported pictures and project covers: object URLs.
      'blob:',
      // Masks drawn to a canvas and read back (`toDataURL`), inline pictures in the CSS.
      'data:',
      // The LottieFiles browser's previews (`assets-v2.lottiefiles.com`).
      'https://*.lottiefiles.com',
    ],
  ],
  [
    'font-src',
    [
      // The bundled fonts.
      SELF,
      // Font subsets inlined in the built CSS (`url(data:font/woff2…)`).
      'data:',
    ],
  ],
  [
    'media-src',
    [
      // Media linked by path (`/__media/<id>`).
      SELF,
      // Media from the workspace and from imports: object URLs.
      'blob:',
    ],
  ],
  [
    'connect-src',
    [
      // The app's own files: wasm, models shipped with the app, the update check of `main.tsx`, the media route.
      SELF,
      // Reading object URLs and data URLs back (`fetch(blobUrl)`, `fetch(dataUrl)`).
      'blob:',
      'data:',
      // The shell's own schemes: decoded frames, the encoder's readback and the audio, the export file.
      `${NATIVE_FRAME_SCHEME}:`,
      `${NATIVE_ENCODE_SCHEME}:`,
      `${EXPORT_FILE_SCHEME}:`,
      // The web, by the user's request only. The media library's "Import media from URL" fetches whatever http(s)
      // address the user types, so no list of hosts can hold it. The hosts the editor itself names are: the cloud
      // (`droneclean.app`) and the storage its uploads and results are signed for (a Railway bucket, by
      // configuration); the models it downloads (`huggingface.co`, which redirects to `*.huggingface.co` and
      // `*.hf.co`); LottieFiles (`graphql.lottiefiles.com`, `*.lottiefiles.com`); Sentry
      // (`*.ingest.de.sentry.io`) and PostHog (`eu.i.posthog.com`), only after the user said yes.
      'https:',
      // An http address typed in "Import media from URL": the page is a secure context, so in practice only a
      // loopback address answers (the feature pass imports from `http://127.0.0.1`).
      'http:',
    ],
  ],
  // Frames of the app's own pages only: MOSS TTS's tokenizer sandbox page. Sentry's blank probe frame needs none.
  ['frame-src', [SELF]],
  // No plugins.
  ['object-src', [NONE]],
  // No `<base>` element: relative addresses always resolve against the app.
  ['base-uri', [NONE]],
  // The editor's two forms submit through script (`preventDefault`); a native submission is never wanted.
  ['form-action', [NONE]],
  // No other page may frame the editor.
  ['frame-ancestors', [NONE]],
]

/** The header's value. */
export const APP_CONTENT_SECURITY_POLICY: string = DIRECTIVES.map(([directive, sources]) =>
  [directive, ...sources].join(' '),
).join('; ')

export const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy'

/** Put the policy on a response of the app scheme; returns the same response. */
export function withContentSecurityPolicy(response: Response): Response {
  response.headers.set(CONTENT_SECURITY_POLICY_HEADER, APP_CONTENT_SECURITY_POLICY)
  return response
}
