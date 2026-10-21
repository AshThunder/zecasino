//! Prints cross-language test vectors consumed by apps/web/scripts/verify-vectors.mjs
use zecasino_fairness::{games, OutcomeStream, commit_server_seed};
fn main() {
    let seed = [5u8; 32];
    let mut out = vec![format!("\"commit\":\"{}\"", commit_server_seed(&seed))];
    let d: Vec<String> = (0..20).map(|n| games::dice(&mut OutcomeStream::new(seed, "t", n)).to_string()).collect();
    let c: Vec<String> = (0..20).map(|n| games::crash(&mut OutcomeStream::new(seed, "t", n)).to_string()).collect();
    let r: Vec<String> = (0..20).map(|n| games::roulette(&mut OutcomeStream::new(seed, "t", n)).to_string()).collect();
    let s: Vec<String> = games::shoe(&mut OutcomeStream::new(seed, "t", 0), 6)[..20].iter().map(|x| x.to_string()).collect();
    out.push(format!("\"dice\":[{}]", d.join(","))); out.push(format!("\"crash\":[{}]", c.join(",")));
    let hs = [u32::MAX, u32::MAX - 1, 4_290_000_001, 4_000_000_001, 12_345, 100];
    out.push(format!("\"crash_points\":[{}]", hs.iter().map(|&h| format!("[{h},{}]", games::crash_point(h))).collect::<Vec<_>>().join(",")));
    out.push(format!("\"roulette\":[{}]", r.join(","))); out.push(format!("\"shoe20\":[{}]", s.join(",")));
    println!("{{{}}}", out.join(","));
}
