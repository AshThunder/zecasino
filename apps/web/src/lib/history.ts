"use client";
/**
 * Private session history. Lives only in this browser (localStorage); nothing is sent to the server.
 * Every entry carries the material needed to re-run its fairness check offline.
 */
import { games, pvpCommit, unhex, verifySeed } from "./fair";
import { verifyBet, type Game } from "./house";
import { DEMO } from "./server";

export type Proof =
  | { kind: "house"; game: Game; commitment: string; clientSeed: string; nonce: number; outcome: unknown; serverSeed?: string }
  | { kind: "crash"; round: number; bust: number; commitment: string; clientSeed: string; serverSeed: string }
  | { kind: "commit"; commitment: string; salt: string; valueHex: string };
export type Entry = { id: string; at: number; game: string; summary: string; demo: boolean; proofs: Proof[] };

const KEY = () => (DEMO ? "zc.demo.history" : "zc.history");
const MAX = 300;
const EVT = "zc-history";

export function load(): Entry[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY()) ?? "[]") as Entry[]; } catch { return []; }
}
function save(list: Entry[]) {
  try { localStorage.setItem(KEY(), JSON.stringify(list.slice(0, MAX))); window.dispatchEvent(new Event(EVT)); } catch { /* storage full or disabled */ }
}
export function record(game: string, summary: string, proofs: Proof[]) {
  const e: Entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), game, summary, demo: DEMO, proofs };
  save([e, ...load()]);
}
/** A house seed was revealed: attach it to every stored bet made under its commitment. */
export function attachSeed(commitment: string, serverSeed: string) {
  let hit = false;
  const list = load().map(e => ({ ...e, proofs: e.proofs.map(p => p.kind === "house" && p.commitment === commitment && !p.serverSeed ? (hit = true, { ...p, serverSeed }) : p) }));
  if (hit) save(list);
}
export function clearAll() { try { localStorage.removeItem(KEY()); window.dispatchEvent(new Event(EVT)); } catch { /* */ } }
export function remove(id: string) { save(load().filter(e => e.id !== id)); }
export const onChange = (f: () => void) => { window.addEventListener(EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(EVT, f); window.removeEventListener("storage", f); }; };
export const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

/** true = verified, false = mismatch, null = proof not yet available (house seed still unrevealed). */
export async function verifyProof(p: Proof): Promise<boolean | null> {
  if (p.kind === "house") {
    if (!p.serverSeed) return null;
    const v = await verifyBet({ serverSeed: p.serverSeed, commitment: p.commitment, clientSeed: p.clientSeed, bets: 0 }, p.game, p.nonce);
    return v !== null && JSON.stringify(v) === JSON.stringify(p.outcome);
  }
  if (p.kind === "crash") return (await verifySeed(p.serverSeed, p.commitment)) && (await games.crash(unhex(p.serverSeed), p.clientSeed, p.round)) === p.bust;
  return (await pvpCommit(unhex(p.salt), unhex(p.valueHex))) === p.commitment;
}
export async function verifyEntry(e: Entry): Promise<boolean | null> {
  const r = await Promise.all(e.proofs.map(verifyProof));
  if (r.some(x => x === false)) return false;
  if (r.some(x => x === null)) return null;
  return true;
}
