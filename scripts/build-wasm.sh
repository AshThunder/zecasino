#!/usr/bin/env bash
# Builds the mental-poker crate for the browser into apps/web/src/wasm/mp (generated, committed for reproducible web builds).
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.cargo/env
cargo build --release -p zecasino-mental-poker --features wasm --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir apps/web/src/wasm/mp target/wasm32-unknown-unknown/release/zecasino_mental_poker.wasm
