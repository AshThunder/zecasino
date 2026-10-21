"use client";
/** Mental-poker crypto, compiled from crates/mental-poker to wasm. Secret keys never leave this tab. */
import init, * as w from "@/wasm/mp/zecasino_mental_poker.js";
let ready: Promise<unknown> | null = null;
export const loadMp = () => (ready ??= init());
export type Masked = { c1: string; c2: string };
export type Share = { d: string; proof: [string, string, string] };
export type Pk = { key: string; proof: [string, string] };
export const mp = {
  keygen: (): { sk: string; pk: Pk } => JSON.parse(w.mp_keygen()),
  jointKey: (pks: Pk[]) => w.mp_joint_key(JSON.stringify(pks)),
  shuffle: (deck: Masked[], joint: string): { deck: Masked[]; proof: unknown } => JSON.parse(w.mp_shuffle(JSON.stringify(deck), joint)),
  verifyShuffle: (i: Masked[], o: Masked[], joint: string, proof: unknown) => w.mp_verify_shuffle(JSON.stringify(i), JSON.stringify(o), joint, JSON.stringify(proof)),
  share: (sk: string, card: Masked): Share => JSON.parse(w.mp_share(sk, JSON.stringify(card))),
  verifyShare: (pk: Pk, card: Masked, s: Share) => w.mp_verify_share(JSON.stringify(pk), JSON.stringify(card), JSON.stringify(s)),
  unmask: (card: Masked, shares: Share[]) => w.mp_unmask(JSON.stringify(card), JSON.stringify(shares)),
};
