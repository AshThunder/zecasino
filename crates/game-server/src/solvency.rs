//! Proof of liabilities: a Merkle-sum tree over every positive session balance.
//! Leaf = H("zecasino:liab:leaf:v1" ‖ salt ‖ u64be balance); salt is fresh random per snapshot and
//! only ever handed to the session that owns the leaf, so the tree carries no identifiers and leaves
//! cannot be linked across snapshots. Leaves are sorted by hash so position says nothing either.
//! Node = H("zecasino:liab:node:v1" ‖ L.hash ‖ u64be L.sum ‖ R.hash ‖ u64be R.sum), sum = L.sum + R.sum.
//! Sums are unsigned, so the house cannot hide a liability behind a negative leaf.
use std::collections::HashMap;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};

pub const REBUILD_SECS: u64 = 60;

#[derive(Clone, Copy, Serialize)]
pub struct Node { #[serde(with = "hex::serde")] pub hash: [u8; 32], pub sum: u64 }

pub fn leaf(salt: &[u8; 32], bal: u64) -> Node {
    let mut h = Sha256::new(); h.update(b"zecasino:liab:leaf:v1"); h.update(salt); h.update(bal.to_be_bytes());
    Node { hash: h.finalize().into(), sum: bal }
}
pub fn parent(l: &Node, r: &Node) -> Node {
    let mut h = Sha256::new(); h.update(b"zecasino:liab:node:v1");
    h.update(l.hash); h.update(l.sum.to_be_bytes()); h.update(r.hash); h.update(r.sum.to_be_bytes());
    Node { hash: h.finalize().into(), sum: l.sum.checked_add(r.sum).expect("liabilities overflow") }
}
const PAD: Node = Node { hash: [0; 32], sum: 0 };

pub struct Snapshot {
    pub epoch: u64, pub built_at: u64,
    levels: Vec<Vec<Node>>,
    index: HashMap<String, (usize, [u8; 32], u64)>,
}

#[derive(Serialize)]
pub struct Step { pub side: &'static str, pub node: Node }

impl Snapshot {
    pub fn build(epoch: u64, built_at: u64, balances: &[(String, u64)]) -> Self {
        let mut leaves: Vec<(String, [u8; 32], u64, Node)> = balances.iter().filter(|(_, b)| *b > 0).map(|(id, b)| {
            let mut s = [0u8; 32]; rand::rngs::OsRng.fill_bytes(&mut s); (id.clone(), s, *b, leaf(&s, *b))
        }).collect();
        leaves.sort_by(|a, b| a.3.hash.cmp(&b.3.hash));
        let index = leaves.iter().enumerate().map(|(i, (id, s, b, _))| (id.clone(), (i, *s, *b))).collect();
        let mut levels = vec![leaves.into_iter().map(|l| l.3).collect::<Vec<_>>()];
        if levels[0].is_empty() { levels[0].push(PAD); }
        while levels.last().unwrap().len() > 1 {
            let cur = levels.last().unwrap();
            let next = cur.chunks(2).map(|c| parent(&c[0], c.get(1).unwrap_or(&PAD))).collect();
            levels.push(next);
        }
        Self { epoch, built_at, levels, index }
    }
    pub fn root(&self) -> Node { self.levels.last().unwrap()[0] }
    pub fn leaves(&self) -> usize { self.index.len() }
    pub fn depth(&self) -> usize { self.levels.len() - 1 }
    /// Inclusion proof for one session: (salt, balance, path from leaf to root).
    pub fn proof(&self, session: &str) -> Option<([u8; 32], u64, Vec<Step>)> {
        let &(mut i, salt, bal) = self.index.get(session)?;
        let mut path = vec![];
        for lvl in &self.levels[..self.levels.len() - 1] {
            let sib = i ^ 1;
            path.push(Step { side: if sib < i { "left" } else { "right" }, node: *lvl.get(sib).unwrap_or(&PAD) });
            i /= 2;
        }
        Some((salt, bal, path))
    }
}

pub fn verify(salt: &[u8; 32], bal: u64, path: &[Step], root: &Node) -> bool {
    let mut n = leaf(salt, bal);
    for s in path { n = if s.side == "left" { parent(&s.node, &n) } else { parent(&n, &s.node) }; }
    n.hash == root.hash && n.sum == root.sum
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_and_proofs() {
        for n in [1usize, 2, 3, 7, 8, 33] {
            let bals: Vec<(String, u64)> = (0..n).map(|i| (format!("s{i}"), (i as u64 + 1) * 1000)).chain([("zero".to_string(), 0)]).collect();
            let s = Snapshot::build(1, 0, &bals);
            assert_eq!(s.root().sum, bals.iter().map(|b| b.1).sum::<u64>());
            assert!(s.proof("zero").is_none());
            for (id, _) in bals.iter().filter(|b| b.1 > 0) {
                let (salt, bal, path) = s.proof(id).unwrap();
                assert!(verify(&salt, bal, &path, &s.root()));
                assert!(!verify(&salt, bal - 1, &path, &s.root()), "understated balance must fail");
            }
        }
    }
}
