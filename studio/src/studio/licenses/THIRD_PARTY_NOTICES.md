# Third-party notices

DroneClean Studio is free software: you can redistribute it and modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
version. The licence text is `LICENSE-GPL-3.0.txt` beside this file (and `LICENSE` at the root of the repository that
carries `studio/` and `gyroflow/`). It comes with no warranty. FreeCut's own MIT text stays in `studio/LICENSE`.

The combined work is distributed under GPL-3.0-or-later because it contains Gyroflow's engine (GPL-3.0-or-later).
Everything below is either under a licence that allows that (MIT, BSD, ISC, Apache-2.0, MPL-2.0, Zlib, Unlicense,
0BSD, LGPL when kept as a separate binary) or is data that is only downloaded when the user starts the feature that
needs it, and is never part of what we distribute. This file is kept by hand; `docs/publish-audit.md` records how it
was checked (19 Nov 2026) and what to re-check at each release.

## Our own and forked code

| Component | Where | Licence | Notice |
|---|---|---|---|
| DroneClean Studio's own code | `studio/` (everything not listed below) | GPL-3.0-or-later | this file |
| FreeCut (video editor this one is forked from), Copyright (c) 2025 FreeCut | `studio/` (the files it owns are listed in `studio/UPSTREAM_CHANGES.md`) | MIT | `studio/LICENSE`, kept as it is and shown in the app at `/licenses` |
| Gyroflow (stabilization engine), Copyright (c) its authors (Adrian Eddy, Elvin Chen and contributors) | `gyroflow/` (and its engine compiled to WebAssembly into `gyroflow/wasm/pkg/` for the app) | GPL-3.0-or-later (with Gyroflow's additional permissions for app stores and mdk-sdk, `gyroflow/LICENSE`) | `gyroflow/LICENSE` |

The desktop app uses Gyroflow's engine only as the WebAssembly module built from `gyroflow/wasm` (no mdk-sdk, no Qt).
Its corresponding source is this repository at the release's tag.

## What the desktop app carries besides the editor

| Component | Version | Licence | Notice shipped with the app |
|---|---|---|---|
| Electron | 45.3.4 | MIT | `Contents/Resources/LICENSE.electron.txt` |
| Chromium (inside Electron) and its dependencies | as Electron's | BSD-3-Clause and others, per component | `Contents/Resources/LICENSES.chromium.html` |
| FFmpeg (`ffmpeg`, `ffprobe`), built by `desktop/scripts/build-ffmpeg.sh` | 9.0.2, from https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz (SHA-256 `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`) | LGPL-2.1-or-later: no `--enable-gpl`, no `--enable-nonfree`, no external library; VideoToolbox, AudioToolbox and zlib only | `Contents/Resources/ffmpeg/COPYING.LGPLv2.1` and `NOTICE.txt` (the version, the source's address and checksum, the exact configure line: our source offer). The binaries are run as separate programs and can be replaced by the user. FFmpeg is a trademark of Fabrice Bellard. |
| onnxruntime-web (WebAssembly and WebGPU runtime), Copyright (c) Microsoft Corporation | 1.26.0-dev.20260410 (and 1.22.0-dev inside `kokoro-js`) | MIT | the licence header of the bundled files |
| Anime4K CNN x2 M weights (three 12.7 KB ONNX graphs), converted by `src/infrastructure/upscale/models/convert-weights.py` | n/a | MIT: bloc97/Anime4K (Copyright (c) 2019 bloc97) and sb2702/websr (Copyright (c) 2023 Sam Bhattacharyya) | `src/infrastructure/upscale/models/NOTICE.md` |
| MOSS TTS browser runtime (`public/moss-tts/`), vendored onnxruntime and tokenizer sandbox | n/a | MIT (onnxruntime); BSD-3-Clause and MIT for the bundled `ieee754` and `buffer` (the notices inside `tokenizer_sandbox.js`) | headers in the files |

## Models downloaded when the user starts a feature (not distributed by us)

The app makes no network request the user did not ask for. These weights are fetched by the user's own browser or
app from the host named, the first time the user uses the feature, and cached on their machine. Their licences apply
to the user as the downloader.

| Feature | Model | Host | Licence |
|---|---|---|---|
| Speech to text | Whisper tiny, base, small, large-v3-turbo (`onnx-community/whisper-*_timestamped`) | huggingface.co | Apache-2.0 (the `openai/whisper-*` cards; OpenAI's code repository is MIT); the ONNX conversions' cards state no licence |
| Speech to text | NVIDIA Parakeet TDT 0.6b v3 (`Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx`) | huggingface.co | CC-BY-4.0: attribution to NVIDIA |
| Text to speech | Kokoro 82M (`onnx-community/Kokoro-82M-v1.0-ONNX`) | huggingface.co | Apache-2.0 |
| Text to speech | MOSS-TTS-Nano and MOSS-Audio-Tokenizer-Nano (`OpenMOSS-Team/*`) | huggingface.co | Apache-2.0 (both cards) |
| Text to speech | Supertonic 3 (`Supertone/supertonic-3`) | huggingface.co | BigScience OpenRAIL-M: use restrictions that pass to the user |
| Music generation | MusicGen small (`Xenova/musicgen-small`) | huggingface.co | **CC-BY-NC-4.0: non-commercial use only** |
| Semantic search | CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32`) | huggingface.co | MIT |
| Semantic search | all-MiniLM-L6-v2 (`Xenova/all-MiniLM-L6-v2`) | huggingface.co | Apache-2.0 |
| Filler-word detection | CLAP (`Xenova/clap-htsat-unfused`) | huggingface.co | Apache-2.0 (`laion/clap-htsat-unfused`); the conversion's card states no licence |
| Local assistant | Gemma 4 E4B instruct (`onnx-community/gemma-4-E4B-it-ONNX`) | huggingface.co | Apache-2.0 (as the model card says) |
| Frame interpolation | RIFE fp32 (`walterlow/RIFE_fp32_timestep`, a copy of `FuryTMP/RIFE_fp32`) | huggingface.co | MIT |

Licences were read from the models' Hugging Face cards on 19 Nov 2026 and are to be read again before each release.

## Fonts

The editor's text tool and interface bundle the Fontsource packages below (the files are the fonts' own, repackaged as
WOFF2). Each family's copyright line is in `src/studio/licenses/font-licenses.ts` and is shown by the app at
`/licenses`. The SIL Open Font License 1.1 is at https://openfontlicense.org/open-font-license-official-text/ and
travels with every Fontsource package (`LICENSE`); the Apache License 2.0 is at https://www.apache.org/licenses/LICENSE-2.0;
the Ubuntu Font Licence 1.0 is at https://ubuntu.com/legal/font-licence. The fonts are separate works shipped beside the
program, not linked into it; none is sold on its own.

**OFL-1.1** (118): Abel, Alfa Slab One, Almarai, Anek Telugu, Anton, Archivo, Archivo Black, Arimo, Arvo, Assistant, Barlow, Barlow Condensed, Barlow Semi Condensed, Bebas Neue, Bitter, Bricolage Grotesque, Bungee, Cabin, Cairo, Caveat, Changa One, Comfortaa, Cormorant Garamond, Crimson Text, DM Sans, DM Serif Display, Dancing Script, Domine, Dosis, EB Garamond, Exo 2, Figtree, Fira Sans, Fjalla One, Google Sans, Gravitas One, Heebo, Hind, Hind Siliguri, IBM Plex Mono, IBM Plex Sans, Inconsolata, Inter, Inter Tight, Josefin Sans, Jost, Kanit, Karla, Lato, Lexend, Lexend Deca, Libre Baskerville, Libre Franklin, Lobster, Lobster Two, Lora, M PLUS 1p, M PLUS Rounded 1c, Manrope, Merriweather, Merriweather Sans, Montserrat, Mukta, Mulish, Nanum Gothic, Noto Color Emoji, Noto Sans, Noto Sans Arabic, Noto Sans JP, Noto Sans KR, Noto Sans SC, Noto Sans TC, Noto Sans Telugu, Noto Serif, Noto Serif JP, Nunito, Nunito Sans, Open Sans, Orbitron, Oswald, Outfit, Overpass, Oxygen, PT Sans, PT Sans Narrow, PT Serif, Pacifico, Playfair Display, Plus Jakarta Sans, Poppins, Prompt, Public Sans, Quicksand, Rajdhani, Raleway, Ramabhadra, Red Hat Display, Roboto, Roboto Condensed, Roboto Flex, Roboto Mono, Rubik, Saira, Schibsted Grotesk, Shadows Into Light, Share Tech, Slabo 27px, Smooch Sans, Sora, Source Code Pro, Source Sans 3, Source Serif 4, Space Grotesk, Tajawal, Teko, Titillium Web, Urbanist, Work Sans.

**Apache-2.0** (2): Roboto Slab, Satisfy.

**UFL-1.0** (1): Ubuntu.

## Production npm packages of the editor (`package-lock.json`, 19 Nov 2026)

The licence field of each package in the lockfile, packages that are not fonts. Entries marked optional are
Node-only (`sharp` and its libvips, `onnxruntime-node`: pulled in by the transformers libraries for Node) and are not
part of the browser build or the desktop app; the check was a search of the packaged app for them. Regenerate with the
lockfile's `packages` entries that are not `dev`.

| Package | Version | Licence |
|---|---|---|
| `@babel/runtime` | 7.29.2 | MIT |
| `@emnapi/runtime` | 1.11.1 | MIT (optional, Node-only) |
| `@floating-ui/core` | 1.7.5 | MIT |
| `@floating-ui/dom` | 1.7.6 | MIT |
| `@floating-ui/react-dom` | 2.1.8 | MIT |
| `@floating-ui/utils` | 0.2.11 | MIT |
| `@hookform/resolvers` | 5.2.2 | MIT |
| `@huggingface/jinja` | 0.5.6 | MIT |
| `@huggingface/tokenizers` | 0.1.3 | Apache-2.0 |
| `@huggingface/transformers` | 4.1.0 | Apache-2.0 |
| `@huggingface/transformers` | 3.8.1 | Apache-2.0 |
| `@img/colour` | 1.1.0 | MIT |
| `@img/sharp-darwin-arm64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-darwin-x64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-libvips-darwin-arm64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-darwin-x64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linux-arm` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linux-arm64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linux-ppc64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linux-riscv64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linux-s390x` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linux-x64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-libvips-linuxmusl-x64` | 1.2.4 | LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-linux-arm` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linux-arm64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linux-ppc64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linux-riscv64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linux-s390x` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linux-x64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linuxmusl-arm64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-linuxmusl-x64` | 0.34.5 | Apache-2.0 (optional, Node-only) |
| `@img/sharp-wasm32` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT (optional, Node-only) |
| `@img/sharp-win32-arm64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-win32-ia32` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later (optional, Node-only) |
| `@img/sharp-win32-x64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later (optional, Node-only) |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `@lottiefiles/dotlottie-web` | 0.76.0 | MIT |
| `@mediabunny/aac-encoder` | 1.66.1 | MPL-2.0 |
| `@mediabunny/ac3` | 1.66.1 | MPL-2.0 |
| `@mediabunny/mp3-encoder` | 1.66.1 | MPL-2.0 |
| `@mediabunny/prores` | 1.66.1 | MPL-2.0 |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.1 | BSD-3-Clause |
| `@radix-ui/number` | 1.1.1 | MIT |
| `@radix-ui/primitive` | 1.1.3 | MIT |
| `@radix-ui/react-accordion` | 1.2.12 | MIT |
| `@radix-ui/react-alert-dialog` | 1.1.15 | MIT |
| `@radix-ui/react-arrow` | 1.1.7 | MIT |
| `@radix-ui/react-collapsible` | 1.1.12 | MIT |
| `@radix-ui/react-collection` | 1.1.7 | MIT |
| `@radix-ui/react-compose-refs` | 1.1.2 | MIT |
| `@radix-ui/react-context` | 1.1.2 | MIT |
| `@radix-ui/react-context` | 1.1.3 | MIT |
| `@radix-ui/react-context-menu` | 2.2.16 | MIT |
| `@radix-ui/react-dialog` | 1.1.15 | MIT |
| `@radix-ui/react-direction` | 1.1.1 | MIT |
| `@radix-ui/react-dismissable-layer` | 1.1.11 | MIT |
| `@radix-ui/react-dropdown-menu` | 2.1.16 | MIT |
| `@radix-ui/react-focus-guards` | 1.1.3 | MIT |
| `@radix-ui/react-focus-scope` | 1.1.7 | MIT |
| `@radix-ui/react-id` | 1.1.1 | MIT |
| `@radix-ui/react-label` | 2.1.8 | MIT |
| `@radix-ui/react-menu` | 2.1.16 | MIT |
| `@radix-ui/react-popover` | 1.1.15 | MIT |
| `@radix-ui/react-popper` | 1.2.8 | MIT |
| `@radix-ui/react-portal` | 1.1.9 | MIT |
| `@radix-ui/react-presence` | 1.1.5 | MIT |
| `@radix-ui/react-primitive` | 2.1.4 | MIT |
| `@radix-ui/react-primitive` | 2.1.3 | MIT |
| `@radix-ui/react-primitive` | 2.1.4 | MIT |
| `@radix-ui/react-primitive` | 2.1.4 | MIT |
| `@radix-ui/react-progress` | 1.1.8 | MIT |
| `@radix-ui/react-roving-focus` | 1.1.11 | MIT |
| `@radix-ui/react-scroll-area` | 1.2.10 | MIT |
| `@radix-ui/react-select` | 2.2.6 | MIT |
| `@radix-ui/react-separator` | 1.1.8 | MIT |
| `@radix-ui/react-slider` | 1.3.6 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-slot` | 1.2.4 | MIT |
| `@radix-ui/react-slot` | 1.2.3 | MIT |
| `@radix-ui/react-switch` | 1.2.6 | MIT |
| `@radix-ui/react-tabs` | 1.1.13 | MIT |
| `@radix-ui/react-tooltip` | 1.2.8 | MIT |
| `@radix-ui/react-use-callback-ref` | 1.1.1 | MIT |
| `@radix-ui/react-use-controllable-state` | 1.2.2 | MIT |
| `@radix-ui/react-use-effect-event` | 0.0.2 | MIT |
| `@radix-ui/react-use-escape-keydown` | 1.1.1 | MIT |
| `@radix-ui/react-use-layout-effect` | 1.1.1 | MIT |
| `@radix-ui/react-use-previous` | 1.1.1 | MIT |
| `@radix-ui/react-use-rect` | 1.1.1 | MIT |
| `@radix-ui/react-use-size` | 1.1.1 | MIT |
| `@radix-ui/react-visually-hidden` | 1.2.3 | MIT |
| `@radix-ui/rect` | 1.1.1 | MIT |
| `@rollup/rollup-linux-x64-gnu` | 4.62.1 | MIT (optional, Node-only) |
| `@standard-schema/utils` | 0.3.0 | MIT |
| `@tanstack/history` | 1.161.6 | MIT |
| `@tanstack/react-router` | 1.168.22 | MIT |
| `@tanstack/react-store` | 0.9.3 | MIT |
| `@tanstack/react-virtual` | 3.13.24 | MIT |
| `@tanstack/router-core` | 1.168.15 | MIT |
| `@tanstack/store` | 0.9.3 | MIT |
| `@tanstack/virtual-core` | 3.14.0 | MIT |
| `@types/dom-mediacapture-transform` | 0.1.11 | MIT |
| `@types/dom-webcodecs` | 0.1.13 | MIT |
| `@types/node` | 22.19.17 | MIT |
| `@types/react` | 19.2.14 | MIT |
| `@types/react-dom` | 19.2.3 | MIT |
| `@typescript/typescript-aix-ppc64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-darwin-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-freebsd-arm64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-freebsd-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-arm` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-arm64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-loong64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-mips64el` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-ppc64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-riscv64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-s390x` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-netbsd-arm64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-netbsd-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-openbsd-arm64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-openbsd-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-sunos-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-win32-arm64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `@typescript/typescript-win32-x64` | 7.0.2 | Apache-2.0 (optional, Node-only) |
| `adm-zip` | 0.5.17 | MIT |
| `aria-hidden` | 1.2.6 | MIT |
| `boolean` | 3.2.0 | MIT |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `clsx` | 2.1.1 | MIT |
| `cookie-es` | 3.1.1 | MIT |
| `csstype` | 3.2.3 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `detect-node` | 2.1.0 | MIT |
| `detect-node-es` | 1.1.0 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `fflate` | 0.8.2 | MIT |
| `flatbuffers` | 25.9.23 | Apache-2.0 |
| `framer-motion` | 12.40.0 | MIT |
| `get-nonce` | 1.0.1 | MIT |
| `gifuct-js` | 2.1.2 | MIT |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `globalthis` | 1.0.4 | MIT |
| `gopd` | 1.2.0 | MIT |
| `guid-typescript` | 1.0.9 | ISC |
| `has-property-descriptors` | 1.0.2 | MIT |
| `html-parse-stringify` | 3.0.1 | MIT |
| `i18next` | 25.6.0 | MIT |
| `i18next-browser-languagedetector` | 8.2.0 | MIT |
| `idb` | 8.0.3 | ISC |
| `isbot` | 5.1.38 | Unlicense |
| `js-binary-schema-parser` | 2.0.3 | MIT |
| `json-stringify-safe` | 5.0.1 | ISC |
| `kokoro-js` | 1.2.1 | Apache-2.0 |
| `long` | 5.3.2 | Apache-2.0 |
| `lucide-react` | 0.468.0 | ISC |
| `matcher` | 3.0.0 | MIT |
| `mediabunny` | 1.66.1 | MPL-2.0 |
| `minipass` | 7.1.3 | BlueOak-1.0.0 |
| `minizlib` | 3.1.0 | MIT |
| `motion` | 12.40.0 | MIT |
| `motion-dom` | 12.40.0 | MIT |
| `motion-utils` | 12.39.0 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `onnxruntime-common` | 1.21.0 | MIT |
| `onnxruntime-common` | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| `onnxruntime-common` | 1.24.3 | MIT |
| `onnxruntime-common` | 1.24.0-dev.20251116-b39e144322 | MIT |
| `onnxruntime-node` | 1.21.0 | MIT |
| `onnxruntime-node` | 1.24.3 | MIT |
| `onnxruntime-web` | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| `onnxruntime-web` | 1.26.0-dev.20260410-5e55544225 | MIT |
| `phonemizer` | 1.2.1 | Apache-2.0 |
| `platform` | 1.3.6 | MIT |
| `protobufjs` | 7.6.4 | BSD-3-Clause |
| `react` | 19.2.5 | MIT |
| `react-colorful` | 5.6.1 | MIT |
| `react-dom` | 19.2.5 | MIT |
| `react-hook-form` | 7.72.1 | MIT |
| `react-hotkeys-hook` | 5.2.4 | MIT |
| `react-i18next` | 16.2.4 | MIT |
| `react-remove-scroll` | 2.7.2 | MIT |
| `react-remove-scroll-bar` | 2.3.8 | MIT |
| `react-resizable-panels` | 3.0.6 | MIT |
| `react-style-singleton` | 2.2.3 | MIT |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `scheduler` | 0.27.0 | MIT |
| `semver` | 7.7.4 | ISC |
| `semver` | 7.7.4 | ISC |
| `semver-compare` | 1.0.0 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `seroval` | 1.5.2 | MIT |
| `seroval-plugins` | 1.5.2 | MIT |
| `sharp` | 0.34.5 | Apache-2.0 |
| `sonner` | 2.0.7 | MIT |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |
| `tailwind-merge` | 2.6.1 | MIT |
| `tailwindcss` | 4.2.2 | MIT |
| `tailwindcss-animate` | 1.0.7 | MIT |
| `tar` | 7.5.17 | BlueOak-1.0.0 |
| `tslib` | 2.8.1 | 0BSD |
| `turbores` | 1.2.5 | MPL-2.0 |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |
| `typescript` | 7.0.2 | Apache-2.0 |
| `undici-types` | 6.21.0 | MIT |
| `use-callback-ref` | 1.3.3 | MIT |
| `use-sidecar` | 1.1.3 | MIT |
| `use-sync-external-store` | 1.6.0 | MIT |
| `void-elements` | 3.1.0 | MIT |
| `yallist` | 5.0.0 | BlueOak-1.0.0 |
| `zod` | 4.3.6 | MIT |
| `zustand` | 5.0.12 | MIT |

## Production npm packages of the desktop shell (`desktop/package-lock.json`)

| Package | Version | Licence |
|---|---|---|
| `@hono/node-server` | 2.1.9 | MIT |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT |
| `accepts` | 2.0.0 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `body-parser` | 2.4.0 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `content-disposition` | 2.0.1 | MIT |
| `content-type` | 2.1.0 | MIT |
| `content-type` | 1.0.5 | MIT |
| `content-type` | 2.1.0 | MIT |
| `content-type` | 2.1.0 | MIT |
| `content-type` | 2.1.0 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.2.2 | MIT |
| `cors` | 2.8.6 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `depd` | 2.0.0 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `encodeurl` | 2.0.3 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `etag` | 1.8.1 | MIT |
| `eventsource` | 3.0.7 | MIT |
| `eventsource-parser` | 3.1.1 | MIT |
| `express` | 5.3.0 | MIT |
| `express-rate-limit` | 8.7.4 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 3.1.9 | BSD-3-Clause |
| `finalhandler` | 2.1.1 | MIT |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 2.0.0 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `gopd` | 1.2.0 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `hasown` | 2.0.4 | MIT |
| `hono` | 4.13.19 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `iconv-lite` | 0.7.3 | MIT |
| `inherits` | 2.0.4 | ISC |
| `ip-address` | 10.7.6 | MIT |
| `ipaddr.js` | 1.9.1 | MIT |
| `is-promise` | 4.0.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `jose` | 6.2.17 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 1.1.1 | MIT |
| `merge-descriptors` | 2.0.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `negotiator` | 1.1.0 | MIT |
| `object-assign` | 4.1.1 | MIT |
| `object-inspect` | 1.13.4 | MIT |
| `on-finished` | 2.4.2 | MIT |
| `once` | 1.4.0 | ISC |
| `parseurl` | 1.3.3 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-to-regexp` | 8.4.2 | MIT |
| `pkce-challenge` | 5.0.1 | MIT |
| `proxy-addr` | 2.0.8 | MIT |
| `qs` | 6.17.1 | BSD-3-Clause |
| `range-parser` | 1.3.0 | MIT |
| `raw-body` | 3.0.2 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `router` | 2.3.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `send` | 1.2.1 | MIT |
| `serve-static` | 2.2.1 | MIT |
| `setprototypeof` | 1.2.0 | ISC |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `statuses` | 2.0.2 | MIT |
| `toidentifier` | 1.0.1 | MIT |
| `type-is` | 2.1.0 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `vary` | 1.1.2 | MIT |
| `which` | 2.0.2 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `zod` | 4.6.7 | MIT |
| `zod-to-json-schema` | 3.25.2 | ISC |

## Rust crates of Gyroflow's engine as built for WebAssembly (`gyroflow/wasm/Cargo.lock`)

305 crates (target `wasm32-unknown-unknown`), read with `cargo metadata` on 19 Nov 2026: MIT and Apache-2.0 (and their
dual-licence forms) for most; BSD-3-Clause (nalgebra, exr, moxcms, argh); Zlib (slotmap, foldhash, zlib-rs); ISC
(rustls-webpki, untrusted, ring with Apache-2.0); Unicode-3.0 (the `icu_*` crates); MPL-2.0 (`median`,
`mp4parse-patched`: file-level copyleft, their source is on crates.io and unchanged by us); CDLA-Permissive-2.0
(webpki-roots); Unlicense, 0BSD, BSL-1.0. Gyroflow's own crates (`gyroflow-core`, `rs-sync`, `stabilize_spirv`) are
GPL-3.0-or-later; `telemetry-parser` is MIT OR Apache-2.0. No crate is GPL-incompatible, proprietary or
non-commercial.

## JavaScript packages under MPL-2.0

`mediabunny`, `@mediabunny/aac-encoder`, `@mediabunny/ac3`, `@mediabunny/mp3-encoder`, `@mediabunny/prores` and
`turbores` are MPL-2.0 (file-level copyleft; compatible with GPL-3.0 under MPL section 3.3). Their source is on npm and
GitHub, and we do not modify their files.

## Colour transforms and DJI

The D-Log curve and D-Gamut matrix are DJI's published 2017 formulas (Cinema Color System white paper). The D-Log M
curve (three exponents) and matrix (nine numbers) in `src/studio/color/` are our own least-squares fit to measurements
of the output of DJI's "D-Log M to Rec.709" LUT. No DJI LUT, table sampled from one, or other DJI file is part of this
repository or the app. DJI, Avata, D-Log and D-Log M are trademarks of SZ DJI Technology Co., Ltd. and are named only to
say which cameras the transforms are for; DroneClean Studio is not affiliated with or endorsed by DJI.
