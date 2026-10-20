# Testnet spike — Oct 20 2026 (times WAT)
Tool: zcash-devtool @ 0b3436b (Oct 17), librustzcash rev eb38d7a: zcash_client_backend 0.25.0-pre.2, zcash_client_sqlite 0.23.0-pre.2, zcash_protocol 0.11.0-pre.1, orchard 0.16. rustc 1.99.1 (box default 1.85 too old: crates need >=1.89). Release build 2m35s.
Server: testnet.zec.rocks:443 (devtool "zecrocks" default). Chain tip ~4,523,400.
GOTCHA: devtool hangs forever unless stdin is </dev/null.

1. wallet init (house, player) <1s each; sync from birthday ~1s.
2. Orchard-only UA: `wallet generate-address -p orchard` (time-based diversifier).
3. Faucet: POST https://faucet.testnet.valargroup.dev/api/claim {"address":...} — no captcha. 22:44:08 queued -> 22:44:13 sent, tx b737336f…d691, mined 4523404 @22:44:42. Wallet saw balance 22:45:06, spendable 22:47:25 (3 conf). 0.125 TAZ, 1 per IP/24h.
4. Send player->house 0.05 TAZ, memo "zc1:7f3a9c2e41b8d06f": 22:47:36, built+broadcast in 3s, fee 0.0001, tx 17a466c0…2ac5, mined 4523418 @22:48:36.
5. House detected the note on sync; memo needs `wallet enhance` (compact blocks carry no memo) -> Memo::Text decoded.
6. View-only wallet from house UFVK (init-fvk) synced+enhanced in 2s and decoded the same memo. => house can run with viewing key only for deposits.
NOTES: funds land in the NU7 **Ironwood** pool (shown as Ironwood, not Orchard) even when sent to an Orchard receiver. `enhance` also asks lightwalletd for history of the wallet's transparent addresses (TransactionsInvolvingAddress) — our service must avoid that (server-side metadata leak).
