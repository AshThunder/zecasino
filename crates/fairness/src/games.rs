//! Outcome derivations for house games. Each is a pure function of an OutcomeStream.
use crate::OutcomeStream;

/// Dice roll 0.00..=100.00 (returned in hundredths).
pub fn dice(s: &mut OutcomeStream) -> u32 { (s.next_f64() * 10_001.0) as u32 }

/// Highest crash point, in hundredths: 1000.00x. Bounds the house's worst case per round.
pub const CRASH_MAX: u64 = 100_000;

/// Crash multiplier in hundredths (100 = 1.00x), 1% house edge, capped at CRASH_MAX.
pub fn crash(s: &mut OutcomeStream) -> u64 { crash_point(s.next_u32()) }

pub fn crash_point(h: u32) -> u64 {
    let h = h as u64;
    if h % 100 == 0 { return 100; }
    let e = 1u64 << 32;
    ((100 * e - h) / (e - h)).clamp(100, CRASH_MAX)
}

/// European roulette pocket 0..=36.
pub fn roulette(s: &mut OutcomeStream) -> u32 { s.next_below(37) }

/// Fisher-Yates shuffled shoe of `decks` decks; cards 0..52 (rank = c % 13, suit = c / 13).
pub fn shoe(s: &mut OutcomeStream, decks: u32) -> Vec<u8> {
    let mut v: Vec<u8> = (0..decks * 52).map(|i| (i % 52) as u8).collect();
    for i in (1..v.len()).rev() { let j = s.next_below(i as u32 + 1) as usize; v.swap(i, j); }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    fn st(n: u64) -> OutcomeStream { OutcomeStream::new([5; 32], "t", n) }
    #[test] fn dice_range() { for n in 0..2000 { assert!(dice(&mut st(n)) <= 10_000); } }
    #[test] fn crash_min_and_edge() {
        let v: Vec<u64> = (0..20_000).map(|n| crash(&mut st(n))).collect();
        assert!(v.iter().all(|&x| x >= 100));
        let p2 = v.iter().filter(|&&x| x >= 200).count() as f64 / v.len() as f64;
        assert!((0.47..0.52).contains(&p2), "P(>=2x)={p2}");
    }
    #[test] fn crash_cap() {
        assert_eq!(crash_point(u32::MAX), CRASH_MAX);
        assert_eq!(crash_point(u32::MAX - 1), CRASH_MAX);
        assert_eq!(crash_point(4_290_000_001), 85_601); // 856.01x: just under the cap, uncapped formula
    }
    #[test] fn roulette_covers_all() {
        let mut seen = [false; 37];
        for n in 0..5000 { seen[roulette(&mut st(n)) as usize] = true; }
        assert!(seen.iter().all(|&b| b));
    }
    #[test] fn shoe_is_permutation() {
        let mut v = shoe(&mut st(0), 6); assert_eq!(v.len(), 312);
        v.sort(); let mut e: Vec<u8> = (0..312).map(|i| (i % 52) as u8).collect(); e.sort();
        assert_eq!(v, e);
        assert_ne!(shoe(&mut st(0), 6), shoe(&mut st(1), 6));
    }
}
