//! Mental poker (Barnett–Smart style) on the Ristretto group.
//!
//! * Every party `i` holds a secret `x_i` and publishes `X_i = x_i·G` with a Schnorr proof.
//!   The deck is encrypted to the joint key `H = Σ X_i`, so **no single party, including the house,
//!   can read any card**.
//! * Card `j` is the point `M_j = hash_to_ristretto("zecasino:card:v1" ‖ j)`. A masked card is an
//!   ElGamal ciphertext `(c1, c2) = (r·G, M + r·H)`.
//! * Each party in turn permutes and re-randomises the whole deck and attaches a non-interactive
//!   cut-and-choose shuffle proof (soundness 2^-SHUFFLE_ROUNDS) that the output is a permutation
//!   of the input, without revealing the permutation.
//! * To open a card each party publishes `D_i = x_i·c1` with a Chaum–Pedersen proof that it used
//!   the same `x_i` as its public key. `M = c2 − Σ D_i`. Hole cards are opened privately: the
//!   other parties hand their shares to the owner only, who adds its own share locally.
use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT as G, ristretto::{CompressedRistretto, RistrettoPoint}, scalar::Scalar, traits::Identity};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};

#[cfg(feature = "wasm")]
pub mod wasm;

pub const DECK: usize = 52;
pub const SHUFFLE_ROUNDS: usize = 32;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("malformed point or scalar")] Malformed,
    #[error("proof does not verify")] BadProof,
    #[error("deck has the wrong size")] BadDeck,
    #[error("ciphertext does not open to a card")] NotACard,
}

// ---------- serialisation helpers: points and scalars travel as 32-byte hex ----------
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pt(#[serde(with = "hexpt")] pub RistrettoPoint);
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sc(#[serde(with = "hexsc")] pub Scalar);
mod hexpt {
    use super::*; use serde::{Deserializer, Serializer};
    pub fn serialize<S: Serializer>(p: &RistrettoPoint, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&hex::encode(p.compress().as_bytes())) }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<RistrettoPoint, D::Error> {
        let b: [u8; 32] = hex::decode(String::deserialize(d)?).map_err(serde::de::Error::custom)?.try_into().map_err(|_| serde::de::Error::custom("len"))?;
        CompressedRistretto(b).decompress().ok_or_else(|| serde::de::Error::custom("not a point"))
    }
}
mod hexsc {
    use super::*; use serde::{Deserializer, Serializer};
    pub fn serialize<S: Serializer>(x: &Scalar, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&hex::encode(x.as_bytes())) }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Scalar, D::Error> {
        let b: [u8; 32] = hex::decode(String::deserialize(d)?).map_err(serde::de::Error::custom)?.try_into().map_err(|_| serde::de::Error::custom("len"))?;
        Option::from(Scalar::from_canonical_bytes(b)).ok_or_else(|| serde::de::Error::custom("non-canonical scalar"))
    }
}

fn rand_scalar() -> Scalar { let mut b = [0u8; 64]; OsRng.fill_bytes(&mut b); Scalar::from_bytes_mod_order_wide(&b) }
fn challenge(label: &[u8], points: &[&RistrettoPoint]) -> Scalar {
    let mut h = Sha512::new(); h.update(b"zecasino:mp:v1:"); h.update(label);
    for p in points { h.update(p.compress().as_bytes()); }
    Scalar::from_hash(h)
}

pub fn card_point(j: usize) -> RistrettoPoint { RistrettoPoint::hash_from_bytes::<Sha512>(format!("zecasino:card:v1:{j}").as_bytes()) }

// ---------- keys ----------
pub struct SecretKey(Scalar);
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicKey { pub key: Pt, pub proof: (Pt, Sc) }

impl SecretKey {
    pub fn generate() -> Self { Self(rand_scalar()) }
    pub fn to_hex(&self) -> String { hex::encode(self.0.as_bytes()) }
    pub fn from_hex(s: &str) -> Result<Self, Error> {
        let b: [u8; 32] = hex::decode(s).map_err(|_| Error::Malformed)?.try_into().map_err(|_| Error::Malformed)?;
        Option::from(Scalar::from_canonical_bytes(b)).map(Self).ok_or(Error::Malformed)
    }
    /// Public key with a Schnorr proof of knowledge (blocks rogue-key attacks on the joint key).
    pub fn public(&self) -> PublicKey {
        let x = self.0 * G; let k = rand_scalar(); let a = k * G;
        let c = challenge(b"key", &[&x, &a]);
        PublicKey { key: Pt(x), proof: (Pt(a), Sc(k + c * self.0)) }
    }
}
impl PublicKey {
    pub fn verify(&self) -> Result<(), Error> {
        let c = challenge(b"key", &[&self.key.0, &self.proof.0 .0]);
        if self.proof.1 .0 * G == self.proof.0 .0 + c * self.key.0 { Ok(()) } else { Err(Error::BadProof) }
    }
}
/// Joint key; every public key must carry a valid proof.
pub fn joint_key(keys: &[PublicKey]) -> Result<RistrettoPoint, Error> {
    let mut h = RistrettoPoint::identity();
    for k in keys { k.verify()?; h += k.key.0; }
    Ok(h)
}

// ---------- masked cards ----------
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Masked { pub c1: Pt, pub c2: Pt }
impl Masked {
    fn reenc(&self, r: Scalar, h: &RistrettoPoint) -> Self { Masked { c1: Pt(self.c1.0 + r * G), c2: Pt(self.c2.0 + r * h) } }
}
/// The face-up starting deck (randomness 0); the first shuffle masks it.
pub fn open_deck() -> Vec<Masked> { (0..DECK).map(|j| Masked { c1: Pt(RistrettoPoint::identity()), c2: Pt(card_point(j)) }).collect() }

fn random_perm(n: usize) -> Vec<usize> {
    let mut p: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() { let j = (OsRng.next_u64() % (i as u64 + 1)) as usize; p.swap(i, j); }
    p
}
fn apply(deck: &[Masked], perm: &[usize], rs: &[Scalar], h: &RistrettoPoint) -> Vec<Masked> { perm.iter().zip(rs).map(|(&p, r)| deck[p].reenc(*r, h)).collect() }
fn is_perm(p: &[usize], n: usize) -> bool { let mut seen = vec![false; n]; p.len() == n && p.iter().all(|&i| i < n && !std::mem::replace(&mut seen[i], true)) }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Opening { pub perm: Vec<usize>, pub rand: Vec<Sc> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShuffleProof { pub decks: Vec<Vec<Masked>>, pub openings: Vec<Opening> }

fn shuffle_challenge(h: &RistrettoPoint, input: &[Masked], output: &[Masked], decks: &[Vec<Masked>]) -> Vec<bool> {
    let mut pts: Vec<&RistrettoPoint> = vec![h];
    for d in std::iter::once(input).chain(std::iter::once(output)).chain(decks.iter().map(|d| d.as_slice())) { for m in d { pts.push(&m.c1.0); pts.push(&m.c2.0); } }
    let c = challenge(b"shuffle", &pts);
    let bytes = c.as_bytes();
    (0..decks.len()).map(|t| (bytes[t / 8] >> (t % 8)) & 1 == 1).collect()
}

/// Permute and re-randomise `input` under joint key `h`, with a zero-knowledge proof.
pub fn shuffle(input: &[Masked], h: &RistrettoPoint) -> (Vec<Masked>, ShuffleProof) {
    let n = input.len();
    let pi = random_perm(n); let r: Vec<Scalar> = (0..n).map(|_| rand_scalar()).collect();
    let output = apply(input, &pi, &r, h);
    let mut decks = vec![]; let mut secrets = vec![];
    for _ in 0..SHUFFLE_ROUNDS {
        let pt = random_perm(n); let st: Vec<Scalar> = (0..n).map(|_| rand_scalar()).collect();
        decks.push(apply(input, &pt, &st, h)); secrets.push((pt, st));
    }
    let bits = shuffle_challenge(h, input, &output, &decks);
    let openings = secrets.into_iter().zip(bits).map(|((pt, st), b)| {
        if !b { Opening { perm: pt, rand: st.into_iter().map(Sc).collect() } } else {
            // Out[i] = In[pi[i]] + r_i  and  D[k] = In[pt[k]] + s_k  =>  Out[i] = D[sigma[i]] + (r_i - s_sigma[i])
            let mut inv = vec![0; n]; for (k, &p) in pt.iter().enumerate() { inv[p] = k; }
            let sigma: Vec<usize> = pi.iter().map(|&p| inv[p]).collect();
            let u = sigma.iter().enumerate().map(|(i, &k)| Sc(r[i] - st[k])).collect();
            Opening { perm: sigma, rand: u }
        }
    }).collect();
    (output, ShuffleProof { decks, openings })
}

pub fn verify_shuffle(input: &[Masked], output: &[Masked], h: &RistrettoPoint, proof: &ShuffleProof) -> Result<(), Error> {
    let n = input.len();
    if output.len() != n || proof.decks.len() != SHUFFLE_ROUNDS || proof.openings.len() != SHUFFLE_ROUNDS { return Err(Error::BadDeck); }
    let bits = shuffle_challenge(h, input, output, &proof.decks);
    for ((d, o), b) in proof.decks.iter().zip(&proof.openings).zip(bits) {
        if d.len() != n || o.rand.len() != n || !is_perm(&o.perm, n) { return Err(Error::BadProof); }
        let rs: Vec<Scalar> = o.rand.iter().map(|s| s.0).collect();
        let ok = if !b { apply(input, &o.perm, &rs, h) == *d } else { apply(d, &o.perm, &rs, h) == output };
        if !ok { return Err(Error::BadProof); }
    }
    Ok(())
}

// ---------- reveal ----------
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Share { pub d: Pt, pub proof: (Pt, Pt, Sc) }

impl SecretKey {
    /// `D = x·c1` with a Chaum–Pedersen proof that log_G(X) = log_c1(D).
    pub fn share(&self, card: &Masked) -> Share {
        let x = self.0 * G; let d = self.0 * card.c1.0;
        let k = rand_scalar(); let (a1, a2) = (k * G, k * card.c1.0);
        let c = challenge(b"share", &[&x, &card.c1.0, &d, &a1, &a2]);
        Share { d: Pt(d), proof: (Pt(a1), Pt(a2), Sc(k + c * self.0)) }
    }
}
pub fn verify_share(pk: &PublicKey, card: &Masked, s: &Share) -> Result<(), Error> {
    let (a1, a2, z) = (s.proof.0 .0, s.proof.1 .0, s.proof.2 .0);
    let c = challenge(b"share", &[&pk.key.0, &card.c1.0, &s.d.0, &a1, &a2]);
    if z * G == a1 + c * pk.key.0 && z * card.c1.0 == a2 + c * s.d.0 { Ok(()) } else { Err(Error::BadProof) }
}
/// Combines one verified share per party and returns the card index 0..52.
pub fn unmask(card: &Masked, shares: &[Share]) -> Result<usize, Error> {
    let m = shares.iter().fold(card.c2.0, |acc, s| acc - s.d.0);
    (0..DECK).find(|&j| card_point(j) == m).ok_or(Error::NotACard)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_party_shuffle_and_private_deal() {
        let sks: Vec<SecretKey> = (0..3).map(|_| SecretKey::generate()).collect();
        let pks: Vec<PublicKey> = sks.iter().map(|k| k.public()).collect();
        let h = joint_key(&pks).unwrap();
        let mut deck = open_deck();
        for _ in 0..3 { let (out, pf) = shuffle(&deck, &h); verify_shuffle(&deck, &out, &h, &pf).unwrap(); deck = out; }
        // Every card opens with all three shares, and the deck is still a permutation of 0..52.
        let mut seen: Vec<usize> = deck.iter().map(|c| {
            let shares: Vec<Share> = sks.iter().zip(&pks).map(|(k, pk)| { let s = k.share(c); verify_share(pk, c, &s).unwrap(); s }).collect();
            unmask(c, &shares).unwrap()
        }).collect();
        seen.sort(); assert_eq!(seen, (0..DECK).collect::<Vec<_>>());
        // Two of three shares do not open a card.
        let partial: Vec<Share> = sks[..2].iter().map(|k| k.share(&deck[0])).collect();
        assert_eq!(unmask(&deck[0], &partial), Err(Error::NotACard));
    }
    #[test]
    fn cheating_is_caught() {
        let sks: Vec<SecretKey> = (0..2).map(|_| SecretKey::generate()).collect();
        let pks: Vec<PublicKey> = sks.iter().map(|k| k.public()).collect();
        let h = joint_key(&pks).unwrap();
        let deck = open_deck();
        let (mut out, pf) = shuffle(&deck, &h);
        // swap in a duplicate ace: no longer a permutation
        out[5] = out[6];
        assert_eq!(verify_shuffle(&deck, &out, &h, &pf), Err(Error::BadProof));
        // wrong key for a share
        let s = sks[0].share(&deck[0]);
        assert_eq!(verify_share(&pks[1], &deck[0], &s), Err(Error::BadProof));
        // rogue public key without a valid proof
        let mut bad = pks[0].clone(); bad.key = Pt(bad.key.0 + G);
        assert_eq!(joint_key(&[bad, pks[1].clone()]), Err(Error::BadProof));
    }
    #[test]
    fn serde_roundtrip() {
        let k = SecretKey::generate(); let pk = k.public();
        let j = serde_json::to_string(&pk).unwrap(); let back: PublicKey = serde_json::from_str(&j).unwrap();
        assert_eq!(pk, back); back.verify().unwrap();
        assert_eq!(SecretKey::from_hex(&k.to_hex()).unwrap().public().key, pk.key);
    }
}
