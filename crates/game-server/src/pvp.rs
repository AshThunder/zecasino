//! Player-vs-player rooms. The server deals hidden information, commits to it with
//! fairness::commit before anyone acts, and opens every commitment at the end so both
//! browsers can check it. Stakes are escrowed in the ledger; winner takes the pot less rake.
use serde_json::{json, Value};
use rand::Rng;
use zecasino_fairness::commit::{self, Commitment, Opening};

pub const RAKE_BPS: u64 = 200;
pub fn pot_after_rake(pot: u64) -> u64 { pot - pot * RAKE_BPS / 10_000 }

#[derive(Clone)]
pub struct Player { pub token: String, pub anon: String }

// ---------- Carrot in a Box ----------
pub struct Carrot { pub holder: Player, pub guesser: Player, pub stake: u64, pub in_holder: bool, pub c: Commitment, pub o: Opening, pub done: bool }

impl Carrot {
    pub fn new(a: Player, b: Player, stake: u64) -> Self {
        let mut r = rand::rngs::OsRng;
        let (holder, guesser) = if r.gen_bool(0.5) { (a, b) } else { (b, a) };
        let in_holder = r.gen_bool(0.5);
        let (c, o) = commit::commit(if in_holder { b"carrot:holder" } else { b"carrot:guesser" });
        Self { holder, guesser, stake, in_holder, c, o, done: false }
    }
    /// Returns the winner's token. `swap` is the guesser's decision.
    pub fn resolve(&mut self, swap: bool) -> &Player {
        self.done = true;
        let guesser_gets_carrot = self.in_holder == swap;
        if guesser_gets_carrot { &self.guesser } else { &self.holder }
    }
    pub fn opening(&self) -> Value { json!({ "commitment": self.c.0, "value": String::from_utf8_lossy(&self.o.value), "salt": self.o.salt }) }
}

// ---------- Liar's Dice (heads-up or more) ----------
pub struct Liars { pub players: Vec<Player>, pub dice: Vec<[u8; 5]>, pub commits: Vec<(Commitment, Opening)>, pub stake: u64, pub turn: usize, pub bid: Option<(u8, u8, usize)>, pub done: bool }

#[derive(Debug, PartialEq, Eq)]
pub enum BidError { NotYourTurn, NotHigher, Invalid, Over }

impl Liars {
    pub fn new(players: Vec<Player>, stake: u64) -> Self {
        let mut r = rand::rngs::OsRng;
        let dice: Vec<[u8; 5]> = players.iter().map(|_| std::array::from_fn(|_| r.gen_range(1..=6))).collect();
        let commits = dice.iter().map(|d| commit::commit(d)).collect();
        Self { players, dice, commits, stake, turn: 0, bid: None, done: false }
    }
    pub fn bid(&mut self, who: usize, q: u8, f: u8) -> Result<(), BidError> {
        if self.done { return Err(BidError::Over); }
        if who != self.turn { return Err(BidError::NotYourTurn); }
        let total = (self.players.len() * 5) as u8;
        if !(1..=6).contains(&f) || q == 0 || q > total { return Err(BidError::Invalid); }
        if let Some((bq, bf, _)) = self.bid { if !(q > bq || (q == bq && f > bf)) { return Err(BidError::NotHigher); } }
        self.bid = Some((q, f, who)); self.turn = (who + 1) % self.players.len();
        Ok(())
    }
    /// Caller challenges the standing bid. Returns (winner index, actual count).
    pub fn call(&mut self, who: usize) -> Result<(usize, u8), BidError> {
        if self.done { return Err(BidError::Over); }
        if who != self.turn { return Err(BidError::NotYourTurn); }
        let (q, f, bidder) = self.bid.ok_or(BidError::Invalid)?;
        let count = self.dice.iter().flatten().filter(|&&d| d == f).count() as u8;
        self.done = true;
        Ok((if count >= q { bidder } else { who }, count))
    }
    pub fn openings(&self) -> Value {
        json!(self.commits.iter().zip(&self.players).map(|((c, o), p)| json!({ "anon": p.anon, "commitment": c.0, "dice": o.value, "salt": o.salt })).collect::<Vec<_>>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(n: &str) -> Player { Player { token: n.into(), anon: n.into() } }
    #[test] fn carrot_commitment_opens_and_resolves() {
        for _ in 0..50 {
            let mut g = Carrot::new(p("a"), p("b"), 100);
            assert!(commit::verify(&g.c, &g.o));
            let in_holder = g.in_holder; let holder = g.holder.token.clone();
            let w = g.resolve(false).token.clone();
            assert_eq!(w == holder, in_holder);
        }
    }
    #[test] fn liars_rules() {
        let mut g = Liars::new(vec![p("a"), p("b")], 100);
        assert_eq!(g.call(0), Err(BidError::Invalid));
        g.bid(0, 2, 3).unwrap();
        assert_eq!(g.bid(0, 3, 3), Err(BidError::NotYourTurn));
        assert_eq!(g.bid(1, 2, 2), Err(BidError::NotHigher));
        g.bid(1, 2, 5).unwrap();
        let (w, n) = g.call(0).unwrap();
        assert_eq!(w == 1, n >= 2);
        for (c, o) in &g.commits { assert!(commit::verify(c, o)); }
        assert_eq!(pot_after_rake(200), 196);
    }
}
