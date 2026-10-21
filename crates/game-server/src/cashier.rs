//! Bridge to zec-service. Deposits: one Orchard-only address per session, credited after
//! CONFIRMATIONS blocks. Withdrawals: debited at once, then paid in batches after a random delay so
//! the payout time does not line up with the request (timing-link mitigation from PLAN.md §6).
use std::{sync::Arc, time::{Duration, SystemTime, UNIX_EPOCH}};
use rand::Rng;
use serde_json::{json, Value};
use crate::{ledger::token_id, App};

pub const CONFIRMATIONS: u32 = 3;
pub const MIN_WITHDRAW: u64 = 100_000; // 0.001 TAZ

pub struct Zec { pub url: String, pub key: String, pub http: reqwest::Client }

impl Zec {
    pub fn from_env() -> Option<Self> {
        Some(Self { url: std::env::var("ZEC_SERVICE_URL").ok()?, key: std::env::var("ZEC_INTERNAL_KEY").ok()?, http: reqwest::Client::new() })
    }
    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> anyhow::Result<Value> {
        let mut r = self.http.request(method, format!("{}{}", self.url, path)).bearer_auth(&self.key).timeout(Duration::from_secs(120));
        if let Some(b) = body { r = r.json(&b); }
        let res = r.send().await?;
        let ok = res.status().is_success(); let text = res.text().await?;
        if !ok { anyhow::bail!("{text}"); }
        Ok(serde_json::from_str(&text)?)
    }
    pub async fn address(&self, index: u64) -> anyhow::Result<String> {
        Ok(self.call(reqwest::Method::POST, "/address", Some(json!({ "index": index }))).await?["address"].as_str().unwrap_or_default().to_owned())
    }
}

pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() }

/// Withdrawal destinations must be shielded: unified (u1/utest1) or Sapling (zs1/ztestsapling1).
pub fn shielded_address(a: &str) -> bool {
    let ok_prefix = ["utest1", "u1", "ztestsapling1", "zs1"].iter().any(|p| a.starts_with(p));
    ok_prefix && a.len() > 60 && a.len() < 600 && a.chars().all(|c| c.is_ascii_alphanumeric())
}

pub async fn run(app: Arc<App>) {
    let Some(zec) = app.zec.as_ref() else { return };
    loop {
        // deposits
        match zec.call(reqwest::Method::GET, "/deposits", None).await {
            Ok(v) => for d in v["deposits"].as_array().cloned().unwrap_or_default() {
                let (Some(idx), Some(zat)) = (d["diversifier_index"].as_u64(), d["zat"].as_u64()) else { continue };
                if d["confirmations"].as_u64().unwrap_or(0) < CONFIRMATIONS as u64 { continue; }
                let key = format!("{}:{}:{}", d["txid"].as_str().unwrap_or(""), d["pool"].as_str().unwrap_or(""), d["output_index"]);
                let credited = app.ledger.lock().await.credit_deposit(idx, &key, zat);
                if let Some((session, bal)) = credited { app.notify_session(&session, json!({ "t": "deposit", "zat": zat, "balance": bal })).await; }
            },
            Err(e) => tracing::warn!("deposit poll failed: {e:#}"),
        }
        // withdrawals: everything due goes out in one transaction
        let due = app.ledger.lock().await.due_withdrawals(now());
        if !due.is_empty() {
            let outputs: Vec<Value> = due.iter().map(|(_, a, z)| json!({ "address": a, "zat": z })).collect();
            let ids: Vec<i64> = due.iter().map(|d| d.0).collect();
            let res = zec.call(reqwest::Method::POST, "/withdraw", Some(json!({ "outputs": outputs }))).await;
            let txid = res.as_ref().ok().and_then(|v| v["txid"].as_str().map(str::to_owned));
            if let Err(e) = &res { tracing::warn!("withdrawal batch failed, refunding: {e:#}"); }
            let sessions: Vec<Option<String>> = { let l = app.ledger.lock().await; ids.iter().map(|i| l.session_of_withdrawal(*i)).collect() };
            app.ledger.lock().await.finish_withdrawals(&ids, txid.as_deref());
            for s in sessions.into_iter().flatten() { app.notify_session(&s, json!({ "t": "withdrawal", "status": if txid.is_some() { "sent" } else { "refunded" }, "txid": txid })).await; }
        }
        tokio::time::sleep(Duration::from_secs(20)).await;
    }
}

pub fn delay_between(lo: u64, hi: u64) -> u64 { rand::rngs::OsRng.gen_range(lo..=hi) }
pub fn session_matches(token: &str, session: &str) -> bool { token_id(token) == session }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn only_shielded_destinations() {
        assert!(shielded_address("utest16j8np93zm49a2nv7h5e7d2n6ww0n9m6aznz802lw96nmwhj7yfynhw8099nzg3lkamxraxst4x86nwl8y82euns7x7a4w3p67chlfpu0"));
        assert!(!shielded_address("tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU"));
        assert!(!shielded_address("texregtest1abc"));
        assert!(!shielded_address("utest1 short"));
    }
}
