<p align="center">
  <a href="https://droneclean.app"><img src="https://droneclean.app/media/studio-demo.webp" alt="Claude Code, on the right, editing six drone clips in DroneClean Studio through its MCP server, shown 47 times faster" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <strong>English</strong> &nbsp;·&nbsp;
  <a href="README.it.md">Italiano</a> &nbsp;·&nbsp;
  <a href="README.es.md">Español</a> &nbsp;·&nbsp;
  <a href="README.fr.md">Français</a> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português (Brasil)</a> &nbsp;·&nbsp;
  <a href="README.tr.md">Türkçe</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>A free, local-first video editor for FPV and drone pilots.</strong><br>
  Gyro stabilization, D-Log M colour, smooth speed ramps with optical-flow slow motion, and an MCP server for AI agents.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="Licence: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS (Apple silicon), Windows and the web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Download for Mac</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Download for Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/studio/"><strong>Open in your browser</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app">droneclean.app</a>
</p>

The video above is Claude Code editing six DJI Avata 2 clips through the editor's MCP server, with no hand on the
mouse. It reads the song's beats, picks a few seconds of each clip and cuts them on the beat, stabilizes them from
the gyro data, converts the D-Log M colour, gives each shot a speed ramp with optical-flow slow motion and motion
blur, and looks at the frames to leave out people and cars. The 19 minutes it took are shown 47 times faster. Every
change it makes is an ordinary step in the editor, which you can undo or keep editing by hand.

## Before and after

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="The same drone reel side by side: on the left as filmed, flat and shaky; on the right stabilized, graded and speed-ramped in DroneClean Studio" width="488">
</p>

The first 24 seconds of a reel cut in DroneClean Studio from clips of the same flight. On the left the cuts as filmed: flat
D-Log M colour, the drone's shake, real speed. On the right the finished edit: stabilized from the gyro data, D-Log M
converted and graded, with speed ramps, optical-flow slow motion and motion blur.

## Features

- **Stabilization from the gyro.** DJI and GoPro files carry the camera's motion; Studio steadies them with
  [Gyroflow](https://github.com/gyroflow/gyroflow)'s engine compiled to WebAssembly, with no analysis pass. A 4:3
  clip in a 9:16 project fills the vertical frame by itself, and a keyframable framing keeps the subject in view.
- **Colour for drone footage.** DJI D-Log M and D-Log to Rec.709, creative looks from `.cube` files, colour wheels,
  curves, secondary qualifiers, power windows and a sky gradient for washed-out skies.
- **Speed.** Speed curves with eased segments and a one-click "smooth ramp + zoom". Motion blur follows each pixel's
  motion along the optical flow, and slow motion makes new frames from it instead of repeating them. Beat markers
  from the song.
- **Keyframes** on every property and effect parameter, with bezier and spring easing.
- **Export.** Presets for YouTube 4K and Instagram Reels, and 10-bit masters (ProRes 422 HQ, HEVC Main 10) in the
  desktop app.
- **AI agents.** A local MCP server: Claude, or another MCP client, can build, grade and export a project through the
  same SDK the editor uses, and every change is an undo step.
- **Drone shadow removal**, the one paid effect, through the DroneClean cloud service.
- **Local-first.** Projects and media stay in a folder you choose; footage leaves your computer only when you send a
  piece of it to clean the shadow.

<p align="center">
  <img src=".github/assets/studio.webp" alt="The DroneClean Studio editor with a beach clip on the timeline and a drone's shadow marked on the picture" width="820">
</p>

## Install

**Mac (Apple silicon):** download the disk image from the [latest release](../../releases/latest) and drag
DroneClean Studio to Applications. This build is not signed by Apple yet, so macOS stops it the first time: open it
once, then go to System Settings › Privacy & Security and press **Open Anyway**.

**Windows 10 and 11 (x64):** download `DroneClean-Studio-x64.exe` from the [latest release](../../releases/latest)
and run it; it installs for your user, with no administrator prompt. It is not signed yet, so SmartScreen stops it
the first time: choose **More info › Run anyway**. It carries its own FFmpeg with NVIDIA, Intel and AMD encoders.

**Browser:** [droneclean.app/studio](https://droneclean.app/studio/) runs the same editor in Chrome or Edge on a
computer (it needs the File System Access API).

## Use it with an AI agent

Agent access is on by default in the desktop app (only your user can reach it; **Settings › Agent access › Allow AI
agents** switches it off), and that panel shows the exact command. For Claude Code on a Mac:

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

On Windows the command names
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` (the panel shows it with your user's path).

The server has four tools: `search` (the SDK reference, the user guide and the feature map), `run` (a script against
the editor's SDK), `frame` (a rendered frame or contact sheet) and `export`. Then ask for an edit in your own words,
as in the video above: "make a smooth drone edit from the six clips in the open project, cut to the beat of the
song".

## Build from source

macOS on Apple silicon, Node 24, Rust with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.130 and
`wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # the editor, Gyroflow's wasm and FFmpeg, then the app in dist/mac-arm64
```

In `studio/`, `npm run check:quick` runs the fast checks and `npm run verify` the full suite (it needs Google Chrome
and FFmpeg).

## Repository layout

| Path | What it is |
| --- | --- |
| `studio/` | The editor, a fork of [FreeCut](https://github.com/walterlow/freecut) (MIT). DroneClean's own code is in `studio/src/studio/`. |
| `studio/desktop/` | The Electron app, its FFmpeg build and the release script. |
| `studio/mcp/` | The MCP launcher an agent starts. |
| `studio/web/` | The static server of the web editor. |
| `gyroflow/` | A fork of [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0); `gyroflow/wasm/` builds its engine for the editor. |

This repository is published by the release process: each release is one commit, tagged `v0.1.10` for this one.

## Contributing and security

Bug reports and ideas are welcome: [open an issue](../../issues/new/choose). [CONTRIBUTING.md](CONTRIBUTING.md) says
how changes reach a release. Report a vulnerability privately as [SECURITY.md](SECURITY.md) describes, never in a
public issue.

## Licence and credits

GPL-3.0-or-later (see [LICENSE](LICENSE)). DroneClean Studio includes FreeCut (MIT) and Gyroflow (GPL-3.0); the
desktop app includes FFmpeg (LGPL-2.1), built from its official source by `studio/desktop/scripts/build-ffmpeg.sh`.
The screenshot shows Pexels video 39579103 under the [Pexels License](https://www.pexels.com/license/). The demo and
the before and after show the author's own DJI Avata 2 footage; they are served from droneclean.app and are not part
of this repository or its licence.
