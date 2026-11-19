#!/usr/bin/env bash
# The checks of gyroflow/ (task 6.1): builds the WebAssembly package, smoke-tests it in Node (no footage), then runs it
# in a Chrome worker against the reference recorded from the node spike.
#
#   gyroflow/scripts/verify.sh
#   GYRO_CLIP=/path/to/clip.MP4 gyroflow/scripts/verify.sh
#
# Without GYRO_CLIP the Chrome test says it was skipped: the clip is footage, never part of the repository.
# Needs: cargo with the wasm32-unknown-unknown target, wasm-bindgen 0.2.130, wasm-opt, Node; for the Chrome test also
# playwright-core (cd gyroflow/wasm/test && npm install) and Google Chrome.
#
# Task 6.3's two additions are checked here: the smoke test holds the warp shader's assets (the kernel template, the
# lens model's functions, the coefficient table), and the Chrome test holds the progress `open` reports while it reads
# the clip and the assets of the clip's own lens profile.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> build"
wasm/build.sh

echo "==> smoke test (Node, no footage): the API, the smoothing methods, the warp shader's assets"
node wasm/test/smoke.mjs

echo "==> Chrome worker test: the reference, the progress of open, the clip's shader assets"
if [ -n "${GYRO_CLIP:-}" ] && [ ! -d wasm/test/node_modules ]; then
    echo "gyroflow/wasm/test/node_modules is missing: cd gyroflow/wasm/test && npm install" >&2
    exit 1
fi
node wasm/test/chrome-worker.test.mjs
