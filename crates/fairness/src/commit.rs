//! Salted, domain-separated hash commitments for PvP hidden information.
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Commitment(pub String);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Opening { pub value: Vec<u8>, pub salt: String }

fn digest(value: &[u8], salt: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b"zecasino:commit:v1");
    h.update((salt.len() as u32).to_be_bytes());
    h.update(salt);
    h.update(value);
    hex::encode(h.finalize())
}

pub fn commit(value: &[u8]) -> (Commitment, Opening) {
    let mut salt = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    (Commitment(digest(value, &salt)), Opening { value: value.to_vec(), salt: hex::encode(salt) })
}

pub fn verify(c: &Commitment, o: &Opening) -> bool {
    hex::decode(&o.salt).map(|s| digest(&o.value, &s) == c.0).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opens_and_binds() {
        let (c, o) = commit(b"carrot-in-box-1");
        assert!(verify(&c, &o));
        let mut bad = o.clone(); bad.value = b"carrot-in-box-0".to_vec();
        assert!(!verify(&c, &bad));
        let (c2, _) = commit(b"carrot-in-box-1");
        assert_ne!(c, c2, "salt hides equal values");
    }
}
