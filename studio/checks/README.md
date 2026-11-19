# The repository's checks

The rules of `AGENTS.md` that a script can measure live here, each with its tests in `test/`:

| Check | Script | Fails when |
|---|---|---|
| Network origins (`check:network`) | `checks/network-origins.mjs` | opening the app and a project makes a request to an origin other than the one that served it |
| Secrets (`check:secrets`) | `checks/secrets.mjs` | a secret sits in the files the repository tracks (`git ls-files`; untracked folders such as `cloud/`, `node_modules` and `.worktrees/` are never scanned) |
| Upstream rows (`check:upstream-rows`) | `checks/upstream-rows.mjs` | a changed or deleted FreeCut file has no row in `UPSTREAM_CHANGES.md`, or a row no longer describes a change (the fork's own paths are not FreeCut's and are skipped) |
| Fork folders (`check:fork-folders`) | `checks/fork-folders.mjs` | a file the fork adds lives outside the folders the fork owns and is not a test beside its subject |
| Reachable (`check:reachable`) | `checks/reachable.mjs` | a module of `src/studio/` or `desktop/src/` is not loaded by the app and is not in `checks/baselines/reachable.json`, or an entry of that baseline is reachable now |
| Studio layers (inside `check:layer-boundaries`) | `checks/studio-layers.mjs` | the core of `src/studio/` reaches React, a store or `src/features/`, or `src/types/` reaches a studio UI module, and the violation is not in `checks/baselines/studio-layers.json` |
| No CDN (`check:no-cdn`) | `checks/no-cdn.mjs` | a file the app ships names a public CDN (`cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`, `cdnjs`), so a "local" AI runtime could be fetched from one again |
| Licences (`check:licenses`) | `checks/licenses.mjs` | a production dependency in `package-lock.json` or `desktop/package-lock.json` has a licence outside the allow-list (MIT, ISC, BSD-2/3-Clause, Apache-2.0, OFL-1.1, MPL-2.0, LGPL-2.1/3.0, Zlib, 0BSD, Unlicense, BlueOak-1.0.0, CC0-1.0, UFL-1.0, CC-BY-4.0, and OR / AND expressions of them) or declares none; a package judged acceptable anyway goes in `EXCEPTIONS` with its reason |
| I18n keys (`check:i18n-keys`) | `checks/i18n-keys.mjs` | the code uses a translation key English does not define; builds a key at runtime that is not listed in `checks/baselines/i18n-dynamic-keys.json`; or a key lacks a translation in one of the eight other languages (an error for keys DroneClean code uses, a baseline that may only shrink for FreeCut's own: `i18n-missing-english.json`, `i18n-missing-translations.json`) |

None of them needs the network; the upstream-rows and fork-folders checks read only the git history and finish
in under a second. `npm run verify` runs them and the checks' own tests (`npm run check:checks`).

## Quick checks (`npm run check:quick`)

Run this before reporting a change: it is every fast check of `npm run verify` (types and lint, the three
boundary checks, wrapper health, unused exports and class members, changed-code health, feature map, edge
budgets, secrets, no CDN, licences, upstream rows, fork folders, reachable, the checks' own tests), in verify's order, and
takes about 20 s on this Mac. It stops at the first failure and prints `check:quick FAILED at <check>`. The list
is `QUICK_CHECKS` in `checks/quick.mjs`; `verify` calls `check:quick` for that part, so the two cannot drift
(`checks/test/quick.test.mjs` fails if `verify` repeats a check). Not in it: the unit tests (`vp test run`), the
build, the network check, the desktop checks and the headless suites, which `verify` runs after it.

## Network origins check

Opening the editor and a project must not reach any origin but the one that served the app. This is the
rule "The editor makes no network request the user did not ask for" in `AGENTS.md`, measured: the plan's
task 1.4 is done when "a network log of opening the app and a project shows only our own origin", and this
script is that log, kept as a check so the rule cannot come back unnoticed.

```sh
cd studio
npm run check:network                  # reuse the build in dist/ (npm run verify builds it just before)
node checks/network-origins.mjs        # build the app, then check
node checks/network-origins.mjs --dist dist   # reuse a build that already exists
```

`npm run check:network` is part of `npm run verify`, which builds `dist/` just before and passes `--dist dist`,
so the check reuses that build instead of building a second one.

Exit codes: `0` every request stayed on the served origin, `1` a request went elsewhere (each offending URL
and the step it happened in is printed), `2` the check could not run (build failed, no Chrome, or the editor
did not open the seeded project).

### What it does

1. Builds the app with `vp build` unless `--dist` names an existing build. `npm run verify` builds `dist/`
   just before, so it passes `--dist dist` and nothing is built twice. The build's log goes to
   `checks/out/build.log`, never into this process.
2. Serves it on `127.0.0.1` at a random port, from `/`, with the cross-origin isolation headers the editor
   needs (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`,
   `Cross-Origin-Resource-Policy: same-origin`) and the history fallback: an extension-less path gets
   `index.html`, a missing file gets a 404.
3. Launches Chrome through Playwright 1.60 as the rest of the repository does (`channel: 'chrome'`,
   `headless: true`, `chromeLaunchArgs()` from `headless/lib/cli.mjs`), in a fresh browser context.
4. Records every request the context makes — pages, dedicated workers, the service worker, stylesheets,
   fonts, images, `fetch`, and WebSocket handshakes (which Playwright reports as `websocket` events, not as
   requests). Each entry carries the URL, method, resource type, the step, the initiator and the status or
   failure.
5. Opens five steps, each until no request has started or finished for 3 s:
   - `landing` — `/`, the landing page;
   - `projects` — `/projects`, the project list (the seeded project must appear);
   - `editor` — `/editor/<id>`, the editor with the seeded project (the seeded clip and its text must be on
     screen; the clip's font is what makes the text-font request this step exists to see);
   - `font-picker` — selects the seeded text clip and opens its font picker, whose catalogue and preview faces
     must all come from the app's own assets;
   - `lottie` — opens the Lottie tab. This step must make **no request at all**: opening the tab is not the
     user asking for the catalogue, so it waits on its "Browse LottieFiles" button until that button is
     clicked. A request here fails the run even if it stays on the served origin (`lib/expectations.mjs`).
6. Writes `checks/out/network-origins.json` and prints a short summary. Any request to an origin other than
   the served one fails the run, as does any request from a step marked `noRequests`. `data:` and `blob:` URLs
   are made in the page, not fetched, and a WebSocket to the app's own server is the app's own origin.

`checks/out/` is ignored by `studio/.gitignore` (`out`).

### How the workspace is seeded

A native folder picker cannot be clicked from a test. FreeCut keeps the workspace folder as a
`FileSystemDirectoryHandle` in the IndexedDB database `freecut-handles-db` (`handles` store, the
`workspace:current` record plus the `workspace:{id}` record it points at), and the browser hands out the
same kind of handle for its own storage: `navigator.storage.getDirectory()` returns a real
`FileSystemDirectoryHandle` for an origin-private folder, always with permission granted.

Before the first page of the app loads, on an `SVG` document from the same origin (`/favicon.svg`), the
check writes:

- the folder `network-check-workspace` in the origin-private file system, with `projects/<id>/project.json`,
  `index.json`, `.freecut-workspace.json` (schema 2.0) and `README.md`, in the format
  `src/infrastructure/storage/workspace-fs` writes;
- those two `workspace` records in `freecut-handles-db`.

The project is one 30 fps 1080p sequence with one text clip using `Roboto`, a font in the app's catalogue and
not the default (`Inter`): opening the editor then exercises the app's font loader. `checks/test/seeded-project.test.mjs`
fails if the seed's schema version drifts from `CURRENT_SCHEMA_VERSION` or if the font leaves the catalogue.

The app then behaves exactly as after a folder pick: the gate finds the handle, checks the permission and
activates the workspace. If it did not, the run fails at the step that did not appear — the seeding is never
"fixed" by changing the app.

### What it does not cover

- **Features the user starts.** Model downloads (Hugging Face, ONNX), text-to-speech, transcription, AI
  generation, stickers and the shadow-removal cloud call only make requests when the user uses them; nothing
  of that is opened here, so nothing of it is measured. Task 1.3 records per feature what each one downloads
  and when, and that list is the place to add each feature's own check when it ships. The `lottie` step only
  opens the tab: the request the "Browse LottieFiles" click makes is the user asking for it, and the check
  does not click it.
- **The desktop shell.** The Electron app (`studio/desktop/`) is not launched; this measures the web build.
- **The dev server.** Only the production build is measured; `vp dev` serves a different graph.
- **A request after the quiet window.** A step ends after 3 s without a request (30 s at most). A background
  task that waits longer than that before fetching is not in the log.
- **Which worker made a request.** Playwright reports a dedicated worker's requests through the page that
  started it, so the log names the page; it lists the worker and service-worker scripts it saw in `workers`.
  A service worker's own requests are named as such. `checks/test/recorder.test.mjs` proves a request from a
  dedicated worker, a request from a service worker and a WebSocket handshake are all recorded.
- **The app's service worker in this run.** The production build registers `/sw.js` inside a `load` listener
  that `main.tsx` adds after a dynamic import; on a local build the `load` event has already fired by then, so
  the app registers no service worker here. That is a finding about the app, not a gap in the recorder:
  `checks/test/recorder.test.mjs` starts a real service worker and sees its requests.

### Building into another folder

`vp build --outDir checks/out/dist` works: FreeCut's `serviceWorkerVersionPlugin` in `studio/vite.config.ts`
stamps the `sw.js` of the folder the build wrote (the `options.dir` that `writeBundle` reports), so a build
whose output is not `dist/` no longer ends with `ENOENT`. This check builds into `dist/` (or serves a folder
given with `--dist`), so it measures the build the rest of the repository talks about.

## Upstream rows check

`node checks/upstream-rows.mjs` measures the rule "The forks stay mergeable ... every touched file of
FreeCut's listed in `studio/UPSTREAM_CHANGES.md`": every file of FreeCut's that differs from the imported
tree, and every file the fork deleted, has a row in `UPSTREAM_CHANGES.md`, and every row still names such a
file. A row is one line of the table, its first cell a path relative to `studio/` in backticks, its second
cell what changed. A file the fork deleted on purpose keeps a row whose second cell begins with `Deleted`;
a row for a deleted file that does not say so is stale, like a row for a file that no longer differs or that
FreeCut never had.

The paths `checks/lib/fork-areas.mjs` says are the fork's own are skipped: the table describes FreeCut's
files, and the imported branch `studio/main` already carried some of the fork's own (`bench/`, `golden/`,
this table), so "exists in the imported tree" alone does not make a file FreeCut's. A row naming such a path
is ignored rather than reported stale.

The reference is the merge base of `HEAD` and the remote branch `upstream-studio/main` (`findUpstreamBase` in
`checks/lib/upstream.mjs`): a commit of FreeCut's own history, found without the network, that moves forward
by itself with every `git subtree merge --prefix=studio upstream-studio/main`. The `git-subtree-split` trailer
of the first import is not used: it names a branch that already held the fork's own commits.
`git ls-tree -r <sha>` gives that tree's files and blobs. The lookup is shared with the fork-folders check.
The branch must be in the clone (`git fetch upstream-studio`).

Both checks read `HEAD`, the tree a commit would carry, not the working tree: a row belongs in the same
commit as the file it describes.

Exit codes: `0` every changed or deleted FreeCut file has a row and every row is current, `1` a row is
missing or stale (each path is printed), `2` the check could not run (not a git checkout, `upstream-studio/main` is
not in this clone or shares no history, or `UPSTREAM_CHANGES.md` is missing).

## Fork folders check

`node checks/fork-folders.mjs` measures the rule "new code in new folders": every file `studio/` has and
FreeCut's imported tree does not lives under a folder the fork owns. The list is `FORK_FOLDERS` in
`checks/lib/fork-areas.mjs`, each entry with the reason it is the fork's; an entry ending in `/` owns that
folder and everything under it, an entry without the slash owns exactly one file. The one general exception
is a test beside the file it covers: `toolbar.test.tsx` is allowed when `toolbar.tsx` exists in the same
folder, and a qualifier before `.test` is dropped until a file matches (`gpu.shadow.test.ts` covers `gpu.ts`).
Nothing else in FreeCut's folders is allowed. When a file is reported, either move it under a folder the fork
owns, add the file as an entry with the reason its place is fixed by a framework, or name the test after the
file it covers.

Exit codes: `0` every file the fork adds is under a listed folder, `1` a file is outside (each path is
printed), `2` the check could not run (not a git checkout, no subtree import in the history, or the imported
commit is not in this clone).

## No CDN check

`node checks/no-cdn.mjs` measures the same rule as the network check, statically: "The editor makes no network
request the user did not ask for" covers the runtimes of the "local" AI features, which used to be downloaded
from `cdn.jsdelivr.net` and `esm.sh` on first use. The check reads every file under `src/`, `public/` and
`index.html` and fails on a line that names one of the banned hosts (`cdn.jsdelivr.net`, `esm.sh`,
`unpkg.com`, `cdnjs`). A line that is only a comment may name a host when it also carries the marker
`no-cdn-ok`, which is how a comment explains the old behaviour it replaced; the marker on a line of code does
not count.

Exit codes: `0` nothing found, `1` at least one finding (each file and line is printed), `2` the check could
not run (the folder or `index.html` is missing).

## Reachable check

`node checks/reachable.mjs` asks which modules of the fork the app never loads (review finding F1: `fallow`
counts tests and probes as entries, so the dead-code ratchets let a module through that only a test calls).
The walk starts at the production entries only (`src/bootstrap.ts`, `src/headless/main.ts`, every module under
`src/routes/`, `desktop/src/main/index.ts`, the preload scripts and `vite.config.ts`) and follows imports,
re-exports, dynamic imports, `new URL('./x', import.meta.url)` and `import.meta.glob`. The modules judged are
the non-test files of `src/studio/` and `desktop/src/`. Test-only support code is not judged: put it in a
`__fixtures__/` folder (or name it `*.fixture.ts` / `*.fixture.mjs`) and the check ignores it; every other module
stays checked, so a module only tests import still fails.

Today's unreachable modules are in `checks/baselines/reachable.json`, which may only shrink: a new unreachable
module fails the check, and a module that became reachable must leave the baseline (the check says so).
`--shrink-baseline` removes the reachable entries and never adds one; `--list` prints every unreachable
module. The fix for a failure is to give the module a real caller or to delete it, never to add it to the
baseline. Exit codes: `0` the baseline matches, `1` a module is newly unreachable or an entry is stale, `2`
the check could not run.

## Studio layers

`checks/studio-layers.mjs` runs inside `npm run check:layer-boundaries` (`scripts/check-layer-boundaries.mjs`
calls `runStudioLayerRules` first, and fails when it reports a failure). Two rules (finding F3):

- `core-purity`: the core of the fork (time, the pure colour maths, the precise render contract, the
  stabilization client, stage and settings, motion blur, the speed mapping) may not reach React, a store or
  `src/features/`, directly or through the modules it imports. The headless engine, the workers and the tests
  rely on the core without a UI.
- `types-ui`: `src/types/` may not reach a studio UI module (a `.tsx` file, a folder `ui`, `panel`, `panels` or
  `components`, or a module that imports React), directly or through its imports.

Today's violations are in `checks/baselines/studio-layers.json`, which may only shrink: a violation that is not
in it fails the check, and an entry that is no longer a violation fails it until removed.
`node scripts/check-layer-boundaries.mjs --shrink-baseline` removes the fixed ones and never adds one.

## Secrets check

`node checks/secrets.mjs` scans exactly the files `git ls-files` lists, as they are in the working tree: a
folder git does not track (`cloud/`, `node_modules`, `dist`, `.worktrees/`) is never scanned, in the main
checkout as in a worktree. The files are copied into a temporary folder and gitleaks scans that, with
`--redact` so a finding is named by file, line and rule and never by its value. Files over 1 MB are skipped.
A folder that is not a git repository (the checks' own tests) is scanned whole. Exit codes: `0` no finding,
`1` a finding, `2` gitleaks missing or failed.

## The checks' own tests

`npm run check:checks` runs `node --test checks/test/*.test.mjs`; `npm run verify` runs it too. The
upstream-rows and fork-folders tests build a throwaway repository in the operating system's temporary folder
— an upstream commit, the `git subtree` import commit and a fork commit — and run the real script on it, so
a missing row, a stale row, a fork-owned path that needs no row, a test beside its subject and a file added
inside FreeCut's folders are each seen. `secrets.test.mjs` needs gitleaks, and `recorder.test.mjs` starts
Chrome, as `verify` already does elsewhere.
