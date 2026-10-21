//! Zecasino game server. One websocket per browser tab; all messages are JSON `{ "t": ... }`.
//! Privacy: no IPs are logged or stored, sessions are bearer tokens stored hashed, and other
//! players only ever see a short per-room `anon` tag.
pub mod crash;
pub mod house;
pub mod ledger;
pub mod pvp;

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

pub struct Waiting { pub player: Player, pub stake: u64 }

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
    pub dev_credit: bool,
}

fn rid() -> String { let mut b = [0u8; 8]; rand::rngs::OsRng.fill_bytes(&mut b); hex::encode(b) }
fn anon() -> String { let mut b = [0u8; 2]; rand::rngs::OsRng.fill_bytes(&mut b); hex::encode(b) }
fn err(id: &Value, msg: &str) -> Value { json!({ "t": "error", "id": id, "error": msg }) }
fn lerr(e: LedgerError) -> &'static str { match e { LedgerError::Insufficient => "insufficient balance", LedgerError::UnknownSession => "unknown session" } }

impl App {
    pub fn new(db: &str, dev_credit: bool) -> Arc<Self> {
        Arc::new(Self {
            ledger: Mutex::new(Ledger::open(db).expect("ledger")), seats: Default::default(), hands: Default::default(),
            crash: Mutex::new(crash::Crash::new()), conns: Default::default(), carrot_wait: Default::default(), carrots: Default::default(),
            liars_wait: Default::default(), liars: Default::default(), dev_credit,
        })
    }
    pub async fn notify(&self, token: &str, v: Value) {
        if let Some(list) = self.conns.lock().await.get(token) { for tx in list { let _ = tx.send(v.to_string()); } }
    }
    async fn seat_view(&self, token: &str) -> Value {
        let s = self.seats.lock().await; let p = &s[token];
        json!({ "commitment": p.commitment, "client_seed": p.client_seed, "nonce": p.nonce })
    }
    async fn debit(&self, token: &str, stake: u64, r: &str) -> Result<u64, &'static str> {
        if stake == 0 || stake > MAX_STAKE { return Err("stake out of range"); }
        self.ledger.lock().await.apply(token, -(stake as i64), "bet", r).map_err(lerr)
    }
    async fn credit(&self, token: &str, amt: u64, r: &str) -> u64 {
        let mut l = self.ledger.lock().await;
        if amt > 0 { l.apply(token, amt as i64, "payout", r).unwrap() } else { l.balance(token).unwrap() }
    }
}

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/ws", get(ws))
        .route("/health", get(|| async { "ok" }))
        .route("/solvency", get(solvency))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(app)
}

async fn solvency(State(app): State<Arc<App>>) -> Json<Value> {
    let l = app.ledger.lock().await;
    Json(json!({ "liabilities_zat": l.liabilities(), "house_pnl_zat": l.house_pnl() }))
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
            let tok = match v["token"].as_str() { Some(k) if app.ledger.lock().await.exists(k) => k.to_owned(), _ => app.ledger.lock().await.create() };
            let mut seats = app.seats.lock().await;
            if !seats.contains_key(&tok) { match SeedPair::generate(cs) { Ok(p) => { seats.insert(tok.clone(), p); } Err(_) => { seats.insert(tok.clone(), SeedPair::generate("zecasino").unwrap()); } } }
            drop(seats);
            app.conns.lock().await.entry(tok.clone()).or_default().push(tx.clone());
            let bal = app.ledger.lock().await.balance(&tok).unwrap();
            let _ = tx.send(json!({ "t": "session", "id": id, "token": tok, "balance": bal, "seat": app.seat_view(&tok).await }).to_string());
            token = Some(tok);
            continue;
        }
        let Some(tok) = token.clone() else { let _ = tx.send(err(&id, "say hello first").to_string()); continue };
        let reply = match handle(&app, &tok, t, &v, &id, &tx, &mut crash_sub).await { Ok(r) => r, Err(e) => Some(err(&id, e)) };
        if let Some(r) = reply { let _ = tx.send(r.to_string()); }
    }
    if let Some(h) = crash_sub { h.abort(); }
    if let Some(tok) = token { if let Some(l) = app.conns.lock().await.get_mut(&tok) { l.retain(|x| !x.same_channel(&tx)); } 
        app.carrot_wait.lock().await.retain(|w| w.player.token != tok); app.liars_wait.lock().await.retain(|w| w.player.token != tok); }
    writer.abort();
}

async fn handle(app: &Arc<App>, tok: &str, t: &str, v: &Value, id: &Value, tx: &Tx, crash_sub: &mut Option<tokio::task::JoinHandle<()>>) -> Result<Option<Value>, &'static str> {
    let stake = v["stake"].as_u64().unwrap_or(0);
    Ok(Some(match t {
        "dev_credit" => {
            if !app.dev_credit { return Err("dev credit disabled"); }
            let amt = v["amount"].as_u64().unwrap_or(0).min(100_000_000);
            let b = app.ledger.lock().await.apply(tok, amt as i64, "deposit", "dev").map_err(lerr)?;
            json!({ "t": "balance", "id": id, "balance": b })
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
        "bj_hit" | "bj_stand" | "bj_double" => {
            let mut hands = app.hands.lock().await;
            let h = hands.get_mut(tok).filter(|h| !h.done).ok_or("no active hand")?;
            if t == "bj_double" { if h.player.len() != 2 { return Err("can only double on two cards"); } app.debit(tok, h.stake, &format!("bj#{}", h.nonce)).await?; h.double(); }
            if t == "bj_hit" { h.hit(); }
            let finished = t != "bj_hit" || house::bj_value(&h.player).0 > 21;
            let (pay, msg) = if finished { let (p, m) = h.settle(); (p, Some(m.to_owned())) } else { (0, None) };
            let bal = app.credit(tok, pay, &format!("bj#{}", h.nonce)).await;
            json!({ "t": "bj", "id": id, "hand": h.view(pay, msg), "balance": bal })
        }
        "crash_sub" => {
            let c = app.crash.lock().await; let mut rx = c.tx.subscribe(); let snap = c.snapshot(); drop(c);
            let tx2 = tx.clone();
            if let Some(h) = crash_sub.take() { h.abort(); }
            *crash_sub = Some(tokio::spawn(async move { while let Ok(m) = rx.recv().await { if tx2.send(m).is_err() { break; } } }));
            snap
        }
        "crash_bet" => {
            let auto = v["auto"].as_u64().filter(|a| *a >= 101);
            let mut c = app.crash.lock().await;
            if c.phase != crash::Phase::Betting { return Err("betting closed"); }
            if c.bets.contains_key(tok) { return Err("already in this round"); }
            let round = c.round;
            let bal = app.debit(tok, stake, &format!("crash#{round}")).await?;
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
            let bal = app.credit(tok, amt, &format!("crash#{round}")).await;
            json!({ "t": "crash_cashed", "id": id, "mult": m, "payout": amt, "balance": bal })
        }
        "carrot_join" => {
            let me = Player { token: tok.to_owned(), anon: anon() };
            let mut q = app.carrot_wait.lock().await;
            if q.iter().any(|w| w.player.token == tok) { return Err("already queued"); }
            if let Some(i) = q.iter().position(|w| w.stake == stake) {
                let other = q.remove(i); drop(q);
                app.debit(tok, stake, "carrot").await?;
                if app.debit(&other.player.token, stake, "carrot").await.is_err() { app.credit(tok, stake, "carrot-refund").await; return Err("opponent left"); }
                let room = rid(); let g = Carrot::new(other.player, me, stake);
                for (p, role) in [(&g.holder, "holder"), (&g.guesser, "guesser")] {
                    let opp = if role == "holder" { &g.guesser.anon } else { &g.holder.anon };
                    let mut m = json!({ "t": "carrot_start", "room": room, "role": role, "you": p.anon, "opponent": opp, "stake": stake, "commitment": g.c.0 });
                    if role == "holder" { m["peek"] = json!(if g.in_holder { "carrot" } else { "empty" }); }
                    app.notify(&p.token, m).await;
                }
                app.carrots.lock().await.insert(room, g);
                return Ok(None);
            }
            app.debit(tok, stake, "carrot-hold").await?; app.credit(tok, stake, "carrot-hold").await; // balance check only
            q.push(Waiting { player: me, stake });
            json!({ "t": "queued", "id": id, "game": "carrot" })
        }
        "carrot_say" => {
            const LINES: [&str; 6] = ["I'd keep mine if I were you.", "Swap. Trust me.", "There's definitely a carrot in here.", "Mine's empty, honestly.", "You look like a swapper.", "Take your time."];
            let line = LINES.get(v["line"].as_u64().unwrap_or(99) as usize).ok_or("unknown line")?;
            let rooms = app.carrots.lock().await; let g = rooms.get(v["room"].as_str().unwrap_or("")).ok_or("no room")?;
            if g.holder.token != tok { return Err("only the holder talks"); }
            app.notify(&g.guesser.token, json!({ "t": "carrot_say", "line": line })).await;
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
            rooms.remove(&room); drop(rooms);
            app.credit(&w.token, pot, &format!("carrot#{room}")).await;
            for p in [&h, &gs] {
                let bal = app.ledger.lock().await.balance(&p.token).ok();
                app.notify(&p.token, json!({ "t": "carrot_reveal", "room": room, "swap": swap, "winner": w.anon, "you_won": w.token == p.token, "pot": pot, "opening": opening, "balance": bal })).await;
            }
            return Ok(None);
        }
        "liars_join" => {
            let me = Player { token: tok.to_owned(), anon: anon() };
            let mut q = app.liars_wait.lock().await;
            if q.iter().any(|w| w.player.token == tok) { return Err("already queued"); }
            if let Some(i) = q.iter().position(|w| w.stake == stake) {
                let other = q.remove(i); drop(q);
                app.debit(tok, stake, "liars").await?;
                if app.debit(&other.player.token, stake, "liars").await.is_err() { app.credit(tok, stake, "liars-refund").await; return Err("opponent left"); }
                let room = rid(); let g = Liars::new(vec![other.player, me], stake);
                let commits: Vec<Value> = g.players.iter().zip(&g.commits).map(|(p, (c, _))| json!({ "anon": p.anon, "commitment": c.0 })).collect();
                for (i, p) in g.players.iter().enumerate() {
                    app.notify(&p.token, json!({ "t": "liars_start", "room": room, "seat": i, "you": p.anon, "dice": g.dice[i], "salt": g.commits[i].1.salt, "commitments": commits, "turn": g.turn, "stake": stake })).await;
                }
                app.liars.lock().await.insert(room, g);
                return Ok(None);
            }
            app.debit(tok, stake, "liars-hold").await?; app.credit(tok, stake, "liars-hold").await;
            q.push(Waiting { player: me, stake });
            json!({ "t": "queued", "id": id, "game": "liars" })
        }
        "liars_bid" | "liars_call" => {
            let room = v["room"].as_str().unwrap_or("").to_owned();
            let mut rooms = app.liars.lock().await;
            let g = rooms.get_mut(&room).ok_or("no room")?;
            let who = g.players.iter().position(|p| p.token == tok).ok_or("not seated")?;
            if t == "liars_bid" {
                let (q, f) = (v["q"].as_u64().unwrap_or(0) as u8, v["f"].as_u64().unwrap_or(0) as u8);
                g.bid(who, q, f).map_err(|e| match e { pvp::BidError::NotYourTurn => "not your turn", pvp::BidError::NotHigher => "bid must be higher", _ => "invalid bid" })?;
                let m = json!({ "t": "liars_bid", "room": room, "by": g.players[who].anon, "q": q, "f": f, "turn": g.turn });
                for p in g.players.clone() { app.notify(&p.token, m.clone()).await; }
                return Ok(None);
            }
            let (wi, count) = g.call(who).map_err(|_| "cannot call now")?;
            let pot = pvp::pot_after_rake(g.stake * g.players.len() as u64);
            let (players, openings, winner, bid) = (g.players.clone(), g.openings(), g.players[wi].clone(), g.bid);
            rooms.remove(&room); drop(rooms);
            app.credit(&winner.token, pot, &format!("liars#{room}")).await;
            for p in &players {
                let bal = app.ledger.lock().await.balance(&p.token).ok();
                app.notify(&p.token, json!({ "t": "liars_reveal", "room": room, "caller": players[who].anon, "bid": bid.map(|b| json!({"q": b.0, "f": b.1})), "count": count, "winner": winner.anon, "you_won": winner.token == p.token, "pot": pot, "openings": openings, "balance": bal })).await;
            }
            return Ok(None);
        }
        _ => return Err("unknown message"),
    }))
}
