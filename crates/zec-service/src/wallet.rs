//! The house wallet. Shielded only:
//! - deposit addresses are Orchard-only unified addresses, one fresh diversifier per session;
//! - withdrawals refuse any recipient that is not a shielded unified/Sapling address;
//! - the only per-transaction lightwalletd query is GetTransaction for txids the wallet already
//!   found by trial-decrypting compact blocks (never a transparent address lookup).
use std::{num::NonZeroUsize, path::Path, str::FromStr};
use anyhow::{anyhow, bail, Context};
use rand10::{rand_core::UnwrapErr, rngs::SysRng};
use secrecy::{ExposeSecret, SecretVec};
use tonic::transport::{Channel, ClientTlsConfig};
use zcash_address::ZcashAddress;
use zcash_client_backend::{
    data_api::{
        wallet::{create_proposed_transactions, decrypt_and_store_transaction, input_selection::{GreedyInputSelector, SpendPolicy}, propose_transfer, ConfirmationsPolicy, SpendingKeys},
        Account, AccountBirthday, TransactionDataRequest, TransactionStatus, WalletRead, WalletWrite,
    },
    fees::{standard::MultiOutputChangeStrategy, DustOutputPolicy, SplitPolicy, StandardFeeRule},
    proto::service::{self, compact_tx_streamer_client::CompactTxStreamerClient},
    wallet::OvkPolicy,
};
use zcash_client_sqlite::{util::SystemClock, wallet::init::init_wallet_db, AccountUuid, WalletDb};
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::{consensus::{BlockHeight, BranchId, Network}, memo::MemoBytes, value::Zatoshis, ShieldedPool};
use zip32::DiversifierIndex;
use zip321::{Payment, TransactionRequest};

use crate::cache::MemCache;

pub const NETWORK: Network = Network::TestNetwork;
pub type Db = WalletDb<rusqlite::Connection, Network, SystemClock, UnwrapErr<SysRng>>;
pub type Client = CompactTxStreamerClient<Channel>;

pub async fn connect(url: &str) -> anyhow::Result<Client> {
    let ch = Channel::from_shared(url.to_owned())?
        .tls_config(ClientTlsConfig::new().with_webpki_roots())?
        .connect().await.with_context(|| format!("connecting to {url}"))?;
    Ok(CompactTxStreamerClient::new(ch))
}

pub fn open(path: &Path) -> anyhow::Result<Db> {
    let mut db = WalletDb::for_path(path, NETWORK, SystemClock, UnwrapErr(SysRng))?;
    init_wallet_db(&mut db, None).map_err(|e| anyhow!("init wallet db: {e:?}"))?;
    Ok(db)
}

pub fn read_seed(mnemonic_file: &Path) -> anyhow::Result<SecretVec<u8>> {
    let words = std::fs::read_to_string(mnemonic_file).with_context(|| format!("reading {}", mnemonic_file.display()))?;
    let m = bip0039::Mnemonic::<bip0039::English>::from_phrase(words.trim()).map_err(|e| anyhow!("bad mnemonic: {e}"))?;
    Ok(SecretVec::new(m.to_seed("").to_vec()))
}

/// Writes a new 24-word mnemonic with 0600 permissions. Refuses to overwrite.
pub fn new_mnemonic(path: &Path) -> anyhow::Result<()> {
    if path.exists() { bail!("{} already exists", path.display()); }
    let mut entropy = [0u8; 32]; rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut entropy);
    let m = bip0039::Mnemonic::<bip0039::English>::from_entropy(entropy.to_vec()).map_err(|e| anyhow!("{e}"))?;
    zeroize::Zeroize::zeroize(&mut entropy);
    std::fs::write(path, m.phrase())?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?; }
    Ok(())
}

pub async fn create_account(db: &mut Db, client: &mut Client, seed: &SecretVec<u8>, birthday: u32) -> anyhow::Result<AccountUuid> {
    if let Some(id) = db.get_account_ids()?.first() { return Ok(*id); }
    let ts = client.get_tree_state(service::BlockId { height: (birthday - 1) as u64, ..Default::default() }).await?.into_inner();
    let bday = AccountBirthday::from_treestate(ts, None).map_err(|_| anyhow!("bad tree state"))?;
    let (id, _usk) = db.create_account("house", seed, &bday, None)?;
    Ok(id)
}

pub fn account(db: &Db) -> anyhow::Result<AccountUuid> { db.get_account_ids()?.first().copied().ok_or_else(|| anyhow!("no account: run `zec-service init` first")) }

/// Fresh Orchard-only UA at an explicit diversifier index (the caller allocates unique indices).
pub fn deposit_address(db: &mut Db, index: u64) -> anyhow::Result<String> {
    let acct = account(db)?;
    let di = DiversifierIndex::from(index);
    let ua = db.get_address_for_index(acct, di, UnifiedAddressRequest::ORCHARD)?.ok_or_else(|| anyhow!("index {index} has no valid Orchard diversifier"))?;
    Ok(ua.encode(&NETWORK))
}

/// Scan new blocks, then fetch full transactions only for txids the scan already attributed to us.
pub async fn sync(db: &mut Db, client: &mut Client) -> anyhow::Result<()> {
    let cache = MemCache::default();
    zcash_client_backend::sync::run(client, &NETWORK, &cache, db, 1_000).await.map_err(|e| anyhow!("sync: {e}"))?;
    let tip = db.chain_height()?.ok_or_else(|| anyhow!("no chain tip"))?;
    for req in db.transaction_data_requests()? {
        match req {
            TransactionDataRequest::GetStatus(txid) => {
                let st = fetch_tx(client, tip, txid).await?.map_or(TransactionStatus::TxidNotRecognized, |(_, h)| h.map_or(TransactionStatus::NotInMainChain, TransactionStatus::Mined));
                db.set_transaction_status(txid, st)?;
            }
            TransactionDataRequest::Enhancement(txid) => match fetch_tx(client, tip, txid).await? {
                Some((tx, h)) => decrypt_and_store_transaction(&NETWORK, db, &tx, h)?,
                None => db.set_transaction_status(txid, TransactionStatus::TxidNotRecognized)?,
            },
            // Unreachable without `transparent-inputs`; refuse rather than leak an address to the server.
            #[allow(unreachable_patterns)]
            other => tracing::warn!("ignoring data request {other:?}"),
        }
    }
    Ok(())
}

async fn fetch_tx(client: &mut Client, tip: BlockHeight, txid: TxId) -> anyhow::Result<Option<(Transaction, Option<BlockHeight>)>> {
    let raw = match client.get_transaction(service::TxFilter { hash: txid.as_ref().to_vec(), ..Default::default() }).await {
        Ok(r) => r.into_inner(),
        Err(s) if s.code() == tonic::Code::NotFound => return Ok(None),
        Err(s) => return Err(s.into()),
    };
    let h = (raw.height > 0 && raw.height <= u32::MAX as u64).then(|| BlockHeight::from_u32(raw.height as u32));
    Ok(Some((Transaction::read(&raw.data[..], BranchId::for_height(&NETWORK, h.unwrap_or(tip)))?, h)))
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct Deposit { pub txid: String, pub pool: &'static str, pub output_index: u32, pub zat: u64, pub mined_height: Option<u32>, pub confirmations: u32, pub diversifier_index: Option<u64>, pub memo: Option<String> }

/// Every non-change shielded output received by the house account.
pub fn deposits(db_path: &Path, tip: u32) -> anyhow::Result<Vec<Deposit>> {
    let c = rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut st = c.prepare("SELECT txid, output_pool, output_index, value, tx_mined_height, diversifier_index_be, memo FROM v_tx_outputs WHERE is_change = 0 AND to_account_uuid IS NOT NULL AND from_account_uuid IS NULL AND output_pool != 0")?;
    let rows = st.query_map([], |r| {
        let mut txid: Vec<u8> = r.get(0)?; txid.reverse();
        let pool: i64 = r.get(1)?;
        let div: Option<Vec<u8>> = r.get(5)?;
        let memo: Option<Vec<u8>> = r.get(6)?;
        let mined: Option<u32> = r.get(4)?;
        Ok(Deposit {
            txid: hex::encode(txid), pool: match pool { 2 => "sapling", 3 => "orchard", 4 => "ironwood", _ => "shielded" },
            output_index: r.get(2)?, zat: r.get::<_, i64>(3)? as u64, mined_height: mined,
            confirmations: mined.map_or(0, |m| tip.saturating_sub(m) + 1),
            // diversifier_index_be is the 11-byte big-endian index; we only ever allocate < 2^64.
            diversifier_index: div.map(|b| b.iter().rev().take(8).rev().fold(0u64, |a, x| (a << 8) | *x as u64)),
            memo: memo.and_then(|m| MemoBytes::from_bytes(&m).ok()).and_then(|m| match zcash_protocol::memo::Memo::try_from(m) { Ok(zcash_protocol::memo::Memo::Text(t)) => Some(t.to_string()), _ => None }),
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn balance(db: &Db) -> anyhow::Result<(u64, u64)> {
    let s = db.get_wallet_summary(ConfirmationsPolicy::default())?.ok_or_else(|| anyhow!("wallet not synced"))?;
    let b = s.account_balances().values().next().ok_or_else(|| anyhow!("no account"))?;
    Ok((b.spendable_value().into_u64(), b.total().into_u64()))
}

/// Pays shielded recipients only. Returns the broadcast txid.
pub async fn withdraw(db: &mut Db, client: &mut Client, seed: &SecretVec<u8>, outputs: &[(String, u64)]) -> anyhow::Result<String> {
    let mut payments = vec![];
    for (addr, zat) in outputs {
        let a = ZcashAddress::from_str(addr).map_err(|_| anyhow!("invalid address"))?;
        if !shielded_only(&a) { bail!("refusing non-shielded recipient: withdrawals go to a shielded address only"); }
        payments.push(Payment::new(a, Some(Zatoshis::from_u64(*zat)?), None, None, None, vec![]).map_err(|e| anyhow!("bad payment: {e:?}"))?);
    }
    let request = TransactionRequest::new(payments).map_err(|e| anyhow!("{e:?}"))?;
    let acct = account(db)?;
    let derivation = db.get_account(acct)?.and_then(|a| a.source().key_derivation().cloned()).ok_or_else(|| anyhow!("view-only account cannot spend"))?;
    let usk = UnifiedSpendingKey::from_seed(&NETWORK, seed.expose_secret(), derivation.account_index()).map_err(|e| anyhow!("{e:?}"))?;
    let change = MultiOutputChangeStrategy::new(StandardFeeRule::Zip317, None, ShieldedPool::Orchard, DustOutputPolicy::default(), SplitPolicy::with_min_output_value(NonZeroUsize::new(1).unwrap(), Zatoshis::from_u64(100_000)?));
    let proposal = propose_transfer::<_, _, _, _, zcash_client_sqlite::wallet::commitment_tree::Error>(db, &NETWORK, acct, &GreedyInputSelector::new(), &change, request, ConfirmationsPolicy::default(), &SpendPolicy::default(), None, None).map_err(|e| anyhow!("propose: {e}"))?;
    let prover = LocalTxProver::bundled();
    let txids = create_proposed_transactions::<_, _, std::convert::Infallible, _, std::convert::Infallible, _>(db, &NETWORK, &SystemClock, &mut UnwrapErr(SysRng), &prover, &prover, &SpendingKeys::from_unified_spending_key(usk), OvkPolicy::Sender, &proposal, None).map_err(|e| anyhow!("build: {e}"))?;
    let mut last = String::new();
    for txid in txids.iter() {
        let tx = db.get_transaction(*txid)?.ok_or_else(|| anyhow!("built tx missing"))?;
        let mut raw = service::RawTransaction::default(); tx.write(&mut raw.data)?;
        let r = client.send_transaction(raw).await?.into_inner();
        if r.error_code != 0 { bail!("broadcast failed: {} {}", r.error_code, r.error_message); }
        last = txid.to_string();
    }
    Ok(last)
}

/// Accept unified addresses that carry a shielded receiver, and Sapling addresses. Reject transparent/TEX.
pub fn shielded_only(a: &ZcashAddress) -> bool {
    use zcash_protocol::PoolType;
    if !a.can_receive_as(PoolType::ORCHARD) && !a.can_receive_as(PoolType::SAPLING) && !a.can_receive_as(PoolType::IRONWOOD) { return false; }
    let s = a.to_string();
    !(s.starts_with('t') || s.starts_with("tex"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_transparent() {
        let t = ZcashAddress::from_str("tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU").unwrap();
        assert!(!shielded_only(&t));
    }
}

/// Viewing key of the cold reserve account, derived once from its own seed. Only this string is
/// ever stored next to the service; the reserve seed stays offline (run/reserve.mnemonic, 0600).
pub fn reserve_ufvk(seed: &SecretVec<u8>) -> anyhow::Result<String> {
    let usk = UnifiedSpendingKey::from_seed(&NETWORK, seed.expose_secret(), zip32::AccountId::ZERO).map_err(|e| anyhow!("{e:?}"))?;
    Ok(usk.to_unified_full_viewing_key().encode(&NETWORK).map_err(|e| anyhow!("{e:?}"))?)
}

/// Imports a viewing key as a watch-only account (the reserve view DB holds no spending material).
pub async fn import_view(db: &mut Db, client: &mut Client, ufvk: &str, birthday: u32) -> anyhow::Result<()> {
    if !db.get_account_ids()?.is_empty() { return Ok(()); }
    let k = zcash_keys::keys::UnifiedFullViewingKey::decode(&NETWORK, ufvk.trim()).map_err(|e| anyhow!("bad viewing key: {e}"))?;
    let ts = client.get_tree_state(service::BlockId { height: (birthday - 1) as u64, ..Default::default() }).await?.into_inner();
    let bday = AccountBirthday::from_treestate(ts, None).map_err(|_| anyhow!("bad tree state"))?;
    db.import_account_ufvk("reserve", &k, &bday, zcash_client_backend::data_api::AccountPurpose::ViewOnly, None)?;
    Ok(())
}

pub fn birthday(db: &Db) -> anyhow::Result<u32> { Ok(u32::from(db.get_account_birthday(account(db)?)?)) }

/// Public chain facts read straight from the wallet DBs (read-only, no wallet lock): tip height + block hash
/// (display byte order), and how many transparent outputs the wallet ever received or sent. Deposits and
/// withdrawals are shielded-only, so these should stay 0; the lobby shows the measured number, not a claim.
pub fn chain_facts(db_path: &Path) -> anyhow::Result<(u32, String, u64, u64)> {
    let c = rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let (h, mut hash): (u32, Vec<u8>) = c.query_row("SELECT height, hash FROM blocks ORDER BY height DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))?;
    hash.reverse();
    let t_in: u64 = c.query_row("SELECT COUNT(*) FROM transparent_received_outputs", [], |r| r.get(0))?;
    let t_out: u64 = c.query_row("SELECT COUNT(*) FROM sent_notes WHERE output_pool = 0", [], |r| r.get(0))?;
    Ok((h, hex::encode(hash), t_in, t_out))
}
