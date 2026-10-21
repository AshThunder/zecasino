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

/// One player hand. A split makes two.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PHand { pub cards: Vec<u8>, pub stake: u64, pub done: bool }

/// A blackjack round. `draws` records where every card off the shoe went (hand index, or -1 for the
/// dealer), in order, so the browser can check after the seed reveal that each card is the next
/// card of the committed shoe and that the dealer followed the stand-on-17 rule.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hand { pub nonce: u64, pub shoe: Vec<u8>, pub pos: usize, pub hands: Vec<PHand>, pub active: usize, pub dealer: Vec<u8>, pub done: bool, pub draws: Vec<(i8, u8)> }

#[derive(Serialize, Debug)]
pub struct HandView {
    pub nonce: u64, pub player: Vec<u8>, pub dealer: Vec<u8>, pub hole_hidden: bool, pub done: bool, pub payout: u64, pub stake: u64, pub message: Option<String>,
    pub hands: Vec<PHand>, pub active: usize, pub can_split: bool, pub can_double: bool, pub draws: Option<Vec<(i8, u8)>>,
}

/// `draws` marker for a split (not a card off the shoe).
pub const SPLIT: i8 = -2;

pub fn card_value(c: u8) -> u8 { let r = c % 13; if r == 0 { 11 } else { (r + 1).min(10) } }

impl Hand {
    /// A fresh 6-deck shoe per hand, fully determined by (seed, client seed, nonce): verifiable after reveal.
    pub fn deal(mut s: OutcomeStream, nonce: u64, stake: u64) -> Self {
        let shoe = games::shoe(&mut s, 6);
        let mut h = Self { nonce, shoe, pos: 0, hands: vec![PHand { cards: vec![], stake, done: false }], active: 0, dealer: vec![], done: false, draws: vec![] };
        h.draw_to(0); h.draw_to(-1); h.draw_to(0); h.draw_to(-1);
        h
    }
    fn draw_to(&mut self, t: i8) { let c = self.shoe[self.pos]; self.pos += 1; self.draws.push((t, c)); if t < 0 { self.dealer.push(c) } else { self.hands[t as usize].cards.push(c) } }
    pub fn stake(&self) -> u64 { self.hands.iter().map(|h| h.stake).sum() }
    pub fn player(&self) -> &[u8] { &self.hands[self.active.min(self.hands.len() - 1)].cards }
    pub fn natural(&self) -> bool { self.hands.len() == 1 && self.hands[0].cards.len() == 2 && bj_value(&self.hands[0].cards).0 == 21 }
    pub fn can_split(&self) -> bool { !self.done && self.hands.len() == 1 && self.hands[0].cards.len() == 2 && card_value(self.hands[0].cards[0]) == card_value(self.hands[0].cards[1]) }
    pub fn can_double(&self) -> bool { !self.done && self.player().len() == 2 }
    /// Moves to the next unfinished hand; returns true when every player hand is finished.
    fn advance(&mut self) -> bool {
        while self.active < self.hands.len() && self.hands[self.active].done { self.active += 1; }
        self.active >= self.hands.len()
    }
    fn close_active(&mut self) -> bool { let a = self.active; self.hands[a].done = true; self.advance() }
    /// Returns true when the player is finished with every hand (time to settle).
    pub fn hit(&mut self) -> bool {
        if self.done { return true; }
        let a = self.active; self.draw_to(a as i8);
        if bj_value(&self.hands[a].cards).0 >= 21 { self.close_active() } else { false }
    }
    pub fn stand(&mut self) -> bool { if self.done { return true; } self.close_active() }
    pub fn double(&mut self) -> Option<bool> {
        if !self.can_double() { return None; }
        let a = self.active; self.hands[a].stake *= 2; self.draw_to(a as i8); Some(self.close_active())
    }
    /// Splits a pair into two hands of the same stake; each gets one new card. Split aces get one card only.
    pub fn split(&mut self) -> Option<bool> {
        if !self.can_split() { return None; }
        let c = self.hands[0].cards.pop().unwrap(); let stake = self.hands[0].stake;
        self.hands.push(PHand { cards: vec![c], stake, done: false });
        self.draws.push((SPLIT, 0)); // marker: hand 0's second card moves to hand 1 here
        self.draw_to(0); self.draw_to(1);
        if self.hands[0].cards[0] % 13 == 0 { self.hands[0].done = true; self.hands[1].done = true; }
        for i in 0..2 { if bj_value(&self.hands[i].cards).0 == 21 { self.hands[i].done = true; } }
        self.active = 0; Some(self.advance())
    }
    pub fn dealer_play(&mut self) { while bj_value(&self.dealer).0 < 17 { self.draw_to(-1); } }
    /// Settles every hand: returns (gross payout, message). Dealer stands on all 17s; blackjack pays 3:2
    /// (a 21 on a split hand is not blackjack). The dealer only draws if some hand is still live.
    pub fn settle(&mut self) -> (u64, &'static str) {
        self.done = true;
        let dealer_bj = self.dealer.len() == 2 && bj_value(&self.dealer).0 == 21;
        if self.natural() && !dealer_bj { return (self.hands[0].stake * 5 / 2, "Blackjack! Pays 3 to 2."); }
        if self.hands.iter().any(|h| bj_value(&h.cards).0 <= 21) && !dealer_bj { self.dealer_play(); }
        let dv = bj_value(&self.dealer).0;
        let mut pay = 0; let mut wins = 0; let mut pushes = 0;
        for h in &self.hands {
            let pv = bj_value(&h.cards).0;
            let p = if pv > 21 { 0 } else if dealer_bj && !self.natural() { 0 } else if dv > 21 || pv > dv { h.stake * 2 } else if pv == dv { h.stake } else { 0 };
            if p > h.stake { wins += 1 } else if p == h.stake { pushes += 1 }
            pay += p;
        }
        let msg = if self.hands.len() > 1 {
            match (wins, pushes) { (2, _) => "Both hands win.", (1, 1) => "One hand wins, one pushes.", (1, 0) => "One hand wins, one loses.", (0, 2) => "Both hands push.", (0, 1) => "One hand pushes, one loses.", _ => "Both hands lose." }
        } else {
            let pv = bj_value(&self.hands[0].cards).0;
            if pv > 21 { "Bust." } else if dealer_bj { "Dealer has blackjack." } else if dv > 21 { "Dealer busts. You win." } else if pv > dv { "You win." } else if pv == dv { "Push." } else { "Dealer wins." }
        };
        (pay, msg)
    }
    pub fn view(&self, payout: u64, message: Option<String>) -> HandView {
        HandView { nonce: self.nonce, player: self.player().to_vec(), dealer: if self.done { self.dealer.clone() } else { vec![self.dealer[0]] }, hole_hidden: !self.done, done: self.done, payout, stake: self.stake(), message,
            hands: self.hands.clone(), active: self.active.min(self.hands.len() - 1), can_split: self.can_split(), can_double: self.can_double(), draws: self.done.then(|| self.draws.clone()) }
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
        assert_eq!(a.hands[0].cards, b.hands[0].cards); assert_eq!(a.dealer, b.dealer);
        let mut h = a; let (p, _) = h.settle(); assert!(p <= 250); assert!(h.done);
    }

    fn find_pair() -> Hand {
        for n in 0..5000 { let h = Hand::deal(OutcomeStream::new([7; 32], "c", n), n, 100); if h.can_split() && h.hands[0].cards[0] % 13 != 0 && !h.natural() { return h; } }
        panic!("no pair");
    }
    #[test] fn split_plays_two_hands_and_records_draws() {
        let mut h = find_pair();
        let shoe = h.shoe.clone();
        let mut fin = h.split().unwrap();
        assert_eq!(h.hands.len(), 2); assert_eq!(h.stake(), 200);
        while !fin { fin = h.stand(); }
        let (pay, _) = h.settle();
        assert!(pay <= 400);
        // replaying `draws` against the shoe rebuilds exactly the hands the player saw
        let (mut hands, mut dealer, mut i) = (vec![vec![]], vec![], 0usize);
        for &(t, _) in &h.draws {
            if t == SPLIT { let c = hands[0].pop().unwrap(); hands.push(vec![c]); continue; }
            let c = shoe[i]; i += 1;
            if t < 0 { dealer.push(c) } else { hands[t as usize].push(c) }
        }
        assert_eq!(hands, h.hands.iter().map(|x| x.cards.clone()).collect::<Vec<_>>());
        assert_eq!(dealer, h.dealer);
        assert!(h.split().is_none(), "no re-split");
    }
    #[test] fn double_lands_one_card_and_doubles_stake() {
        let mut h = Hand::deal(OutcomeStream::new([1; 32], "c", 3), 3, 100);
        assert!(h.double().unwrap()); assert_eq!(h.hands[0].cards.len(), 3); assert_eq!(h.stake(), 200);
    }
}
