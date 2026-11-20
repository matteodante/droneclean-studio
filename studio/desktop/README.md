# Desktop shell (PLAN.md task 1.1)

DroneClean Studio's desktop app: an Electron shell around the editor in `studio/`.
The editor is the same build the web version uses; this folder adds the window, the
scheme it is served from, the permission policy, the sandboxed bridge, and the
packaging. A native media engine (task 3.3) and a local MCP server (task 2.2) will
live in this main process later.

This is an independent npm package (`studio/desktop/package.json`, its own
`package-lock.json` and `node_modules`); nothing is added to `studio/package.json`.

```
src/main/protocol.ts         request → file mapping (pure, unit-tested)
src/main/protocol-handler.ts protocol.handle: reads the file, realpath check, headers
src/main/permissions.ts      permission policy (pure, unit-tested)
src/main/index.ts            app lifecycle, window, navigation, permission wiring
src/main/workspace-lock.ts   one owner of a workspace folder: the lock, its IPC and the owner preload
src/preload/index.ts         window.dronecleanDesktop (self-contained: sandboxed preload)
src/preload/workspace-owner.ts  window.dronecleanWorkspaceOwner (a second preload, registered by the lock)
src/shared/bridge.ts         the DesktopBridge interface, version 1
src/shared/workspace-owner.ts   the owner record's shape and numbers, shared by main and the page
test/protocol.test.mjs       the mapping: headers, MIME, SPA fallback, traversal
test/permissions.test.mjs    the policy: allowed, refused
test/e2e.mjs                 the packaged test variant (or the built main), driven with Playwright
test/e2e-mcp.mjs             the MCP in the packaged test variant, through the app's own stdio launcher
test/support/e2e-profile.mjs the e2e launcher's guard: never the real profile
electron-builder.yml         appId, product name, arm64 `dir` target, icons
scripts/make-icons.mjs       regenerates resources/icon.icns and icon.ico from the brand SVG
resources/                   icon.icns (macOS, 130 KB) and icon.ico (Windows, 22 KB), committed
```

Generated output: `out/` (compiled main and preload), `dist/` (electron-builder
output and the `.app`). Both are ignored by `studio/.gitignore`.

## Requirements

- macOS on Apple Silicon for the Mac app (`dir` target, arm64 only), or Windows 10/11 x64 for the Windows app (task
  8.1; see "Windows" below).
- Node 22.18+ or 24.11+ (there is no Node version pin here beyond what Electron 45
  needs), FFmpeg at `/opt/homebrew/bin/ffmpeg` (on Windows the vendored `vendor/ffmpeg-win/`) for the e2e's test
  clips and measurements (`FFMPEG=` and `FFPROBE=` override the paths, `test/support/ffmpeg-path.mjs`).
- A long HEVC clip for the e2e, named by `DRONECLEAN_E2E_CLIP=/path/to/clip.mp4` (no default; the
  reference runs used clip 0020 of the 15 Nov flight). Read only.

## Commands

Run them in `studio/desktop/`.

| Command | What it does |
|---|---|
| `npm install` | installs the dev dependencies (Electron 45.3.4, electron-builder 26.18.0, TypeScript 7.0.2, playwright-core 1.60.0, @types/node 24.9.0, all exact) |
| `npm run build` | `vp build` in `studio/` (the editor), then `tsc` for main and preload into `out/` |
| `npm start` | runs the built app (`out/` + `studio/dist`) in Electron |
| `npm run dev` | loads `http://localhost:5173/projects` from a `npx vp dev` running in `studio/`, same window settings |
| `npm run check` | `tsc --noEmit` (strict) |
| `npm test` | compiles main/preload, then `node --test test/*.test.mjs` (unit tests) |
| `npm run package` | builds everything, then electron-builder: `dist/mac-arm64/DroneClean Studio.app` |
| `npm run package:test` | the packaged test variant, `dist/test-app/.../DroneClean Studio Test.app` (own name and app id, so its own profile) |
| `npm run e2e` | the packaged test variant under Playwright; prints a JSON result, exits non-zero on a failure |
| `npm run e2e:quick` | the same checks on the built main process in a throwaway profile (no packaging) |
| `npm run e2e:mcp` | the MCP in the packaged test variant: an MCP client through the app's launcher, as Claude Code runs it, edits, renders and exports generated clips; with `DRONECLEAN_E2E_CLIP` also stabilizes that clip and keys its framing |

`npm start` and `npm run dev` use the same profile as the packaged app
(`~/Library/Application Support/DroneClean Studio`), so a workspace picked in one is
there in the others. Two copies cannot run at the same time (Chromium's profile
lock). The e2e never uses that profile (review finding E1): it runs the packaged
test variant, whose profile is `DroneClean Studio Test`, or a throwaway one, so the
real app may stay open.

### Windows

Built and tested on the PC (Windows 11, RTX 5070 Ti) on 20 Nov 2026:

- **FFmpeg**: `npm run package` and `npm run package:test` call `scripts/vendor-ffmpeg.mjs`, which on Windows runs
  `scripts/build-ffmpeg-win.sh` inside WSL (`wsl -e sh ...`): a cross-build with mingw-w64 of the same pinned FFmpeg,
  with NVENC/NVDEC, Quick Sync (libvpl), AMF, Media Foundation, D3D11VA and DXVA2, into `vendor/ffmpeg-win/`. It needs
  WSL with Ubuntu (24.04) and `curl`, `cmake`, `make`, `pkg-config` there; the mingw-w64 compiler and nasm are taken
  from Ubuntu's packages with `apt-get download` and unpacked in `~/.cache/droneclean-ffmpeg-win/` when they are not
  installed, so no root is needed. About 10 minutes the first time; then the stamp makes it a no-op.
- **The stabilization engine** (`gyroflow/wasm/pkg`) is built by `gyroflow/wasm/build.sh`, which needs Rust and
  wasm-bindgen. Without them, copy `gyroflow/wasm/pkg` from a machine that built it from the same sources: the
  WebAssembly is the same on every system and its `source-stamp.txt` tells the build it is current.
- **Packages**: `npm run package` writes `dist/DroneClean-Studio-x64.exe`, a per-user NSIS installer, unsigned;
  `npm run package:test` writes the unpacked test variant `dist/test-app/win-unpacked/DroneClean Studio Test.exe`.
- **e2e**: `DRONECLEAN_E2E_CLIP=<a long 10-bit HEVC clip>` (a synthetic one from the bundled FFmpeg is fine) and
  `DRONECLEAN_E2E_GPU_VENDOR=nvidia` to check WebGPU runs on the discrete card. Run it, `npm run e2e:mcp` and the
  golden run from a desktop session: over SSH there is no desktop, the video never advances, the run stops at the
  first drag, and the GPU draws nothing (the golden run refuses the empty frames). `npm run e2e:mcp` refuses to start
  while a DroneClean Studio answers on the MCP pipe, which on Windows is per user, not per profile.
- **Golden**: on Windows `npm run golden` reads and writes `golden/expected-pc/` (the PC's GPU), never the Mac's set.

Versions in the packaged app: Electron 45.3.4, Chromium 156.0.8078.100, Node 24.22.3,
V8 15.6.75.57-electron.0.

## Icons

`resources/icon.icns` and `resources/icon.ico` come from `studio/public/brand/app-icon.svg` (the logo of task 1.4),
drawn on Apple's icon grid (824 px rounded square on a transparent 1024 px canvas). To regenerate them after the
logo changes, on a Mac with Google Chrome (`CHROME_PATH=` overrides its path):

```sh
node scripts/make-icons.mjs
```

It renders the SVG with headless Chrome, makes the sizes with `sips`, builds the `.icns` with `iconutil` and writes
the `.ico` (16 to 256 px). The files live in `resources/`, not `build/`, because `studio/.gitignore` ignores `build`.

## How the app is served

`droneclean://app/` is registered before `ready` with `standard: true`, `secure: true`,
`supportFetchAPI`, `stream`, `corsEnabled` and `codeCache`. Every response, including
404 and 405, carries:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

The window opens `droneclean://app/projects` (the projects page; the landing page at
`/` is the web version's front door). The origin never changes — no port, no host, no
random partition — so IndexedDB, OPFS and file handles persist between launches.

`mapRequestUrl` in `src/main/protocol.ts` decides what a request means:

- `/` and any path whose last segment has no extension serve `index.html`, so the
  router sees `/projects/abc`, `/editor/42`, `/docs/…`;
- a path with an extension names a file in `dist/`; MIME types are explicit (`.wasm`
  → `application/wasm`, `.mjs` → `text/javascript`, `.webmanifest` →
  `application/manifest+json`, `.js.map` → `application/json`, …) and an unknown
  extension is `application/octet-stream`.
- Anything that could leave `dist/` is refused: a decoded `..` or `.` segment (so
  `%2e%2e` and `..%2f` are refused, while plain `/../x` is already normalised away by
  the URL parser and becomes the SPA entry), a backslash, a colon, a NUL byte, a
  malformed escape, another host or scheme. `protocol-handler.ts` then resolves the
  real path and checks it is still inside `dist/`, so a symlink cannot escape either.

The editor's build is bundled as `Contents/Resources/dist` (`extraResources` in
`electron-builder.yml`); in a working copy it is `studio/dist`.

### The service worker

The scheme does not grant `allowServiceWorkers`. The editor registers `/sw.js` in
production and the registration rejects:

```
TypeError: Failed to register a ServiceWorker: The URL protocol of the current origin ('droneclean://app') is not supported.
```

`main.tsx` catches it and logs a warning. Nothing else breaks: the start page, a
project, the workspace and playback all work without a service worker, and neither
`pageerror` nor a console error appears. Offline caching is what the web version has
and the desktop app does not need (its files are local).

## The bridge

`src/preload/index.ts` exposes exactly this, and nothing else:

```ts
interface DesktopBridge {
  readonly version: 1
  readonly platform: 'darwin' | 'win32' | 'linux'
  /** Absolute path of a File that comes from the local disk, '' otherwise. */
  getPathForFile(file: File): string
}
```

It is the meeting point with task 1.2. `getPathForFile` is `webUtils.getPathForFile`,
called in the sandboxed preload. Measured in the packaged app:

- a `File` from `<input type="file">` → the path (clip 0020: 3,764,360,098 bytes, and
  the page never holds the bytes);
- a `File` from `dataTransfer.files` of a Finder drop → the path;
- a `File` from `await fileSystemFileHandle.getFile()` → **`''`**, even for a handle
  obtained from that same drop. That File has no path in Chromium, so task 1.2 has to
  keep the path from the picker or the drop, not ask the handle's File later. The
  picker-sourced case could not be measured: the pickers are native dialogs (see
  "What could not be automated").
- a `new File(['x'], 'x.txt')` → `''`.

## Permissions

Electron's default, while no handler is installed, is to grant what a page asks for.
The shell installs both handlers and `src/main/permissions.ts` decides; everything not
listed is refused, so a future upstream merge that starts using a new API fails here
and is added on purpose. Allowed, with the reason:

| Permission | Why |
|---|---|
| `fileSystem` | the workspace folder and the media files; a request needs a non-empty `details.filePath`. A file is granted to read only; only a directory (the workspace the user picked) is granted to write, so a footage file the page holds stays unwritable (review finding D3) |
| `media` | FreeCut's mic recording. Microphone only: a request that also lists `video` is refused, and the check handler only allows `mediaType: 'audio'` |
| `clipboard-read`, `clipboard-sanitized-write` | copy/paste of project JSON, transcripts, media paths |
| `fullscreen` | the preview player and the export preview |
| `persistent-storage` | `navigator.storage.persist()` before OPFS proxies are written |

There is no `file-system-access-restricted` listener, on purpose: a path Chromium restricts (system folders,
the home folder itself) stays blocked and the picker fails for it, as in any Chromium browser. Answering
`allow` for every path would let the picker hand the page a system folder (D3).

### Media registry and decode limits

The native frame protocol (`decode.start`) decodes only a file the page has registered through the media
bridge: a path that was never registered is refused with "not a registered media file", and so is a Windows
UNC, network or device path (`\\server\share`, `\\?\`, `\\.\`; `media/path-guard.ts`), which would make the
machine authenticate to another host. Each window may hold at most two decode jobs
(`MAX_JOBS_PER_WINDOW`, `media/window-jobs.ts`); a third is refused. A window's jobs are cancelled when its
main frame navigates, when its renderer is gone and when the window is destroyed, and a job nobody has read
from for 30 s is cancelled too. Callers of the IPC and the protocol are checked against the app's own URL
(`sender.ts`).

### Environment variables and the profile

`DRONECLEAN_DEV_URL` (load a dev server), `DRONECLEAN_FFMPEG` (run another FFmpeg) and `DRONECLEAN_USER_DATA`
(move the profile) are read only by an unpackaged run (`launch-env.ts`). A packaged app ignores all three
(review finding D5): any process can set them in the environment of an installed app. Spellcheck is off
(C16: it would load dictionaries and, on Windows, download them).

### GPU

The shell starts Chromium with `force-high-performance-gpu` (task 8.1), so a machine with an integrated and
a discrete GPU renders and exports on the discrete one; on a machine with one GPU it changes nothing.

The permission policy is unit-tested, and the e2e proves the microphone (with
`--use-fake-device-for-media-stream`) and the clipboard (write then read) work in the
packaged app. Camera, screen capture, geolocation, notifications, MIDI, USB, serial,
HID, pointer lock, local fonts and the rest are refused.

On a new Mac the first microphone capture waits on macOS's own microphone prompt, even with the
fake device: until someone answers it, `getUserMedia({audio: true})` never settles (every capture
on the machine hangs, `ffmpeg -f avfoundation` included). Answer the prompt once; it is not a
shell permission problem. Measured 19 Nov 2026: with the prompt pending, plain Electron with no
handler timed out after 8 s; after it was accepted, `getUserMedia` resolved with 1 audio track in
221 ms.

## File-system access across a restart: what Electron does

Measured, not assumed (a standalone Electron 45 app with no handlers, then the packaged
app):

- **The check handler is the whole story.** For every file-system access — right
  after a drop, and on every later launch — Electron calls
  `setPermissionCheckHandler` with `permission: 'fileSystem'` and
  `details = { filePath, isDirectory, fileAccessType, isMainFrame: false }`
  (`fileAccessType` arrived as `'readable'` even for a `readwrite` query). Returning
  `true` makes `queryPermission({ mode: 'readwrite' })` answer `'granted'`; returning
  `false` makes it `'denied'`, makes `requestPermission()` answer `'denied'`, and makes
  `getFileHandle()` throw `NotAllowedError`.
- **Electron keeps no grant of its own.** With the check handler denying, a handle
  persisted in IndexedDB is unusable after a restart; Electron's documentation says
  grants are reset shortly after the last document closes. So the restart works
  because this shell answers the check, not because something was remembered. That is
  why there is **no `userData/granted-paths.json`**: the policy needs no list of roots,
  and the only handles a page can hold are the ones the user gave it in a picker or a
  drop.
- The **request** handler (`setPermissionRequestHandler`) with
  `details = { filePath, isDirectory, fileAccessType }` is not called on this path: a
  handle from a picker or a drop is already granted, and the check handler is what the
  app sees on start-up. It stays installed as the safety net for a request that does
  arrive, and it logs each `fileSystem` request to the terminal.
- After a restart of the packaged app: `queryPermission({ mode: 'readwrite' })` is
  `'granted'`, `requestPermission` is `'granted'`, listing the folder works and a file
  in it reads, with no prompt and no click. The e2e checks the value of a file in the
  seeded workspace after the relaunch.

The native pickers themselves (`showDirectoryPicker`, `showOpenFilePicker`) are
Chromium dialogs and were not automated; see the manual steps below.

## What the checks proved

`npm run e2e` against `dist/mac-arm64/DroneClean Studio.app`: 23 checks, green in
every run on 18 Nov 2026 (22 s with the 10 s cut, 28 s importing clip 0020 itself;
90–180 s while other builds were loading the machine), Electron 45.3.4, Mac M4:

| Check | Result |
|---|---|
| Start page | `droneclean://app/projects`, `#root` rendered, no console error, no `pageerror`; 1.9–2.9 s to the first render on the first launch, 0.48–0.64 s on a relaunch |
| Cross-origin isolation | `crossOriginIsolated === true`, `SharedArrayBuffer` present, origin `droneclean://app` |
| WebGPU | adapter `apple` / `metal-3`, feature `core-features-and-limits`, `maxTextureDimension2D` 8192, `maxStorageBufferBindingSize` 128 MiB; `requestDevice()` succeeds. No command-line switch was needed |
| HEVC Main 10 | `VideoDecoder.isConfigSupported('hvc1.2.4.L153.B0', 3840x2880)` supported. Clip 0020 plays in a `<video>`: 3840x2880, duration 230.88 s, **176 frames presented in 3 s** (`requestVideoFrameCallback`), `currentTime` advanced 2.91 s, first frame times 0 / 0.017 / 0.033 / 0.05 s |
| H.264 | `avc1.640033` at 3840x2160: 60 frames in, **60 chunks, 115,772 bytes**, 1.1 s (flat-colour canvas, so the size says little about quality) |
| AAC | `mp4a.40.2`, 48 kHz stereo, one second of a 440 Hz sine: **50 packets, 4,381 bytes** |
| Bridge | `version === 1`, `platform === 'darwin'`, keys `version, platform, getPathForFile`; paths as described above |
| Permissions | microphone (1 audio track) and clipboard write → read; fullscreen is in the policy and the manual steps (see the note below) |
| Service worker | registration rejects with the `TypeError` above; no `pageerror` |
| Persistence | an IndexedDB value is read back after a relaunch; the workspace handle's `queryPermission('readwrite')` is `granted` and a file in the folder reads, with no prompt and no click |
| A project | workspace seeded → new project → clip 0020 dropped on the media library (copied into the project folder, ready in 7.8 s) → dragged to the video track (1 clip, 1 media, 0 missing, 3m51s) → Play: timecode 00:00:00 → 00:04:00 in 4 s (120 frames at 30 fps), the button switches to Pause. With the 10 s cut the media is ready in 0.5–1.3 s |

The project flow imports a **10 s stream copy of clip 0020** (`ffmpeg -ss 60 -t 10 -c
copy`, in the temp folder), because the editor copies every imported file into the
project folder and then builds its filmstrips (PLAN.md section 3.1): the full clip
writes 3.76 GB on every run. `DRONECLEAN_E2E_FULL_CLIP=1` imports clip 0020 itself —
measured: ready in 7.8 s, on the timeline at 3m51s, playing — and the `<video>` check
above always uses clip 0020.

Two things the editor does during a run, recorded in the JSON and not treated as a
shell failure: while a preview video is disposed it logs
`[VideoFrameExtractor] Failed to initialize … InputDisposedError` and aborts `blob:`
requests (`net::ERR_ABORTED`); and in a few runs the **first** drag of a freshly
imported clip onto an empty video track was refused with "Unable to add dropped media
items. No compatible track or open space was available for 1 dropped media items." The
test now waits until the card shows the clip's duration (0:10) before dragging, and
records every gesture and any toast, so a refusal is visible in the result instead of
being a mystery.

The e2e never touches the app's real profile (review finding E1: an earlier version
did, and left it pointing at a temporary workspace, where the owner made a real
project). The default run launches the packaged test variant (`npm run package:test`:
the same build with product name "DroneClean Studio Test" and app id
`com.droneclean.studio.test`), whose profile folder is its own; the run empties it
before and after. `npm run e2e:quick` launches the built main process under
`test/support/throwaway-profile.cjs` with a throwaway profile folder. Either way the
launcher (`test/support/e2e-profile.mjs`) refuses the real profile and the real app,
and the workspace is a throwaway folder under `dist/` (the app refuses a workspace in
the system's temporary folder), removed afterwards. The seeded workspace handle is
written into `freecut-handles-db` of that profile (a `FileSystemHandle` cannot leave
the page).

`npm test` covers what cannot be seen from outside: the request mapping (SPA fallback,
MIME types, traversal attempts) and the permission policy.

## What could not be automated

The native dialogs. `showDirectoryPicker` and `showOpenFilePicker` open Chromium's
macOS dialogs; the DevTools protocol can intercept a `<input type=file>` chooser but not
these. So the e2e:

- gets the workspace handle from a **folder dropped on the page**
  (`DataTransferItem.getAsFileSystemHandle`) and writes FreeCut's own record into
  `freecut-handles-db`, which is the record the picker would have written;
- imports the clip by a **drop** on the media library (the app's real import path for
  a drop), and places it with a **mouse drag** of the media card onto the track.

Neither is a backdoor in the shell or the app: no test-only code exists in either, and
every action is one a user can do.

## Manual steps (for the coordinator)

1. `cd studio/desktop && npm run package && open "dist/mac-arm64/DroneClean Studio.app"`
   The app is unsigned (no Developer ID, no notarization) and ad-hoc signed by the
   linker; building it locally leaves no quarantine flag.
2. **Choose folder** on the start page, pick a folder you own (for example
   `~/Movies/DroneClean`), and confirm. The gate opens the projects page.
3. **New Project** → name → **Create Project**. The editor opens.
4. **Import** → pick `DJI_20261115124704_0020_D.MP4` in the native dialog. The card
   appears and is ready when it stops showing the preparation overlay.
5. Drag the card onto the V1 track, press **Space** (or the Play button). The preview
   plays; the transport timecode advances; `0 missing` stays in the header.
6. Quit the app (⌘Q) and open it again: the workspace is there, **no prompt and no
   click**, and the project opens.
7. In the editor: the mic record button in the timeline records with no permission
   prompt; the fullscreen button of the player fills the screen and comes back;
   copy/paste of a project JSON works.

The fullscreen permission is allowed by the policy and unit-tested, but it is not in
the e2e: a scripted `document.documentElement.requestFullscreen()` with no user click
once stalled the app's renderer for minutes, so the check is done by hand (step 7).

## Notes

- The window is 1440x900 (min 1024x640), `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, `webSecurity: true`. Navigation stays on the app's origin
  (the dev server's origin under `npm run dev`); `window.open`/`target=_blank` with
  `https:` goes to the system browser and everything else is denied.
- In `npm run dev` Electron prints its own "Insecure Content-Security-Policy" warning
  to the console. It is about the Vite dev server (no CSP, eval for HMR) and does not
  appear in the packaged app. The packaged app logs no console error while it starts;
  later the editor's own filmstrip extractor can log one
  (`[VideoFrameExtractor] … InputDisposedError`) while a preview video is disposed.
- No signing, no notarization, no auto-update. The app is arm64 only, as this Mac is.
- The `.app` is 473 MB: the editor's `dist/` (191 MB: 68 MB of onnxruntime
  WebAssembly, 14 MB of text-to-speech assets, 7 MB of source maps) and the Electron
  framework make up the rest. `app.asar` (our code) is 37 KB.
- The editor's `index.html` loads Google Fonts from `fonts.googleapis.com` /
  `fonts.gstatic.com`. The isolation headers do not block them (they answer with
  CORS), so the packaged app asks a third party for its fonts on every launch and no
  request fails; task 1.4 bundles the fonts and removes the request.
