use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use zecasino_fairness::{commit::{self, Commitment, Opening}, games, verify_server_seed, OutcomeStream};

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn server() -> String { server_with(30_000, 20_000).await }
async fn server_with(act_ms: u64, proto_ms: u64) -> String { server_full(act_ms, proto_ms, 60_000).await }
async fn server_full(act_ms: u64, proto_ms: u64, pvp_idle_ms: u64) -> String {
    let app = zecasino_game_server::App::new(":memory:", true);
    app.pvp_idle_ms.store(pvp_idle_ms, std::sync::atomic::Ordering::Relaxed);
    app.hm_act_ms.store(act_ms, std::sync::atomic::Ordering::Relaxed);
    app.hm_proto_ms.store(proto_ms, std::sync::atomic::Ordering::Relaxed);
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


fn opening(v: &Value) -> (Commitment, Opening) {
    let value = match &v["value"] { Value::String(s) => s.as_bytes().to_vec(), _ => v["dice"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect() };
    (Commitment(v["commitment"].as_str().unwrap().into()), Opening { value, salt: v["salt"].as_str().unwrap().into() })
}
async fn lobby(url: &str) -> Value {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let host = url.trim_start_matches("ws://").trim_end_matches("/ws");
    let mut s = tokio::net::TcpStream::connect(host).await.unwrap();
    s.write_all(b"GET /lobby HTTP/1.0\r\nHost: x\r\n\r\n").await.unwrap();
    let mut b = String::new(); s.read_to_string(&mut b).await.unwrap();
    serde_json::from_str(&b[b.find("\r\n\r\n").unwrap() + 4..]).unwrap()
}

#[tokio::test]
async fn public_queue_and_invites_stay_private() {
    let url = server().await;
    let (mut a, _) = client(&url, 1_000_000).await;
    let (mut b, _) = client(&url, 1_000_000).await;
    let (mut c, _) = client(&url, 1_000_000).await;
    send(&mut a, json!({ "t": "carrot_join", "stake": 80_000 })).await; until(&mut a, "queued").await;
    send(&mut b, json!({ "t": "carrot_join", "stake": 50_000, "invite": true })).await;
    let q = until(&mut b, "queued").await; let code = q["code"].as_str().unwrap().to_owned(); assert_eq!(code.len(), 6);
    let l = lobby(&url).await;
    assert_eq!(l["tables"]["carrot"]["waiting"], 1, "invite tables are not counted");
    // A public join at 0.0005 must not take the private table.
    send(&mut c, json!({ "t": "carrot_join", "stake": 50_000 })).await; until(&mut c, "queued").await;
    send(&mut c, json!({ "t": "queue_leave" })).await; until(&mut c, "queue_left").await;
    // Join by code adopts the host's stake whatever the joiner sent.
    send(&mut c, json!({ "t": "carrot_join", "stake": 10, "code": code.to_lowercase() })).await;
    let sc = until(&mut c, "carrot_start").await; let sb = until(&mut b, "carrot_start").await;
    assert_eq!(sc["stake"], 50_000); assert_eq!(sb["room"], sc["room"]); assert_eq!(sc["opponent_house"], false);
    send(&mut a, json!({ "t": "queue_leave" })).await; until(&mut a, "queue_left").await;
    send(&mut a, json!({ "t": "carrot_join", "stake": 1, "code": code })).await;
    let e = loop { let m = until_any(&mut a).await; if m["t"] == "error" { break m; } };
    assert!(e["error"].as_str().unwrap().contains("invite"));
}

#[tokio::test]
async fn house_carrot_commits_its_decision_and_ledger_is_exact() {
    let url = server().await;
    for _ in 0..4 {
        let (mut a, _) = client(&url, 1_000_000).await;
        send(&mut a, json!({ "t": "carrot_join", "stake": 100_000 })).await; until(&mut a, "queued").await;
        send(&mut a, json!({ "t": "carrot_join", "stake": 100_000, "house": true })).await;
        let s = until(&mut a, "carrot_start").await;
        assert_eq!(s["opponent_house"], true); assert_eq!(s["opponent"], "house");
        assert_eq!(s["balance"], 900_000);
        assert_eq!(lobby(&url).await["tables"]["carrot"]["waiting"], 0, "left the queue");
        let r = if s["role"] == "guesser" {
            assert!(s.get("peek").is_none()); assert!(s.get("house_commitment").is_none());
            assert!(until(&mut a, "carrot_say").await["line"].is_string(), "house holder talks");
            send(&mut a, json!({ "t": "carrot_choose", "room": s["room"], "swap": false })).await;
            until(&mut a, "carrot_reveal").await
        } else {
            let hc = s["house_commitment"].as_str().unwrap().to_owned();
            let r = until(&mut a, "carrot_reveal").await; // house decides on its own
            let (c, o) = opening(&r["house_decision"]); assert_eq!(c.0, hc); assert!(commit::verify(&c, &o));
            assert_eq!(o.value == b"carrot:house-swap", r["swap"].as_bool().unwrap());
            r
        };
        let (c, o) = opening(&r["opening"]); assert!(commit::verify(&c, &o));
        let bal = r["balance"].as_u64().unwrap();
        if r["you_won"].as_bool().unwrap() { assert_eq!(bal, 900_000 + 196_000); } else { assert_eq!(bal, 900_000); }
    }
}

#[tokio::test]
async fn house_liars_moves_follow_public_policy() {
    let url = server().await;
    let (mut a, _) = client(&url, 1_000_000).await;
    send(&mut a, json!({ "t": "liars_join", "stake": 50_000, "house": true })).await;
    let s = until(&mut a, "liars_start").await;
    assert_eq!(s["opponent_house"], true);
    let me = s["seat"].as_u64().unwrap() as usize; let room = s["room"].clone();
    let mut bids: Vec<(usize, u8, u8)> = vec![]; let mut turn = s["turn"].as_u64().unwrap() as usize;
    let rv = loop {
        if turn == me {
            if bids.is_empty() { send(&mut a, json!({ "t": "liars_bid", "room": room, "q": 1, "f": s["dice"][0] })).await; }
            else if bids.len() < 3 { let (_, q, f) = *bids.last().unwrap(); send(&mut a, json!({ "t": "liars_bid", "room": room, "q": q + 1, "f": f })).await; }
            else { send(&mut a, json!({ "t": "liars_call", "room": room })).await; }
        }
        let m = loop { let m = until_any(&mut a).await; if m["t"] == "liars_bid" || m["t"] == "liars_reveal" { break m; } if m["t"] == "error" { panic!("{m}"); } };
        if m["t"] == "liars_reveal" { break m; }
        bids.push((1 - m["turn"].as_u64().unwrap() as usize, m["q"].as_u64().unwrap() as u8, m["f"].as_u64().unwrap() as u8));
        turn = m["turn"].as_u64().unwrap() as usize;
    };
    let house = 1 - me;
    let o = opening(&rv["openings"][house]).1; let hd: [u8; 5] = o.value.clone().try_into().unwrap();
    let mut standing: Option<(u8, u8)> = None;
    for (who, q, f) in &bids { if *who == house { assert_eq!(zecasino_game_server::house_bot::liars_move(&hd, standing, 10), Some((*q, *f))); } standing = Some((*q, *f)); }
    if rv["caller"] != s["you"] { assert_eq!(zecasino_game_server::house_bot::liars_move(&hd, standing, 10), None, "house call follows policy"); }
}

#[tokio::test]
async fn presence_and_rematch() {
    let url = server().await;
    let (mut a, _) = client(&url, 1_000_000).await;
    let (mut b, sb) = client(&url, 1_000_000).await;
    send(&mut a, json!({ "t": "liars_join", "stake": 50_000 })).await; until(&mut a, "queued").await;
    send(&mut b, json!({ "t": "liars_join", "stake": 50_000 })).await;
    let s = until(&mut a, "liars_start").await; until(&mut b, "liars_start").await;
    assert_eq!(s["turn_ms"], 60_000);
    drop(b);
    let p = until(&mut a, "pvp_presence").await; assert_eq!(p["online"], false); assert_eq!(p["grace_ms"], 30_000);
    let (mut b, _) = connect_async(&url).await.unwrap();
    send(&mut b, json!({ "t": "hello", "token": sb["token"] })).await;
    assert_eq!(until(&mut a, "pvp_presence").await["online"], true);
    let room = s["room"].clone();
    let (first, second) = if s["seat"] == s["turn"] { (&mut a, &mut b) } else { (&mut b, &mut a) };
    send(first, json!({ "t": "liars_bid", "room": room, "q": 1, "f": 2 })).await; until(second, "liars_bid").await;
    send(second, json!({ "t": "liars_call", "room": room })).await; until(first, "liars_reveal").await; until(second, "liars_reveal").await;
    send(&mut a, json!({ "t": "pvp_rematch", "room": room })).await; until(&mut a, "rematch_wait").await;
    until(&mut b, "pvp_rematch_offer").await;
    send(&mut b, json!({ "t": "pvp_rematch", "room": room })).await;
    let n = until(&mut a, "liars_start").await; until(&mut b, "liars_start").await;
    assert_ne!(n["room"], room);
}
