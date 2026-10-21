#!/bin/bash
# Usage: bash record.sh scene [scene…]  — records each scene on a private Xvfb display.
cd "$(dirname "$0")"; OUT=${OUT:-/workspace/zcasino-video/raw}; mkdir -p "$OUT"
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & XP=$!; sleep 1
for s in "$@"; do DISPLAY=:99 node rec.js "$s" "$OUT"; done
kill $XP
