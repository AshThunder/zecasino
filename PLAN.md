# Zecasino — Build Plan (ZECATHON, Wildcard)

**Zecasino — the shielded casino. *Play in the shielded pool.*** Name chosen by Chris on Oct 20.

Deadline: **Oct 28 2026 23:59 UTC (00:59 WAT Oct 29)**. Repo local until submission; push public before deadline. All code written in-window.

Why it matters: every Zcash casino listed today (Cloudbet, BC.Game, Spinly, Bspin, Rakebit) hands out **transparent** t-addresses — none accept shielded deposits (cryptoslate.com/crypto-casinos/zcash-casinos). We are the first casino where the ledger never learns who plays.

## 1. Name & brand
**Zecasino** (chosen). To avoid any confusion with **ZKasino** (2024 rug-pull), branding is unmistakably Zcash:
- Wordmark "ZECASINO" with the Zcash gold (#F4B728) "Z" ⓩ mark set as a casino chip; tagline **"Play in the shielded pool."** Sub-line: "No accounts. No transparent addresses. Provably fair."
- Palette: Zcash gold #F4B728 + deep black #0B0B0C, emerald felt #0E3B2E, ivory #F3ECDD; chips denominated in ZEC/TAZ with the ⓩ glyph.
- Footer + about copy: "Built on Zcash Orchard/Ironwood shielded pools. Not affiliated with ZKasino."
(Earlier candidates The Blind Table / Masquerade dropped.)

## 2. Games — each with a privacy reason to exist
PvP (privacy = hidden information between players AND from the house):
1. **Carrot in a Box** (flagship). Two players; dealer box hides carrot. Holder peeks (commitment H(box||salt) published), bluffs, other player keeps/swaps. Reveal at end. Shielded stakes; neither player learns the other's address.
2. **Heads-up Texas Hold'em** with **mental-poker shuffle**: SRA/ElGamal-style commutative encryption over Ristretto (curve25519-dalek). Each player + house shuffles and encrypts the deck; cards decrypt only to their holder. The server can't see hands (prevents a colluding house — the classic online-poker cheat).
3. **Liar's Dice** (2–4 players): each player commits to dice H(dice||salt) at roll; bids public, dice revealed only on "liar" call; proof every die matched commitment.
House games (privacy = unlinkable player + provable fairness):
4. **Dice** (over/under), 5. **Crash**, 6. **European Roulette**, 7. **Blackjack** (6-deck shoe; shoe order committed up front).
All house games: server seed committed `H(server_seed)` before bet; result = HMAC-SHA256(server_seed, client_seed:nonce); seed revealed after session rotates; in-browser verifier page.

## 3. Money flow (no accounts)
- **Session = bearer secret** generated in-browser (32 bytes, stored locally; optional "backup code"). No email, no login.
- **Deposit**: server derives a fresh **diversified Orchard-only Unified Address** per session from the house UFVK (diversifier index = session counter, never reused) AND a ZIP-321 URI with a random 16-byte memo tag (`zc1:<tag>`) as a second binding. Display as QR.
- **House detection**: Rust service scans with the house viewing key (lightwalletd compact blocks via testnet.zec.rocks); match by receiving diversified address (+memo). Credit after N confirmations (NU7 testnet 25 s blocks → 3 conf ≈ 75 s; show "seen in mempool" earlier).
- **Play**: off-chain balance ledger keyed by session hash; chips in zats.
- **Withdraw** to **any shielded address only** (reject t-addrs, warn on Sapling, prefer Orchard UA). Batched with random delay window (0–N min, user-choosable "privacy delay") and amount rounding suggestion to defeat timing/amount linking.
- PvP pots: escrowed in house ledger; house takes rake.

## 4. House transparency / solvency without leaking players
- **Merkle-sum liability tree** (proof-of-liabilities): leaves = H(session_id_hash || balance || salt). Root + total published each epoch. Each player gets their inclusion proof in-browser. No player identifiers in the tree.
- **Reserves**: publish a reserve-only **viewing key for a separate cold reserve account** (not the deposit account, so deposits aren't linkable) OR periodic ZAP1-style memo-anchored attestations of reserves ≥ liabilities. Reserves dashboard: reserves ≥ Σ liabilities.
- **Fairness log**: append-only list of (commitment, reveal) for every round, anchored hourly as hash in a shielded memo to self (timestamped on-chain, content private).

## 5. Architecture
```
browser (Next.js 15 + PixiJS tables + GSAP UI + Howler sound)
   │  WebSocket (rooms, game state)  + REST (session, deposit, withdraw)
   ▼
game-server (Rust, axum + tokio-tungstenite): game engines, commit-reveal, ledger (SQLite/Postgres)
   │  internal gRPC/IPC
   ▼
zec-service (Rust, zcash_client_backend 0.25.0-pre.2 / zcash_client_sqlite 0.23.0-pre.2, NU7)
   ├─ sync via lightwalletd testnet.zec.rocks:443
   ├─ deposit address derivation (diversified Orchard UAs), memo decode
   └─ withdrawal tx builder + broadcaster (batched)
```
- Mental poker crypto in shared Rust crate compiled to **wasm** for the browser (players do their own encrypt/decrypt).
- Frontend art direction: dark emerald felt, brass/gold trim, serif display font (e.g. Cormorant) + clean sans; real chip stacks with physics-ish GSAP stacking; card flip/deal arcs in Pixi; roulette wheel 3D-ish spin; crash curve canvas. Custom SVG chip/card assets; no stock gradients/emoji. Sound design (felt slide, chip clack).
- Lobby: tables with live seat counts, "privacy meter", provably-fair verifier, cashier drawer.

## 6. Privacy threat model
| Party | Learns | Must not learn |
|---|---|---|
| Chain observer | Orchard txs exist (amount/addresses hidden) | Who deposits, amounts, bets, payouts |
| Other players | Public table actions, revealed cards at showdown | Address, balance, hole cards, other sessions |
| House server | Session balance, bets, deposit amount, withdraw destination | Player identity, hole cards (mental poker), link between sessions |
| Network observer | IP ↔ site | Bets (TLS); advise Tor |
Avoid / mitigations:
- **No transparent addresses anywhere** (deposit UA is Orchard-only receiver; reject t-addr withdrawals; never use t-addr change). Sapling allowed in only, not out by default.
- **Timing link** deposit↔withdraw: randomized batched withdrawals, privacy-delay option, recommend amount not equal to deposit.
- **Amount link**: suggest round-number withdrawals; split into notes.
- **Address reuse**: never reuse diversified index; each session one-time address.
- **Server logs**: no IP logging, no analytics, no third-party CDNs/fonts (self-host).
- **Memo**: tag is random; never put session id/secret into memo.
- **Withdraw address storage**: delete after broadcast.
- **Mental poker**: house cannot see hands; dropout handling via timeouts + forfeit.
- Real vs mocked must be stated in submission: legal disclaimer — testnet TAZ tech demo only.

## 7. Schedule (WAT)
- **Tue Oct 20 (night)**: plan; testnet spike (devtool wallet, address, faucet, send/receive memo).
- **Wed Oct 21**: monorepo scaffold; zec-service: house wallet, diversified deposit addresses, scanner + memo match, credit pipeline; withdrawal builder. Real testnet deposit end-to-end.
- **Thu Oct 22**: game-server core: sessions, ledger, websockets, provably-fair engine + verifier; Dice, Crash, Roulette engines + tests.
- **Fri Oct 23**: Blackjack, Carrot in a Box (commit-reveal), Liar's Dice; PvP matchmaking/rooms.
- **Sat Oct 24**: Mental-poker crate (Rust+wasm), Hold'em engine; solvency Merkle-sum tree + reserves page.
- **Sun Oct 25**: Frontend: design system, lobby, cashier, felt tables in Pixi, chips/cards/dice animations, sound. (Note: Lockwatch due Oct 26 16:00 WAT — keep morning free for it.)
- **Mon Oct 26**: Remaining table UIs (poker, roulette wheel, crash), privacy meter, fairness verifier UI.
- **Tue Oct 27**: Hardening: privacy audit vs threat model, withdrawal batching, e2e tests, deploy (Vercel frontend + Railway Rust services), real testnet runs.
- **Wed Oct 28**: README (privacy argument, real vs mocked), 2-min video, description ≤2000 chars, push repo public, submit by ~20:00 WAT (buffer before 00:59 WAT).

## 8. Risks
- TAZ supply: Valar faucet 0.125/day/IP; house bankroll needs more → budget small stakes (0.001 TAZ chips) and claim daily.
- NU7 pre-release crates may break; pin exact git revs (devtool pins librustzcash eb38d7a).
- Mental poker is the hardest piece; build after money flow works.

## 9. Spike findings (Oct 20) — see spike/SPIKE.md
- Works end to end on NU7 testnet: wallet, Orchard-only UA, faucet via API, shielded send with memo, memo detection from a view-only UFVK wallet. Inclusion ~30-60 s, 3 conf ~2.5 min.
- Use librustzcash rev eb38d7a (via zcash-devtool) + rustc >=1.89. Base zec-service on devtool's sync/enhance code.
- Funds land in NU7 **Ironwood** pool: support Ironwood in scanner + UI copy.
- Memo requires full-tx fetch (enhance); fetch only our txids, never query transparent address history.
- Bankroll: 0.125 TAZ/day/IP; chips denominated 0.0001 TAZ.
