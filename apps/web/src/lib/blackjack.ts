"use client";
import { bjValue } from "./cards";
import { getClient, toZat, ZAT } from "./server";
import type { useSeat } from "./house";

/** What the table shows. `dealer` has only the up-card until the hand is done (the server never sends the hole card early). */
export type PHand = { cards: number[]; stake: number; done: boolean };
/** `draws` (sent once the round is done) says where every shoe card went: hand index, -1 dealer, -2 = split marker. */
export type HandView = { nonce: number; player: number[]; dealer: number[]; done: boolean; payout: number; stake: number; message: string | null;
  hands: PHand[]; active: number; can_split: boolean; can_double: boolean; draws?: [number, number][] | null };
export type Action = "hit" | "stand" | "double" | "split";
export interface Dealer { deal(stake: number): Promise<HandView>; act(a: Action): Promise<HandView>; resume?(): Promise<HandView | null>; canSplit: boolean }

/** Same rules as crates/game-server/src/house.rs. */
function settle(player: number[], dealer: number[], draw: () => number, stake: number): [number, string] {
  const pv = bjValue(player).total;
  if (pv > 21) return [0, "Bust."];
  const nat = player.length === 2 && pv === 21, dbj = dealer.length === 2 && bjValue(dealer).total === 21;
  if (nat && !dbj) return [stake * 2.5, "Blackjack! Pays 3 to 2."];
  while (bjValue(dealer).total < 17) dealer.push(draw());
  const dv = bjValue(dealer).total;
  if (dbj && !nat) return [0, "Dealer has blackjack."];
  if (dv > 21) return [stake * 2, "Dealer busts. You win."];
  if (pv > dv) return [stake * 2, "You win."];
  if (pv === dv) return [stake, "Push."];
  return [0, "Dealer wins."];
}

export function localDealer(seat: ReturnType<typeof useSeat>): Dealer {
  let h: { nonce: number; shoe: number[]; pos: number; player: number[]; dealer: number[]; stake: number; done: boolean; payout: number; message: string | null; draws: [number, number][] } | null = null;
  const view = (): HandView => ({ nonce: h!.nonce, player: [...h!.player], dealer: h!.done ? [...h!.dealer] : [h!.dealer[0]], done: h!.done, payout: h!.payout, stake: h!.stake, message: h!.message,
    hands: [{ cards: [...h!.player], stake: h!.stake, done: h!.done }], active: 0, can_split: false, can_double: !h!.done && h!.player.length === 2, draws: h!.done ? rebuildDraws(h!.player, h!.dealer) : null });
  const draw = () => h!.shoe[h!.pos++];
  const finish = () => { const [p, m] = settle(h!.player, h!.dealer, draw, h!.stake); h!.done = true; h!.payout = p; h!.message = m; };
  return {
    canSplit: false,
    async deal(stake) {
      const { nonce, outcome } = await seat.bet<number[]>("blackjack", {});
      h = { nonce, shoe: outcome, pos: 0, player: [], dealer: [], stake, done: false, payout: 0, message: null, draws: [] };
      const [a, b, c, d] = [draw(), draw(), draw(), draw()]; h.player = [a, c]; h.dealer = [b, d];
      if (bjValue(h.player).total === 21) finish();
      return view();
    },
    async act(a) {
      if (!h || h.done) throw new Error("no active hand");
      if (a === "split") throw new Error("split needs the server table");
      if (a === "double") { h.stake *= 2; h.player.push(draw()); finish(); }
      else if (a === "hit") { h.player.push(draw()); if (bjValue(h.player).total > 21) finish(); }
      else finish();
      return view();
    },
  };
}

export async function remoteDealer(): Promise<Dealer | null> {
  const c = await getClient(); if (!c) return null;
  const conv = (m: Record<string, any>): HandView => ({ ...m.hand, payout: m.hand.payout / ZAT, stake: m.hand.stake / ZAT, message: m.hand.message ?? null,
    hands: (m.hand.hands ?? []).map((x: PHand) => ({ ...x, stake: x.stake / ZAT })) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    canSplit: true,
    deal: async stake => conv(await c.rpc({ t: "bj_deal", stake: toZat(stake) })),
    act: async a => conv(await c.rpc({ t: `bj_${a}` })),
    resume: async () => { const m = await c.rpc({ t: "bj_get" }); return m.hand ? conv(m) : null; },
  };
}

/** Single-hand draw log: P D P D, player draws, dealer draws. */
function rebuildDraws(p: number[], d: number[]): [number, number][] {
  return [[0, p[0]], [-1, d[0]], [0, p[1]], [-1, d[1]], ...p.slice(2).map(c => [0, c] as [number, number]), ...d.slice(2).map(c => [-1, c] as [number, number])];
}

/** What gets checked after the seed reveal: the server's draw log plus the final table it claims came from it. */
export type BjRecord = { draws: [number, number][]; hands: number[][]; dealer: number[] };
export const record = (v: HandView): BjRecord => ({ draws: v.draws ?? rebuildDraws(v.player, v.dealer), hands: v.hands.map(h => h.cards), dealer: v.dealer });

/** 1) every non-marker draw is the next card of the revealed shoe, in order; 2) replaying the targets (with the split
 * marker moving hand 0's second card to a new hand) gives exactly the final hands and dealer; 3) the dealer obeyed
 * "draw to 16, stand on all 17s" (only when some hand was still live). */
export function verifyRecord(shoe: number[], r: BjRecord): boolean {
  let pos = 0; const hands: number[][] = [[]]; const dealer: number[] = [];
  for (const [to, c] of r.draws) {
    if (to === -2) { if (hands.length !== 1 || hands[0].length !== 2) return false; hands.push([hands[0].pop()!]); continue; }
    if (shoe[pos++] !== c) return false;
    if (to === -1) dealer.push(c); else { if (!hands[to]) return false; hands[to].push(c); }
  }
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (hands.length !== r.hands.length || !hands.every((h, i) => same(h, r.hands[i])) || !same(dealer, r.dealer)) return false;
  const live = hands.some(h => bjValue(h).total <= 21) && !(hands.length === 1 && hands[0].length === 2 && bjValue(hands[0]).total === 21);
  const dv = (n: number) => bjValue(dealer.slice(0, n)).total;
  if (live) { for (let n = 2; n < dealer.length; n++) if (dv(n) >= 17) return false; return dv(dealer.length) >= 17 || dealer.length === 2 && dv(2) === 21; }
  return dealer.length === 2;
}
