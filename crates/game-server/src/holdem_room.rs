//! Hold'em rooms over the websocket: matchmaking, the mental-poker protocol steps, betting, showdown.
use std::{collections::HashMap, sync::{Arc, atomic::Ordering}, time::Duration};
use serde_json::{json, Value};
use zecasino_mental_poker as mp;
use crate::{holdem::{self, Act, Hand, Phase, Step, BB, HOUSE}, pvp::{self, Player}, App};

pub struct Room { pub id: String, pub players: [Player; 2], pub stacks: [u64; 2], pub button: usize, pub hand: Option<Hand>, pub hand_no: u64, pub closed: bool, pub progress: u64, pub seated: [Value; 2], pub buy_in: u64 }

fn hexpt(p: &curve25519_dalek::ristretto::RistrettoPoint) -> String { hex::encode(p.compress().as_bytes()) }

impl App {
    /// Everything except requests is kept for replay; requests are re-derived from state on resume.
    async fn to_seat(&self, r: &Room, seat: usize, v: Value) {
        let t = v["t"].as_str().unwrap_or("");
        if t.ends_with("_req") || t == "hm_state" || t == "hm_closed" { self.notify(&r.players[seat].token, v).await; } else { self.log_to(&r.players[seat].token, v).await; }
    }

    /// Re-sends a refreshed tab its table: the seat, this hand's messages, any request it owes, the state.
    pub(crate) async fn hm_resume(&self, tok: &str, tx: &crate::Tx) -> bool {
        let rooms = self.holdems.lock().await;
        let Some(r) = rooms.values().find(|r| r.players.iter().any(|p| p.token == tok)) else { return false };
        let seat = r.players.iter().position(|p| p.token == tok).unwrap();
        let send = |mut m: Value| { m["replay"] = json!(true); let _ = tx.send(m.to_string()); };
        send(r.seated[seat].clone());
        for m in self.replay.lock().await.get(tok).cloned().unwrap_or_default() { send(m); }
        let Some(h) = &r.hand else { return true };
        match h.phase {
            Phase::Keys if h.pks[seat].is_none() => send(json!({ "t": "hm_key_req", "room": r.id })),
            Phase::Shuffle(s) if s == seat => send(json!({ "t": "hm_shuffle_req", "room": r.id, "deck": h.deck })),
            Phase::HoleShares | Phase::Board | Phase::Showdown => if let Some((_, p)) = h.pending.iter().find(|p| p.0 == seat) { send(json!({ "t": "hm_share_req", "room": r.id, "positions": p })) },
            _ => {}
        }
        if h.phase == Phase::Betting { let mut m = Self::state_msg(r, h, seat); m["act_ms"] = json!(self.hm_act_ms.load(Ordering::Relaxed)); send(m); }
        true
    }
    async fn to_both(&self, r: &Room, v: Value) { for s in 0..2 { self.to_seat(r, s, v.clone()).await; } }

    pub(crate) async fn hm_new_room(self: &Arc<Self>, a: Player, b: Player, buy_in: u64) {
        let id = crate::rid();
        let mut room = Room { id: id.clone(), players: [a, b], stacks: [buy_in; 2], button: 0, hand: None, hand_no: 0, closed: false, progress: 0, seated: [Value::Null, Value::Null], buy_in };
        for s in 0..2 {
            let bal = self.ledger.lock().await.balance(&room.players[s].token).ok();
            room.seated[s] = json!({ "t": "hm_seated", "room": id, "seat": s, "you": room.players[s].anon, "opponent": room.players[1 - s].anon, "opponent_house": crate::house_bot::is_house(&room.players[1 - s].token), "stacks": room.stacks, "blinds": [holdem::SB, BB], "balance": bal });
            self.notify(&room.players[s].token, room.seated[s].clone()).await;
        }
        self.holdems.lock().await.insert(id.clone(), room);
        tokio::spawn(self.clone().hm_watchdog(id.clone()));
        self.hm_start_hand(&id).await;
    }

    pub(crate) async fn hm_start_hand(self: &Arc<Self>, id: &str) {
        let mut rooms = self.holdems.lock().await;
        let Some(r) = rooms.get_mut(id) else { return };
        if r.closed { return; }
        if r.stacks.iter().any(|&s| s < BB) { drop(rooms); self.hm_close(id, "a player is out of chips").await; return; }
        r.progress += 1;
        r.hand_no += 1; if r.hand_no > 1 { r.button = 1 - r.button; }
        r.hand = Some(Hand::new(r.hand_no, r.stacks, r.button));
        for p in &r.players { self.log_reset(&p.token).await; }
        let v = json!({ "t": "hm_hand", "room": id, "hand": r.hand_no, "button": r.button, "stacks": r.stacks });
        self.to_both(r, v).await;
        self.to_both(r, json!({ "t": "hm_key_req", "room": id })).await;
    }

    pub(crate) async fn hm_close(self: &Arc<Self>, id: &str, why: &str) {
        let Some(mut r) = self.holdems.lock().await.remove(id) else { return };
        r.closed = true;
        for p in &r.players { self.log_reset(&p.token).await; }
        self.keep_rematch(id, "holdem", r.players.to_vec(), r.buy_in).await;
        // Room stacks only change when a hand settles, so an abandoned hand is refunded by
        // paying out the stacks as they stood when it started (blinds and bets included).
        for s in 0..2 {
            let amt = r.stacks[s];
            let bal = if amt > 0 { if crate::house_bot::is_house(&r.players[s].token) { None } else { self.ledger.lock().await.apply(&r.players[s].token, amt as i64, "payout", &format!("holdem#{id}")).ok() } } else { self.ledger.lock().await.balance(&r.players[s].token).ok() };
            self.to_seat(&r, s, json!({ "t": "hm_closed", "room": id, "reason": why, "cashed_out": amt, "balance": bal })).await;
        }
    }

    fn state_msg(r: &Room, h: &Hand, seat: usize) -> Value {
        let b = &h.betting;
        json!({ "t": "hm_state", "room": r.id, "street": b.street, "pot": b.pot(), "street_bet": b.street_bet, "stacks": b.stacks, "to_act": b.to_act,
            "legal": (b.to_act == seat && h.phase == Phase::Betting).then(|| b.legal(seat)), "board": h.board, "log": h.log })
    }
    async fn send_state(&self, r: &Room) {
        let act = self.hm_act_ms.load(Ordering::Relaxed);
        if let Some(h) = &r.hand { for s in 0..2 { let mut m = Self::state_msg(r, h, s); m["act_ms"] = json!(act); self.to_seat(r, s, m).await; } }
    }

    /// Ask both players for their shares of `positions` (each player is asked only for positions it may reveal).
    async fn request_shares(&self, r: &mut Room, req: [Vec<usize>; 2]) {
        let h = r.hand.as_mut().unwrap();
        h.pending = req.iter().cloned().enumerate().filter(|(_, p)| !p.is_empty()).collect();
        for (s, p) in req.iter().enumerate() { if !p.is_empty() { self.to_seat(r, s, json!({ "t": "hm_share_req", "room": r.id, "positions": p })).await; } }
    }

    /// Accepted messages reset the stall clock; rejected ones do not, so spamming cannot stall a table.
    pub(crate) async fn hm_message(self: &Arc<Self>, tok: &str, t: &str, v: &Value) -> Result<(), &'static str> {
        self.hm_message_inner(tok, t, v).await?;
        if let Some(r) = self.holdems.lock().await.get_mut(v["room"].as_str().unwrap_or("")) { r.progress += 1; }
        Ok(())
    }

    /// Who the table is waiting on, and how long they get.
    fn hm_waiting(&self, r: &Room) -> Option<(Vec<usize>, u64)> {
        let h = r.hand.as_ref()?;
        let proto = self.hm_proto_ms.load(Ordering::Relaxed); let act = self.hm_act_ms.load(Ordering::Relaxed);
        match h.phase {
            Phase::Keys => Some(((0..2).filter(|&s| h.pks[s].is_none()).collect(), proto)),
            Phase::Shuffle(s) => Some((vec![s], proto)),
            Phase::HoleShares | Phase::Board | Phase::Showdown => Some((h.pending.iter().map(|p| p.0).collect(), proto)),
            Phase::Betting => Some((vec![h.betting.to_act], act)),
            Phase::Done => None,
        }
    }

    /// Stall handling. Betting: the player to act is checked if that is free, else folded.
    /// Before any betting (keys, shuffles, hole shares) the table closes and every chip is refunded.
    /// Withholding board or showdown shares forfeits the pot, so hiding a losing hand never pays.
    async fn hm_watchdog(self: Arc<Self>, id: String) {
        let mut seen = (u64::MAX, std::time::Instant::now());
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let mut rooms = self.holdems.lock().await;
            let Some(r) = rooms.get_mut(&id) else { return };
            if r.progress != seen.0 { seen = (r.progress, std::time::Instant::now()); continue; }
            let Some((who, limit)) = self.hm_waiting(r) else { continue };
            if who.is_empty() || seen.1.elapsed() < Duration::from_millis(limit) { continue; }
            let h = r.hand.as_mut().unwrap();
            let stalled = who[0];
            let name = r.players[stalled].anon.clone();
            r.progress += 1;
            match h.phase {
                Phase::Betting => {
                    let check = h.betting.legal(stalled)["check"].as_bool().unwrap_or(false);
                    h.log.push(format!("anon · {name} timed out and {}", if check { "checks" } else { "folds" }));
                    drop(rooms);
                    let v = json!({ "room": id, "action": if check { "check" } else { "fold" } });
                    let tok = self.holdems.lock().await.get(&id).map(|r| r.players[stalled].token.clone());
                    if let Some(tok) = tok { let _ = self.hm_message_inner(&tok, "hm_act", &v).await; }
                }
                Phase::Keys | Phase::Shuffle(_) | Phase::HoleShares => { drop(rooms); self.hm_close(&id, &format!("anon · {name} stopped responding; the hand was cancelled and all chips refunded")).await; return; }
                _ => {
                    // Board or showdown shares withheld. If both stalled, nobody is rewarded: refund.
                    if who.len() > 1 { drop(rooms); self.hm_close(&id, "both players stopped responding; chips refunded").await; return; }
                    h.log.push(format!("anon · {name} withheld card shares and forfeits the hand"));
                    drop(rooms); self.hm_settle(&id, Some(1 - stalled), "forfeit").await;
                }
            }
        }
    }

    async fn hm_message_inner(self: &Arc<Self>, tok: &str, t: &str, v: &Value) -> Result<(), &'static str> {
        let id = v["room"].as_str().unwrap_or("").to_owned();
        let mut rooms = self.holdems.lock().await;
        let r = rooms.get_mut(&id).ok_or("no such table")?;
        let seat = r.players.iter().position(|p| p.token == tok).ok_or("not seated")?;
        if t == "holdem_leave" {
            if r.hand.as_ref().is_some_and(|h| h.phase != Phase::Done) { return Err("finish the hand first"); }
            drop(rooms); self.hm_close(&id, "a player left the table").await; return Ok(());
        }
        let h = r.hand.as_mut().ok_or("no hand")?;
        match t {
            "hm_key" => {
                if h.phase != Phase::Keys { return Err("keys already set"); }
                let pk: mp::PublicKey = serde_json::from_value(v["pk"].clone()).map_err(|_| "bad key")?;
                pk.verify().map_err(|_| "key proof failed")?;
                h.pks[seat] = Some(pk);
                if h.pks[0].is_some() && h.pks[1].is_some() {
                    h.pks[HOUSE] = Some(h.house_sk.public());
                    let pks: Vec<mp::PublicKey> = h.pks.iter().map(|k| k.clone().unwrap()).collect();
                    let joint = mp::joint_key(&pks).map_err(|_| "bad joint key")?;
                    h.joint = Some(joint);
                    // House shuffles first (it is the weakest link only if both players collude with it).
                    let input = h.deck.clone(); let (out, proof) = mp::shuffle(&input, &joint);
                    h.deck = out.clone(); h.phase = Phase::Shuffle(0);
                    let msg = json!({ "t": "hm_keys", "room": id, "pks": pks, "joint": hexpt(&joint) });
                    let sh = json!({ "t": "hm_shuffled", "room": id, "by": "house", "input": input, "output": out, "proof": proof });
                    let rq = json!({ "t": "hm_shuffle_req", "room": id, "deck": out });
                    let r = &*r; self.to_both(r, msg).await; self.to_both(r, sh).await; self.to_seat(r, 0, rq).await;
                }
            }
            "hm_shuffle" => {
                if h.phase != Phase::Shuffle(seat) { return Err("not your shuffle"); }
                let out: Vec<mp::Masked> = serde_json::from_value(v["deck"].clone()).map_err(|_| "bad deck")?;
                let proof: mp::ShuffleProof = serde_json::from_value(v["proof"].clone()).map_err(|_| "bad proof")?;
                let joint = h.joint.unwrap(); let input = h.deck.clone();
                let ok = { let (i, o) = (input.clone(), out.clone()); tokio::task::spawn_blocking(move || mp::verify_shuffle(&i, &o, &joint, &proof).map(|_| proof)).await.unwrap() };
                let proof = ok.map_err(|_| "shuffle proof rejected")?;
                h.deck = out.clone();
                let fwd = json!({ "t": "hm_shuffled", "room": id, "by": r.players[seat].anon, "input": input, "output": out, "proof": proof });
                if seat == 0 {
                    h.phase = Phase::Shuffle(1);
                    let rq = json!({ "t": "hm_shuffle_req", "room": id, "deck": out });
                    let r = &*r; self.to_seat(r, 1, fwd).await; self.to_seat(r, 1, rq).await;
                    self.to_seat(r, 0, json!({ "t": "hm_shuffle_ok", "room": id })).await;
                } else {
                    h.phase = Phase::HoleShares;
                    for p in 0..4 { h.house_share(p); }
                    { let r = &*r; self.to_seat(r, 0, fwd).await; self.to_seat(r, 1, json!({ "t": "hm_shuffle_ok", "room": id })).await;
                      self.to_both(r, json!({ "t": "hm_deck", "room": id, "deck": out })).await; }
                    // Each player sends shares for the *opponent's* hole cards; the server never asks for your own.
                    self.request_shares(r, [holdem::hole_positions(1).to_vec(), holdem::hole_positions(0).to_vec()]).await;
                }
            }
            "hm_shares" => {
                let pending = h.pending.iter().position(|(s, _)| *s == seat).ok_or("no shares requested")?;
                let wanted = h.pending[pending].1.clone();
                let got = v["shares"].as_object().ok_or("shares required")?;
                for pos in &wanted {
                    let s: mp::Share = serde_json::from_value(got.get(&pos.to_string()).cloned().ok_or("missing share")?).map_err(|_| "bad share")?;
                    h.add_share(seat, *pos, s)?;
                }
                h.pending.remove(pending);
                if !h.pending.is_empty() { return Ok(()); }
                drop(rooms); self.hm_advance(&id).await;
            }
            "hm_act" => {
                if h.phase != Phase::Betting { return Err("not betting now"); }
                let a = match v["action"].as_str().unwrap_or("") { "fold" => Act::Fold, "check" => Act::Check, "call" => Act::Call, "raise" => Act::Raise, _ => return Err("unknown action") };
                let street = h.betting.street;
                let step = h.betting.act(seat, a, v["to"].as_u64().unwrap_or(0))?;
                let who = &r.players[seat].anon;
                h.log.push(match a { Act::Raise => format!("{who} raises to {}", h.betting.street_bet[seat].max(v["to"].as_u64().unwrap_or(0))), _ => format!("{who} {}", serde_json::to_value(a).unwrap().as_str().unwrap()) });
                match step {
                    Step::Continue => { let r = &*r; self.send_state(r).await; }
                    Step::Folded { winner } => { drop(rooms); self.hm_settle(&id, Some(winner), "fold").await; }
                    Step::StreetDone if street == 3 => { h.phase = Phase::Showdown; self.request_shares(r, [holdem::hole_positions(0).to_vec(), holdem::hole_positions(1).to_vec()]).await; }
                    Step::StreetDone => { h.phase = Phase::Board; let p = holdem::board_positions(h.betting.street).to_vec(); self.request_shares(r, [p.clone(), p]).await; }
                    Step::AllInRunout => {
                        h.runout = true; h.phase = Phase::Board; h.betting.street = street + 1;
                        if h.betting.street > 3 { h.phase = Phase::Showdown; self.request_shares(r, [holdem::hole_positions(0).to_vec(), holdem::hole_positions(1).to_vec()]).await; }
                        else { let p = holdem::board_positions(h.betting.street).to_vec(); self.request_shares(r, [p.clone(), p]).await; }
                    }
                }
            }
            _ => return Err("unknown message"),
        }
        Ok(())
    }

    /// Called when every requested share has arrived.
    async fn hm_advance(self: &Arc<Self>, id: &str) {
        let mut rooms = self.holdems.lock().await;
        let Some(r) = rooms.get_mut(id) else { return };
        let h = r.hand.as_mut().unwrap();
        match h.phase {
            Phase::HoleShares => {
                h.phase = Phase::Betting;
                let mut msgs = vec![];
                for s in 0..2 {
                    let pos = holdem::hole_positions(s);
                    let shares: HashMap<String, Value> = pos.iter().map(|p| (p.to_string(), h.shares_json(*p, &[1 - s, HOUSE]))).collect();
                    msgs.push(json!({ "t": "hm_hole", "room": id, "positions": pos, "shares": shares }));
                }
                let r = &*r; for (s, m) in msgs.into_iter().enumerate() { self.to_seat(r, s, m).await; }
                self.send_state(r).await;
            }
            Phase::Board => {
                let street = h.betting.street;
                let pos = holdem::board_positions(street);
                let mut cards = vec![]; let mut shares = serde_json::Map::new();
                for &p in pos { h.house_share(p); cards.push(h.open(p).expect("all shares verified")); shares.insert(p.to_string(), h.shares_json(p, &[0, 1, HOUSE])); }
                h.board.extend(&cards);
                let msg = json!({ "t": "hm_board", "room": id, "street": street, "positions": pos, "cards": cards, "shares": shares });
                if h.runout {
                    if street < 3 { h.betting.street += 1; let p = holdem::board_positions(h.betting.street).to_vec(); self.to_both(&*r, msg).await; self.request_shares(r, [p.clone(), p]).await; }
                    else { h.phase = Phase::Showdown; self.to_both(&*r, msg).await; self.request_shares(r, [holdem::hole_positions(0).to_vec(), holdem::hole_positions(1).to_vec()]).await; }
                } else { h.phase = Phase::Betting; let r = &*r; self.to_both(r, msg).await; self.send_state(r).await; }
            }
            Phase::Showdown => { drop(rooms); self.hm_settle(id, None, "showdown").await; }
            _ => {}
        }
    }

    /// Ends the hand: `folded_winner` for a fold, else a showdown on the opened cards.
    async fn hm_settle(self: &Arc<Self>, id: &str, folded_winner: Option<usize>, by: &str) {
        let mut rooms = self.holdems.lock().await;
        let Some(r) = rooms.get_mut(id) else { return };
        let h = r.hand.as_mut().unwrap();
        let b = h.betting.clone();
        let saw_flop = !h.board.is_empty();
        let (mut pay, extra) = match folded_winner {
            Some(w) => { let mut p = [b.stacks[0], b.stacks[1]]; p[w] += b.pot(); (p, json!({ "winner": w, "by": by })) }
            None => {
                let holes: Vec<[u8; 2]> = (0..2).map(|s| { let p = holdem::hole_positions(s); [h.open(p[0]).unwrap(), h.open(p[1]).unwrap()] }).collect();
                let eval: Vec<(Vec<u8>, &str)> = holes.iter().map(|hc| { let mut c = h.board.clone(); c.extend(hc); holdem::best(&c) }).collect();
                let cmp = eval[0].0.cmp(&eval[1].0);
                let reveals: Vec<Value> = (0..2).map(|s| { let p = holdem::hole_positions(s); json!({ "positions": p, "cards": holes[s], "shares": { p[0].to_string(): h.shares_json(p[0], &[0, 1, HOUSE]), p[1].to_string(): h.shares_json(p[1], &[0, 1, HOUSE]) } }) }).collect();
                (b.showdown(cmp), json!({ "winner": match cmp { std::cmp::Ordering::Greater => json!(0), std::cmp::Ordering::Less => json!(1), _ => json!("split") }, "by": "showdown", "holes": holes, "hands": [eval[0].1, eval[1].1], "reveals": reveals }))
            }
        };
        // 2% rake, only on hands that saw a flop.
        let rake = if saw_flop { let pot = 2 * b.contrib[0].min(b.contrib[1]); pot - pvp::pot_after_rake(pot) } else { 0 };
        // The rake comes out of the pot, so it is paid by whoever takes the pot; a split pot shares it.
        let won = [pay[0] > b.stacks[0], pay[1] > b.stacks[1]];
        match won { [true, true] => { pay[0] -= rake / 2; pay[1] -= rake - rake / 2; } [false, true] => pay[1] -= rake.min(pay[1]), _ => pay[0] -= rake.min(pay[0]) }
        r.stacks = pay; h.phase = Phase::Done;
        let mut msg = json!({ "t": "hm_result", "room": id, "stacks": pay, "pot": b.pot(), "rake": rake, "board": h.board, "log": h.log });
        msg.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        self.to_both(&*r, msg).await;
        drop(rooms);
        let app = self.clone(); let id = id.to_owned();
        let close = by == "forfeit";
        tokio::spawn(async move { tokio::time::sleep(Duration::from_secs(6)).await; if close { app.hm_close(&id, "the table closed after a forfeit").await; } else { app.hm_start_hand(&id).await; } });
    }
}
