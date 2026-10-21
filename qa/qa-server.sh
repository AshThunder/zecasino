#!/usr/bin/env bash
# QA-only game server: dev credits ON, its own database, no wallet credentials (the server refuses dev credit otherwise).
# The real dev server (3200) never mints chips; QA browsers are routed here by qa/lib.js.
cd "$(dirname "$0")/../run" || exit 1
for p in $(pgrep -f target/release/zecasino-game-server); do tr '\0' '\n' < /proc/$p/environ | grep -q '^ZECASINO_QA=1' && kill $p; done; sleep 1
(env -i PATH=/usr/bin:/bin RUST_LOG=info ZECASINO_QA=1 ZECASINO_DEV_CREDIT=1 ZECASINO_DB="$PWD/qa.sqlite" ZECASINO_ADDR=127.0.0.1:3202 setsid nohup ../target/release/zecasino-game-server > /tmp/qa-gs.log 2>&1 &)
sleep 1; curl -s localhost:3202/health; echo
