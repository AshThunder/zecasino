//! Multiplayer Crash. One fresh server seed per round, committed at the start of betting and
//! revealed at the bust, so every round is verifiable: bust = games::crash(seed, "zecasino-crash", round).
use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};
use rand::RngCore;
use serde_json::json;
use tokio::sync::broadcast;
use zecasino_fairness::{commit_server_seed, games, OutcomeStream};
use crate::App;

pub const RATE: f64 = 0.00006; // per ms, same curve as apps/web/src/lib/crash.ts
pub const BET_MS: u64 = 6_000;
pub const CRASH_CLIENT_SEED: &str = "zecasino-crash";

pub fn mult_at(ms: f64) -> u64 { (100.0 * (RATE * ms).exp()).floor() as u64 }
pub fn ms_for(mult: u64) -> f64 { ((mult as f64) / 100.0).ln() / RATE }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase { Betting, Running, Busted }

pub struct Bet { pub stake: u64, pub auto: Option<u64>, pub out: Option<u64>, pub anon: String }

pub struct Crash {
    pub round: u64, pub phase: Phase, seed: [u8; 32], pub commitment: String, bust: u64,
    pub started: Instant, pub bets: HashMap<String, Bet>, pub tx: broadcast::Sender<String>,
}

impl Crash {
    /// `first_round` comes from the ledger so round ids continue across restarts.
    pub fn new(first_round: u64) -> Self {
        let (tx, _) = broadcast::channel(256);
        let mut c = Self { round: first_round.saturating_sub(1), phase: Phase::Busted, seed: [0; 32], commitment: String::new(), bust: 100, started: Instant::now(), bets: HashMap::new(), tx };
        c.next_round();
        c
    }
    fn next_round(&mut self) { let r = self.round + 1; self.start_round(r); }
    pub fn start_round(&mut self, round: u64) {
        self.round = round;
        rand::rngs::OsRng.fill_bytes(&mut self.seed);
        self.commitment = commit_server_seed(&self.seed);
        self.bust = games::crash(&mut OutcomeStream::new(self.seed, CRASH_CLIENT_SEED, self.round));
        self.phase = Phase::Betting; self.started = Instant::now(); self.bets.clear();
    }
    pub fn snapshot(&self) -> serde_json::Value {
        let elapsed = self.started.elapsed().as_millis() as u64;
        json!({ "t": "crash", "phase": match self.phase { Phase::Betting => "betting", Phase::Running => "running", Phase::Busted => "busted" },
            "round": self.round, "commitment": self.commitment, "elapsed_ms": elapsed, "bet_ms": BET_MS,
            "bettors": self.bets.values().map(|b| json!({ "anon": b.anon, "stake": b.stake, "out": b.out })).collect::<Vec<_>>() })
    }
    /// Current multiplier (hundredths) while running, capped at the bust point.
    pub fn now_mult(&self) -> u64 { mult_at(self.started.elapsed().as_millis() as f64).min(self.bust) }
    pub fn can_cash(&self) -> bool { self.phase == Phase::Running && mult_at(self.started.elapsed().as_millis() as f64) < self.bust }
}

/// Drives rounds forever. Settles auto cash-outs at their exact target.
pub async fn run(app: Arc<App>) {
    loop {
        { let c = app.crash.lock().await; let _ = c.tx.send(c.snapshot().to_string()); }
        tokio::time::sleep(Duration::from_millis(BET_MS)).await;
        let (bust_ms, tx) = {
            let mut c = app.crash.lock().await;
            c.phase = Phase::Running; c.started = Instant::now();
            let _ = c.tx.send(json!({ "t": "crash_start", "round": c.round, "commitment": c.commitment }).to_string());
            (ms_for(c.bust), c.tx.clone())
        };
        // tick: process auto cash-outs
        let t0 = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let mut c = app.crash.lock().await;
            let m = c.now_mult();
            let mut payouts = vec![]; let bust = c.bust;
            for (tok, b) in c.bets.iter_mut() {
                if b.out.is_none() { if let Some(a) = b.auto { if a <= m && a < bust { b.out = Some(a); payouts.push((tok.clone(), b.stake * a / 100, b.anon.clone(), a)); } } }
            }
            let round = c.round; drop(c);
            for (tok, amt, anon, a) in payouts {
                let bal = Some(app.ledger.lock().await.crash_cash(&tok, amt, round));
                let _ = tx.send(json!({ "t": "crash_out", "anon": anon, "mult": a }).to_string());
                app.notify(&tok, json!({ "t": "balance", "balance": bal })).await;
            }
            if t0.elapsed().as_millis() as f64 >= bust_ms { break; }
        }
        let mut c = app.crash.lock().await;
        c.phase = Phase::Busted;
        let _ = c.tx.send(json!({ "t": "crash_bust", "round": c.round, "bust": c.bust, "server_seed": hex::encode(c.seed), "commitment": c.commitment, "client_seed": CRASH_CLIENT_SEED }).to_string());
        let round = c.round; drop(c);
        app.ledger.lock().await.crash_close_round(round);
        tokio::time::sleep(Duration::from_millis(3_000)).await;
        let next = app.ledger.lock().await.next_crash_round();
        app.crash.lock().await.start_round(next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn curve_roundtrip() { for m in [101u64, 150, 200, 1000, 5914] { let t = ms_for(m); assert!((mult_at(t + 1.0) as i64 - m as i64).abs() <= 1, "{m}"); } }
}
