//! Zecasino game server. One websocket per browser tab; all messages are JSON `{ "t": ... }`.
//! Privacy: no IPs are logged or stored, sessions are bearer tokens stored hashed, and other
//! players only ever see a short per-room `anon` tag.
pub mod cashier;
pub mod crash;
pub mod holdem;
mod holdem_room;
pub mod solvency;
pub mod house;
pub mod ledger;
pub mod pvp;
pub mod house_bot;

use std::{collections::HashMap, sync::Arc};
use axum::{extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}}, response::IntoResponse, routing::get, Json, Router};
use futures::{SinkExt, StreamExt};
use rand::RngCore;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use zecasino_fairness::{games, SeedPair};

use house::Hand;
use ledger::{Ledger, LedgerError};
use pvp::{Carrot, Liars, Player};

type Tx = mpsc::UnboundedSender<String>;
pub const MAX_STAKE: u64 = 50_000_000; // 0.5 TAZ
/// Play chips every demo session starts with (and refills to).
pub const DEMO_CHIPS: u64 = 500_000_000;

/// A seat in a wait queue. `code` is set for a private invite table: only a join with that code matches it.
pub struct Waiting { pub player: Player, pub stake: u64, pub code: Option<String> }
/// The pairing of a finished table, kept briefly so both sides can ask for a rematch.
pub struct Rematch { pub game: &'static str, pub players: Vec<Player>, pub stake: u64, pub at: std::time::Instant, pub want: Vec<String> }
/// How long a dropped player's seat is held before their turn may be auto-played.
pub const GRACE_MS: u64 = 30_000;
fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
fn invite_code() -> String { const A: &[u8] = b"23456789ABCDEFGHJKMNPQRSTVWXYZ"; let mut b = [0u8; 6]; rand::rngs::OsRng.fill_bytes(&mut b); b.iter().map(|x| A[*x as usize % A.len()] as char).collect() }

pub struct App {
    pub ledger: Mutex<Ledger>,
    pub seats: Mutex<HashMap<String, SeedPair>>,
    pub hands: Mutex<HashMap<String, Hand>>,
    pub crash: Mutex<crash::Crash>,
    conns: Mutex<HashMap<String, Vec<Tx>>>,
    carrot_wait: Mutex<Vec<Waiting>>,
    carrots: Mutex<HashMap<String, Carrot>>,
    liars_wait: Mutex<Vec<Waiting>>,
    liars: Mutex<HashMap<String, Liars>>,
    holdem_wait: Mutex<Vec<Waiting>>,
    pub(crate) holdems: Mutex<HashMap<String, holdem_room::Room>>,
    pub solvency: Mutex<Option<solvency::Snapshot>>,
    /// Latest fairness anchor: SHA-256 over the chain tip's block hash and every live seed commitment.
    pub anchor: Mutex<Option<Value>>,
    /// Hold'em stall limits in ms: betting action, and protocol steps (keys, shuffles, shares).
    pub hm_act_ms: std::sync::atomic::AtomicU64,
    /// Carrot / Liar's Dice: a stalled player is auto-played after this long without progress.
    pub pvp_idle_ms: std::sync::atomic::AtomicU64,
    /// Per-session messages of the round in progress, replayed to a refreshed tab.
    pub(crate) replay: Mutex<HashMap<String, Vec<Value>>>,
    pvp_seen: Mutex<HashMap<String, std::time::Instant>>,
    /// Sessions whose last tab dropped while seated, and when.
    away: Mutex<HashMap<String, std::time::Instant>>,
    rematch: Mutex<HashMap<String, Rematch>>,
    /// Carrot rooms where the house is the guesser: its committed keep/swap decision.
    house_carrot: Mutex<HashMap<String, (bool, zecasino_fairness::commit::Opening, String)>>,
    pub grace_ms: std::sync::atomic::AtomicU64,
    pub hm_proto_ms: std::sync::atomic::AtomicU64,
    pub dev_credit: bool,
    /// Demo instance: its own database, no cashier, every session starts with play chips. Never the real ledger.
    pub demo: bool,
    pub zec: Option<cashier::Zec>,
}

pub(crate) fn rid() -> String { let mut b = [0u8; 8]; rand::rngs::OsRng.fill_bytes(&mut b); hex::encode(b) }
fn anon() -> String { let mut b = [0u8; 2]; rand::rngs::OsRng.fill_bytes(&mut b); hex::encode(b) }
fn err(id: &Value, msg: &str) -> Value { json!({ "t": "error", "id": id, "error": msg }) }
fn lerr(e: LedgerError) -> &'static str { match e { LedgerError::Insufficient => "insufficient balance", LedgerError::UnknownSession => "unknown session" } }

impl App {
    pub fn new(db: &str, dev_credit: bool) -> Arc<Self> {
        let mut ledger = Ledger::open(db).expect("ledger");
        // Restart safety: void any crash round that never reached its bust, then keep counting rounds.
        for (sess, round, stake) in ledger.crash_refund_open() { tracing::info!(session = %&sess[..8], round, stake, "refunded crash bet from interrupted round"); }
        let first_round = ledger.next_crash_round();
        Arc::new(Self {
            ledger: Mutex::new(ledger), seats: Default::default(), hands: Default::default(),
            crash: Mutex::new(crash::Crash::new(first_round)), conns: Default::default(), carrot_wait: Default::default(), carrots: Default::default(),
            liars_wait: Default::default(), liars: Default::default(), holdem_wait: Default::default(), holdems: Default::default(), solvency: Default::default(), anchor: Default::default(), hm_act_ms: 30_000.into(), pvp_idle_ms: 60_000.into(), replay: Default::default(), pvp_seen: Default::default(), away: Default::default(), rematch: Default::default(), house_carrot: Default::default(), grace_ms: GRACE_MS.into(), hm_proto_ms: 20_000.into(), dev_credit, demo: false, zec: cashier::Zec::from_env(),
        })
    }
    pub async fn notify(&self, token: &str, v: Value) {
        if let Some(list) = self.conns.lock().await.get(token) { for tx in list { let _ = tx.send(v.to_string()); } }
    }
    pub(crate) async fn log_to(&self, token: &str, v: Value) { self.replay.lock().await.entry(token.to_owned()).or_default().push(v.clone()); self.notify(token, v).await; }
    pub(crate) async fn log_reset(&self, token: &str) { self.replay.lock().await.remove(token); }
    async fn touch(&self, room: &str) { self.pvp_seen.lock().await.insert(room.to_owned(), std::time::Instant::now()); }
    pub async fn notify_session(&self, session: &str, v: Value) {
        for (tok, list) in self.conns.lock().await.iter() { if cashier::session_matches(tok, session) { for tx in list { let _ = tx.send(v.to_string()); } } }
    }
    async fn seat_view(&self, token: &str) -> Value {
        let s = self.seats.lock().await; let p = &s[token];
        json!({ "commitment": p.commitment, "client_seed": p.client_seed, "nonce": p.nonce })
    }
    /// Seat (seed pair + nonce) and open blackjack hand, written after every bet so a restart resumes them.
    pub async fn persist_seat(&self, token: &str) {
        let seat = self.seats.lock().await.get(token).and_then(|p| serde_json::to_string(p).ok());
        let hand = self.hands.lock().await.get(token).filter(|h| !h.done).and_then(|h| serde_json::to_string(h).ok());
        if let Some(seat) = seat { self.ledger.lock().await.save_seat(token, &seat, hand.as_deref()); }
    }
    pub(crate) async fn attach(&self, token: &str, tx: Tx) { self.conns.lock().await.entry(token.to_owned()).or_default().push(tx); }
    pub(crate) async fn detach(&self, token: &str) { self.conns.lock().await.remove(token); self.replay.lock().await.remove(token); }
    /// The house's side of a PvP pot is house bankroll, not a session: no ledger row, so the human's
    /// "bet" / "payout" rows alone move house P&L by exactly the house's result, and liabilities are untouched.
    async fn debit(&self, token: &str, stake: u64, r: &str) -> Result<u64, &'static str> {
        if stake == 0 || stake > MAX_STAKE { return Err("stake out of range"); }
        if house_bot::is_house(token) { return Ok(0); }
        self.ledger.lock().await.apply(token, -(stake as i64), "bet", r).map_err(lerr)
    }
    async fn credit(&self, token: &str, amt: u64, r: &str) -> u64 {
        if house_bot::is_house(token) { return 0; }
        let mut l = self.ledger.lock().await;
        if amt > 0 { l.apply(token, amt as i64, "payout", r).unwrap() } else { l.balance(token).unwrap() }
    }
}

impl App {
    fn queue(&self, game: &str) -> &Mutex<Vec<Waiting>> { match game { "carrot" => &self.carrot_wait, "liars" => &self.liars_wait, _ => &self.holdem_wait } }
    fn turn_ms(&self) -> u64 { self.pvp_idle_ms.load(std::sync::atomic::Ordering::Relaxed) }

    /// Seats two players at a fresh table: escrows both stakes (the house's side is bankroll) and deals.
    pub(crate) async fn start_match(self: &Arc<Self>, game: &str, players: Vec<Player>, stake: u64) -> Result<(), &'static str> {
        let kind = if game == "holdem" { "holdem-buyin" } else { game };
        for p in &players { self.queue(game).lock().await.retain(|w| w.player.token != p.token); }
        self.debit(&players[1].token, stake, kind).await?;
        if self.debit(&players[0].token, stake, kind).await.is_err() { self.credit(&players[1].token, stake, &format!("{game}-refund")).await; return Err("opponent left"); }
        let mut it = players.into_iter(); let (a, b) = (it.next().unwrap(), it.next().unwrap());
        match game {
            "carrot" => self.start_carrot(a, b, stake).await,
            "liars" => self.start_liars(a, b, stake).await,
            _ => {
                for p in [&a, &b] { if house_bot::is_house(&p.token) {
                    let (tx, rx) = mpsc::unbounded_channel(); self.attach(&p.token, tx).await;
                    tokio::spawn(house_bot::holdem_bot(self.clone(), p.token.clone(), rx));
                } }
                self.hm_new_room(a, b, stake).await;
            }
        }
        Ok(())
    }

    async fn start_carrot(self: &Arc<Self>, a: Player, b: Player, stake: u64) {
        let room = rid(); let g = Carrot::new(a, b, stake);
        let house_guesses = house_bot::is_house(&g.guesser.token);
        // The house's keep/swap is decided and sealed now, before the holder peeks or says anything.
        let hc = house_guesses.then(|| { let swap = rand::rngs::OsRng.next_u32() & 1 == 1; let (c, o) = zecasino_fairness::commit::commit(if swap { b"carrot:house-swap" } else { b"carrot:house-keep" }); (swap, o, c.0) });
        for (p, role) in [(&g.holder, "holder"), (&g.guesser, "guesser")] {
            let opp = if role == "holder" { &g.guesser } else { &g.holder };
            let mut m = json!({ "t": "carrot_start", "room": room, "role": role, "you": p.anon, "opponent": opp.anon, "opponent_house": house_bot::is_house(&opp.token), "stake": stake, "commitment": g.c.0, "turn_ms": self.turn_ms(), "at": now_ms() });
            if role == "holder" { m["peek"] = json!(if g.in_holder { "carrot" } else { "empty" }); }
            if let Some((_, _, c)) = &hc { m["house_commitment"] = json!(c); }
            m["balance"] = json!(self.ledger.lock().await.balance(&p.token).ok());
            self.log_reset(&p.token).await; self.log_to(&p.token, m).await;
        }
        let (hold, guess) = (g.holder.token.clone(), g.guesser.token.clone());
        self.touch(&room).await;
        self.carrots.lock().await.insert(room.clone(), g);
        if let Some((swap, o, c)) = hc {
            self.house_carrot.lock().await.insert(room.clone(), (swap, o, c));
            let app = self.clone();
            tokio::spawn(async move { tokio::time::sleep(std::time::Duration::from_millis(6_000)).await; app.house_act(guess, json!({ "t": "carrot_choose", "room": room, "swap": swap })).await; });
        } else if house_bot::is_house(&hold) {
            let app = self.clone(); let line = rand::rngs::OsRng.next_u32() % 4;
            tokio::spawn(async move { tokio::time::sleep(std::time::Duration::from_millis(2_500)).await; app.house_act(hold, json!({ "t": "carrot_say", "room": room, "line": line })).await; });
        }
    }

    async fn start_liars(self: &Arc<Self>, a: Player, b: Player, stake: u64) {
        let room = rid(); let g = Liars::new(vec![a, b], stake);
        let commits: Vec<Value> = g.players.iter().zip(&g.commits).map(|(p, (c, _))| json!({ "anon": p.anon, "commitment": c.0, "house": house_bot::is_house(&p.token) })).collect();
        for (i, p) in g.players.iter().enumerate() {
            let bal = self.ledger.lock().await.balance(&p.token).ok();
            let opp = &g.players[1 - i];
            self.log_reset(&p.token).await;
            self.log_to(&p.token, json!({ "t": "liars_start", "room": room, "seat": i, "you": p.anon, "opponent": opp.anon, "opponent_house": house_bot::is_house(&opp.token), "dice": g.dice[i], "salt": g.commits[i].1.salt, "commitments": commits, "turn": g.turn, "stake": stake, "balance": bal, "turn_ms": self.turn_ms(), "at": now_ms() })).await;
        }
        self.touch(&room).await;
        self.liars.lock().await.insert(room.clone(), g);
        self.liars_house_turn(&room).await;
    }

    /// If the house is to move, it moves after a short pause, from its own dice and the public bid only.
    async fn liars_house_turn(self: &Arc<Self>, room: &str) {
        let Some((tok, own, bid, total)) = self.liars.lock().await.get(room).filter(|g| house_bot::is_house(&g.players[g.turn].token)).map(|g| (g.players[g.turn].token.clone(), g.dice[g.turn], g.bid.map(|b| (b.0, b.1)), (g.players.len() * 5) as u8)) else { return };
        let (app, room) = (self.clone(), room.to_owned());
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1_600)).await;
            let msg = match house_bot::liars_move(&own, bid, total) { Some((q, f)) => json!({ "t": "liars_bid", "room": room, "q": q, "f": f }), None => json!({ "t": "liars_call", "room": room }) };
            app.house_act(tok, msg).await;
        });
    }

    /// A house move goes through the same handler (and the same checks) as a player's message.
    fn house_act(self: Arc<Self>, tok: String, msg: Value) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(async move {
            let (dummy, _rx) = mpsc::unbounded_channel::<String>();
            let t = msg["t"].as_str().unwrap_or("").to_owned();
            if let Err(e) = handle(&self, &tok, &t, &msg, &Value::Null, &dummy, &mut None).await { tracing::debug!(e, "house move rejected"); }
        })
    }

    /// Tells everyone sharing a table with `tok` that it dropped or came back.
    async fn presence(&self, tok: &str, online: bool) {
        let mut opp: Vec<(String, String)> = vec![];
        for (r, g) in self.carrots.lock().await.iter() { if g.holder.token == tok { opp.push((r.clone(), g.guesser.token.clone())); } if g.guesser.token == tok { opp.push((r.clone(), g.holder.token.clone())); } }
        for (r, g) in self.liars.lock().await.iter() { if g.players.iter().any(|p| p.token == tok) { for p in &g.players { if p.token != tok { opp.push((r.clone(), p.token.clone())); } } } }
        for (r, g) in self.holdems.lock().await.iter() { if g.players.iter().any(|p| p.token == tok) { for p in &g.players { if p.token != tok { opp.push((r.clone(), p.token.clone())); } } } }
        let grace = self.grace_ms.load(std::sync::atomic::Ordering::Relaxed);
        for (room, o) in opp { self.notify(&o, json!({ "t": "pvp_presence", "room": room, "online": online, "grace_ms": grace })).await; }
    }

    pub(crate) async fn keep_rematch(&self, room: &str, game: &'static str, players: Vec<Player>, stake: u64) {
        let mut m = self.rematch.lock().await;
        m.retain(|_, r| r.at.elapsed() < std::time::Duration::from_secs(120));
        m.insert(room.to_owned(), Rematch { game, players, stake, at: std::time::Instant::now(), want: vec![] });
    }
}

pub fn router(app: Arc<App>) -> Router {
    tokio::spawn(pvp_sweeper(app.clone()));
    tokio::spawn(anchor_loop(app.clone()));
    Router::new()
        .route("/ws", get(ws))
        .route("/health", get(|| async { "ok" }))
        .route("/solvency", get(solvency))
        .route("/lobby", get(lobby))
        .route("/anchor", get(|State(app): State<Arc<App>>| async move { Json(app.anchor.lock().await.clone().unwrap_or(Value::Null)) }))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(app)
}

impl App {
    /// Current liability snapshot, rebuilt at most once per REBUILD_SECS.
    pub async fn snapshot(&self) -> tokio::sync::MappedMutexGuard<'_, solvency::Snapshot> {
        let now = cashier::now();
        let mut g = self.solvency.lock().await;
        if g.as_ref().map_or(true, |s| now >= s.built_at + solvency::REBUILD_SECS) {
            let bals = self.ledger.lock().await.balances();
            let epoch = g.as_ref().map_or(1, |s| s.epoch + 1);
            *g = Some(solvency::Snapshot::build(epoch, now, &bals));
        }
        tokio::sync::MutexGuard::map(g, |s| s.as_mut().unwrap())
    }
}

/// Every 60 s: digest = SHA-256("zecasino:anchor:v1" ‖ tip block hash ‖ sorted live seed commitments ‖ crash commitment).
/// Including the block hash proves the commitment set existed no earlier than that block; the full list is
/// published at /anchor so anyone can recompute the digest and find their own commitment in it.
async fn anchor_loop(app: Arc<App>) {
    use sha2::{Digest, Sha256};
    loop {
        if let Some(z) = &app.zec { if let Ok(c) = z.chain().await {
            let mut coms: Vec<String> = app.seats.lock().await.values().map(|p| p.commitment.clone()).collect();
            coms.push(app.crash.lock().await.commitment.clone());
            coms.sort(); coms.dedup();
            let mut h = Sha256::new(); h.update(b"zecasino:anchor:v1"); h.update(hex::decode(c["hash"].as_str().unwrap_or("")).unwrap_or_default());
            for x in &coms { h.update(hex::decode(x).unwrap_or_default()); }
            *app.anchor.lock().await = Some(json!({ "height": c["tip"], "block_hash": c["hash"], "digest": hex::encode(h.finalize()), "commitments": coms, "built_at": cashier::now(),
                "transparent_received": c["transparent_received"], "transparent_sent": c["transparent_sent"] }));
        } }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}

/// Lobby facts, all measured: reserve coverage, fairness anchor, transparent-output count, live table activity.
async fn lobby(State(app): State<Arc<App>>) -> Json<Value> {
    let liab = app.ledger.lock().await.liabilities();
    let get = |f: Option<anyhow::Result<Value>>| f.and_then(|r| r.ok()).and_then(|r| r["total_zat"].as_u64());
    let t = std::time::Duration::from_secs(4);
    let (reserve, hot) = match &app.zec { Some(z) => (get(tokio::time::timeout(t, z.reserve()).await.ok()), get(tokio::time::timeout(t, z.status()).await.ok())), None => (None, None) };
    // Coverage = cold reserve (checkable with its public viewing key) / liabilities, same as /solvency. Hot wallet reported separately.
    let a = app.anchor.lock().await.clone();
    let c = app.crash.lock().await; let crash_round = c.round; let crash_bettors = c.bets.len(); drop(c);
    // Public queue only: private invite tables are not counted.
    let public = |q: &Vec<Waiting>| q.iter().filter(|w| w.code.is_none()).count();
    let (cw, lw, hw) = (public(&*app.carrot_wait.lock().await), public(&*app.liars_wait.lock().await), public(&*app.holdem_wait.lock().await));
    let tables = json!({
        "carrot": { "rooms": app.carrots.lock().await.len(), "waiting": cw },
        "liars": { "rooms": app.liars.lock().await.len(), "waiting": lw },
        "holdem": { "rooms": app.holdems.lock().await.len(), "waiting": hw },
        "crash": { "round": crash_round, "bettors": crash_bettors },
    });
    Json(json!({ "demo": app.demo, "liabilities_zat": liab, "reserve_zat": reserve, "hot_zat": hot,
        "coverage": reserve.map(|r| if liab == 0 { Value::Null } else { json!(r as f64 / liab as f64) }),
        "anchor": a.as_ref().map(|a| json!({ "height": a["height"], "digest": a["digest"], "block_hash": a["block_hash"], "count": a["commitments"].as_array().map(|x| x.len()) })),
        "transparent": a.as_ref().map(|a| a["transparent_received"].as_u64().unwrap_or(0) + a["transparent_sent"].as_u64().unwrap_or(0)),
        "online": app.conns.lock().await.len(), "tables": tables }))
}

async fn solvency(State(app): State<Arc<App>>) -> Json<Value> {
    let (live, pnl) = { let l = app.ledger.lock().await; (l.liabilities(), l.house_pnl()) };
    let snap = { let s = app.snapshot().await; json!({ "epoch": s.epoch, "built_at": s.built_at, "root": s.root(), "leaves": s.leaves(), "depth": s.depth(), "next_at": s.built_at + solvency::REBUILD_SECS }) };
    // Reserves = the cold reserve account, watched with its published viewing key (anyone can
    // import that key and check the figure). The hot wallet is shown separately, server-reported.
    let (reserves, hot) = match &app.zec { Some(z) => (z.reserve().await.ok(), z.status().await.ok()), None => (None, None) };
    Json(json!({ "liabilities_zat": live, "house_pnl_zat": pnl, "snapshot": snap, "reserves": reserves, "hot": hot }))
}

async fn ws(up: WebSocketUpgrade, State(app): State<Arc<App>>) -> impl IntoResponse { up.on_upgrade(move |s| conn(s, app)) }

async fn conn(socket: WebSocket, app: Arc<App>) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move { while let Some(m) = rx.recv().await { if sink.send(Message::Text(m.into())).await.is_err() { break; } } });
    let mut token: Option<String> = None;
    let mut crash_sub: Option<tokio::task::JoinHandle<()>> = None;
    while let Some(Ok(msg)) = stream.next().await {
        let Message::Text(text) = msg else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { let _ = tx.send(err(&Value::Null, "bad json").to_string()); continue };
        let id = v.get("id").cloned().unwrap_or(Value::Null);
        let t = v["t"].as_str().unwrap_or("");
        if t == "hello" {
            let cs = v["client_seed"].as_str().unwrap_or("zecasino");
            let tok = match v["token"].as_str() { Some(k) if app.ledger.lock().await.exists(k) => k.to_owned(), _ => {
                let t = app.ledger.lock().await.create();
                if app.demo { let _ = app.ledger.lock().await.apply(&t, DEMO_CHIPS as i64, "deposit", "demo"); }
                t } };
            let mut seats = app.seats.lock().await;
            if !seats.contains_key(&tok) {
                // After a restart the seat (and any open blackjack hand) comes back from the ledger DB.
                if let Some((seat, hand)) = app.ledger.lock().await.load_seat(&tok) {
                    if let Ok(p) = serde_json::from_str::<SeedPair>(&seat) { seats.insert(tok.clone(), p); }
                    if let Some(h) = hand.and_then(|h| serde_json::from_str::<Hand>(&h).ok()) { app.hands.lock().await.insert(tok.clone(), h); }
                }
            }
            if !seats.contains_key(&tok) { match SeedPair::generate(cs) { Ok(p) => { seats.insert(tok.clone(), p); } Err(_) => { seats.insert(tok.clone(), SeedPair::generate("zecasino").unwrap()); } } }
            drop(seats);
            app.conns.lock().await.entry(tok.clone()).or_default().push(tx.clone());
            if app.away.lock().await.remove(&tok).is_some() { app.presence(&tok, true).await; }
            let bal = app.ledger.lock().await.balance(&tok).unwrap();
            let _ = tx.send(json!({ "t": "session", "id": id, "token": tok, "balance": bal, "demo": app.demo, "dev_credit": app.dev_credit, "seat": app.seat_view(&tok).await }).to_string());
            token = Some(tok);
            continue;
        }
        let Some(tok) = token.clone() else { let _ = tx.send(err(&id, "say hello first").to_string()); continue };
        let reply = match handle(&app, &tok, t, &v, &id, &tx, &mut crash_sub).await { Ok(r) => r, Err(e) => Some(err(&id, e)) };
        if matches!(t, "seed" | "rotate" | "dice" | "roulette" | "bj_deal" | "bj_hit" | "bj_stand" | "bj_double" | "bj_split") { app.persist_seat(&tok).await; }
        if let Some(r) = reply { let _ = tx.send(r.to_string()); }
    }
    if let Some(h) = crash_sub { h.abort(); }
    if let Some(tok) = token {
        let gone = { let mut c = app.conns.lock().await; match c.get_mut(&tok) { Some(l) => { l.retain(|x| !x.same_channel(&tx)); l.is_empty() } None => true } };
        if gone { app.away.lock().await.insert(tok.clone(), std::time::Instant::now()); app.presence(&tok, false).await; }
        app.carrot_wait.lock().await.retain(|w| w.player.token != tok); app.liars_wait.lock().await.retain(|w| w.player.token != tok); app.holdem_wait.lock().await.retain(|w| w.player.token != tok); }
    writer.abort();
}

/// Carrot / Liar's Dice stall handling: after `pvp_idle_ms` without progress the player who owes
/// a move is played for. Carrot: the guesser keeps their box. Liar's Dice: with a bid on the table
/// the stalled player calls it; on the opening turn they bid one of their first die's face.
pub async fn pvp_sweeper(app: Arc<App>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let limit = app.pvp_idle_ms.load(std::sync::atomic::Ordering::Relaxed) as u128;
        let stale: Vec<String> = app.pvp_seen.lock().await.iter().filter(|(_, t)| t.elapsed().as_millis() >= limit).map(|(r, _)| r.clone()).collect();
        for room in stale {
            let mv = if let Some(g) = app.carrots.lock().await.get(&room) { Some((g.guesser.token.clone(), json!({ "t": "carrot_choose", "room": room, "swap": false }))) }
                else if let Some(g) = app.liars.lock().await.get(&room) {
                    let tok = g.players[g.turn].token.clone();
                    Some((tok, if g.bid.is_some() { json!({ "t": "liars_call", "room": room }) } else { json!({ "t": "liars_bid", "room": room, "q": 1, "f": g.dice[g.turn][0] }) }))
                } else { None };
            let Some((tok, msg)) = mv else { app.pvp_seen.lock().await.remove(&room); continue };
            // A dropped player keeps their seat for the grace period even if the turn clock ran out.
            let grace = app.grace_ms.load(std::sync::atomic::Ordering::Relaxed) as u128;
            if app.away.lock().await.get(&tok).is_some_and(|t| t.elapsed().as_millis() < grace) { continue; }
            app.touch(&room).await;
            let (dummy, _rx) = mpsc::unbounded_channel::<String>();
            let t = msg["t"].as_str().unwrap().to_owned();
            let _ = handle(&app, &tok, &t, &msg, &Value::Null, &dummy, &mut None).await;
        }
    }
}

async fn handle(app: &Arc<App>, tok: &str, t: &str, v: &Value, id: &Value, tx: &Tx, crash_sub: &mut Option<tokio::task::JoinHandle<()>>) -> Result<Option<Value>, &'static str> {
    let stake = v["stake"].as_u64().unwrap_or(0);
    Ok(Some(match t {
        // Demo only: top the play chips back up to the starting stack.
        "demo_refill" => {
            if !app.demo { return Err("not a demo table"); }
            let mut l = app.ledger.lock().await; let b = l.balance(tok).map_err(lerr)?;
            let b = if b < DEMO_CHIPS { l.apply(tok, (DEMO_CHIPS - b) as i64, "deposit", "demo").map_err(lerr)? } else { b };
            json!({ "t": "balance", "id": id, "balance": b })
        }
        "dev_credit" => {
            if !app.dev_credit { return Err("dev credit disabled"); }
            let amt = v["amount"].as_u64().unwrap_or(0).min(100_000_000);
            let b = app.ledger.lock().await.apply(tok, amt as i64, "deposit", "dev").map_err(lerr)?;
            json!({ "t": "balance", "id": id, "balance": b })
        }
        "pvp_resume" => {
            // Hold'em rebuilds its own replay (seat first); other rooms just replay their log.
            if !app.hm_resume(tok, tx).await {
                let log = app.replay.lock().await.get(tok).cloned().unwrap_or_default();
                for mut m in log { m["replay"] = json!(true); let _ = tx.send(m.to_string()); }
            }
            json!({ "t": "pvp_resumed", "id": id })
        }
        "seat_get" => json!({ "t": "seat", "id": id, "seat": app.seat_view(tok).await }),
        // What a chain observer gets for this session: the public, encrypted parts of its deposit/withdrawal txs.
        "chain_view" => {
            let txs = app.ledger.lock().await.chain_txs(tok);
            let mut views = vec![];
            for (kind, txid) in txs.iter().take(10) {
                let v = match &app.zec { Some(z) => tokio::time::timeout(std::time::Duration::from_secs(5), z.txview(txid)).await.ok().and_then(|r| r.ok()), None => None };
                views.push(json!({ "kind": kind, "txid": txid, "view": v }));
            }
            json!({ "t": "chain_view", "id": id, "txs": views })
        }
        "cashier_deposit" => {
            let zec = app.zec.as_ref().ok_or("cashier offline")?;
            let idx = app.ledger.lock().await.deposit_index(tok);
            let cached = app.ledger.lock().await.cached_deposit_address(idx);
            let addr = match cached { Some(a) => a, None => {
                let a = zec.address(idx).await.map_err(|_| "cashier offline")?;
                app.ledger.lock().await.set_deposit_address(idx, &a); a } };
            json!({ "t": "deposit_address", "id": id, "address": addr, "confirmations": cashier::CONFIRMATIONS })
        }
        "cashier_withdraw" => {
            let zec = app.zec.as_ref().ok_or("cashier offline")?;
            let addr = v["address"].as_str().unwrap_or("").trim();
            if !cashier::shielded_address(addr) { return Err("withdrawals go to a shielded address only (u1… / zs1…)"); }
            if stake < cashier::MIN_WITHDRAW { return Err("minimum withdrawal is 0.001 TAZ"); }
            let _ = zec;
            let delay = match v["delay"].as_str().unwrap_or("random") { "now" => 0, "6h" => cashier::delay_between(0, 6 * 3600), _ => cashier::delay_between(300, 3600) };
            let (_wid, bal) = app.ledger.lock().await.queue_withdrawal(tok, addr, stake, cashier::now() + delay).map_err(lerr)?;
            json!({ "t": "withdraw_queued", "id": id, "balance": bal, "eta_s": delay })
        }
        "solvency_proof" => {
            let tid = ledger::token_id(tok);
            let s = app.snapshot().await;
            match s.proof(&tid) {
                Some((salt, bal, path)) => json!({ "t": "solvency_proof", "id": id, "epoch": s.epoch, "root": s.root(), "salt": hex::encode(salt), "balance": bal, "path": path }),
                None => json!({ "t": "solvency_proof", "id": id, "epoch": s.epoch, "root": s.root(), "balance": 0, "path": null }),
            }
        }
        "balance" => json!({ "t": "balance", "id": id, "balance": app.ledger.lock().await.balance(tok).map_err(lerr)? }),
        "seed" => {
            app.seats.lock().await.get_mut(tok).unwrap().set_client_seed(v["client_seed"].as_str().unwrap_or("")).map_err(|_| "bad client seed")?;
            json!({ "t": "seat", "id": id, "seat": app.seat_view(tok).await })
        }
        "rotate" => {
            let r = app.seats.lock().await.get_mut(tok).unwrap().rotate(v["client_seed"].as_str().unwrap_or("zecasino")).map_err(|_| "bad client seed")?;
            app.hands.lock().await.remove(tok);
            json!({ "t": "revealed", "id": id, "revealed": r, "seat": app.seat_view(tok).await })
        }
        "dice" => {
            let target = v["target"].as_u64().unwrap_or(0) as u32; let over = v["over"].as_bool().unwrap_or(true);
            if house::dice_payout(0, target, over, 1).is_none() { return Err("target out of range"); }
            let (nonce, mut s) = app.seats.lock().await.get_mut(tok).unwrap().next_bet();
            let r = format!("dice#{nonce}");
            app.debit(tok, stake, &r).await?;
            let roll = games::dice(&mut s);
            let pay = house::dice_payout(roll, target, over, stake).unwrap();
            let bal = app.credit(tok, pay, &r).await;
            json!({ "t": "result", "id": id, "game": "dice", "nonce": nonce, "outcome": roll, "payout": pay, "balance": bal, "seat": app.seat_view(tok).await })
        }
        "roulette" => {
            let bets: Vec<(String, u64)> = v["bets"].as_array().ok_or("bets required")?.iter()
                .map(|b| (b["key"].as_str().unwrap_or("").to_owned(), b["amount"].as_u64().unwrap_or(0))).collect();
            if bets.is_empty() || bets.iter().any(|(k, a)| *a == 0 || house::roulette_mult(k, 1).is_none()) { return Err("invalid bets"); }
            let total: u64 = bets.iter().map(|b| b.1).sum();
            let (nonce, mut s) = app.seats.lock().await.get_mut(tok).unwrap().next_bet();
            let r = format!("roulette#{nonce}");
            app.debit(tok, total, &r).await?;
            let n = games::roulette(&mut s);
            let pay: u64 = bets.iter().map(|(k, a)| a * house::roulette_mult(k, n).unwrap()).sum();
            let bal = app.credit(tok, pay, &r).await;
            json!({ "t": "result", "id": id, "game": "roulette", "nonce": nonce, "outcome": n, "payout": pay, "balance": bal, "seat": app.seat_view(tok).await })
        }
        "bj_deal" => {
            if app.hands.lock().await.get(tok).is_some_and(|h| !h.done) { return Err("hand in progress"); }
            let (nonce, s) = app.seats.lock().await.get_mut(tok).unwrap().next_bet();
            app.debit(tok, stake, &format!("bj#{nonce}")).await?;
            let mut h = Hand::deal(s, nonce, stake);
            let (pay, msg) = if h.natural() { let (p, m) = h.settle(); (p, Some(m.to_owned())) } else { (0, None) };
            let bal = app.credit(tok, pay, &format!("bj#{nonce}")).await;
            let view = h.view(pay, msg);
            app.hands.lock().await.insert(tok.to_owned(), h);
            json!({ "t": "bj", "id": id, "hand": view, "balance": bal, "seat": app.seat_view(tok).await })
        }
        // Lets a refreshed or reconnected tab pick up an open hand instead of leaving the stake stuck.
        "bj_get" => {
            let hands = app.hands.lock().await;
            json!({ "t": "bj", "id": id, "hand": hands.get(tok).filter(|h| !h.done).map(|h| h.view(0, None)) })
        }
        "bj_hit" | "bj_stand" | "bj_double" | "bj_split" => {
            let mut hands = app.hands.lock().await;
            let h = hands.get_mut(tok).filter(|h| !h.done).ok_or("no active hand")?;
            let finished = match t {
                "bj_double" => { if !h.can_double() { return Err("can only double on two cards"); } let a = h.hands[h.active].stake; app.debit(tok, a, &format!("bj#{}", h.nonce)).await?; h.double().unwrap() }
                "bj_split" => { if !h.can_split() { return Err("can only split a pair, once"); } let a = h.hands[0].stake; app.debit(tok, a, &format!("bj#{}", h.nonce)).await?; h.split().unwrap() }
                "bj_hit" => h.hit(),
                _ => h.stand(),
            };
            let (pay, msg) = if finished { let (p, m) = h.settle(); (p, Some(m.to_owned())) } else { (0, None) };
            let bal = app.credit(tok, pay, &format!("bj#{}", h.nonce)).await;
            json!({ "t": "bj", "id": id, "hand": h.view(pay, msg), "balance": bal })
        }
        "crash_sub" => {
            let c = app.crash.lock().await; let mut rx = c.tx.subscribe(); let mut snap = c.snapshot();
            // A refreshed tab gets its own live bet back so it can still cash out.
            if let Some(b) = c.bets.get(tok) { snap["me"] = json!({ "anon": b.anon, "stake": b.stake, "out": b.out, "auto": b.auto }); }
            drop(c);
            let tx2 = tx.clone();
            if let Some(h) = crash_sub.take() { h.abort(); }
            *crash_sub = Some(tokio::spawn(async move { while let Ok(m) = rx.recv().await { if tx2.send(m).is_err() { break; } } }));
            snap
        }
        "crash_bet" => {
            let auto = v["auto"].as_u64().filter(|a| *a >= 101);
            if auto.is_some_and(|a| a >= games::CRASH_MAX) { return Err("auto cash-out must be below the 1000x cap"); }
            let mut c = app.crash.lock().await;
            if c.phase != crash::Phase::Betting { return Err("betting closed"); }
            if c.bets.contains_key(tok) { return Err("already in this round"); }
            let round = c.round;
            if stake == 0 || stake > MAX_STAKE { return Err("stake out of range"); }
            let bal = app.ledger.lock().await.crash_bet(tok, stake, round).map_err(lerr)?;
            let a = anon(); c.bets.insert(tok.to_owned(), crash::Bet { stake, auto, out: None, anon: a.clone() });
            let _ = c.tx.send(json!({ "t": "crash_join", "anon": a, "stake": stake }).to_string());
            json!({ "t": "crash_bet", "id": id, "round": round, "anon": a, "balance": bal })
        }
        "crash_cash" => {
            let mut c = app.crash.lock().await;
            if !c.can_cash() { return Err("too late"); }
            let m = c.now_mult(); let round = c.round;
            let b = c.bets.get_mut(tok).filter(|b| b.out.is_none()).ok_or("no open bet")?;
            b.out = Some(m); let (amt, a) = (b.stake * m / 100, b.anon.clone());
            let _ = c.tx.send(json!({ "t": "crash_out", "anon": a, "mult": m }).to_string());
            drop(c);
            let bal = app.ledger.lock().await.crash_cash(tok, amt, round);
            json!({ "t": "crash_cashed", "id": id, "mult": m, "payout": amt, "balance": bal })
        }
        "carrot_join" | "liars_join" | "holdem_join" => {
            let game: &'static str = match t { "carrot_join" => "carrot", "liars_join" => "liars", _ => "holdem" };
            let me = Player { token: tok.to_owned(), anon: anon() };
            let code = v["code"].as_str().map(|c| c.trim().to_uppercase()).filter(|c| !c.is_empty());
            let range = |s: u64| if game == "holdem" { (20 * holdem::BB..=MAX_STAKE).contains(&s) } else { (1..=MAX_STAKE).contains(&s) };
            if code.is_none() && !range(stake) { return Err(if game == "holdem" { "buy-in must be 0.2 to 0.5 TAZ" } else { "stake out of range" }); }
            let mut q = app.queue(game).lock().await;
            // "Play the house instead": the casino takes the other seat, clearly labelled as the house.
            if v["house"].as_bool() == Some(true) {
                q.retain(|w| w.player.token != tok); drop(q);
                app.start_match(game, vec![house_bot::house_player(), me], stake).await?;
                return Ok(None);
            }
            if q.iter().any(|w| w.player.token == tok) { return Err("already queued"); }
            let invite = v["invite"].as_bool() == Some(true);
            let found = match &code {
                Some(c) => Some(q.iter().position(|w| w.code.as_deref() == Some(c.as_str())).ok_or("that invite has expired or was already used")?),
                None if invite => None,
                None => q.iter().position(|w| w.code.is_none() && w.stake == stake),
            };
            if let Some(i) = found {
                let other = q.remove(i); drop(q);
                let stake = other.stake; let host = other.player.clone();
                if let Err(e) = app.start_match(game, vec![other.player, me], stake).await {
                    if e == "opponent left" { app.notify(&host.token, json!({ "t": "error", "error": "your opponent could not cover the stake" })).await; }
                    return Err(e);
                }
                return Ok(None);
            }
            if app.ledger.lock().await.balance(tok).map_err(lerr)? < stake { return Err("insufficient balance"); }
            let code = invite.then(invite_code);
            q.push(Waiting { player: me, stake, code: code.clone() });
            json!({ "t": "queued", "id": id, "game": game, "stake": stake, "code": code })
        }
        "queue_leave" => {
            for g in ["carrot", "liars", "holdem"] { app.queue(g).lock().await.retain(|w| w.player.token != tok); }
            json!({ "t": "queue_left", "id": id })
        }
        "pvp_rematch" => {
            let room = v["room"].as_str().unwrap_or("").to_owned();
            let mut m = app.rematch.lock().await;
            let r = m.get_mut(&room).filter(|r| r.at.elapsed() < std::time::Duration::from_secs(120)).ok_or("rematch expired")?;
            if !r.players.iter().any(|p| p.token == tok) { return Err("not your table"); }
            if !r.want.iter().any(|w| w == tok) { r.want.push(tok.to_owned()); }
            if r.players.iter().all(|p| house_bot::is_house(&p.token) || r.want.contains(&p.token)) {
                let r = m.remove(&room).unwrap(); drop(m);
                let players = r.players.into_iter().map(|p| if house_bot::is_house(&p.token) { house_bot::house_player() } else { Player { token: p.token, anon: anon() } }).collect();
                app.start_match(r.game, players, r.stake).await?;
                return Ok(None);
            }
            let others: Vec<String> = r.players.iter().filter(|p| p.token != tok).map(|p| p.token.clone()).collect(); drop(m);
            for o in others { app.notify(&o, json!({ "t": "pvp_rematch_offer", "room": room })).await; }
            json!({ "t": "rematch_wait", "id": id, "room": room })
        }
        "carrot_say" => {
            // Same lines as apps/web/src/app/table/carrot/page.tsx; free text is not allowed (no chat to moderate, nothing identifying).
            const LINES: [&str; 4] = ["I've got the carrot.", "Mine's empty. Want to swap?", "You should keep yours.", "I'd swap if I were you."];
            let line = LINES.get(v["line"].as_u64().unwrap_or(99) as usize).ok_or("unknown line")?;
            let rooms = app.carrots.lock().await; let g = rooms.get(v["room"].as_str().unwrap_or("")).ok_or("no room")?;
            if g.holder.token != tok { return Err("only the holder talks"); }
            app.log_to(&g.guesser.token, json!({ "t": "carrot_say", "line": line, "turn_ms": app.turn_ms(), "at": now_ms() })).await;
            app.touch(v["room"].as_str().unwrap_or("")).await;
            return Ok(None);
        }
        "carrot_choose" => {
            let room = v["room"].as_str().unwrap_or("").to_owned();
            let mut rooms = app.carrots.lock().await;
            let g = rooms.get_mut(&room).filter(|g| !g.done).ok_or("no room")?;
            if g.guesser.token != tok { return Err("only the guesser chooses"); }
            let swap = v["swap"].as_bool().unwrap_or(false);
            let w = g.resolve(swap).clone(); let pot = pvp::pot_after_rake(g.stake * 2);
            let opening = g.opening(); let (h, gs) = (g.holder.clone(), g.guesser.clone());
            let stake = g.stake;
            rooms.remove(&room); drop(rooms);
            app.credit(&w.token, pot, &format!("carrot#{room}")).await;
            app.pvp_seen.lock().await.remove(&room);
            let house = app.house_carrot.lock().await.remove(&room).map(|(_, o, c)| json!({ "commitment": c, "value": String::from_utf8_lossy(&o.value), "salt": o.salt }));
            app.keep_rematch(&room, "carrot", vec![h.clone(), gs.clone()], stake).await;
            for p in [&h, &gs] {
                app.log_reset(&p.token).await;
                let bal = app.ledger.lock().await.balance(&p.token).ok();
                app.notify(&p.token, json!({ "t": "carrot_reveal", "room": room, "swap": swap, "winner": w.anon, "you_won": w.token == p.token, "pot": pot, "opening": opening, "house_decision": house, "balance": bal })).await;
            }
            return Ok(None);
        }
        "liars_bid" | "liars_call" => {
            let room = v["room"].as_str().unwrap_or("").to_owned();
            let mut rooms = app.liars.lock().await;
            let g = rooms.get_mut(&room).ok_or("no room")?;
            let who = g.players.iter().position(|p| p.token == tok).ok_or("not seated")?;
            if t == "liars_bid" {
                let (q, f) = (v["q"].as_u64().unwrap_or(0) as u8, v["f"].as_u64().unwrap_or(0) as u8);
                g.bid(who, q, f).map_err(|e| match e { pvp::BidError::NotYourTurn => "not your turn", pvp::BidError::NotHigher => "bid must be higher", _ => "invalid bid" })?;
                let m = json!({ "t": "liars_bid", "room": room, "by": g.players[who].anon, "q": q, "f": f, "turn": g.turn, "turn_ms": app.turn_ms(), "at": now_ms() });
                for p in g.players.clone() { app.log_to(&p.token, m.clone()).await; }
                drop(rooms);
                app.touch(&room).await;
                app.liars_house_turn(&room).await;
                return Ok(None);
            }
            let (wi, count) = g.call(who).map_err(|_| "cannot call now")?;
            let pot = pvp::pot_after_rake(g.stake * g.players.len() as u64);
            let (players, openings, winner, bid, stake) = (g.players.clone(), g.openings(), g.players[wi].clone(), g.bid, g.stake);
            rooms.remove(&room); drop(rooms);
            app.keep_rematch(&room, "liars", players.clone(), stake).await;
            app.credit(&winner.token, pot, &format!("liars#{room}")).await;
            app.pvp_seen.lock().await.remove(&room);
            for p in &players { app.log_reset(&p.token).await; }
            for p in &players {
                let bal = app.ledger.lock().await.balance(&p.token).ok();
                app.notify(&p.token, json!({ "t": "liars_reveal", "room": room, "caller": players[who].anon, "bid": bid.map(|b| json!({"q": b.0, "f": b.1})), "count": count, "winner": winner.anon, "you_won": winner.token == p.token, "pot": pot, "openings": openings, "balance": bal })).await;
            }
            return Ok(None);
        }
        "hm_key" | "hm_shuffle" | "hm_shares" | "hm_act" | "holdem_leave" => { app.hm_message(tok, t, v).await?; return Ok(None); }
        _ => return Err("unknown message"),
    }))
}
