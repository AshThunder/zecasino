//! The house as a PvP opponent ("House player"). Always labelled as the casino, never as a person.
//!
//! What it may know is exactly what a human in its seat would know:
//! - Carrot in a Box, house = guesser: its keep/swap decision is a coin flip committed (SHA-256 commit, same
//!   scheme as the box) at the start of the round, before the holder peeks or speaks, and opened at the end.
//! - Carrot in a Box, house = holder: it sees its own box (holders always do) and says one of the four lines at random.
//! - Liar's Dice: every house move is a pure function of the house's own dice and the public bid
//!   (`liars_move` below, mirrored in apps/web/src/lib/housePolicy.ts). The dice are sealed before the first bid and
//!   opened at the end, so any browser can replay the house's moves and confirm they never used the player's dice.
//! - Hold'em: the house player is a third mental-poker seat with its own keys. It cannot open the player's hole
//!   cards without the player's own share (cryptographically, not by policy). It plays check/call/fold from its
//!   own two cards and the public pot.
//! Money: the house's side of the pot comes from the house bankroll (house P&L), never from a player session, so
//! liabilities stay the sum of player balances and the ledger rake/P&L entries stay exact.
use std::sync::Arc;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use zecasino_mental_poker as mp;
use crate::App;

pub const HOUSE_ANON: &str = "house";
pub fn is_house(tok: &str) -> bool { tok.starts_with("house:") }
pub fn house_player() -> crate::pvp::Player { crate::pvp::Player { token: format!("house:{}", crate::rid()), anon: HOUSE_ANON.into() } }

/// Liar's Dice house move from its own five dice and the standing bid only. `None` means "call liar".
/// Expected count of a face = own matches + unknown dice / 3 (faces are not wild). Call if the standing bid
/// is above that by more than one die; otherwise bid the cheapest legal raise on the face it holds most of.
pub fn liars_move(own: &[u8; 5], bid: Option<(u8, u8)>, total: u8) -> Option<(u8, u8)> {
    let unknown = total as f64 - 5.0;
    let have = |f: u8| own.iter().filter(|&&d| d == f).count() as u8;
    let expect = |f: u8| have(f) as f64 + unknown / 3.0;
    // best face: most copies, ties to the higher face
    let best = (1..=6u8).max_by_key(|&f| (have(f), f)).unwrap();
    match bid {
        None => Some((have(best).max(1), best)),
        Some((q, f)) => {
            if q as f64 > expect(f) + 1.0 { return None; }
            let (nq, nf) = if best > f { (q, best) } else { (q + 1, best) };
            if nq > total || nq as f64 > expect(nf) + 1.0 { None } else { Some((nq, nf)) }
        }
    }
}

/// Hold'em house seat: a virtual connection that speaks the same protocol as a browser.
pub async fn holdem_bot(app: Arc<App>, tok: String, mut rx: mpsc::UnboundedReceiver<String>) {
    let mut sk = mp::SecretKey::generate(); let mut pks: Vec<mp::PublicKey> = vec![]; let mut deck: Vec<mp::Masked> = vec![]; let mut hole: Vec<usize> = vec![];
    let mut room = String::new();
    while let Some(s) = rx.recv().await {
        let Ok(m) = serde_json::from_str::<Value>(&s) else { continue };
        let send = |t: &str, mut body: Value| { body["t"] = json!(t); body["room"] = json!(room.clone()); body };
        let reply: Option<Value> = match m["t"].as_str().unwrap_or("") {
            "hm_seated" => { room = m["room"].as_str().unwrap_or("").into(); None }
            "hm_key_req" => { sk = mp::SecretKey::generate(); hole.clear(); Some(send("hm_key", json!({ "pk": sk.public() }))) }
            "hm_keys" => { pks = serde_json::from_value(m["pks"].clone()).unwrap_or_default(); None }
            "hm_shuffle_req" => {
                let d: Vec<mp::Masked> = serde_json::from_value(m["deck"].clone()).unwrap_or_default();
                let Ok(j) = mp::joint_key(&pks) else { continue };
                let (o, pf) = tokio::task::spawn_blocking(move || mp::shuffle(&d, &j)).await.unwrap();
                Some(send("hm_shuffle", json!({ "deck": o, "proof": pf })))
            }
            "hm_deck" => { deck = serde_json::from_value(m["deck"].clone()).unwrap_or_default(); None }
            "hm_share_req" => {
                let shares: serde_json::Map<String, Value> = m["positions"].as_array().into_iter().flatten().filter_map(|p| p.as_u64()).filter_map(|p| deck.get(p as usize).map(|c| (p.to_string(), json!(sk.share(c))))).collect();
                Some(send("hm_shares", json!({ "shares": shares })))
            }
            "hm_hole" => {
                for p in m["positions"].as_array().into_iter().flatten().filter_map(|p| p.as_u64()) {
                    let Ok(mut sh) = serde_json::from_value::<Vec<mp::Share>>(m["shares"][p.to_string()].clone()) else { continue };
                    if let Some(c) = deck.get(p as usize) { sh.push(sk.share(c)); if let Ok(card) = mp::unmask(c, &sh) { hole.push(card); } }
                }
                None
            }
            "hm_state" => {
                let Some(l) = m.get("legal").filter(|l| !l.is_null()) else { continue };
                tokio::time::sleep(std::time::Duration::from_millis(900)).await;
                let ranks: Vec<usize> = hole.iter().map(|c| c % 13).collect();
                let strong = ranks.len() == 2 && (ranks[0] == ranks[1] || ranks.iter().any(|&r| r == 0));
                let call = l["call"].as_u64().unwrap_or(0); let pot = m["pot"].as_u64().unwrap_or(0);
                let a = if l["check"].as_bool().unwrap_or(false) { "check" } else if strong || call * 2 <= pot { "call" } else { "fold" };
                Some(send("hm_act", json!({ "action": a })))
            }
            "hm_closed" => break,
            _ => None,
        };
        if let Some(r) = reply { let t = r["t"].as_str().unwrap_or("").to_owned(); let _ = app.hm_message(&tok, &t, &r).await; }
    }
    app.detach(&tok).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn liars_policy_is_sane() {
        assert_eq!(liars_move(&[3, 3, 1, 2, 5], None, 10), Some((2, 3)));
        assert_eq!(liars_move(&[1, 2, 3, 4, 5], Some((9, 6)), 10), None);
        let m = liars_move(&[6, 6, 6, 1, 2], Some((2, 4)), 10).unwrap(); assert_eq!(m, (2, 6));
    }
}
