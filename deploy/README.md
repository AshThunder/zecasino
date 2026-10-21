# Deploying on Fly.io
Four apps in one region (jnb): `zecasino` (web), `zecasino-gs` (game server, public wss), `zecasino-zs` (wallet, private 6PN only), `zecasino-demo` (play chips).
Run from the repo root; each build uses the repo as context.

```sh
for a in zecasino zecasino-gs zecasino-zs zecasino-demo; do fly apps create $a --org <ORG>; done
fly volumes create zs_data   -a zecasino-zs   -r jnb -s 1 -y
fly volumes create gs_data   -a zecasino-gs   -r jnb -s 1 -y
fly volumes create demo_data -a zecasino-demo -r jnb -s 1 -y
K=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
fly secrets set -a zecasino-zs ZEC_INTERNAL_KEY=$K ZEC_SEED_WORDS="$(cat run/house.mnemonic)" --stage
fly secrets set -a zecasino-gs ZEC_INTERNAL_KEY=$K --stage
```

## Copy existing state (no re-sync, same wallets)
Stop local services first (`zs`, `gs`), checkpoint WAL: `sqlite3 run/zc-real.sqlite 'PRAGMA wal_checkpoint(TRUNCATE)'` (same for zec-wallet, reserve-view).
Deploy each app once with `fly deploy -c deploy/fly.<x>.toml --dockerfile deploy/<x>.Dockerfile`, then for zs/gs:
```sh
fly scale count 0 -a zecasino-zs   # or: fly machine stop
fly ssh sftp shell -a zecasino-zs  # put run/zec-wallet.sqlite /data/ ; reserve-view.sqlite ; reserve.ufvk
fly ssh sftp shell -a zecasino-gs  # put run/zc-real.sqlite /data/
```
(sftp needs a running machine; simplest: deploy, `fly machine stop` not possible with sftp, so put files while running then `fly apps restart`.)
Never upload `reserve.mnemonic`; it stays offline. After cutover do not run the local zec-service on the same seed, to avoid double spends.
