#!/bin/sh
# Builds Gyroflow's engine (gyroflow-core) as a WebAssembly module for browsers and workers, into gyroflow/wasm/pkg:
# wasm-bindgen's ES module (`--target web`), its `.d.ts`, and the `.wasm` optimized by wasm-opt.
# Needs: the Rust target wasm32-unknown-unknown, wasm-bindgen-cli 0.2.130 and wasm-opt (Binaryen), on PATH or in
# $WASM_BINDGEN / $WASM_OPT. Prints the wasm's size before and after wasm-opt.
set -eu
cd "$(dirname "$0")"

WASM=target/wasm32-unknown-unknown/release/gyroflow_wasm.wasm
BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"
OPT="${WASM_OPT:-wasm-opt}"

size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

RUSTFLAGS='--cfg getrandom_backend="wasm_js"' cargo build --release --target wasm32-unknown-unknown
BEFORE=$(size "$WASM")

rm -rf pkg
"$BINDGEN" --target web --out-dir pkg "$WASM"

# -O3 must not change a single computed number: an optimized module has no fast-math, so the arithmetic is the same
# (test/chrome-worker.test.mjs holds it to the reference, which was recorded from an unoptimized build)
"$OPT" -O3 pkg/gyroflow_wasm_bg.wasm -o pkg/gyroflow_wasm_bg.opt.wasm
AFTER=$(size pkg/gyroflow_wasm_bg.opt.wasm)
mv pkg/gyroflow_wasm_bg.opt.wasm pkg/gyroflow_wasm_bg.wasm

# Record what the package was built from, with the same script the editor's build uses, so `vite build` does not
# build it once more
node scripts/source-stamp.mjs "$(cd ../.. && pwd)"

echo "wasm: $BEFORE bytes, $AFTER after wasm-opt -O3"
