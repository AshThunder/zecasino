"use client";
import { bjValue } from "./cards";
import { getClient, toZat, ZAT } from "./server";
import type { useSeat } from "./house";

/** What the table shows. `dealer` has only the up-card until the hand is done (the server never sends the hole card early). */
export type HandView = { nonce: number; player: number[]; dealer: number[]; done: boolean; payout: number; stake: number; message: string | null };
export interface Dealer { deal(stake: number): Promise<HandView>; act(a: "hit" | "stand" | "double"): Promise<HandView>; resume?(): Promise<HandView | null> }

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
  let h: { nonce: number; shoe: number[]; pos: number; player: number[]; dealer: number[]; stake: number; done: boolean; payout: number; message: string | null } | null = null;
  const view = (): HandView => ({ nonce: h!.nonce, player: [...h!.player], dealer: h!.done ? [...h!.dealer] : [h!.dealer[0]], done: h!.done, payout: h!.payout, stake: h!.stake, message: h!.message });
  const draw = () => h!.shoe[h!.pos++];
  const finish = () => { const [p, m] = settle(h!.player, h!.dealer, draw, h!.stake); h!.done = true; h!.payout = p; h!.message = m; };
  return {
    async deal(stake) {
      const { nonce, outcome } = await seat.bet<number[]>("blackjack", {});
      h = { nonce, shoe: outcome, pos: 0, player: [], dealer: [], stake, done: false, payout: 0, message: null };
      const [a, b, c, d] = [draw(), draw(), draw(), draw()]; h.player = [a, c]; h.dealer = [b, d];
      if (bjValue(h.player).total === 21) finish();
      return view();
    },
    async act(a) {
      if (!h || h.done) throw new Error("no active hand");
      if (a === "double") { h.stake *= 2; h.player.push(draw()); finish(); }
      else if (a === "hit") { h.player.push(draw()); if (bjValue(h.player).total > 21) finish(); }
      else finish();
      return view();
    },
  };
}

export async function remoteDealer(): Promise<Dealer | null> {
  const c = await getClient(); if (!c) return null;
  const conv = (m: Record<string, any>): HandView => ({ ...m.hand, payout: m.hand.payout / ZAT, stake: m.hand.stake / ZAT, message: m.hand.message ?? null }); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    deal: async stake => conv(await c.rpc({ t: "bj_deal", stake: toZat(stake) })),
    act: async a => conv(await c.rpc({ t: `bj_${a}` })),
    resume: async () => { const m = await c.rpc({ t: "bj_get" }); return m.hand ? conv(m) : null; },
  };
}

/** Order the shoe was consumed in: P D P D, player draws, dealer draws. Used to verify against the revealed shoe. */
export const drawOrder = (v: HandView) => [v.player[0], v.dealer[0], v.player[1], v.dealer[1], ...v.player.slice(2), ...v.dealer.slice(2)];
