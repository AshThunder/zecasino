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
             INSERT OR IGNORE INTO house VALUES ('pnl', 0);",
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
    }
}
