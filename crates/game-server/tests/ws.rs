use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use zecasino_fairness::{commit::{self, Commitment, Opening}, games, verify_server_seed, OutcomeStream};

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn server() -> String {
    let app = zecasino_game_server::App::new(":memory:", true);
    tokio::spawn(zecasino_game_server::crash::run(app.clone()));
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let a = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, zecasino_game_server::router(app)).await.unwrap() });
    format!("ws://{a}/ws")
}
async fn send(w: &mut Ws, v: Value) { w.send(Message::Text(v.to_string().into())).await.unwrap(); }
async fn until(w: &mut Ws, t: &str) -> Value {
    loop {
        let m = tokio::time::timeout(std::time::Duration::from_secs(180), w.next()).await.expect("timeout").unwrap().unwrap();
        if let Message::Text(s) = m { let v: Value = serde_json::from_str(&s).unwrap(); if v["t"] == t { return v; } if v["t"] == "error" { panic!("{v}"); } }
    }
}
async fn until_any(w: &mut Ws) -> Value {
    loop { if let Message::Text(s) = w.next().await.unwrap().unwrap() { return serde_json::from_str(&s).unwrap(); } }
}
async fn client(url: &str, credit: u64) -> (Ws, Value) {
    let (mut w, _) = connect_async(url).await.unwrap();
    send(&mut w, json!({ "t": "hello", "client_seed": "test-seed" })).await;
    let s = until(&mut w, "session").await;
    send(&mut w, json!({ "t": "dev_credit", "amount": credit })).await;
    until(&mut w, "balance").await;
    (w, s)
}

#[tokio::test]
async fn dice_roulette_and_blackjack_verify_after_rotate() {
    let url = server().await;
    let (mut w, s) = client(&url, 10_000_000).await;
    let commitment = s["seat"]["commitment"].as_str().unwrap().to_owned();
    send(&mut w, json!({ "t": "dice", "stake": 100_000, "target": 5050, "over": true })).await;
    let d = until(&mut w, "result").await;
    send(&mut w, json!({ "t": "roulette", "bets": [{ "key": "red", "amount": 100_000 }, { "key": "n:17", "amount": 10_000 }] })).await;
    let r = until(&mut w, "result").await;
    send(&mut w, json!({ "t": "bj_deal", "stake": 100_000 })).await;
    let mut h = until(&mut w, "bj").await;
    if !h["hand"]["done"].as_bool().unwrap() { assert_eq!(h["hand"]["dealer"].as_array().unwrap().len(), 1, "hole card must stay hidden"); send(&mut w, json!({ "t": "bj_stand" })).await; h = until(&mut w, "bj").await; }
    assert!(h["hand"]["done"].as_bool().unwrap());
    send(&mut w, json!({ "t": "rotate", "client_seed": "next" })).await;
    let rev = until(&mut w, "revealed").await["revealed"].clone();
    assert_eq!(rev["commitment"], commitment.as_str());
    let seed = verify_server_seed(rev["server_seed"].as_str().unwrap(), &commitment).unwrap();
    assert_eq!(games::dice(&mut OutcomeStream::new(seed, "test-seed", 0)) as u64, d["outcome"].as_u64().unwrap());
    assert_eq!(games::roulette(&mut OutcomeStream::new(seed, "test-seed", 1)) as u64, r["outcome"].as_u64().unwrap());
    let shoe = games::shoe(&mut OutcomeStream::new(seed, "test-seed", 2), 6);
    let p: Vec<u8> = h["hand"]["player"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect();
    assert_eq!(&p[..2], &[shoe[0], shoe[2]]);
    // ledger is consistent
    send(&mut w, json!({ "t": "balance" })).await;
    let bal = until(&mut w, "balance").await["balance"].as_u64().unwrap();
    let spent = 100_000 + 110_000 + h["hand"]["stake"].as_u64().unwrap();
    let won = d["payout"].as_u64().unwrap() + r["payout"].as_u64().unwrap() + h["hand"]["payout"].as_u64().unwrap();
    assert_eq!(bal, 10_000_000 - spent + won);
}

#[tokio::test]
async fn overdraw_is_rejected() {
    let url = server().await;
    let (mut w, _) = client(&url, 1_000).await;
    send(&mut w, json!({ "t": "dice", "stake": 5_000, "target": 5050, "over": true })).await;
    loop { if let Some(Ok(Message::Text(s))) = w.next().await { let v: Value = serde_json::from_str(&s).unwrap(); if v["t"] == "error" { assert_eq!(v["error"], "insufficient balance"); break; } } }
}

fn opening(v: &Value) -> (Commitment, Opening) {
    let value = match &v["value"] { Value::String(s) => s.as_bytes().to_vec(), _ => v["dice"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect() };
    (Commitment(v["commitment"].as_str().unwrap().into()), Opening { value, salt: v["salt"].as_str().unwrap().into() })
}

#[tokio::test]
async fn carrot_in_a_box_full_round() {
    let url = server().await;
    let (mut a, _) = client(&url, 1_000_000).await;
    let (mut b, _) = client(&url, 1_000_000).await;
    send(&mut a, json!({ "t": "carrot_join", "stake": 100_000 })).await; until(&mut a, "queued").await;
    send(&mut b, json!({ "t": "carrot_join", "stake": 100_000 })).await;
    let sa = until(&mut a, "carrot_start").await; let sb = until(&mut b, "carrot_start").await;
    let (holder, guesser, hs) = if sa["role"] == "holder" { (&mut a, &mut b, sa.clone()) } else { (&mut b, &mut a, sb.clone()) };
    assert!(hs.get("peek").is_some());
    let gs = if sa["role"] == "guesser" { &sa } else { &sb }; assert!(gs.get("peek").is_none(), "guesser must not see the box");
    send(holder, json!({ "t": "carrot_say", "room": hs["room"], "line": 1 })).await;
    assert_eq!(until(guesser, "carrot_say").await["line"], "Mine's empty. Want to swap?");
    send(guesser, json!({ "t": "carrot_choose", "room": hs["room"], "swap": true })).await;
    let rg = until(guesser, "carrot_reveal").await; let rh = until(holder, "carrot_reveal").await;
    let (c, o) = opening(&rg["opening"]); assert!(commit::verify(&c, &o)); assert_eq!(c.0, hs["commitment"].as_str().unwrap());
    let in_holder = o.value == b"carrot:holder"; assert_eq!(hs["peek"] == "carrot", in_holder);
    assert_eq!(rg["you_won"].as_bool().unwrap(), in_holder); // guesser swapped
    assert_ne!(rg["you_won"], rh["you_won"]);
    let total = rg["balance"].as_u64().unwrap() + rh["balance"].as_u64().unwrap();
    assert_eq!(total, 2_000_000 - 4_000); // 2% rake on 0.002 pot
}

#[tokio::test]
async fn liars_dice_full_round() {
    let url = server().await;
    let (mut a, _) = client(&url, 1_000_000).await;
    let (mut b, _) = client(&url, 1_000_000).await;
    send(&mut a, json!({ "t": "liars_join", "stake": 50_000 })).await; until(&mut a, "queued").await;
    send(&mut b, json!({ "t": "liars_join", "stake": 50_000 })).await;
    let sa = until(&mut a, "liars_start").await; let sb = until(&mut b, "liars_start").await;
    let (first, second, fs) = if sa["seat"] == 0 { (&mut a, &mut b, sa.clone()) } else { (&mut b, &mut a, sb.clone()) };
    send(first, json!({ "t": "liars_bid", "room": fs["room"], "q": 3, "f": 4 })).await;
    until(second, "liars_bid").await;
    send(second, json!({ "t": "liars_call", "room": fs["room"] })).await;
    let rv = until(first, "liars_reveal").await;
    let mut fours = 0;
    for op in rv["openings"].as_array().unwrap() { let (c, o) = opening(op); assert!(commit::verify(&c, &o)); fours += o.value.iter().filter(|&&d| d == 4).count(); }
    assert_eq!(rv["count"].as_u64().unwrap() as usize, fours);
    assert_eq!(rv["you_won"].as_bool().unwrap(), fours >= 3);
}

#[tokio::test]
async fn crash_round_settles_and_reveals() {
    let url = server().await;
    let (mut w, _) = client(&url, 1_000_000).await;
    send(&mut w, json!({ "t": "crash_sub" })).await;
    // wait for a betting phase
    loop { let s = until(&mut w, "crash").await; if s["phase"] == "betting" { break; } }
    send(&mut w, json!({ "t": "crash_bet", "stake": 100_000, "auto": 100_000 })).await;
    let e = loop { let m = until_any(&mut w).await; if m["t"] == "error" { break m; } };
    assert!(e["error"].as_str().unwrap().contains("1000x"), "{e}");
    send(&mut w, json!({ "t": "crash_bet", "stake": 100_000, "auto": 101 })).await;
    let bet = until(&mut w, "crash_bet").await;
    let commitment = until(&mut w, "crash_start").await["commitment"].as_str().unwrap().to_owned();
    let bust = until(&mut w, "crash_bust").await;
    let seed = verify_server_seed(bust["server_seed"].as_str().unwrap(), &commitment).unwrap();
    assert_eq!(games::crash(&mut OutcomeStream::new(seed, "zecasino-crash", bet["round"].as_u64().unwrap())), bust["bust"].as_u64().unwrap());
    send(&mut w, json!({ "t": "balance" })).await;
    let bal = until(&mut w, "balance").await["balance"].as_u64().unwrap();
    let b = bust["bust"].as_u64().unwrap();
    assert_eq!(bal, if b > 101 { 1_000_000 - 100_000 + 101_000 } else { 900_000 });
}

mod holdem_e2e {
    use super::*;
    use zecasino_mental_poker as mp;
    use std::collections::HashMap;

    struct Bot { w: Ws, sk: mp::SecretKey, seat: usize, room: String, deck: Vec<mp::Masked>, hole: Vec<u8>, pks: Vec<mp::PublicKey> }

    /// One message-pump step for a bot: handles protocol requests, plays check/call. Returns the message type.
    async fn pump(b: &mut Bot) -> Value {
        let m = loop { if let Message::Text(s) = b.w.next().await.unwrap().unwrap() { break serde_json::from_str::<Value>(&s).unwrap(); } };
        match m["t"].as_str().unwrap() {
            "hm_seated" => { b.seat = m["seat"].as_u64().unwrap() as usize; b.room = m["room"].as_str().unwrap().into(); }
            "hm_key_req" => { b.sk = mp::SecretKey::generate(); b.hole.clear(); send(&mut b.w, json!({ "t": "hm_key", "room": b.room, "pk": b.sk.public() })).await; }
            "hm_keys" => { b.pks = serde_json::from_value(m["pks"].clone()).unwrap(); }
            "hm_shuffled" => {
                // Every browser can check every shuffle it did not make.
                let i: Vec<mp::Masked> = serde_json::from_value(m["input"].clone()).unwrap();
                let o: Vec<mp::Masked> = serde_json::from_value(m["output"].clone()).unwrap();
                let pf: mp::ShuffleProof = serde_json::from_value(m["proof"].clone()).unwrap();
                let joint = mp::joint_key(&b.pks).unwrap();
                mp::verify_shuffle(&i, &o, &joint, &pf).expect("forwarded shuffle verifies");
            }
            "hm_shuffle_req" => {
                let d: Vec<mp::Masked> = serde_json::from_value(m["deck"].clone()).unwrap();
                let (o, pf) = mp::shuffle(&d, &mp::joint_key(&b.pks).unwrap());
                send(&mut b.w, json!({ "t": "hm_shuffle", "room": b.room, "deck": o, "proof": pf })).await;
            }
            "hm_deck" => { b.deck = serde_json::from_value(m["deck"].clone()).unwrap(); }
            "hm_share_req" => {
                let shares: HashMap<String, mp::Share> = m["positions"].as_array().unwrap().iter().map(|p| { let p = p.as_u64().unwrap() as usize; (p.to_string(), b.sk.share(&b.deck[p])) }).collect();
                send(&mut b.w, json!({ "t": "hm_shares", "room": b.room, "shares": shares })).await;
            }
            "hm_hole" => {
                for p in m["positions"].as_array().unwrap() {
                    let p = p.as_u64().unwrap() as usize;
                    let mut sh: Vec<mp::Share> = serde_json::from_value(m["shares"][p.to_string()].clone()).unwrap();
                    assert_eq!(sh.len(), 2);
                    sh.push(b.sk.share(&b.deck[p]));
                    b.hole.push(mp::unmask(&b.deck[p], &sh).unwrap() as u8);
                }
            }
            "hm_state" => if let Some(l) = m.get("legal").filter(|l| !l.is_null()) {
                let a = if l["check"].as_bool().unwrap() { "check" } else { "call" };
                send(&mut b.w, json!({ "t": "hm_act", "room": b.room, "action": a })).await;
            },
            "error" => panic!("{m}"),
            _ => {}
        }
        m
    }

    #[tokio::test]
    async fn heads_up_hand_to_showdown() {
        let url = server().await;
        let (mut a, _) = client(&url, 100_000_000).await;
        let (mut c, _) = client(&url, 100_000_000).await;
        send(&mut a, json!({ "t": "holdem_join", "stake": 40_000_000 })).await; until(&mut a, "queued").await;
        send(&mut c, json!({ "t": "holdem_join", "stake": 40_000_000 })).await;
        let mk = |w| Bot { w, sk: mp::SecretKey::generate(), seat: 9, room: String::new(), deck: vec![], hole: vec![], pks: vec![] };
        let (mut b0, mut b1) = (mk(a), mk(c));
        let mut results = vec![];
        while results.len() < 2 {
            tokio::select! {
                m = pump(&mut b0) => if m["t"] == "hm_result" { results.push((0, m)); },
                m = pump(&mut b1) => if m["t"] == "hm_result" { results.push((1, m)); },
            }
        }
        let r = &results[0].1;
        assert_eq!(r["by"], "showdown");
        assert_eq!(r["board"].as_array().unwrap().len(), 5);
        // The hole cards each browser decrypted privately are the ones revealed at showdown.
        let holes: Vec<Vec<u8>> = serde_json::from_value(r["holes"].clone()).unwrap();
        for b in [&b0, &b1] { assert_eq!(holes[b.seat], b.hole, "seat {}", b.seat); }
        let mut all: Vec<u8> = holes.concat(); all.extend(serde_json::from_value::<Vec<u8>>(r["board"].clone()).unwrap());
        all.sort(); all.dedup(); assert_eq!(all.len(), 9, "no duplicate cards");
        let stacks: Vec<u64> = serde_json::from_value(r["stacks"].clone()).unwrap();
        assert_eq!(stacks[0] + stacks[1] + r["rake"].as_u64().unwrap(), 80_000_000);
        // Leave after the hand: chips go back to the ledger.
        send(&mut b0.w, json!({ "t": "holdem_leave", "room": b0.room })).await;
        let closed = loop { let m = pump(&mut b0).await; if m["t"] == "hm_closed" { break m; } };
        assert_eq!(closed["cashed_out"].as_u64().unwrap(), stacks[b0.seat]);
    }
}

#[tokio::test]
async fn solvency_inclusion_proof() {
    use zecasino_game_server::solvency::{verify, Node, Step};
    let url = server().await;
    let (mut a, _) = client(&url, 12_345_678).await;
    send(&mut a, json!({ "t": "solvency_proof", "id": 1 })).await;
    let p = until(&mut a, "solvency_proof").await;
    assert_eq!(p["balance"], 12_345_678);
    let node = |v: &Value| Node { hash: hex::decode(v["hash"].as_str().unwrap()).unwrap().try_into().unwrap(), sum: v["sum"].as_u64().unwrap() };
    let path: Vec<Step> = p["path"].as_array().unwrap().iter().map(|s| Step { side: if s["side"] == "left" { "left" } else { "right" }, node: node(&s["node"]) }).collect();
    let salt: [u8; 32] = hex::decode(p["salt"].as_str().unwrap()).unwrap().try_into().unwrap();
    assert!(verify(&salt, 12_345_678, &path, &node(&p["root"])));
}
