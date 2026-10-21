//! Settlement for single-player house games. Outcomes come only from the fairness crate.
use serde::{Deserialize, Serialize};
use zecasino_fairness::{games, OutcomeStream};

pub const DICE_EDGE_BPS: u64 = 100; // 1%

/// Dice: `target` and roll in hundredths (0..=10000). Returns gross payout in zats.
pub fn dice_payout(roll: u32, target: u32, over: bool, stake: u64) -> Option<u64> {
    if !(200..=9800).contains(&target) { return None; }
    let chance = if over { 10_000 - target } else { target } as u64; // hundredths of %
    let win = if over { roll > target } else { roll < target };
    // payout = stake * 99 / chance%  ==  stake * (10000 - edge) / chance
    Some(if win { stake * (10_000 - DICE_EDGE_BPS) / chance } else { 0 })
}

pub const RED: [u32; 18] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

/// Roulette multiplier (gross, including stake) for one bet key; same keys as the web layout.
pub fn roulette_mult(key: &str, n: u32) -> Option<u64> {
    let red = RED.contains(&n);
    Some(match key {
        k if k.starts_with("n:") => { let v: u32 = k[2..].parse().ok().filter(|v| *v <= 36)?; if v == n { 36 } else { 0 } }
        _ if n == 0 => { if ["red", "black", "even", "odd", "low", "high"].contains(&key) || key.starts_with("doz:") || key.starts_with("col:") { 0 } else { return None } }
        "red" => if red { 2 } else { 0 },
        "black" => if !red { 2 } else { 0 },
        "even" => if n % 2 == 0 { 2 } else { 0 },
        "odd" => if n % 2 == 1 { 2 } else { 0 },
        "low" => if n <= 18 { 2 } else { 0 },
        "high" => if n >= 19 { 2 } else { 0 },
        k if k.starts_with("doz:") => { let d: u32 = k[4..].parse().ok().filter(|d| (1..=3).contains(d))?; if n.div_ceil(12) == d { 3 } else { 0 } }
        k if k.starts_with("col:") => { let c: u32 = k[4..].parse().ok().filter(|c| (1..=3).contains(c))?; if (n - 1) % 3 + 1 == c { 3 } else { 0 } }
        _ => return None,
    })
}

// ---------------- Blackjack ----------------
pub fn bj_value(cards: &[u8]) -> (u32, bool) {
    let (mut t, mut aces) = (0u32, 0);
    for &c in cards { let r = (c % 13) as u32; if r == 0 { aces += 1; t += 11 } else { t += (r + 1).min(10) } }
    while t > 21 && aces > 0 { t -= 10; aces -= 1; }
    (t, aces > 0)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hand { pub nonce: u64, pub shoe: Vec<u8>, pub pos: usize, pub player: Vec<u8>, pub dealer: Vec<u8>, pub stake: u64, pub done: bool }

#[derive(Serialize, Debug)]
pub struct HandView { pub nonce: u64, pub player: Vec<u8>, pub dealer: Vec<u8>, pub hole_hidden: bool, pub done: bool, pub payout: u64, pub stake: u64, pub message: Option<String> }

impl Hand {
    /// A fresh 6-deck shoe per hand, fully determined by (seed, client seed, nonce): verifiable after reveal.
    pub fn deal(mut s: OutcomeStream, nonce: u64, stake: u64) -> Self {
        let shoe = games::shoe(&mut s, 6);
        let mut h = Self { nonce, shoe, pos: 0, player: vec![], dealer: vec![], stake, done: false };
        let (a, b, c, d) = (h.draw(), h.draw(), h.draw(), h.draw());
        h.player = vec![a, c]; h.dealer = vec![b, d];
        h
    }
    fn draw(&mut self) -> u8 { let c = self.shoe[self.pos]; self.pos += 1; c }
    pub fn natural(&self) -> bool { self.player.len() == 2 && bj_value(&self.player).0 == 21 }
    pub fn hit(&mut self) { if !self.done { let c = self.draw(); self.player.push(c); } }
    pub fn double(&mut self) -> bool { if self.done || self.player.len() != 2 { return false; } self.stake *= 2; self.hit(); true }
    pub fn dealer_play(&mut self) { while bj_value(&self.dealer).0 < 17 { let c = self.draw(); self.dealer.push(c); } }
    /// Settles: returns (gross payout, message). Dealer stands on all 17s; blackjack pays 3:2.
    pub fn settle(&mut self) -> (u64, &'static str) {
        self.done = true;
        let (pv, _) = bj_value(&self.player);
        if pv > 21 { return (0, "Bust."); }
        let dealer_bj = self.dealer.len() == 2 && bj_value(&self.dealer).0 == 21;
        if self.natural() && !dealer_bj { return (self.stake * 5 / 2, "Blackjack! Pays 3 to 2."); }
        self.dealer_play();
        let dv = bj_value(&self.dealer).0;
        if dealer_bj && !self.natural() { (0, "Dealer has blackjack.") }
        else if dv > 21 { (self.stake * 2, "Dealer busts. You win.") }
        else if pv > dv { (self.stake * 2, "You win.") }
        else if pv == dv { (self.stake, "Push.") }
        else { (0, "Dealer wins.") }
    }
    pub fn view(&self, payout: u64, message: Option<String>) -> HandView {
        HandView { nonce: self.nonce, player: self.player.clone(), dealer: if self.done { self.dealer.clone() } else { vec![self.dealer[0]] }, hole_hidden: !self.done, done: self.done, payout, stake: self.stake, message }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn dice_math() {
        assert_eq!(dice_payout(5051, 5050, true, 1_000_000), Some(2_000_000));
        assert_eq!(dice_payout(5050, 5050, true, 1_000_000), Some(0));
        assert_eq!(dice_payout(100, 9800, true, 1), Some(0));
        assert_eq!(dice_payout(0, 100, true, 1), None);
    }
    #[test] fn roulette_keys() {
        assert_eq!(roulette_mult("n:17", 17), Some(36));
        assert_eq!(roulette_mult("red", 0), Some(0));
        assert_eq!(roulette_mult("red", 1), Some(2));
        assert_eq!(roulette_mult("doz:2", 13), Some(3));
        assert_eq!(roulette_mult("col:1", 34), Some(3));
        assert_eq!(roulette_mult("n:37", 1), None);
        assert_eq!(roulette_mult("bogus", 1), None);
    }
    #[test] fn bj_values() {
        assert_eq!(bj_value(&[0, 12]).0, 21); // A K
        assert_eq!(bj_value(&[0, 0, 8]).0, 21); // A A 9
        assert_eq!(bj_value(&[12, 11, 1]).0, 22);
    }
    #[test] fn bj_hand_is_reproducible() {
        let a = Hand::deal(OutcomeStream::new([3; 32], "c", 9), 9, 100);
        let b = Hand::deal(OutcomeStream::new([3; 32], "c", 9), 9, 100);
        assert_eq!(a.player, b.player); assert_eq!(a.dealer, b.dealer);
        let mut h = a; let (p, _) = h.settle(); assert!(p <= 250); assert!(h.done);
    }
}
