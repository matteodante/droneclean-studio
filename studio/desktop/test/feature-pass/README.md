# Feature pass of task 1.3 (the packaged desktop app)

Two scripts try every feature of the editor in the packaged app and write down, for each one, what happened, what it
requested from the network, and where it stored data. The coordinator runs them, one at a time, and pastes the
"Desktop app" column into `docs/feature-pass.md` and the plan.

| Script | Features | Downloads |
|---|---|---|
| `test/feature-pass-light.mjs` | launch, projects, create, save and reopen, import by drop, timeline, text, shapes, effects, transitions, Lottie prompt, panels, settings and dialogs, language, workspaces, User Guide link, mic (fake device), proxy, reverse, URL import, embedded subtitles, bundle export and import | none or tiny |
| `test/feature-pass-models.mjs` | Whisper, Parakeet, captions from a transcript, Kokoro, Supertonic, MOSS, MusicGen, filler-word scoring, scene analysis, semantic search, upscale, frame interpolation | about 4 GB from Hugging Face and others, into the throwaway profile only |

## Running

In `studio/desktop/`, with the packaged app built (`npm run package`, which writes `dist/mac-arm64/`), the app
closed, and FFmpeg at `/opt/homebrew/bin/ffmpeg` (`FFMPEG=` overrides) and macOS `say` (for the speech fixtures):

```sh
scripts/heavy.sh --max-gb 6 -- node test/feature-pass-light.mjs
scripts/heavy.sh --max-gb 6 -- node test/feature-pass-models.mjs      # long: each model has a ceiling of 10 to 30 minutes
```

Options: `--list` (feature ids), `--only id,id`, `--limit N`, `--mode packaged|built` (default `auto`), `--keep` (keep
the throwaway folder, with the downloaded models, for a look).

The models pass depends on order: `captions-from-transcript` needs the transcript `whisper` made, and
`semantic-search` needs the captions `scenes` made. Running them with `--only` skips that, and the record says so.
Each feature stands on one project, "Feature pass", that the first feature creates; the others reuse it.

## The profile is never the real one

`e2e.mjs` once ran against `~/Library/Application Support/DroneClean Studio` and left it pointing at a temporary
workspace. This harness cannot do that:

1. Every launch gets a fresh folder under `$TMPDIR` (the profile and the workspace are inside it; fixtures too).
2. A packaged app ignores `DRONECLEAN_USER_DATA` (review finding D5), so the harness moves the app's `appData`
   instead: it starts with `HOME` and `CFFIXED_USER_HOME` set to the throwaway folder. Before the `.app` is
   started at all, `test/support/print-appdata.cjs` runs under Electron's own binary with the same environment and
   prints `appData`; unless it is inside the throwaway folder (and not inside the real profile), the packaged app is
   not started. `--mode auto` then falls back to `built` (Electron on `out/` + `studio/dist`, through
   `test/support/throwaway-profile.cjs`, not `isPackaged`); `--mode packaged` stops instead.
3. After every launch the harness asks the running app for `app.getPath('userData')` and stops, closing the app, if
   that path is the real profile, inside it, or outside the throwaway folder (`lib/profile.mjs`, unit-tested in
   `test/feature-pass.test.mjs`).
4. The throwaway folder is deleted at the end (`--keep` keeps it); the outputs are not in it.

On 19 Nov 2026 the probe passed on this Mac: the packaged app runs with `appData` inside the throwaway folder.

## What is recorded

For each feature, in `out/<pass>-<time>/record.json` (and the table in `table.md`):

- `status`: `works`, `works after a download the user starts`, `does not work in the desktop app` (with the reason in
  `notes`), `manual step`, or `script error`. A script error means the script could not finish (a button it looked
  for was not there); it says nothing about the app, and the notes carry the page text and a screenshot. Those are
  to be read and fixed in the script, not copied into the plan.
- `requests`: every request of the default session (pages, workers, the service worker), through
  `session.webRequest` in the main process, plus requests the main process itself makes through `fetch`,
  `net.fetch`, `net.request`, `http.request`, `https.request` (best effort: code that kept a reference to the
  original function before the harness patched it is not seen). Grouped by host with sizes (the response's
  `Content-Length`, else the size Playwright saw). Requests to `droneclean://`, `blob:` and `data:` are our own
  origin and only counted. A request is flagged **before the user acts** when it is not to our own origin and was
  made before the feature's first real action (`ctx.act(...)`): loading the page, opening a panel. The full list
  with timings is in `requestLog`.
- `stored`: the growth of the profile's folders (IndexedDB, Cache Storage, the model caches) and the new files in
  the workspace. Models downloaded by the page land in the profile (Cache Storage, OPFS), so their size shows there.
- `screenshot`: a PNG under `out/<pass>-<time>/shots/` (the folder `out/` is git-ignored).
- `firstUserAction`, `toasts` (what was on screen at the end), `seconds`.

A feature that worked but, after the click, pulled 1 MB or more from another host is "works after a download the
user starts" in the models pass (`expectsDownload`).

## How it drives the app, and what it cannot

Everything is a click, a key press, a mouse drag or a file drop with real files, as in `e2e.mjs`. Two things stand in
for native dialogs that cannot be driven:

- **The workspace folder** is a folder dropped on the page (`getAsFileSystemHandle`), and the record the folder
  picker would have written is stored in `freecut-handles-db`, as `e2e.mjs` does. Media is imported by a drop on the
  media panel, not through the Import button's picker.
- **File pickers** (`showSaveFilePicker`, `showOpenFilePicker`, `showDirectoryPicker`) are wrapped by an init
  script that records the call and answers as a user who cancelled (`AbortError`). Nothing is faked as a success.
  Features that need one end as **manual step** with the exact steps for the owner: project bundle export and
  import. (Whether the macOS dialog itself opens in the packaged app is only seen by hand.)

Fixtures are made at the start in the throwaway folder: three small H.264 clips and a clip with an embedded subtitle
track (FFmpeg), and two speech files (`say`, one with filler words). The owner's footage is not used or copied.

## Known limits

- Selectors are the editor's own markup and English strings; a changed label shows up as a `script error`, not as a
  broken feature. The lists of what each script could not finish are in the notes of the record.
- `transitions` only opens the tab: applying one needs a drag onto a cut between two adjacent clips.
- `effects` does not read the applied effect back from the clip's properties.
- `semantic-search` types a query and leaves the result for a person to read from the screenshot.
- The model downloads are not cancelled and the pass has long ceilings; if a model host is down the pass waits for
  its ceiling (10 to 30 minutes) per feature.
- The harness records the second a request starts, not what a person would have seen at that moment: a request made
  by an earlier feature that finishes after the next one started is attributed to the next one.
