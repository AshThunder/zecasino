"use client";
import { useEffect, useRef, useState } from "react";
import { LocalSeat, games, unhex, verifySeed } from "./fair";

export type Revealed = { serverSeed: string; commitment: string; clientSeed: string; bets: number };
export type Game = "dice" | "crash" | "roulette" | "blackjack";

/** One seeded seat at a house game. Uses the game server when NEXT_PUBLIC_GAME_WS is set, else an in-browser seat. */
export interface Seat {
  commitment: string; clientSeed: string; nonce: number;
  bet<T>(game: Game, params: Record<string, unknown>): Promise<{ nonce: number; outcome: T; settle?: unknown }>;
  rotate(newClientSeed: string): Promise<Revealed>;
}

export function useSeat(defaultClientSeed = "lagos-night-77") {
  const ref = useRef<Seat | null>(null);
  const [view, setView] = useState({ commitment: "…", clientSeed: defaultClientSeed, nonce: 0, remote: false });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { connectSeat } = await import("./server");
      const remote = await connectSeat(defaultClientSeed).catch(() => null);
      const seat: Seat = remote ?? (await localSeat(defaultClientSeed));
      if (!alive) return;
      ref.current = seat; setView({ commitment: seat.commitment, clientSeed: seat.clientSeed, nonce: seat.nonce, remote: !!remote });
    })();
    return () => { alive = false; };
  }, [defaultClientSeed]);
  const sync = () => { const s = ref.current; if (s) setView(v => ({ ...v, commitment: s.commitment, clientSeed: s.clientSeed, nonce: s.nonce })); };
  return {
    ...view, ready: view.commitment !== "…",
    async bet<T>(game: Game, params: Record<string, unknown> = {}) { const r = await ref.current!.bet<T>(game, params); sync(); return r; },
    async rotate(cs: string) { const r = await ref.current!.rotate(cs); sync(); return r; },
  };
}

async function localSeat(cs: string): Promise<Seat> {
  const s = await new LocalSeat(cs).init();
  return {
    get commitment() { return s.commitment; }, get clientSeed() { return s.clientSeed; }, get nonce() { return s.nonce; },
    async bet<T>(game: Game) {
      const n = s.next();
      const outcome = game === "blackjack" ? await games.shoe(s.seed, s.clientSeed, n) : await games[game](s.seed, s.clientSeed, n);
      return { nonce: n, outcome: outcome as T };
    },
    rotate: (c: string) => s.rotate(c),
  };
}

/** Recompute an outcome from a revealed seed. Returns null if the seed does not open the commitment. */
export async function verifyBet(r: Revealed, game: Game, nonce: number) {
  if (!(await verifySeed(r.serverSeed, r.commitment))) return null;
  const seed = unhex(r.serverSeed);
  return game === "blackjack" ? games.shoe(seed, r.clientSeed, nonce) : games[game](seed, r.clientSeed, nonce);
}
