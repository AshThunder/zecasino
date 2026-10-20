//! Zecasino provably-fair engine.
//!
//! House games: before any bet the server publishes `commitment = SHA256(server_seed)`.
//! Every outcome is derived from `HMAC-SHA256(server_seed, "{client_seed}:{nonce}:{cursor}")`.
//! When the player rotates seeds the old `server_seed` is revealed, and anyone can recompute
//! every result with [`verify`]-style functions. The player controls `client_seed`, so the
//! house cannot pre-pick outcomes; the house commits first, so the player cannot either.
//!
//! PvP games (Carrot in a Box, Liar's Dice) use [`commit::Commitment`]: a salted, domain
//! separated hash that hides a value until it is opened.

pub mod commit;
pub mod games;

use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FairnessError {
    #[error("server seed does not match commitment")]
    CommitmentMismatch,
    #[error("invalid hex")]
    BadHex,
    #[error("client seed must be 1..=64 printable characters")]
    BadClientSeed,
}

/// SHA-256 commitment to a server seed, hex encoded.
pub fn commit_server_seed(seed: &[u8; 32]) -> String {
    hex::encode(Sha256::digest(seed))
}

/// Checks that a revealed seed opens a published commitment.
pub fn verify_server_seed(seed_hex: &str, commitment_hex: &str) -> Result<[u8; 32], FairnessError> {
    let bytes = hex::decode(seed_hex).map_err(|_| FairnessError::BadHex)?;
    let seed: [u8; 32] = bytes.try_into().map_err(|_| FairnessError::BadHex)?;
    if commit_server_seed(&seed) == commitment_hex.to_ascii_lowercase() {
        Ok(seed)
    } else {
        Err(FairnessError::CommitmentMismatch)
    }
}

pub fn validate_client_seed(s: &str) -> Result<(), FairnessError> {
    if s.is_empty() || s.len() > 64 || !s.chars().all(|c| c.is_ascii_graphic()) {
        return Err(FairnessError::BadClientSeed);
    }
    Ok(())
}

/// Deterministic byte stream for one bet: (server_seed, client_seed, nonce).
#[derive(Clone)]
pub struct OutcomeStream {
    server_seed: [u8; 32],
    client_seed: String,
    nonce: u64,
    cursor: u64,
    buf: [u8; 32],
    pos: usize,
}

impl OutcomeStream {
    pub fn new(server_seed: [u8; 32], client_seed: &str, nonce: u64) -> Self {
        let mut s = Self {
            server_seed,
            client_seed: client_seed.to_owned(),
            nonce,
            cursor: 0,
            buf: [0; 32],
            pos: 32,
        };
        s.refill();
        s
    }

    fn refill(&mut self) {
        let mut mac = HmacSha256::new_from_slice(&self.server_seed).expect("any key length");
        mac.update(format!("{}:{}:{}", self.client_seed, self.nonce, self.cursor).as_bytes());
        self.buf.copy_from_slice(&mac.finalize().into_bytes());
        self.cursor += 1;
        self.pos = 0;
    }

    pub fn next_u8(&mut self) -> u8 {
        if self.pos == 32 {
            self.refill();
        }
        let b = self.buf[self.pos];
        self.pos += 1;
        b
    }

    pub fn next_u32(&mut self) -> u32 {
        u32::from_be_bytes([self.next_u8(), self.next_u8(), self.next_u8(), self.next_u8()])
    }

    /// Uniform float in [0, 1) from 4 bytes (same construction as common verifiers).
    pub fn next_f64(&mut self) -> f64 {
        let mut f = 0.0;
        let mut div = 1.0;
        for _ in 0..4 {
            div *= 256.0;
            f += self.next_u8() as f64 / div;
        }
        f
    }

    /// Unbiased integer in [0, n) via rejection sampling on u32.
    pub fn next_below(&mut self, n: u32) -> u32 {
        assert!(n > 0);
        let zone = u32::MAX - (u32::MAX % n);
        loop {
            let v = self.next_u32();
            if v < zone {
                return v % n;
            }
        }
    }
}

/// Active seed pair for a player session.
#[derive(Clone, Serialize, Deserialize)]
pub struct SeedPair {
    #[serde(with = "hex_seed")]
    server_seed: [u8; 32],
    pub commitment: String,
    pub client_seed: String,
    pub nonce: u64,
}

impl std::fmt::Debug for SeedPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SeedPair")
            .field("commitment", &self.commitment)
            .field("client_seed", &self.client_seed)
            .field("nonce", &self.nonce)
            .finish_non_exhaustive()
    }
}

/// What the house publishes after rotating: enough to verify every past bet.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevealedSeed {
    pub server_seed: String,
    pub commitment: String,
    pub client_seed: String,
    pub bets: u64,
}

impl SeedPair {
    pub fn generate(client_seed: &str) -> Result<Self, FairnessError> {
        validate_client_seed(client_seed)?;
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        Ok(Self::from_seed(seed, client_seed))
    }

    pub fn from_seed(server_seed: [u8; 32], client_seed: &str) -> Self {
        Self {
            commitment: commit_server_seed(&server_seed),
            server_seed,
            client_seed: client_seed.to_owned(),
            nonce: 0,
        }
    }

    /// Stream for the next bet; increments the nonce.
    pub fn next_bet(&mut self) -> (u64, OutcomeStream) {
        let n = self.nonce;
        self.nonce += 1;
        (n, OutcomeStream::new(self.server_seed, &self.client_seed, n))
    }

    pub fn set_client_seed(&mut self, client_seed: &str) -> Result<(), FairnessError> {
        validate_client_seed(client_seed)?;
        self.client_seed = client_seed.to_owned();
        Ok(())
    }

    /// Reveal the current seed and replace it with a fresh committed one.
    pub fn rotate(&mut self, new_client_seed: &str) -> Result<RevealedSeed, FairnessError> {
        let next = SeedPair::generate(new_client_seed)?;
        let old = std::mem::replace(self, next);
        Ok(RevealedSeed {
            server_seed: hex::encode(old.server_seed),
            commitment: old.commitment,
            client_seed: old.client_seed,
            bets: old.nonce,
        })
    }
}

mod hex_seed {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(v))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s = String::deserialize(d)?;
        let v = hex::decode(s).map_err(serde::de::Error::custom)?;
        v.try_into().map_err(|_| serde::de::Error::custom("seed must be 32 bytes"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commitment_roundtrip_and_mismatch() {
        let seed = [7u8; 32];
        let c = commit_server_seed(&seed);
        assert_eq!(verify_server_seed(&hex::encode(seed), &c).unwrap(), seed);
        assert_eq!(
            verify_server_seed(&hex::encode([8u8; 32]), &c),
            Err(FairnessError::CommitmentMismatch)
        );
        assert_eq!(verify_server_seed("zz", &c), Err(FairnessError::BadHex));
    }

    #[test]
    fn stream_is_deterministic_and_sensitive() {
        let a: Vec<u8> = { let mut s = OutcomeStream::new([1; 32], "lucky", 0); (0..100).map(|_| s.next_u8()).collect() };
        let b: Vec<u8> = { let mut s = OutcomeStream::new([1; 32], "lucky", 0); (0..100).map(|_| s.next_u8()).collect() };
        let c: Vec<u8> = { let mut s = OutcomeStream::new([1; 32], "lucky", 1); (0..100).map(|_| s.next_u8()).collect() };
        let d: Vec<u8> = { let mut s = OutcomeStream::new([1; 32], "lucky2", 0); (0..100).map(|_| s.next_u8()).collect() };
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, d);
    }

    #[test]
    fn known_vector_first_block_is_hmac() {
        // First 32 bytes must equal HMAC-SHA256(seed, "client:0:0") so external verifiers agree.
        let mut mac = HmacSha256::new_from_slice(&[0u8; 32]).unwrap();
        mac.update(b"client:0:0");
        let expected = mac.finalize().into_bytes();
        let mut s = OutcomeStream::new([0u8; 32], "client", 0);
        let got: Vec<u8> = (0..32).map(|_| s.next_u8()).collect();
        assert_eq!(&got[..], &expected[..]);
    }

    #[test]
    fn floats_in_range_and_roughly_uniform() {
        let mut s = OutcomeStream::new([9; 32], "x", 0);
        let mut buckets = [0u32; 10];
        for _ in 0..50_000 {
            let f = s.next_f64();
            assert!((0.0..1.0).contains(&f));
            buckets[(f * 10.0) as usize] += 1;
        }
        for b in buckets {
            assert!((4_500..5_500).contains(&b), "bucket {b}");
        }
    }

    #[test]
    fn next_below_bounds() {
        let mut s = OutcomeStream::new([3; 32], "x", 0);
        for n in [1u32, 2, 6, 37, 312] {
            for _ in 0..1000 {
                assert!(s.next_below(n) < n);
            }
        }
    }

    #[test]
    fn seed_pair_rotation_reveals_verifiable_seed() {
        let mut p = SeedPair::generate("player-seed").unwrap();
        let commitment = p.commitment.clone();
        let (n0, _) = p.next_bet();
        let (n1, _) = p.next_bet();
        assert_eq!((n0, n1), (0, 1));
        let revealed = p.rotate("next").unwrap();
        assert_eq!(revealed.commitment, commitment);
        assert_eq!(revealed.bets, 2);
        verify_server_seed(&revealed.server_seed, &revealed.commitment).unwrap();
        assert_ne!(p.commitment, commitment);
        assert_eq!(p.nonce, 0);
    }

    #[test]
    fn debug_never_prints_server_seed() {
        let p = SeedPair::from_seed([0xab; 32], "c");
        assert!(!format!("{p:?}").contains(&hex::encode([0xab; 32])));
    }

    #[test]
    fn client_seed_validation() {
        assert!(validate_client_seed("").is_err());
        assert!(validate_client_seed("has space").is_err());
        assert!(validate_client_seed(&"a".repeat(65)).is_err());
        assert!(validate_client_seed("ok-seed_42").is_ok());
    }
}
