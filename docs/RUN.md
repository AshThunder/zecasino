# Running Zecasino locally (testnet)

```sh
source ~/.cargo/env
cargo build --release -p zecasino-game-server -p zecasino-zec-service
mkdir -p run && cd run
export ZEC_MNEMONIC=$PWD/house.mnemonic ZEC_WALLET_DB=$PWD/zec-wallet.sqlite
../target/release/zecasino-zec-service new-seed      # once; file is 0600, never commit it
../target/release/zecasino-zec-service init tip </dev/null
export ZEC_INTERNAL_KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
../target/release/zecasino-zec-service serve </dev/null &                # 127.0.0.1:3300, lightwalletd testnet.zec.rocks:443
ZEC_SERVICE_URL=http://127.0.0.1:3300 ZECASINO_DB=$PWD/zecasino.sqlite \
  ../target/release/zecasino-game-server &                                 # ws://127.0.0.1:3200/ws
cd ../apps/web && NEXT_PUBLIC_GAME_WS=ws://127.0.0.1:3200/ws pnpm build && pnpm start -p 3100
```

`ZECASINO_DEV_CREDIT=1` (server) + `NEXT_PUBLIC_DEV_CREDIT=1` (web) give each new session 0.412 TAZ of play balance for UI testing, without a chain deposit. Never set in a deployment.

Without the game server the web app falls back to in-browser seats that use the same fairness code (`apps/web/src/lib/fair.ts`, checked against Rust vectors by `node --experimental-strip-types apps/web/scripts/verify-vectors.mts`).

Tests: `cargo test --workspace` (fairness, ledger, settlement, websocket end-to-end for Dice/Roulette/Blackjack/Crash/Carrot/Liar's Dice, address policy).
