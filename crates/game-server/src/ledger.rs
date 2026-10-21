//! Session ledger. A session is a random bearer token; we only store its SHA-256.
//! Balances are in zatoshi. No IPs, no addresses, no identity.
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub const ZAT: u64 = 100_000_000;

pub struct Ledger { db: Connection }

#[derive(Debug, PartialEq, Eq)]
pub enum LedgerError { UnknownSession, Insufficient }

pub fn token_id(token: &str) -> String { hex::encode(Sha256::digest(token.as_bytes())) }

impl Ledger {
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        let db = if path == ":memory:" { Connection::open_in_memory()? } else { Connection::open(path)? };
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, session TEXT NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT);
             CREATE TABLE IF NOT EXISTS house (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
             INSERT OR IGNORE INTO house VALUES ('pnl', 0);
             CREATE TABLE IF NOT EXISTS deposit_addrs (idx INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL UNIQUE, address TEXT NOT NULL DEFAULT '');
             INSERT OR IGNORE INTO sqlite_sequence (name, seq) SELECT 'deposit_addrs', 1000 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'deposit_addrs');
             CREATE TABLE IF NOT EXISTS credited (output TEXT PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY, session TEXT NOT NULL, address TEXT, zat INTEGER NOT NULL, status TEXT NOT NULL, txid TEXT, not_before INTEGER NOT NULL);",
        )?;
        Ok(Self { db })
    }

    /// Creates a fresh session and returns its bearer token (shown to the client once).
    pub fn create(&self) -> String {
        let mut b = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut b);
        let token = hex::encode(b);
        // Day-granularity creation time only, to avoid fine timing correlation.
        let day = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() / 86_400 * 86_400;
        self.db.execute("INSERT INTO sessions (id, balance, created) VALUES (?1, 0, ?2)", params![token_id(&token), day as i64]).unwrap();
        token
    }

    pub fn exists(&self, token: &str) -> bool { self.balance(token).is_ok() }

    pub fn balance(&self, token: &str) -> Result<u64, LedgerError> {
        self.db.query_row("SELECT balance FROM sessions WHERE id = ?1", [token_id(token)], |r| r.get::<_, i64>(0))
            .optional().unwrap().map(|b| b as u64).ok_or(LedgerError::UnknownSession)
    }

    /// Atomically applies `delta` (zats) if the balance stays non-negative. House PnL moves the other way.
    pub fn apply(&mut self, token: &str, delta: i64, kind: &str, reference: &str) -> Result<u64, LedgerError> {
        let id = token_id(token);
        let tx = self.db.transaction().unwrap();
        let bal: i64 = tx.query_row("SELECT balance FROM sessions WHERE id = ?1", [&id], |r| r.get(0)).optional().unwrap().ok_or(LedgerError::UnknownSession)?;
        let nb = bal + delta;
        if nb < 0 { return Err(LedgerError::Insufficient); }
        tx.execute("UPDATE sessions SET balance = ?1 WHERE id = ?2", params![nb, id]).unwrap();
        tx.execute("INSERT INTO entries (session, delta, kind, ref) VALUES (?1, ?2, ?3, ?4)", params![id, delta, kind, reference]).unwrap();
        if kind == "bet" || kind == "payout" { tx.execute("UPDATE house SET v = v - ?1 WHERE k = 'pnl'", [delta]).unwrap(); }
        tx.commit().unwrap();
        Ok(nb as u64)
    }

    /// One diversifier index per session, allocated once. Indices start above 1000 so they never collide with wallet defaults.
    pub fn deposit_index(&self, token: &str) -> u64 {
        let id = token_id(token);
        self.db.execute("INSERT OR IGNORE INTO deposit_addrs (session) VALUES (?1)", [&id]).unwrap();
        self.db.query_row("SELECT idx FROM deposit_addrs WHERE session = ?1", [&id], |r| r.get::<_, i64>(0)).unwrap() as u64
    }
    pub fn set_deposit_address(&self, idx: u64, addr: &str) { self.db.execute("UPDATE deposit_addrs SET address = ?1 WHERE idx = ?2", params![addr, idx as i64]).unwrap(); }
    pub fn cached_deposit_address(&self, idx: u64) -> Option<String> {
        self.db.query_row("SELECT address FROM deposit_addrs WHERE idx = ?1", [idx as i64], |r| r.get::<_, String>(0)).ok().filter(|a| !a.is_empty())
    }
    /// Credits a confirmed deposit exactly once. Returns the session id hash and new balance if newly credited.
    pub fn credit_deposit(&mut self, idx: u64, output_key: &str, zat: u64) -> Option<(String, u64)> {
        let tx = self.db.transaction().unwrap();
        let session: Option<String> = tx.query_row("SELECT session FROM deposit_addrs WHERE idx = ?1", [idx as i64], |r| r.get(0)).optional().unwrap();
        let session = session?;
        if tx.execute("INSERT OR IGNORE INTO credited (output) VALUES (?1)", [output_key]).unwrap() == 0 { return None; }
        tx.execute("UPDATE sessions SET balance = balance + ?1 WHERE id = ?2", params![zat as i64, session]).unwrap();
        tx.execute("INSERT INTO entries (session, delta, kind, ref) VALUES (?1, ?2, 'deposit', ?3)", params![session, zat as i64, output_key]).unwrap();
        let bal: i64 = tx.query_row("SELECT balance FROM sessions WHERE id = ?1", [&session], |r| r.get(0)).unwrap();
        tx.commit().unwrap();
        Some((session, bal as u64))
    }
    /// Debits now and queues the payout; the address is wiped once the withdrawal is broadcast.
    pub fn queue_withdrawal(&mut self, token: &str, address: &str, zat: u64, not_before: u64) -> Result<(i64, u64), LedgerError> {
        let bal = self.apply(token, -(zat as i64), "withdraw", "queued")?;
        self.db.execute("INSERT INTO withdrawals (session, address, zat, status, not_before) VALUES (?1, ?2, ?3, 'queued', ?4)", params![token_id(token), address, zat as i64, not_before as i64]).unwrap();
        Ok((self.db.last_insert_rowid(), bal))
    }
    pub fn due_withdrawals(&self, now: u64) -> Vec<(i64, String, u64)> {
        let mut st = self.db.prepare("SELECT id, address, zat FROM withdrawals WHERE status = 'queued' AND not_before <= ?1").unwrap();
        st.query_map([now as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? as u64))).unwrap().map(Result::unwrap).collect()
    }
    pub fn finish_withdrawals(&mut self, ids: &[i64], txid: Option<&str>) {
        let tx = self.db.transaction().unwrap();
        for id in ids {
            match txid {
                Some(t) => { tx.execute("UPDATE withdrawals SET status = 'sent', txid = ?1, address = NULL WHERE id = ?2", params![t, id]).unwrap(); }
                None => {
                    let (s, z): (String, i64) = tx.query_row("SELECT session, zat FROM withdrawals WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
                    tx.execute("UPDATE sessions SET balance = balance + ?1 WHERE id = ?2", params![z, s]).unwrap();
                    tx.execute("UPDATE withdrawals SET status = 'refunded', address = NULL WHERE id = ?1", [id]).unwrap();
                }
            }
        }
        tx.commit().unwrap();
    }
    pub fn session_of_withdrawal(&self, id: i64) -> Option<String> { self.db.query_row("SELECT session FROM withdrawals WHERE id = ?1", [id], |r| r.get(0)).ok() }

    /// Sum of all session balances: the liability side for the solvency page.
    pub fn liabilities(&self) -> u64 { self.db.query_row("SELECT COALESCE(SUM(balance),0) FROM sessions", [], |r| r.get::<_, i64>(0)).unwrap() as u64 }
    pub fn house_pnl(&self) -> i64 { self.db.query_row("SELECT v FROM house WHERE k='pnl'", [], |r| r.get(0)).unwrap() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credit_bet_payout_and_overdraw() {
        let mut l = Ledger::open(":memory:").unwrap();
        let t = l.create();
        assert_eq!(l.balance(&t), Ok(0));
        assert_eq!(l.apply(&t, 1_000, "deposit", "tx"), Ok(1_000));
        assert_eq!(l.apply(&t, -400, "bet", "d#0"), Ok(600));
        assert_eq!(l.apply(&t, -700, "bet", "d#1"), Err(LedgerError::Insufficient));
        assert_eq!(l.apply(&t, 800, "payout", "d#0"), Ok(1_400));
        assert_eq!(l.house_pnl(), -400);
        assert_eq!(l.liabilities(), 1_400);
        assert_eq!(l.balance("nope"), Err(LedgerError::UnknownSession));
        let i = l.deposit_index(&t); assert_eq!(i, l.deposit_index(&t)); assert!(i > 1000);
        assert!(l.credit_deposit(i, "tx:3:0", 500).is_some());
        assert!(l.credit_deposit(i, "tx:3:0", 500).is_none(), "credited twice");
        let (id, b) = l.queue_withdrawal(&t, "utest1x", 1_000, 0).unwrap(); assert_eq!(b, 900);
        assert_eq!(l.due_withdrawals(0).len(), 1);
        l.finish_withdrawals(&[id], None); assert_eq!(l.balance(&t), Ok(1_900));
        assert!(l.due_withdrawals(0).is_empty());
    }
}
