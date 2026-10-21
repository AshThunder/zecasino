//! Heads-up no-limit Hold'em with a mental-poker deck.
//!
//! Three parties hold deck keys: both players and the house. The house shuffles first, then each
//! player shuffles with a zero-knowledge shuffle proof the server checks (and forwards so the
//! other player can check too). Hole cards open only in their owner's browser: the server relays
//! the house's and the opponent's decryption shares to the owner, who adds its own share locally.
//! The server learns hole cards only at showdown, when the owner publishes its share.
use std::collections::HashMap;
use serde::Serialize;
use serde_json::{json, Value};
use zecasino_mental_poker as mp;

pub const SB: u64 = 500_000;
pub const BB: u64 = 1_000_000;

// ---------------- hand evaluator (best 5 of 7), same scoring as apps/web/src/lib/poker.ts -------------
const NAMES: [&str; 9] = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];
fn rv(c: u8) -> u8 { if c % 13 == 0 { 14 } else { c % 13 + 1 } }
fn score5(cs: &[u8; 5]) -> Vec<u8> {
    let mut r: Vec<u8> = cs.iter().map(|&c| rv(c)).collect(); r.sort_unstable_by(|a, b| b.cmp(a));
    let flush = cs.iter().all(|c| c / 13 == cs[0] / 13);
    let mut uniq = r.clone(); uniq.dedup();
    let mut sh = 0;
    if uniq.len() == 5 && r[0] - r[4] == 4 { sh = r[0]; }
    if uniq.len() == 5 && r[0] == 14 && r[1] == 5 { sh = 5; }
    let mut groups: Vec<(u8, u8)> = uniq.iter().map(|&v| (r.iter().filter(|&&x| x == v).count() as u8, v)).collect();
    groups.sort_unstable_by(|a, b| b.cmp(a));
    let shape: Vec<u8> = groups.iter().map(|g| g.0).collect();
    let kick: Vec<u8> = groups.iter().map(|g| g.1).collect();
    let with = |cat: u8, v: &[u8]| { let mut o = vec![cat]; o.extend_from_slice(v); o };
    match () {
        _ if sh > 0 && flush => vec![8, sh],
        _ if shape == [4, 1] => with(7, &kick),
        _ if shape == [3, 2] => with(6, &kick),
        _ if flush => with(5, &r),
        _ if sh > 0 => vec![4, sh],
        _ if shape == [3, 1, 1] => with(3, &kick),
        _ if shape == [2, 2, 1] => with(2, &kick),
        _ if shape == [2, 1, 1, 1] => with(1, &kick),
        _ => with(0, &r),
    }
}
pub fn best(cards: &[u8]) -> (Vec<u8>, &'static str) {
    let n = cards.len(); let mut top = vec![];
    for a in 0..n { for b in a + 1..n { for c in b + 1..n { for d in c + 1..n { for e in d + 1..n {
        let s = score5(&[cards[a], cards[b], cards[c], cards[d], cards[e]]); if s > top { top = s; }
    } } } } }
    let name = NAMES[top[0] as usize]; (top, name)
}

// ---------------- betting engine ----------------
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Act { Fold, Check, Call, Raise }

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step { Continue, StreetDone, Folded { winner: usize }, AllInRunout }

#[derive(Clone, Debug, Serialize)]
pub struct Betting {
    pub stacks: [u64; 2], pub street_bet: [u64; 2], pub contrib: [u64; 2], pub button: usize,
    pub street: u8, pub to_act: usize, pub min_raise: u64, acted: [bool; 2],
}

impl Betting {
    /// Heads-up: the button posts the small blind and acts first pre-flop, last after.
    pub fn new(stacks: [u64; 2], button: usize) -> Self {
        let mut b = Self { stacks, street_bet: [0; 2], contrib: [0; 2], button, street: 0, to_act: button, min_raise: BB, acted: [false; 2] };
        b.put(button, SB.min(stacks[button])); b.put(1 - button, BB.min(stacks[1 - button]));
        b
    }
    fn put(&mut self, s: usize, amt: u64) { self.stacks[s] -= amt; self.street_bet[s] += amt; self.contrib[s] += amt; }
    pub fn pot(&self) -> u64 { self.contrib[0] + self.contrib[1] }
    pub fn to_call(&self, s: usize) -> u64 { self.street_bet[1 - s].saturating_sub(self.street_bet[s]).min(self.stacks[s]) }
    pub fn min_raise_to(&self, s: usize) -> u64 { (self.street_bet[1 - s] + self.min_raise).min(self.street_bet[s] + self.stacks[s]) }
    pub fn max_raise_to(&self, s: usize) -> u64 { self.street_bet[s] + self.stacks[s] }
    pub fn legal(&self, s: usize) -> Value {
        let tc = self.to_call(s); let can_raise = self.stacks[s] > tc && self.stacks[1 - s] > 0;
        json!({ "fold": tc > 0, "check": tc == 0, "call": tc, "raise": can_raise.then(|| json!({ "min": self.min_raise_to(s), "max": self.max_raise_to(s) })) })
    }
    pub fn act(&mut self, s: usize, a: Act, raise_to: u64) -> Result<Step, &'static str> {
        if s != self.to_act { return Err("not your turn"); }
        let o = 1 - s;
        match a {
            Act::Fold => { if self.to_call(s) == 0 { return Err("check instead of folding"); } return Ok(Step::Folded { winner: o }); }
            Act::Check => { if self.to_call(s) != 0 { return Err("cannot check facing a bet"); } }
            Act::Call => { let c = self.to_call(s); if c == 0 { return Err("nothing to call"); } self.put(s, c); }
            Act::Raise => {
                let (lo, hi) = (self.min_raise_to(s), self.max_raise_to(s));
                if self.stacks[s] <= self.to_call(s) || self.stacks[o] == 0 { return Err("cannot raise"); }
                if raise_to < lo || raise_to > hi { return Err("raise out of range"); }
                let inc = raise_to - self.street_bet[o];
                if raise_to - self.street_bet[s] > 0 { let add = raise_to - self.street_bet[s]; self.put(s, add); }
                if inc >= self.min_raise { self.min_raise = inc; }
                self.acted[o] = false;
            }
        }
        self.acted[s] = true;
        let even = self.street_bet[0] == self.street_bet[1] || self.stacks[0] == 0 || self.stacks[1] == 0;
        if self.acted[0] && self.acted[1] && even || (even && (self.stacks[0] == 0 || self.stacks[1] == 0) && self.acted[s] && self.to_call(o) == 0 && (self.acted[o] || self.stacks[o] == 0)) {
            if self.stacks[0] == 0 || self.stacks[1] == 0 { return Ok(Step::AllInRunout); }
            if self.street == 3 { return Ok(Step::StreetDone); }
            self.street += 1; self.street_bet = [0; 2]; self.acted = [false; 2]; self.min_raise = BB; self.to_act = 1 - self.button;
            return Ok(Step::StreetDone);
        }
        self.to_act = o;
        Ok(Step::Continue)
    }
    /// Returns per-seat payouts (gross, before rake) for a showdown given `cmp` = sign(hand0 - hand1).
    pub fn showdown(&self, cmp: std::cmp::Ordering) -> [u64; 2] {
        let eff = self.contrib[0].min(self.contrib[1]);
        let mut pay = [self.contrib[0] - eff + self.stacks[0], self.contrib[1] - eff + self.stacks[1]];
        let pot = 2 * eff;
        match cmp { std::cmp::Ordering::Greater => pay[0] += pot, std::cmp::Ordering::Less => pay[1] += pot,
            std::cmp::Ordering::Equal => { pay[0] += pot / 2; pay[1] += pot - pot / 2; } }
        pay
    }
}

// ---------------- deck positions ----------------
/// Heads-up deal: seat 0 gets 0 and 2, seat 1 gets 1 and 3; burn 4, flop 5-7, burn 8, turn 9, burn 10, river 11.
pub fn hole_positions(seat: usize) -> [usize; 2] { [seat, seat + 2] }
pub fn board_positions(street: u8) -> &'static [usize] { match street { 1 => &[5, 6, 7], 2 => &[9], 3 => &[11], _ => &[] } }

// ---------------- protocol state for one hand ----------------
pub const HOUSE: usize = 2;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase { Keys, Shuffle(usize), HoleShares, Betting, Board, Showdown, Done }

pub struct Hand {
    pub no: u64, pub phase: Phase, pub house_sk: mp::SecretKey, pub pks: [Option<mp::PublicKey>; 3], pub joint: Option<curve25519_dalek::ristretto::RistrettoPoint>,
    pub deck: Vec<mp::Masked>, pub shares: HashMap<usize, [Option<mp::Share>; 3]>, pub betting: Betting, pub board: Vec<u8>, pub log: Vec<String>,
    pub pending: Vec<(usize, Vec<usize>)>, pub hole: [Option<[u8; 2]>; 2], pub runout: bool,
}

impl Hand {
    pub fn new(no: u64, stacks: [u64; 2], button: usize) -> Self {
        Self { no, phase: Phase::Keys, house_sk: mp::SecretKey::generate(), pks: [None, None, None], joint: None, deck: mp::open_deck(),
            shares: HashMap::new(), betting: Betting::new(stacks, button), board: vec![], log: vec![], pending: vec![], hole: [None, None], runout: false }
    }
    pub fn add_share(&mut self, party: usize, pos: usize, s: mp::Share) -> Result<(), &'static str> {
        let pk = self.pks[party].as_ref().ok_or("no key")?;
        let card = self.deck.get(pos).ok_or("bad position")?;
        mp::verify_share(pk, card, &s).map_err(|_| "share proof failed")?;
        self.shares.entry(pos).or_insert([None, None, None])[party] = Some(s);
        Ok(())
    }
    pub fn house_share(&mut self, pos: usize) { let s = self.house_sk.share(&self.deck[pos]); self.shares.entry(pos).or_insert([None, None, None])[HOUSE] = Some(s); }
    pub fn open(&self, pos: usize) -> Option<u8> {
        let s = self.shares.get(&pos)?; let all: Option<Vec<mp::Share>> = s.iter().cloned().collect();
        mp::unmask(&self.deck[pos], &all?).ok().map(|c| c as u8)
    }
    pub fn shares_json(&self, pos: usize, parties: &[usize]) -> Value {
        json!(parties.iter().filter_map(|&p| self.shares.get(&pos).and_then(|s| s[p])).collect::<Vec<_>>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;
    #[test] fn evaluator() {
        // A♣ K♣ Q♣ J♣ 10♣ (royal) beats four aces
        let royal = [0, 12, 11, 10, 9, 20, 30]; let quads = [0, 13, 26, 39, 5, 6, 7];
        assert!(best(&royal).0 > best(&quads).0); assert_eq!(best(&royal).1, "Straight flush");
        assert_eq!(best(&[0, 1, 2, 3, 4, 20, 30]).1, "Straight flush"); // wheel A-5 clubs
        assert_eq!(best(&[0, 13, 1, 14, 30, 45, 9]).1, "Two pair");
        assert_eq!(best(&[0, 14, 2, 16, 30, 45, 9]).1, "Straight"); // A-2-3-4-5 wheel
    }
    #[test] fn preflop_call_check_and_streets() {
        let mut b = Betting::new([10 * BB, 10 * BB], 0);
        assert_eq!(b.to_act, 0); assert_eq!(b.pot(), SB + BB);
        assert_eq!(b.act(0, Act::Call, 0), Ok(Step::Continue));
        assert_eq!(b.act(1, Act::Check, 0), Ok(Step::StreetDone));
        assert_eq!((b.street, b.to_act), (1, 1)); // BB acts first post-flop
        assert_eq!(b.act(0, Act::Check, 0), Err("not your turn"));
        b.act(1, Act::Raise, 3 * BB).unwrap();
        assert_eq!(b.act(0, Act::Raise, 4 * BB), Err("raise out of range")); // min re-raise is to 6BB
        b.act(0, Act::Raise, 6 * BB).unwrap();
        assert_eq!(b.act(1, Act::Call, 0), Ok(Step::StreetDone));
        assert_eq!(b.pot(), 2 * BB + 12 * BB);
    }
    #[test] fn fold_and_allin_side_refund() {
        let mut b = Betting::new([10 * BB, 4 * BB], 0);
        b.act(0, Act::Raise, 10 * BB).unwrap(); // shove
        assert_eq!(b.act(1, Act::Call, 0), Ok(Step::AllInRunout));
        let pay = b.showdown(Ordering::Less); // short stack wins
        assert_eq!(pay, [6 * BB, 8 * BB]);
        let mut c = Betting::new([10 * BB, 10 * BB], 1);
        assert_eq!(c.act(1, Act::Fold, 0), Ok(Step::Folded { winner: 0 }));
    }
    #[test] fn full_protocol_hand_three_parties() {
        let mut h = Hand::new(1, [10 * BB; 2], 0);
        let p: Vec<mp::SecretKey> = (0..2).map(|_| mp::SecretKey::generate()).collect();
        h.pks = [Some(p[0].public()), Some(p[1].public()), Some(h.house_sk.public())];
        let joint = mp::joint_key(&h.pks.iter().map(|k| k.clone().unwrap()).collect::<Vec<_>>()).unwrap();
        for _ in 0..3 { let (o, pf) = mp::shuffle(&h.deck, &joint); mp::verify_shuffle(&h.deck, &o, &joint, &pf).unwrap(); h.deck = o; }
        // seat 0's hole card at position 0: house + seat 1 shares to the owner, owner adds its own
        h.house_share(0); let s1 = p[1].share(&h.deck[0]); h.add_share(1, 0, s1).unwrap();
        assert_eq!(h.open(0), None, "server cannot open a hole card with two of three shares");
        let own = p[0].share(&h.deck[0]);
        let mut sh: Vec<mp::Share> = serde_json::from_value(h.shares_json(0, &[1, HOUSE])).unwrap(); sh.push(own);
        let c = mp::unmask(&h.deck[0], &sh).unwrap();
        h.add_share(0, 0, own).unwrap(); assert_eq!(h.open(0), Some(c as u8));
        assert_eq!(h.add_share(0, 1, p[1].share(&h.deck[1])), Err("share proof failed"));
    }
}
