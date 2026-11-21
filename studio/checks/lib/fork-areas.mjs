// The paths under `studio/` that belong to the fork rather than to FreeCut.
//
// `checks/fork-folders.mjs` uses the list to decide where a new file may live.
// `checks/upstream-rows.mjs` uses it to skip the fork's own files even though
// FreeCut's imported tree already contained them: `studio/` was imported from
// the prepped branch `studio/main`, which carried the phase-0 bench and golden
// kits and this table, so "exists in the imported tree" alone does not make a
// file FreeCut's.
//
// An entry ending in "/" owns that folder and everything under it. An entry
// without the slash owns exactly one file, listed because its place is fixed
// by a framework or by the FreeCut code it sits beside; the reason says which.
// Neither kind may be used to quiet a file that merely belongs beside
// FreeCut's code: a test beside its subject is the one general exception, and
// it is a rule in `checks/fork-folders.mjs`, not an entry here.

/** The languages `src/i18n/index.ts` reads partials for, in its own order. */
const LICENCE_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'tr', 'zh']

const FORK_FOLDERS = [
  {
    path: 'src/studio/',
    why: "the fork's own code: brand, fonts, colour, speed ramps, shadow removal, stabilization, SDK and its generated reference",
  },
  { path: 'desktop/', why: 'the Electron shell (task 1.1)' },
  { path: 'web/', why: "the web editor's static server (Dockerfile, Caddyfile): published at /studio/ on the live site" },
  { path: 'mcp/', why: 'the MCP launcher and its protocol files, started by the desktop app (task 2.2)' },
  { path: 'bench/', why: 'the benchmark kit, its page and its measurements (task 0.3)' },
  { path: 'golden/', why: 'the golden-frame kit, its clips and its expected frames (task 0.4)' },
  {
    path: 'checks/',
    why: 'the repository checks and their tests: network origins, secrets, upstream rows, fork folders',
  },
  { path: 'docs/feature-map/', why: 'the feature map and its checker (task 2.4)' },
  { path: 'public/brand/', why: "DroneClean's brand assets: app icon, mark and wordmark" },
  {
    path: 'UPSTREAM_CHANGES.md',
    why: "the fork's table of changed FreeCut files, named by AGENTS.md and the plan",
  },
  {
    path: 'src/features/docs/pages/27-drone-footage.ts',
    why: "the docs load every page with import.meta.glob('./pages/*.ts'): the drone-footage guide page has to sit there (19 Nov 2026)",
  },
  {
    path: 'src/routes/licenses.lazy.tsx',
    why: "the router's file-based routes: a page is one file in src/routes/ (task 1.4)",
  },
  {
    path: 'src/i18n/locales/partials/it/',
    why: "Italian, the fork's own language (21 Nov 2026): the i18n loader reads partials per language from src/i18n/locales/partials/<code>/, so the whole Italian set has to sit here",
  },
  {
    path: 'src/i18n/locales/it.json',
    why: "Italian's base file, which the i18n loader reads by name from src/i18n/locales/ (21 Nov 2026)",
  },
  {
    path: '.claude/skills/studio-release/',
    why: "the release skill (21 Nov 2026): Claude Code reads a project's skills from .claude/skills/<name>/; studio/.claude is never exported to the public repository",
  },
  ...['it', 'es', 'fr', 'de', 'pt-BR', 'tr', 'ja', 'ko', 'zh'].map((language) => ({
    path: `src/features/docs/pages/${language}/`,
    why: `the user guide in ${language} (21 Nov 2026): docs-content.ts reads a translated page beside the English one, by its file name, from src/features/docs/pages/<code>/`,
  })),
  ...LICENCE_LANGUAGES.map((language) => ({
    path: `src/i18n/locales/partials/${language}/licenses.json`,
    why: "the i18n loader reads one partial per language from this folder; the licences page's copy has to sit here",
  })),
  {
    path: 'src/features/media-library/services/linked-media-source.ts',
    why: 'task 1.2: the linked-media descriptor reader sits beside the media-library service that writes the link',
  },
  {
    path: 'src/features/media-library/services/caption-generation-job.ts',
    why: "task 1.3: the caption job is a media-library service that reads that feature's store, transcription service and runner; moving it under src/studio/ would make the fork's folder import FreeCut's feature internals",
  },
  {
    path: 'src/features/media-library/components/transcribe-dialog-first-use-hint.tsx',
    why: 'task 1.3: the first-use hint is the transcribe dialog\'s own child, rendered from transcribe-dialog.tsx beside it',
  },
  {
    path: 'src/features/settings/components/agent-access-panel.tsx',
    why: "task 2.2 slice 7: the Agent access panel is one of the settings dialog's sections, rendered from settings-dialog.tsx beside the other settings controls",
  },
  {
    path: 'src/features/settings/components/agent-access-snippets.ts',
    why: 'task 2.2 slice 7: the panel\'s snippet block, imported only by agent-access-panel.tsx beside it',
  },
  {
    path: 'src/app/router.ts',
    why: "task 2.2: the router's single instance and its Register declaration live beside src/app.tsx, and code outside React (the MCP's export) imports it to open a project's editor route",
  },
  {
    path: 'src/runtime/renderer/audio/speed-curve.test.ts',
    why: 'the speed-curve audio test covers planning.ts, pipeline.ts and decode.ts together (design 7.1), so it has no single subject file',
  },
  {
    path: 'headless/lib/build-log.mjs',
    why: 'the build log golden/run.mjs and checks/network-origins.mjs share, beside the headless helpers they start',
  },
  {
    path: 'headless/subclips-e2e.mjs',
    why: "the headless suite's Chrome end-to-end tests are headless/*.mjs (package.json, headless:test:chrome), and this one covers the subclips of the editor, which has no single subject file",
  },
  {
    path: 'headless/build-log.test.mjs',
    why: "the headless suite's tests are headless/*.test.mjs and its modules headless/lib/*.mjs, so this test cannot sit beside its subject",
  },
  {
    path: 'src/runtime/renderer/audio/audio-grid.test.ts',
    why: 'the exact-rate audio grid test covers mixdown.ts, pipeline.ts and windowed.ts together (design 1.5), so it has no single subject file',
  },
  {
    path: 'headless/lib/mp4-boxes.mjs',
    why: "task 11.19: the MP4 box walk used by the headless export pass (export-media-video.mjs) and its tests, beside FreeCut's other headless helpers",
  },
  {
    path: 'headless/mp4-boxes.test.mjs',
    why: 'task 11.19: `headless:test:node` runs headless/*.test.mjs, so the box walk\'s test has to sit there',
  },
  {
    path: 'headless/mp4-mux-contract.test.mjs',
    why: 'task 11.19: the contract that the muxer writes moov first and no edit list; `headless:test:node` runs headless/*.test.mjs',
  },
]

/** The entry that owns `file`, or null when the file sits in FreeCut's folder. */
export function ownerOf(file) {
  return (
    FORK_FOLDERS.find((entry) =>
      entry.path.endsWith('/') ? file.startsWith(entry.path) : file === entry.path,
    ) ?? null
  )
}
