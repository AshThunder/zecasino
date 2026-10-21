//! zec-service: Zecasino's cashier. Internal HTTP API on localhost only, called by the game server.
//!
//!   zec-service new-seed                 write a fresh 24-word mnemonic to $ZEC_MNEMONIC (0600)
//!   zec-service init <birthday-height>   create the wallet DB + house account
//!   zec-service sync | status | address <index> | deposits
//!   zec-service withdraw <ua> <zat>
//!   zec-service reserve-init <height|tip>   watch-only DB for the cold reserve, from $ZEC_RESERVE_MNEMONIC
//!   zec-service serve                    sync loop + API on $ZEC_API (default 127.0.0.1:3300)
mod cache;
mod wallet;

use std::{path::PathBuf, sync::Arc, time::Duration};
use anyhow::{anyhow, bail};
use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::{get, post}, Json, Router};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use zcash_client_backend::data_api::WalletRead;

struct Cfg { lwd: String, db: PathBuf, mnemonic: PathBuf, api: String, key: Option<String>, reserve_db: PathBuf, reserve_ufvk: PathBuf }
fn cfg() -> Cfg {
    let e = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
    Cfg { lwd: e("ZEC_LWD", "https://testnet.zec.rocks:443"), db: e("ZEC_WALLET_DB", "zec-wallet.sqlite").into(), mnemonic: e("ZEC_MNEMONIC", "house.mnemonic").into(), api: e("ZEC_API", "127.0.0.1:3300"), key: std::env::var("ZEC_INTERNAL_KEY").ok(),
        reserve_db: e("ZEC_RESERVE_DB", "reserve-view.sqlite").into(), reserve_ufvk: e("ZEC_RESERVE_UFVK", "reserve.ufvk").into() }
}

struct Svc { db: Mutex<wallet::Db>, reserve: Option<Mutex<wallet::Db>>, client: Mutex<wallet::Client>, cfg: Cfg }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let c = cfg();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    if cmd == "new-seed" { wallet::new_mnemonic(&c.mnemonic)?; println!("wrote {}", c.mnemonic.display()); return Ok(()); }
    if cmd == "reserve-init" {
        let mut client = wallet::connect(&c.lwd).await?;
        let a = args.get(1).ok_or_else(|| anyhow!("birthday height (or `tip`) required"))?;
        let h: u32 = if a == "tip" { (client.get_latest_block(zcash_client_backend::proto::service::ChainSpec::default()).await?.into_inner().height as u32).saturating_sub(10) } else { a.parse()? };
        let rm = std::env::var("ZEC_RESERVE_MNEMONIC").map_err(|_| anyhow!("set ZEC_RESERVE_MNEMONIC"))?;
        let ufvk = wallet::reserve_ufvk(&wallet::read_seed(rm.as_ref())?)?;
        std::fs::write(&c.reserve_ufvk, &ufvk)?;
        let mut rdb = wallet::open(&c.reserve_db)?;
        wallet::import_view(&mut rdb, &mut client, &ufvk, h).await?;
        let addr_file = c.reserve_ufvk.with_extension("addr");
        if !addr_file.exists() { std::fs::write(&addr_file, wallet::deposit_address(&mut rdb, 1)?)?; }
        println!("reserve viewing key written to {}\naddress {}", c.reserve_ufvk.display(), std::fs::read_to_string(&addr_file)?);
        return Ok(());
    }
    let mut db = wallet::open(&c.db)?;
    let need_net = !matches!(cmd, "address" | "deposits");
    let mut client = if need_net { Some(wallet::connect(&c.lwd).await?) } else { None };
    match cmd {
        "init" => {
            let a = args.get(1).ok_or_else(|| anyhow!("birthday height (or `tip`) required"))?;
            let h: u32 = if a == "tip" {
                let t = client.as_mut().unwrap().get_latest_block(zcash_client_backend::proto::service::ChainSpec::default()).await?.into_inner().height as u32;
                t.saturating_sub(10)
            } else { a.parse()? };
            println!("birthday {h}");
            let seed = wallet::read_seed(&c.mnemonic)?;
            let id = wallet::create_account(&mut db, client.as_mut().unwrap(), &seed, h).await?;
            println!("account {id:?}");
        }
        "sync" => { wallet::sync(&mut db, client.as_mut().unwrap()).await?; println!("synced to {:?}", db.chain_height()?); }
        "status" => println!("{}", status(&db)?),
        "address" => println!("{}", wallet::deposit_address(&mut db, args.get(1).ok_or_else(|| anyhow!("index required"))?.parse()?)?),
        "deposits" => println!("{}", serde_json::to_string_pretty(&wallet::deposits(&c.db, db.chain_height()?.map(u32::from).unwrap_or(0))?)?),
        "withdraw" => {
            let (a, z) = (args.get(1).ok_or_else(|| anyhow!("address"))?, args.get(2).ok_or_else(|| anyhow!("zat"))?.parse()?);
            let seed = wallet::read_seed(&c.mnemonic)?;
            wallet::sync(&mut db, client.as_mut().unwrap()).await?;
            println!("{}", wallet::withdraw(&mut db, client.as_mut().unwrap(), &seed, &[(a.clone(), z)]).await?);
        }
        "serve" => {
            if c.key.is_none() { bail!("set ZEC_INTERNAL_KEY"); }
            let reserve = if c.reserve_db.exists() && c.reserve_ufvk.exists() { Some(Mutex::new(wallet::open(&c.reserve_db)?)) } else { tracing::warn!("no reserve view wallet: run reserve-init"); None };
            let svc = Arc::new(Svc { db: Mutex::new(db), reserve, client: Mutex::new(client.unwrap()), cfg: c });
            let s2 = svc.clone();
            tokio::spawn(async move { loop {
                // Each sync is bounded: a stalled lightwalletd stream must not hold the wallet lock (and every API call) forever.
                const SYNC_LIMIT: Duration = Duration::from_secs(120);
                { let mut db = s2.db.lock().await; let mut cl = s2.client.lock().await;
                  let mut stalled = false;
                  match tokio::time::timeout(SYNC_LIMIT, wallet::sync(&mut db, &mut cl)).await { Ok(Err(e)) => tracing::warn!("sync failed: {e:#}"), Err(_) => { tracing::warn!("sync stalled; reconnecting"); stalled = true; } _ => {} }
                  if let (false, Some(r)) = (stalled, &s2.reserve) { match tokio::time::timeout(SYNC_LIMIT, wallet::sync(&mut *r.lock().await, &mut cl)).await { Ok(Err(e)) => tracing::warn!("reserve sync failed: {e:#}"), Err(_) => { tracing::warn!("reserve sync stalled; reconnecting"); stalled = true; } _ => {} } }
                  if stalled { match wallet::connect(&s2.cfg.lwd).await { Ok(c) => *cl = c, Err(e) => tracing::warn!("reconnect failed: {e:#}") } } }
                tokio::time::sleep(Duration::from_secs(20)).await;
            } });
            let app = Router::new()
                .route("/status", get(api_status)).route("/address", post(api_address))
                .route("/deposits", get(api_deposits)).route("/withdraw", post(api_withdraw)).route("/reserve", get(api_reserve)).route("/chain", get(api_chain)).route("/txview/{txid}", get(api_txview))
                .with_state(svc.clone());
            let addr = svc.cfg.api.clone();
            tracing::info!(%addr, lwd = %svc.cfg.lwd, "zec-service listening");
            axum::serve(tokio::net::TcpListener::bind(&addr).await?, app).await?;
        }
        _ => println!("usage: zec-service new-seed | init <height> | sync | status | address <i> | deposits | withdraw <ua> <zat> | serve"),
    }
    Ok(())
}

fn status(db: &wallet::Db) -> anyhow::Result<Value> {
    let tip = db.chain_height()?.map(u32::from);
    let (spendable, total) = wallet::balance(db).unwrap_or((0, 0));
    Ok(json!({ "network": "testnet", "tip": tip, "spendable_zat": spendable, "total_zat": total }))
}

/// Public facts only: the reserve viewing key, its address, and what the watch-only wallet sees.
async fn api_reserve(State(s): State<Arc<Svc>>) -> ApiResult {
    let r = s.reserve.as_ref().ok_or((StatusCode::NOT_FOUND, "no reserve wallet".into()))?;
    let db = r.lock().await;
    let ufvk = std::fs::read_to_string(&s.cfg.reserve_ufvk).map_err(|e| ise(e.into()))?;
    let (_, total) = wallet::balance(&db).unwrap_or((0, 0));
    Ok(Json(json!({ "ufvk": ufvk.trim(), "address": std::fs::read_to_string(s.cfg.reserve_ufvk.with_extension("addr")).map_err(|e| ise(e.into()))?.trim(), "birthday": wallet::birthday(&db).map_err(ise)?,
        "tip": db.chain_height().map_err(|e| ise(e.into()))?.map(u32::from), "total_zat": total, "network": "testnet" })))
}

async fn api_txview(State(s): State<Arc<Svc>>, h: HeaderMap, axum::extract::Path(txid): axum::extract::Path<String>) -> ApiResult {
    auth(&s, &h)?;
    if txid.len() != 64 || !txid.bytes().all(|b| b.is_ascii_hexdigit()) { return Err((StatusCode::BAD_REQUEST, "txid".into())); }
    Ok(Json(wallet::tx_view(&s.cfg.db, &txid).map_err(ise)?))
}
/// Public: tip + block hash and transparent-output counts for the hot and the reserve wallet.
async fn api_chain(State(s): State<Arc<Svc>>) -> ApiResult {
    let (tip, hash, hi, ho) = wallet::chain_facts(&s.cfg.db).map_err(ise)?;
    let (ri, ro) = wallet::chain_facts(&s.cfg.reserve_db).map(|f| (f.2, f.3)).unwrap_or((0, 0));
    Ok(Json(json!({ "tip": tip, "hash": hash, "transparent_received": hi + ri, "transparent_sent": ho + ro, "network": "testnet" })))
}
type ApiResult = Result<Json<Value>, (StatusCode, String)>;
fn auth(s: &Svc, h: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let ok = h.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")) == s.cfg.key.as_deref();
    if ok { Ok(()) } else { Err((StatusCode::UNAUTHORIZED, "unauthorized".into())) }
}
fn ise(e: anyhow::Error) -> (StatusCode, String) { (StatusCode::BAD_REQUEST, format!("{e:#}")) }

async fn api_status(State(s): State<Arc<Svc>>, h: HeaderMap) -> ApiResult { auth(&s, &h)?; Ok(Json(status(&*s.db.lock().await).map_err(ise)?)) }
async fn api_address(State(s): State<Arc<Svc>>, h: HeaderMap, Json(b): Json<Value>) -> ApiResult {
    auth(&s, &h)?;
    let i = b["index"].as_u64().ok_or((StatusCode::BAD_REQUEST, "index".into()))?;
    Ok(Json(json!({ "address": wallet::deposit_address(&mut *s.db.lock().await, i).map_err(ise)? })))
}
async fn api_deposits(State(s): State<Arc<Svc>>, h: HeaderMap) -> ApiResult {
    auth(&s, &h)?;
    let tip = s.db.lock().await.chain_height().map_err(|e| ise(e.into()))?.map(u32::from).unwrap_or(0);
    Ok(Json(json!({ "tip": tip, "deposits": wallet::deposits(&s.cfg.db, tip).map_err(ise)? })))
}
async fn api_withdraw(State(s): State<Arc<Svc>>, h: HeaderMap, Json(b): Json<Value>) -> ApiResult {
    auth(&s, &h)?;
    let outs: Vec<(String, u64)> = b["outputs"].as_array().ok_or((StatusCode::BAD_REQUEST, "outputs".into()))?.iter()
        .map(|o| (o["address"].as_str().unwrap_or("").to_owned(), o["zat"].as_u64().unwrap_or(0))).collect();
    let seed = wallet::read_seed(&s.cfg.mnemonic).map_err(ise)?;
    let mut db = s.db.lock().await; let mut cl = s.client.lock().await;
    Ok(Json(json!({ "txid": wallet::withdraw(&mut db, &mut cl, &seed, &outs).await.map_err(ise)? })))
}
