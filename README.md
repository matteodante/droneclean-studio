# DroneClean Studio

A free, local-first video editor for FPV and drone pilots: stabilization from the drone's own gyro data (Gyroflow's
engine, compiled to WebAssembly), DJI D-Log M to Rec.709, speed ramps with motion blur, 10-bit masters (ProRes HQ,
HEVC Main 10) with the Mac's hardware encoders, and an MCP server so an AI agent can edit with you. Removing the
drone's own shadow is its one paid effect, done through the DroneClean cloud service.

This is the source of release 0.1.1. Downloads are on the [releases page](../../releases).

## Layout

- `studio/`: the editor, a fork of [FreeCut](https://github.com/walterlow/freecut) (MIT), and its desktop shell
  (`studio/desktop/`, Electron).
- `gyroflow/`: a fork of [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0); `gyroflow/wasm/` builds its
  engine for the editor.

## Build (macOS, Apple silicon)

Node 24, Rust with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.130 and `wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # builds the editor, Gyroflow's wasm and FFmpeg, then the app in dist/mac-arm64
```

## Licence

GPL-3.0-or-later (see `LICENSE`). It includes FreeCut (MIT), Gyroflow (GPL-3.0) and, in the app, FFmpeg
(LGPL-2.1, built from its official source by `studio/desktop/scripts/build-ffmpeg.sh`).
